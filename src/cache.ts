/**
 * KV-backed cache for fetched stats.
 *
 * What is cached is the *data*, not the rendered SVG. Colours, radius, locale
 * and animation are applied downstream, so a reader who asks for the same
 * profile in a different theme reuses the entry the first reader paid for
 * instead of triggering a fresh round of GitHub calls. That single decision is
 * what keeps a shared hourly quota viable.
 *
 * Entries carry their own freshness deadline and are written with a KV TTL
 * beyond it, so an exhausted quota can still be answered from an expired entry
 * rather than with an error — see the fallback in `stats.ts`.
 */

import type { RateLimitState, StatsData } from './github/types'
import type { DataParams } from './params'

/**
 * Namespace for everything this service writes, so a key can be recognised at a
 * glance in the KV browser. Entries are retired by the build component of the
 * key rather than by editing this, and it only needs to change if the key format
 * itself does.
 */
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
 * Cache key: `v1:<build>:<login>:<hash of the data-shaping parameters>`.
 *
 * Only inputs that change the *bytes we fetch* participate in the hash: the
 * username, how many languages are ranked, which are excluded, and which modules
 * are hidden (hiding a module skips its query entirely). Style parameters are
 * deliberately absent — the entry holds data, not pixels, so a request in a
 * different theme reuses whatever an earlier request already paid for.
 *
 * The build component is the deployed `SERVICE_VERSION`. Including it retires
 * every entry on deploy, which removes the standing hazard of a release that
 * changes the shape of `StatsData` and then reads yesterday's entries back into
 * the new type. The manual `SCHEMA_VERSION` below no longer has to be remembered.
 *
 * It is not free: the first request for each profile after a deploy is a miss,
 * so a release spends fresh GitHub quota proportional to how many distinct
 * profiles are active. On a busy instance that is the cost worth watching.
 */
export function cacheKey(params: DataParams, build: string): string {
  const dataShape = [
    `l=${params.langsCount}`,
    `m=${params.langMode}`,
    `x=${[...params.excludeLangs].sort().join('|')}`,
    `i=${[...params.includeLangs].sort().join('|')}`,
    `h=${[...params.hide].sort().join('|')}`,
  ].join(';')

  return [SCHEMA_VERSION, build, params.username.toLowerCase(), fingerprint(dataShape)].join(':')
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
 *
 * Deliberately *not* versioned by build. A deploy empties the stats cache and so
 * causes a burst of upstream traffic; forgetting the quota reading at the same
 * moment would blind the fallback exactly when it is most needed. The reading
 * describes GitHub's state, not ours, and outlives any release.
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
