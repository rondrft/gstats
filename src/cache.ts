/**
 * KV-backed cache for fetched stats.
 *
 * What is cached is the *data*, not the rendered SVG. Colours, radius, locale
 * and animation are applied downstream, so a reader who asks for the same
 * profile in a different theme reuses the entry the first reader paid for
 * instead of triggering a fresh round of GitHub calls. That single decision is
 * what keeps a shared hourly quota viable.
 *
 * Entries carry their own timestamp and are written with a TTL beyond the one
 * the caller asked for, so an exhausted quota can still be answered with a
 * slightly stale card rather than an error (see `readStale`).
 */

import type { RateLimitState, StatsData } from './github/types'
import type { DataParams } from './params'

/** Bumped whenever the shape of `StatsData` changes, to orphan old entries. */
const SCHEMA_VERSION = 'v1'

/**
 * How long an entry physically survives in KV beyond its logical freshness.
 * The gap is the window in which a rate-limited request can still serve
 * something rather than nothing.
 */
const STALE_GRACE_SECONDS = 86_400

export interface CacheEntry {
  data: StatsData
  /** Epoch milliseconds at which the entry stops being considered fresh. */
  freshUntil: number
}

export interface StatsCache {
  read(key: string): Promise<CacheEntry | null>
  write(key: string, entry: CacheEntry, ttlSeconds: number): Promise<void>
}

/**
 * Cache key.
 *
 * Only inputs that change the *bytes we fetch* participate: the username, how
 * many languages are ranked, which are excluded, and which modules are hidden
 * (hiding a module skips its query entirely). Style parameters are deliberately
 * absent — including them would fragment the cache by theme for no benefit.
 */
export function cacheKey(params: DataParams): string {
  const dataShape = [
    `l=${params.langsCount}`,
    `x=${[...params.excludeLangs].sort().join('|')}`,
    `h=${[...params.hide].sort().join('|')}`,
  ].join(';')

  return `${SCHEMA_VERSION}:${params.username.toLowerCase()}:${fingerprint(dataShape)}`
}

/**
 * FNV-1a, 32 bits, rendered as hex.
 *
 * The key only has to distinguish a handful of parameter combinations per user,
 * and collisions between different shapes for the *same* user are the only ones
 * that could matter. A non-cryptographic hash is the right tool, and it avoids
 * making the key path async as WebCrypto would.
 */
function fingerprint(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export class KvStatsCache implements StatsCache {
  constructor(private readonly namespace: KVNamespace) {}

  async read(key: string): Promise<CacheEntry | null> {
    try {
      return await this.namespace.get<CacheEntry>(key, 'json')
    } catch {
      // A cache that is down is a slow service, not a broken one.
      return null
    }
  }

  async write(key: string, entry: CacheEntry, ttlSeconds: number): Promise<void> {
    try {
      await this.namespace.put(key, JSON.stringify(entry), {
        expirationTtl: ttlSeconds + STALE_GRACE_SECONDS,
      })
    } catch {
      // Losing a write costs one extra upstream call; failing the request costs
      // the reader a broken image.
    }
  }
}

/** In-memory implementation used by tests and by `wrangler dev` without KV. */
export class MemoryStatsCache implements StatsCache {
  private readonly entries = new Map<string, CacheEntry>()

  read(key: string): Promise<CacheEntry | null> {
    return Promise.resolve(this.entries.get(key) ?? null)
  }

  write(key: string, entry: CacheEntry): Promise<void> {
    this.entries.set(key, entry)
    return Promise.resolve()
  }
}

export function isFresh(entry: CacheEntry, now: number): boolean {
  return entry.freshUntil > now
}

/**
 * Last known state of GitHub's hourly quota.
 *
 * A Worker isolate handles one request and forgets everything, so the headers
 * from the previous call have to be written down somewhere for the next request
 * to act on them. This is the "are we running out?" signal that lets the service
 * fall back to stale cards before it starts failing, and it is what `/health`
 * reports.
 */
const RATE_LIMIT_KEY = `${SCHEMA_VERSION}:rate-limit`

export interface StoredRateLimit extends RateLimitState {
  /** Epoch milliseconds when these headers were observed. */
  observedAt: number
}

export class KvRateLimitStore {
  constructor(private readonly namespace: KVNamespace) {}

  async read(): Promise<StoredRateLimit | null> {
    try {
      return await this.namespace.get<StoredRateLimit>(RATE_LIMIT_KEY, 'json')
    } catch {
      return null
    }
  }

  async write(state: RateLimitState, observedAt: number): Promise<void> {
    if (state.remaining === null) return
    try {
      await this.namespace.put(
        RATE_LIMIT_KEY,
        JSON.stringify({ ...state, observedAt } satisfies StoredRateLimit),
        // The window is an hour; keeping the record a little longer costs
        // nothing and makes `/health` useful during a quiet period.
        { expirationTtl: 7_200 },
      )
    } catch {
      // Best effort. A missing reading degrades the fallback, not the response.
    }
  }
}
