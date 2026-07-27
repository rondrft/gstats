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

import { recordWrite } from './budget'
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
 * How long a KV entry counts as fresh.
 *
 * Deliberately much longer than the `max-age` the card is served with. Those
 * two used to be the same number, and because they are in series a reader's
 * wait for a new figure was the sum of both — up to four hours. They answer
 * different questions:
 *
 *   `max-age` decides how often Camo comes back and asks. Shortening it costs
 *   Worker invocations and nothing else, because the answer comes from KV.
 *
 *   This decides how often *we* ask GitHub. Shortening it costs quota from a
 *   budget shared by every user of the instance, which is the scarce thing.
 *
 * So this stays long and `max-age` stays short. Anyone who needs a figure
 * sooner than six hours purges the entry rather than making everybody pay.
 */
export const KV_FRESH_SECONDS = 6 * 60 * 60

/**
 * How long an entry physically survives, well beyond its freshness. The gap is
 * the window in which a rate-limited request can still answer with a stale card
 * rather than an error.
 */
export const KV_EXPIRE_SECONDS = 7 * 24 * 60 * 60

export interface CacheEntry {
  data: StatsData
  /** Epoch milliseconds at which the entry stops being considered fresh. */
  freshUntil: number
}

export interface StatsCache {
  read(key: string): Promise<CacheEntry | null>
  write(key: string, entry: CacheEntry): Promise<void>
  /** Removes every entry for a login. Returns how many were deleted. */
  purge(prefix: string): Promise<number>
}

/**
 * Everything cached for one login, under one schema and one build.
 *
 * A login does not have *an* entry: it has one per combination of the
 * parameters that shape what is fetched, so purging has to work by prefix.
 * Entries under other builds are unreachable from this one and are left for
 * their own expiry.
 */
export function cachePrefix(username: string, build: string): string {
  return `${SCHEMA_VERSION}:${build}:${username.toLowerCase()}:`
}

/**
 * Cache key: `<schema>:<build>:<login>:<hash of the data-shaping parameters>`.
 *
 * Only inputs that change the *bytes we fetch* participate in the hash: the
 * username, how the languages are ranked and filtered, and which modules are
 * hidden (hiding a module skips its query entirely). Style parameters are
 * deliberately absent — the entry holds data, not pixels, so a request in a
 * different theme reuses whatever an earlier request already paid for.
 *
 * The build component retires every entry on deploy, which is not free: the
 * first request for each profile after a release is a miss, so a deploy spends
 * fresh GitHub quota in proportion to how many distinct profiles are active.
 */
export function cacheKey(params: DataParams, build: string): string {
  const dataShape = [
    `l=${params.langsCount}`,
    `m=${params.langMode}`,
    `x=${[...params.excludeLangs].sort().join('|')}`,
    `i=${[...params.includeLangs].sort().join('|')}`,
    `h=${[...params.hide].sort().join('|')}`,
  ].join(';')

  return cachePrefix(params.username, build) + fingerprint(dataShape)
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

  async write(key: string, entry: CacheEntry): Promise<void> {
    try {
      await this.namespace.put(key, JSON.stringify(entry), {
        expirationTtl: KV_EXPIRE_SECONDS,
      })
      await recordWrite(this.namespace)
    } catch {
      // Losing a write costs one extra upstream call; failing the request costs
      // the reader a broken image.
    }
  }

  /**
   * Deletes every entry under a prefix.
   *
   * Unlike a read, a failure here is reported: the caller asked for something to
   * be gone, and silently not doing it would leave them believing a stale card
   * had been retired.
   */
  async purge(prefix: string): Promise<number> {
    let deleted = 0
    let cursor: string | undefined

    do {
      const listing: KVNamespaceListResult<unknown, string> = await this.namespace.list(
        cursor === undefined ? { prefix } : { prefix, cursor },
      )
      await Promise.all(listing.keys.map((key) => this.namespace.delete(key.name)))
      deleted += listing.keys.length
      cursor = listing.list_complete ? undefined : listing.cursor
    } while (cursor !== undefined)

    return deleted
  }
}

/** In-memory implementation, used by the tests. */
export class MemoryStatsCache implements StatsCache {
  private readonly entries = new Map<string, CacheEntry>()

  read(key: string): Promise<CacheEntry | null> {
    return Promise.resolve(this.entries.get(key) ?? null)
  }

  write(key: string, entry: CacheEntry): Promise<void> {
    this.entries.set(key, entry)
    return Promise.resolve()
  }

  purge(prefix: string): Promise<number> {
    const doomed = [...this.entries.keys()].filter((key) => key.startsWith(prefix))
    for (const key of doomed) this.entries.delete(key)
    return Promise.resolve(doomed.length)
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

/**
 * The last reading this isolate took.
 *
 * This is the whole of the storage in the ordinary case. Sampling the reading
 * into KV every five minutes cost a fixed 288 writes a day per instance —
 * 29% of the free plan's entire allowance — to keep one diagnostic field on
 * `/health` current, and `docs/limits.md` had to subtract it from the ceiling
 * before dividing. A module variable costs nothing at all.
 *
 * It is lossy on purpose. An isolate is recycled and its reading goes with it,
 * so `/health` served by a cold one reports whatever KV last heard about, or
 * `null`. For a diagnostic that is an acceptable answer. The case that is not
 * diagnostic — the budget actually running out — is written through to KV, so
 * it survives the isolate and is visible from every one of them.
 */
let observed: StoredRateLimit | null = null

/**
 * Discards the isolate's reading.
 *
 * For tests, which share module state within a file. Production has no reason
 * to call it.
 */
export function forgetObservedRateLimit(): void {
  observed = null
}

/** Remaining requests below which the reading stops being merely diagnostic. */
const URGENT_REMAINING = 1_000

/**
 * How often the alert is refreshed in KV while the budget stays below the line.
 *
 * Below the threshold every fresh isolate would otherwise write once, and an
 * instance in that state is by definition the busiest it gets. This caps the
 * cost of the condition at the same interval the old sampler used, but only
 * while the condition holds rather than permanently.
 */
const ALERT_REFRESH_MS = 5 * 60_000

export class KvRateLimitStore {
  constructor(private readonly namespace: KVNamespace) {}

  /**
   * The isolate's own reading if it has one, and KV otherwise.
   *
   * Preferring memory is not only cheaper, it is more current: KV now holds
   * only alerts, and an absent alert means the budget was healthy when anybody
   * last looked.
   */
  async read(): Promise<StoredRateLimit | null> {
    if (observed !== null) return observed
    try {
      return await this.namespace.get<StoredRateLimit>(RATE_LIMIT_KEY, 'json')
    } catch {
      return null
    }
  }

  /**
   * Records the reading in memory, and in KV only when it is an alert.
   *
   * The cost of the healthy case is zero. The cost of the unhealthy case is one
   * read and at most one write every five minutes, which is what makes an
   * instance running out of quota visible at `/health` from any isolate.
   */
  async write(state: RateLimitState, observedAt: number): Promise<void> {
    if (state.remaining === null) return

    observed = { ...state, observedAt }
    if (state.remaining >= URGENT_REMAINING) return

    try {
      const stored = await this.namespace.get<StoredRateLimit>(RATE_LIMIT_KEY, 'json')
      if (!shouldPublishAlert(stored, observedAt)) return

      await this.namespace.put(RATE_LIMIT_KEY, JSON.stringify(observed), {
        // The window is an hour; keeping the record a little longer costs
        // nothing and makes `/health` useful during a quiet period.
        expirationTtl: 7_200,
      })
      await recordWrite(this.namespace, observedAt)
    } catch {
      // Best effort. A missing reading degrades the fallback, not the response.
    }
  }
}

/**
 * Whether a low reading is worth writing through to KV.
 *
 * Called only when the budget is already below the threshold, so the question
 * is never "is this interesting?" — it is "does KV already say so, recently
 * enough?".
 */
export function shouldPublishAlert(stored: StoredRateLimit | null, now: number): boolean {
  if (stored === null || stored.remaining === null) return true
  if (stored.remaining >= URGENT_REMAINING) return true
  return now - stored.observedAt >= ALERT_REFRESH_MS
}
