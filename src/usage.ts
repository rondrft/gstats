/**
 * How much of this instance is actually being used.
 *
 * `budget.ts` answers "how close is today to the ceiling?". This answers the
 * question underneath it, which until now nobody could answer at all: **how
 * many distinct profiles is the service carrying, and how hard are they being
 * asked for?** The arithmetic in `docs/limits.md` puts the free plan's ceiling
 * at about 240 active profiles, and there was no way to tell whether an
 * instance was at twenty of those or at two hundred short of a symptom.
 *
 * ## What is counted, and what is deliberately not
 *
 * Nothing about a visitor. Not an address, not a user agent, not a header, not
 * a referrer, not a timestamp of any individual request. The only quantity here
 * is *how many distinct GitHub logins were fetched*, which is a property of the
 * cards this instance draws rather than of the people looking at them.
 *
 * The logins themselves are not kept either, although they could be — they are
 * public, and they are already in every cache key for the seven days an entry
 * lives. A distinct count over a window cannot be a plain total: something has
 * to remember which logins have already been counted. So the ledger holds a
 * short hash of each login rather than the login, which counts identically and
 * leaves the only long-lived record here unreadable as a list of anybody. That
 * is a statement about what this record is for and not a security boundary —
 * a 32-bit hash of a public login is enumerable by anyone who wants to bother,
 * and pretending otherwise would be the wrong kind of reassurance.
 *
 * ## The counter must not spend the budget it exists to measure
 *
 * The same constraint `budget.ts` is built around, and the reason the two
 * figures are gathered in completely different ways.
 *
 * **Distinct profiles cost nothing per request.** Counting them on the way in
 * would mean a KV write for every login an isolate had not seen yet — and every
 * isolate discovers every login separately, so the cost would scale with
 * isolates times profiles, which is the shape that ruined the quota reading
 * twice. Instead the count is *derived from storage the service already keeps*:
 * a stats entry survives seven days, so listing the cache is a list of the
 * logins fetched in the last seven days, free and exact. A rollup on the cron
 * folds that list into a thirty-day ledger, and one write every six hours is
 * the whole cost. See `docs/decisions.md`.
 *
 * **Requests are counted the way writes are**: accumulated in the isolate and
 * flushed once every `PERSIST_EVERY_REQUESTS`. It undercounts for the same
 * reasons and in the same direction — an isolate recycled before it flushes
 * takes its pending count with it, and two locations flushing at once can
 * overwrite each other. It is a floor, and it is least accurate on a quiet
 * instance, which is exactly where the figure matters least.
 */

import { recordWrite, recordWriteFailure } from './budget'
import { CACHE_KEY_ROOT, fingerprint, loginFromCacheKey } from './cache'

/** A profile last fetched longer ago than this is not an active profile. */
export const PROFILE_WINDOW_DAYS = 30

/** Over how many days the request figure is reported. */
export const REQUEST_WINDOW_DAYS = 7

/**
 * How often the cron folds the cache listing into the ledger.
 *
 * The only lower bound that matters is the seven days an entry survives, so
 * this could be daily and still miss nobody. Six hours is a day-stamp accurate
 * to a quarter of a day for four writes, which rounds to nothing against a
 * thousand.
 */
const ROLLUP_INTERVAL_MS = 6 * 60 * 60 * 1000

const LEDGER_KEY = 'usage:profiles'

/**
 * Comfortably past the window, so the ledger outlives a quiet fortnight and an
 * abandoned instance still eventually forgets everything.
 */
const LEDGER_TTL_SECONDS = (PROFILE_WINDOW_DAYS + 15) * 86_400

/**
 * A stop on the listing loop.
 *
 * Twenty pages is twenty thousand keys, which is an instance far past anything
 * the free plan can serve. It exists so that a pathological namespace cannot
 * turn a diagnostic into an unbounded scheduled job, and it says so in the logs
 * when it engages rather than quietly reporting a smaller number.
 */
const MAX_LIST_PAGES = 20

/**
 * Requests an isolate counts before it writes the total down.
 *
 * At roughly a dozen requests per cache write — a card is revalidated far more
 * often than the entry behind it is refetched — this costs about one write for
 * every twenty the service makes on its own account. Raising it buys back
 * budget and loses resolution on a quiet instance; lowering it does the
 * reverse, and spends the resource being measured, which is the trade to be
 * suspicious of.
 */
const PERSIST_EVERY_REQUESTS = 200

/** The window plus enough slack that the oldest day is still readable. */
const REQUEST_TTL_SECONDS = (REQUEST_WINDOW_DAYS + 2) * 86_400

const MS_PER_DAY = 86_400_000

function requestKey(day: string): string {
  return `usage:requests:${day}`
}

/** UTC, to agree with the write budget and with Cloudflare's own reset. */
function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

/** Whole days since the epoch, which is what the ledger stores per login. */
function dayNumber(now: number): number {
  return Math.floor(now / MS_PER_DAY)
}

async function readCount(namespace: KVNamespace, key: string): Promise<number> {
  const raw = await namespace.get(key)
  const value = Number.parseInt(raw ?? '0', 10)
  return Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * Which logins have been seen, and when.
 *
 * `seen` maps a short hash of the login to the day it was last folded in. Not
 * namespaced by build or schema: it measures the instance, not what the
 * instance happens to be storing this week, and a deploy must not reset it.
 */
interface ProfileLedger {
  /** Epoch milliseconds of the last rollup. */
  updatedAt: number
  seen: Record<string, number>
}

export interface ProfileUsage {
  /** Distinct logins fetched in the last `PROFILE_WINDOW_DAYS`. */
  active30d: number
  /**
   * When the ledger was last folded, or `null` if it never has been. An
   * instance whose cron is not running reports a timestamp that stops moving,
   * for the same reason `warming.lastRun` exists.
   */
  updatedAt: number | null
}

async function readLedger(namespace: KVNamespace): Promise<ProfileLedger | null> {
  try {
    const stored = await namespace.get<ProfileLedger>(LEDGER_KEY, 'json')
    if (stored === null || typeof stored.seen !== 'object' || stored.seen === null) return null
    return stored
  } catch {
    // A diagnostic that cannot be read is reported as absent. Refusing to
    // answer `/health` over it would be the worse failure by a wide margin.
    return null
  }
}

/**
 * Folds the logins currently in the cache into the thirty-day ledger.
 *
 * Runs on the cron, which fires every fifteen minutes; all but four runs a day
 * cost one KV read and stop. The listing is only reached when the ledger is due,
 * because `list` has its own thousand-a-day allowance on the free plan and
 * ninety-six of them would be a tenth of it spent on deciding not to do
 * anything.
 *
 * Every failure is swallowed. This is a diagnostic running on a timer with
 * nobody waiting for it.
 */
export async function rollUpProfiles(
  namespace: KVNamespace,
  now: number = Date.now(),
): Promise<void> {
  const ledger = await readLedger(namespace)
  if (ledger !== null && now - ledger.updatedAt < ROLLUP_INTERVAL_MS) return

  const today = dayNumber(now)
  const seen: Record<string, number> = {}

  // Carry forward what is still inside the window. Pruning here rather than on
  // read is what stops the record growing without limit on an instance that has
  // served a lot of logins once each.
  for (const [token, day] of Object.entries(ledger?.seen ?? {})) {
    if (typeof day === 'number' && today - day < PROFILE_WINDOW_DAYS) seen[token] = day
  }

  try {
    let cursor: string | undefined
    let pages = 0

    do {
      const listing: KVNamespaceListResult<unknown, string> = await namespace.list(
        cursor === undefined ? { prefix: CACHE_KEY_ROOT } : { prefix: CACHE_KEY_ROOT, cursor },
      )

      for (const key of listing.keys) {
        const login = loginFromCacheKey(key.name)
        if (login !== null) seen[fingerprint(login)] = today
      }

      pages += 1
      cursor = listing.list_complete ? undefined : listing.cursor

      if (cursor !== undefined && pages >= MAX_LIST_PAGES) {
        console.warn(`usage: stopped listing after ${pages} pages; active30d is a floor`)
        cursor = undefined
      }
    } while (cursor !== undefined)
  } catch (error) {
    // A partial listing would write a ledger that had forgotten profiles it
    // could not see, so nothing is written at all and the previous one stands.
    console.warn(
      `usage: could not list the cache: ${error instanceof Error ? error.message : error}`,
    )
    return
  }

  try {
    await namespace.put(
      LEDGER_KEY,
      JSON.stringify({ updatedAt: now, seen } satisfies ProfileLedger),
      {
        expirationTtl: LEDGER_TTL_SECONDS,
      },
    )
    await recordWrite(namespace, now)
  } catch (error) {
    recordWriteFailure('profile-ledger', error)
  }
}

/**
 * The figure `/health` reports.
 *
 * Counted from the ledger rather than trusted from a stored total, so a ledger
 * that has not been folded for a while reports what is genuinely still inside
 * the window instead of whatever was true when it was written.
 */
export async function readProfileUsage(
  namespace: KVNamespace,
  now: number = Date.now(),
): Promise<ProfileUsage> {
  const ledger = await readLedger(namespace)
  if (ledger === null) return { active30d: 0, updatedAt: null }

  const today = dayNumber(now)
  let active = 0
  for (const day of Object.values(ledger.seen)) {
    if (typeof day === 'number' && today - day < PROFILE_WINDOW_DAYS) active += 1
  }

  return { active30d: active, updatedAt: ledger.updatedAt }
}

interface RequestTally {
  day: string
  /** Counted in this isolate and not yet flushed. */
  pending: number
}

let tally: RequestTally | null = null

/**
 * Discards the isolate's unflushed count.
 *
 * For tests, which share module state within a file.
 */
export function forgetRequestTally(): void {
  tally = null
}

/**
 * Counts one card request, and flushes if enough have accumulated.
 *
 * Called for `/api` alone, and only for requests the service actually answers:
 * the landing page and the icons are not card traffic, and a caller already
 * over their rate limit is refused before this. Every failure is swallowed —
 * losing the count is worth strictly less than the response it was counting.
 */
export async function recordRequest(
  namespace: KVNamespace,
  now: number = Date.now(),
): Promise<void> {
  const day = utcDay(now)

  // Flush the old day before opening the new one. Dropping it would lose up to
  // a full interval out of the figure at every midnight, and the flush is at
  // most one extra write per isolate per day.
  if (tally !== null && tally.day !== day) {
    await flushRequests(namespace, tally, now)
    tally = null
  }

  if (tally === null) tally = { day, pending: 0 }

  tally.pending += 1
  if (tally.pending < PERSIST_EVERY_REQUESTS) return

  await flushRequests(namespace, tally, now)
}

async function flushRequests(
  namespace: KVNamespace,
  current: RequestTally,
  now: number,
): Promise<void> {
  if (current.pending === 0) return
  const key = requestKey(current.day)

  try {
    const stored = await readCount(namespace, key)
    await namespace.put(key, String(stored + current.pending), {
      expirationTtl: REQUEST_TTL_SECONDS,
    })
    current.pending = 0
    // The flush is a KV write like any other and belongs in the day's total.
    await recordWrite(namespace, now)
  } catch (error) {
    // Keep the pending count and try again on the next request.
    recordWriteFailure('request-count', error)
  }
}

export interface RequestUsage {
  /** Card requests over the last `REQUEST_WINDOW_DAYS`, including today. */
  last7d: number
}

/**
 * Sums the window's daily records, plus whatever this isolate is still holding.
 *
 * One KV read per day in the window. Reads are the resource this service has a
 * hundred times more of than it can use, and `/health` is not on any hot path.
 */
export async function readRequestUsage(
  namespace: KVNamespace,
  now: number = Date.now(),
): Promise<RequestUsage> {
  const days = Array.from({ length: REQUEST_WINDOW_DAYS }, (_, index) =>
    utcDay(now - index * MS_PER_DAY),
  )

  const counts = await Promise.all(
    days.map((day) => readCount(namespace, requestKey(day)).catch(() => 0)),
  )

  const pending = tally !== null && days.includes(tally.day) ? tally.pending : 0
  return { last7d: counts.reduce((total, count) => total + count, 0) + pending }
}
