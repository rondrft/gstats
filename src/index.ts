/**
 * Worker entry point and router.
 *
 * Three routes, no framework. The rule worth stating up front is that `/api` is
 * consumed by an `<img>` tag inside somebody's README, where an error status
 * renders as a broken image and a JSON body renders as nothing at all. So every
 * failure is drawn rather than signalled, and answered 200.
 *
 * There is exactly one exception, and it is deliberate: a caller over their own
 * rate limit gets 429 with `Retry-After`. That response is addressed to whoever
 * is generating the traffic, not to a reader — and its body is a drawn card all
 * the same, because an empty body or a JSON one would tell a reader nothing.
 *
 * The limits cover `/api` alone. `/health` and the landing page are cheap and
 * are what somebody diagnosing a throttled instance will reach for; `/purge`
 * carries its own per-token brake and is called by its owner's CI, which an
 * address-based limit would throttle for no benefit.
 */

import { brandAsset } from './brand'
import { DEFAULT_DAILY_WRITE_BUDGET, readWriteBudget } from './budget'
import { KvRateLimitStore, KvStatsCache } from './cache'
import { GitHubClient, StaticTokenProvider } from './github/client'
import { StatsError } from './github/types'
import { landingPage } from './landing'
import { LIMITS, parseParams, type StyleParams } from './params'
import { handlePurge, KvPurgeLimiter } from './purge'
import {
  checkRateLimits,
  DEFAULT_PROFILES_PER_HOUR,
  DEFAULT_REQUESTS_PER_MINUTE,
  RATE_LIMIT_TOKENS_PER_MINUTE,
  type RateLimitDecision,
  resolveLimit,
} from './ratelimit'
import { renderCard } from './render/cards'
import { ERROR_CACHE_SECONDS, type ErrorCardKind, renderErrorCard } from './render/error-card'
import { type CacheStatus, getStats } from './stats'
import { KvWarmStore, parseWarmUsers, warmUsers } from './warm'

export interface Env {
  STATS_CACHE: KVNamespace
  /** Set with `wrangler secret put GITHUB_TOKEN`. */
  GITHUB_TOKEN?: string
  /**
   * Identifier of the running build. Deploys pass the commit it was built from;
   * `wrangler dev` falls back to the placeholder in `wrangler.toml`. It labels
   * the instance at `/health` and namespaces the cache, so a release starts from
   * a clean one.
   */
  SERVICE_VERSION?: string
  /**
   * Shared secret for `POST /purge`. Set with `wrangler secret put PURGE_TOKEN`.
   * Absent means purging is switched off on this instance.
   */
  PURGE_TOKEN?: string
  /**
   * Instance default for the card's `max-age`, in seconds. A plain variable
   * rather than a constant so it can be raised on a busy instance with
   * `wrangler deploy --var CARD_MAX_AGE:3600`, no code change involved.
   */
  CARD_MAX_AGE?: string
  /**
   * Comma-separated logins to keep warm on a timer, at most `MAX_WARM_USERS`.
   * Absent means the scheduled handler does nothing at all.
   */
  WARM_USERS?: string
  /**
   * Cloudflare's Rate Limiting binding, declared under `[[ratelimits]]` in
   * `wrangler.toml`. Optional so that the Worker still starts on an instance
   * that has not declared it — `/health` reports `rateLimiting: "disabled"`
   * rather than letting the absence of protection pass unnoticed.
   */
  API_RATE_LIMITER?: RateLimit
  /**
   * Requests per minute per address on `/api`. Capped by the token budget the
   * binding is declared with; see `src/ratelimit.ts`.
   */
  API_RATE_LIMIT?: string
  /** Distinct logins per hour per address on `/api`. */
  PROFILE_RATE_LIMIT?: string
  /**
   * Daily KV write allowance this instance is being measured against. The
   * default is Cloudflare's free plan; a paid one is a thousand times larger
   * and reporting 0% for ever would make `/health` useless rather than calm.
   */
  KV_WRITE_BUDGET?: string
  /**
   * Which deploy target this is: `primary`, or `legacy` for the old hostname.
   *
   * The service runs as two Workers sharing one KV namespace, and they share
   * cache entries only while they carry the same `SERVICE_VERSION` — it is part
   * of the key. A deploy updates them one after the other, so there is a window
   * in which they disagree and each pays its own misses out of one write budget.
   * Until this existed, `/health` answered identically on both hostnames and
   * there was no way to see that window at all.
   */
  DEPLOY_TARGET?: string
}

/** Used when nothing set a version, which in practice means local development. */
const UNKNOWN_VERSION = 'dev'

const SVG_CONTENT_TYPE = 'image/svg+xml; charset=utf-8'

/**
 * How long a client may keep serving the previous card while it revalidates.
 * Camo and browsers both honour this, so a card update is never blocking.
 */
const STALE_WHILE_REVALIDATE = 86_400

/**
 * Default `max-age`, overridable per instance by `CARD_MAX_AGE`.
 *
 * Short on purpose, and it does not cost GitHub quota: a revalidation arriving
 * here is answered from KV, which stays fresh for hours. What it costs is
 * Worker invocations, and those are what the floor in `LIMITS.maxAge` protects.
 */
const DEFAULT_MAX_AGE = 1800

function resolveMaxAge(env: Env, override: number | null): number {
  if (override !== null) return override
  const configured = Number.parseInt(env.CARD_MAX_AGE ?? '', 10)
  if (!Number.isFinite(configured)) return DEFAULT_MAX_AGE
  return Math.min(LIMITS.maxAge.max, Math.max(LIMITS.maxAge.min, configured))
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Purging is the one thing here that changes state, so it is the one thing
    // that is not a GET.
    if (url.pathname === '/purge') {
      if (request.method !== 'POST') {
        return json({ error: 'use POST' }, 405, { allow: 'POST' })
      }
      return purge(request, url, env)
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } })
    }

    switch (url.pathname) {
      case '/':
        return html(landingPage(url.origin))
      case '/api':
        return handleCard(request, url, env)
      case '/health':
        return handleHealth(env)
      default: {
        // Icons, which are constants rather than anything derived from a
        // request. Checked before the 404 rather than listed as cases so that
        // adding one to `src/brand.ts` does not also mean editing the router.
        const brand = brandAsset(url.pathname)
        return brand ?? new Response('not found', { status: 404 })
      }
    }
  },
  /**
   * Cron trigger. Does nothing unless `WARM_USERS` is set, so an instance that
   * did not ask for warming pays one no-op invocation per interval and nothing
   * else — no fetches, no writes.
   */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(warm(env))
  },
} satisfies ExportedHandler<Env>

async function warm(env: Env): Promise<void> {
  if (env.GITHUB_TOKEN === undefined || env.GITHUB_TOKEN.length === 0) return

  const run = await warmUsers(env.WARM_USERS, {
    client: new GitHubClient(new StaticTokenProvider(env.GITHUB_TOKEN)),
    cache: new KvStatsCache(env.STATS_CACHE),
    rateLimits: new KvRateLimitStore(env.STATS_CACHE),
    now: Date.now(),
    build: env.SERVICE_VERSION ?? UNKNOWN_VERSION,
  })

  if (run !== null) await new KvWarmStore(env.STATS_CACHE).write(run)
}

async function handleCard(request: Request, url: URL, env: Env): Promise<Response> {
  const parsed = parseParams(url.searchParams)
  const style = parsed.ok ? parsed.params.style : parsed.style

  // Before anything is fetched or read, and for cache hits as much as misses.
  // A hit costs an invocation and the limit protects those too — and a limit
  // that only applied to misses would be trivially avoided by asking for a
  // popular profile in a loop.
  const decision = await checkRateLimits({
    limiter: env.API_RATE_LIMITER,
    ip: request.headers.get('cf-connecting-ip'),
    username: parsed.ok ? parsed.params.username : null,
    requestsPerMinute: resolveLimit(
      env.API_RATE_LIMIT,
      DEFAULT_REQUESTS_PER_MINUTE,
      RATE_LIMIT_TOKENS_PER_MINUTE,
    ),
    profilesPerHour: resolveLimit(
      env.PROFILE_RATE_LIMIT,
      DEFAULT_PROFILES_PER_HOUR,
      Number.MAX_SAFE_INTEGER,
    ),
    now: Date.now(),
  })

  if (!decision.allowed) return tooManyRequests(decision, style)

  if (!parsed.ok) {
    const kind: ErrorCardKind =
      parsed.reason === 'missing-username' ? 'missing-username' : 'not-found'
    return errorCard(kind, parsed.style)
  }

  if (env.GITHUB_TOKEN === undefined || env.GITHUB_TOKEN.length === 0) {
    return errorCard('not-configured', parsed.params.style)
  }

  const client = new GitHubClient(new StaticTokenProvider(env.GITHUB_TOKEN))

  try {
    const { data, status } = await getStats(
      {
        client,
        cache: new KvStatsCache(env.STATS_CACHE),
        rateLimits: new KvRateLimitStore(env.STATS_CACHE),
        now: Date.now(),
        build: env.SERVICE_VERSION ?? UNKNOWN_VERSION,
      },
      parsed.params,
    )

    return new Response(renderCard(data, parsed.params), {
      headers: cardHeaders(status, resolveMaxAge(env, parsed.params.maxAgeOverride)),
    })
  } catch (error) {
    const failure = error instanceof StatsError ? error : new StatsError('upstream', String(error))
    return errorCard(failure.kind, parsed.params.style, failure.retryAfterMinutes)
  }
}

/**
 * How long a client may hold a card served from an expired entry.
 *
 * Short, because the figures are known to be behind and whatever broke upstream
 * is usually over in minutes. Deliberately without `stale-while-revalidate`:
 * that would let Camo keep showing the stale card past even this, which is the
 * opposite of what is wanted while the service is trying to recover.
 */
const STALE_MAX_AGE = 600

/**
 * A card served from an expired entry is still a correct card, a few hours
 * behind, and it is always the right answer over an error card. `X-Stale` is
 * what makes that visible to anyone debugging, since the body looks normal.
 */
function cardHeaders(status: CacheStatus, maxAge: number): Record<string, string> {
  const base = { 'content-type': SVG_CONTENT_TYPE, 'x-cache': status }
  if (status === 'STALE') {
    return { ...base, 'cache-control': `public, max-age=${STALE_MAX_AGE}`, 'x-stale': 'true' }
  }
  return {
    ...base,
    'cache-control': `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=${STALE_WHILE_REVALIDATE}`,
  }
}

/**
 * Targeted invalidation, so that propagation does not have to be bought by
 * shortening the cache for everybody. Answers JSON: this endpoint is called by
 * scripts, and a script cannot read an SVG.
 */
async function purge(request: Request, url: URL, env: Env): Promise<Response> {
  const outcome = await handlePurge({
    authorization: request.headers.get('authorization'),
    username: url.searchParams.get('username'),
    secret: env.PURGE_TOKEN,
    cache: new KvStatsCache(env.STATS_CACHE),
    limiter: new KvPurgeLimiter(env.STATS_CACHE, Date.now()),
    build: env.SERVICE_VERSION ?? UNKNOWN_VERSION,
  })

  return json(outcome.body, outcome.status)
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } })
}

/**
 * Error cards get a one minute lifetime instead of the two hours a real card
 * gets. A rate limit or an upstream blip resolves itself; caching the symptom
 * for hours would outlive the cause by a wide margin.
 */
function errorCard(
  kind: ErrorCardKind,
  style: StyleParams,
  retryAfterMinutes: number | null = null,
): Response {
  return new Response(renderErrorCard({ kind, style, retryAfterMinutes }), {
    headers: {
      'content-type': SVG_CONTENT_TYPE,
      'cache-control': `public, max-age=${ERROR_CACHE_SECONDS}`,
      'x-cache': 'MISS',
    },
  })
}

/**
 * The one refusal on `/api`, and the only non-200 it can produce.
 *
 * `429` and `Retry-After` are what a caller hammering the endpoint needs, and a
 * README reader is not the audience — but the body is still a drawn card rather
 * than JSON or nothing, because whoever eventually looks at it will be looking
 * at an `<img>`. `no-store` keeps any intermediary from pinning the refusal to a
 * URL that will be fine again in a minute.
 */
function tooManyRequests(
  decision: Extract<RateLimitDecision, { allowed: false }>,
  style: StyleParams,
): Response {
  const minutes = Math.max(1, Math.ceil(decision.retryAfterSeconds / 60))

  return new Response(
    renderErrorCard({ kind: 'too-many-requests', style, retryAfterMinutes: minutes }),
    {
      status: 429,
      headers: {
        'content-type': SVG_CONTENT_TYPE,
        'retry-after': String(decision.retryAfterSeconds),
        'cache-control': 'no-store',
        'x-cache': 'MISS',
        // Which of the two limits was hit. A caller who has tripped the login
        // budget is doing something different from one sending too fast, and
        // the fix is different too.
        'x-rate-limit': decision.reason,
      },
    },
  )
}

/**
 * Liveness, the one number that predicts whether this instance is about to
 * start serving stale cards, and the one that predicts the worse failure
 * underneath it.
 */
async function handleHealth(env: Env): Promise<Response> {
  const writeLimit = resolveLimit(
    env.KV_WRITE_BUDGET,
    DEFAULT_DAILY_WRITE_BUDGET,
    Number.MAX_SAFE_INTEGER,
  )

  const [rateLimits, lastWarm, writes] = await Promise.all([
    new KvRateLimitStore(env.STATS_CACHE).read(),
    new KvWarmStore(env.STATS_CACHE).read(),
    readWriteBudget(env.STATS_CACHE, writeLimit),
  ])

  const configured = parseWarmUsers(env.WARM_USERS)

  return Response.json(
    {
      // The write budget is the only thing that moves this off `ok`. Running
      // out of it is what starts the cascade in docs/limits.md, and by the time
      // the symptoms are visible the cause is hours old.
      status: writes.warning ? 'warning' : 'ok',
      version: env.SERVICE_VERSION ?? UNKNOWN_VERSION,
      // Which of the two Workers answered. Both serve the same code from the
      // same cache, so without this their `/health` bodies are indistinguishable
      // and "are they on the same build?" cannot be asked. See
      // docs/decisions.md on the divergence window after a deploy.
      target: env.DEPLOY_TARGET ?? 'primary',
      tokenConfigured: env.GITHUB_TOKEN !== undefined && env.GITHUB_TOKEN.length > 0,
      purgeEnabled: env.PURGE_TOKEN !== undefined && env.PURGE_TOKEN.length > 0,
      // An instance with no binding declared serves every request unthrottled.
      // That is a legitimate way to run a private one, and an illegitimate way
      // to run a public one, so it is stated rather than left to be inferred.
      rateLimiting: env.API_RATE_LIMITER === undefined ? 'disabled' : 'enforced',
      rateLimit: rateLimits ?? null,
      // How much of today's KV write allowance has gone. See docs/limits.md for
      // why this is the ceiling that matters and not the GitHub quota above it.
      writes: { used: writes.used, limit: writes.limit, percent: writes.percent },
      // A cron that has stopped firing looks identical to one that is working
      // until somebody checks when it last did. Reporting the timestamp and the
      // outcome is what makes that visible without reading logs.
      warming: {
        configured: configured.users,
        ignored: configured.skipped,
        lastRun: lastWarm,
      },
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}

function html(body: string): Response {
  return new Response(body, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  })
}
