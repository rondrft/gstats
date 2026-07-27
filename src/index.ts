/**
 * Worker entry point and router.
 *
 * Three routes, no framework. The only rule worth stating up front is that
 * `/api` never returns a status other than 200: it is consumed by an `<img>`
 * tag inside somebody's README, where an error status renders as a broken image
 * and a JSON body renders as nothing at all. Failures are drawn, not signalled.
 */

import { KvRateLimitStore, KvStatsCache } from './cache'
import { GitHubClient, StaticTokenProvider } from './github/client'
import { StatsError } from './github/types'
import { landingPage } from './landing'
import { LIMITS, parseParams, type StyleParams } from './params'
import { handlePurge, KvPurgeLimiter } from './purge'
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
        return handleCard(url, env)
      case '/health':
        return handleHealth(env)
      default:
        return new Response('not found', { status: 404 })
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

async function handleCard(url: URL, env: Env): Promise<Response> {
  const parsed = parseParams(url.searchParams)

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
 * Liveness plus the one number that predicts whether this instance is about to
 * start serving stale cards.
 */
async function handleHealth(env: Env): Promise<Response> {
  const [rateLimits, lastWarm] = await Promise.all([
    new KvRateLimitStore(env.STATS_CACHE).read(),
    new KvWarmStore(env.STATS_CACHE).read(),
  ])

  const configured = parseWarmUsers(env.WARM_USERS)

  return Response.json(
    {
      status: 'ok',
      version: env.SERVICE_VERSION ?? UNKNOWN_VERSION,
      tokenConfigured: env.GITHUB_TOKEN !== undefined && env.GITHUB_TOKEN.length > 0,
      purgeEnabled: env.PURGE_TOKEN !== undefined && env.PURGE_TOKEN.length > 0,
      rateLimit: rateLimits ?? null,
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
