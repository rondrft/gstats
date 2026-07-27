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
import { parseParams, type StyleParams } from './params'
import { renderCard } from './render/cards'
import { ERROR_CACHE_SECONDS, type ErrorCardKind, renderErrorCard } from './render/error-card'
import { getStats } from './stats'

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
}

/** Used when nothing set a version, which in practice means local development. */
const UNKNOWN_VERSION = 'dev'

const SVG_CONTENT_TYPE = 'image/svg+xml; charset=utf-8'

/**
 * How long a client may keep serving the previous card while it revalidates.
 * Camo and browsers both honour this, so a card update is never blocking.
 */
const STALE_WHILE_REVALIDATE = 86_400

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

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
} satisfies ExportedHandler<Env>

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

    const maxAge = parsed.params.cacheSeconds
    return new Response(renderCard(data, parsed.params), {
      headers: {
        'content-type': SVG_CONTENT_TYPE,
        'cache-control': `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=${STALE_WHILE_REVALIDATE}`,
        'x-cache': status,
      },
    })
  } catch (error) {
    const failure = error instanceof StatsError ? error : new StatsError('upstream', String(error))
    return errorCard(failure.kind, parsed.params.style, failure.retryAfterMinutes)
  }
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
  const rateLimits = await new KvRateLimitStore(env.STATS_CACHE).read()

  return Response.json(
    {
      status: 'ok',
      version: env.SERVICE_VERSION ?? UNKNOWN_VERSION,
      tokenConfigured: env.GITHUB_TOKEN !== undefined && env.GITHUB_TOKEN.length > 0,
      rateLimit: rateLimits ?? null,
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
