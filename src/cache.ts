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
 * What an entry *means*. Bump this whenever `StatsData` gains, loses or
 * redefines a field, or whenever a stored value is computed differently — a
 * changed language ranking counts, even though the type is unchanged.
 *
 * This is not the same thing as the build id, and the difference is the whole
 * reason it exists. The build id answers "is this the same deployment?"; this
 * answers "does this entry still mean what the code expects?". They coincide on
 * a production deploy and come apart everywhere else:
 *
 *   - `wrangler dev` reads its `SERVICE_VERSION` from `wrangler.toml`, so the
 *     build component is a constant. Every local session shares one namespace
 *     forever, and a change to how a field is computed is invisible to the key.
 *   - Re-running a deploy for the same commit reuses that commit's namespace,
 *     as does deploying, rolling back, and rolling forward again.
 *
 * Relying on the build id alone left both of those able to serve an entry
 * written under a different meaning.
 *
 * v2: added `calendar`, `yearContributions` and `bestYearContributions`, and
 *     changed how `languages` is ranked.
 */
const SCHEMA_VERSION = 'v2'

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

/**
 * Whether an entry has the shape the current code reads.
 *
 * The key is a heuristic — it depends on somebody having bumped
 * `SCHEMA_VERSION`, and on the build id actually differing. This is the
 * guarantee. Anything that reaches a renderer has been checked to carry the
 * fields the renderer will dereference, so a missed bump costs one extra
 * upstream call rather than a card that throws on `data.calendar.counts`.
 *
 * Only fields whose absence would break a renderer are checked; this is a
 * tripwire, not a validator.
 */
export function hasCurrentShape(entry: unknown): entry is CacheEntry {
  if (typeof entry !== 'object' || entry === null) return false
  const candidate = entry as Partial<CacheEntry>
  const data = candidate.data
  if (typeof candidate.freshUntil !== 'number' || typeof data !== 'object' || data === null) {
    return false
  }

  return (
    typeof data.login === 'string' &&
    typeof data.totalContributions === 'number' &&
    typeof data.yearContributions === 'number' &&
    typeof data.bestYearContributions === 'number' &&
    Array.isArray(data.languages) &&
    typeof data.streaks === 'object' &&
    data.streaks !== null &&
    typeof data.calendar === 'object' &&
    data.calendar !== null &&
    Array.isArray(data.calendar.counts)
  )
}

export class KvStatsCache implements StatsCache {
  constructor(private readonly namespace: KVNamespace) {}

  async read(key: string): Promise<CacheEntry | null> {
    try {
      const entry = await this.namespace.get(key, 'json')
      // An entry from an older shape is treated as a miss rather than trusted.
      return hasCurrentShape(entry) ? entry : null
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
