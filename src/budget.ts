/**
 * How much of the day's KV write allowance has been spent.
 *
 * `docs/limits.md` explains why this is the number that matters: the free plan
 * allows a thousand writes a day, the GitHub quota it is usually confused with
 * is forty-five times further away, and running out of writes triggers a
 * cascade rather than a gradual slowdown — nothing gets cached, so every request
 * becomes a miss, so the GitHub quota drains in minutes too.
 *
 * Until this existed there was no way to see that coming. `/health` now reports
 * the figure and turns `status` to `warning` before it is too late to act.
 *
 * ## The counter has to cost less than what it measures
 *
 * A counter that wrote to KV on every write it counted would double the very
 * quantity it exists to protect. So the isolate accumulates in memory and
 * flushes once every `PERSIST_EVERY` writes, which puts the overhead at about
 * four percent of what it is watching, and the flush counts itself.
 *
 * The consequences are accepted deliberately:
 *
 *   - **It undercounts.** Writes accumulated by an isolate that is recycled
 *     before it flushes are lost, and two colos flushing at once can each read
 *     the same total and overwrite each other. The figure is a floor, not an
 *     audit. For "am I about to run out?" a floor is the useful direction to be
 *     wrong in only if it is not wrong by much, which is why the flush interval
 *     is small rather than merely large enough to be cheap.
 *   - **Deletes are not counted.** Cloudflare bills them against a separate
 *     daily allowance, so folding them in here would misreport the one figure
 *     this is about.
 *
 * The day is UTC because that is when Cloudflare's allowance resets.
 */

/** Cloudflare's free plan, per account. Overridable for a paid one. */
export const DEFAULT_DAILY_WRITE_BUDGET = 1_000

/** Fraction of the allowance above which `/health` stops saying `ok`. */
export const WARNING_FRACTION = 0.8

/**
 * Writes an isolate accumulates before it flushes.
 *
 * At the free plan's ceiling this is about forty writes a day of overhead
 * against the thousand it is measuring. Lowering it buys accuracy with the
 * resource being measured, which is the trade to be suspicious of.
 */
const PERSIST_EVERY = 25

/** Two days, so yesterday's figure is still readable just after midnight. */
const RECORD_TTL_SECONDS = 172_800

/**
 * Deliberately not namespaced by build or schema. It counts a physical account
 * resource, not anything this service stores, and a deploy in the middle of a
 * day must not reset it — a deploy is itself a burst of writes, which is exactly
 * when the figure is worth having.
 */
function recordKey(day: string): string {
  return `budget:writes:${day}`
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

interface Tally {
  day: string
  /** Counted in this isolate and not yet flushed. */
  pending: number
}

let tally: Tally | null = null

/**
 * Discards the isolate's unflushed count.
 *
 * For tests, which share module state within a file. Production has no reason
 * to call it: a new day replaces the tally on the next write.
 */
export function forgetWriteTally(): void {
  tally = null
}

/**
 * Counts one KV write, and flushes if enough have accumulated.
 *
 * Every failure is swallowed. This is a diagnostic: losing the count is worth
 * strictly less than failing the write it was counting, and the caller is
 * already on a path that treats a lost KV write as one extra upstream call.
 */
export async function recordWrite(namespace: KVNamespace, now: number = Date.now()): Promise<void> {
  const day = utcDay(now)
  if (tally === null || tally.day !== day) tally = { day, pending: 0 }

  tally.pending += 1
  if (tally.pending < PERSIST_EVERY) return

  await flush(namespace, tally)
}

async function flush(namespace: KVNamespace, current: Tally): Promise<void> {
  const key = recordKey(current.day)

  try {
    const stored = await readCount(namespace, key)
    // The `+ 1` is this flush. A counter that did not count its own writes
    // would report a figure that is wrong by exactly the amount it is
    // responsible for, which is the one error it has no excuse for.
    await namespace.put(key, String(stored + current.pending + 1), {
      expirationTtl: RECORD_TTL_SECONDS,
    })
    current.pending = 0
  } catch {
    // Keep the pending count and try again on the next write. If the namespace
    // is refusing writes the figure is academic anyway — that is the condition
    // it exists to predict.
  }
}

async function readCount(namespace: KVNamespace, key: string): Promise<number> {
  const raw = await namespace.get(key)
  const value = Number.parseInt(raw ?? '0', 10)
  return Number.isFinite(value) && value > 0 ? value : 0
}

export interface WriteBudget {
  /** Writes counted so far today, across every isolate that has flushed. */
  used: number
  limit: number
  /** `used` as a whole percentage of `limit`, for reading at a glance. */
  percent: number
  /** Whether `used` has passed `WARNING_FRACTION` of the allowance. */
  warning: boolean
}

/**
 * The day's figure, as `/health` reports it.
 *
 * Adds whatever this isolate is holding to what has been flushed, so a reading
 * taken right after a burst is not stale by the size of the burst.
 */
export async function readWriteBudget(
  namespace: KVNamespace,
  limit: number,
  now: number = Date.now(),
): Promise<WriteBudget> {
  const day = utcDay(now)

  let stored = 0
  try {
    stored = await readCount(namespace, recordKey(day))
  } catch {
    // A figure of zero reads as "nothing written yet", which is wrong but
    // harmless; refusing to answer /health at all would not be.
  }

  const used = stored + (tally !== null && tally.day === day ? tally.pending : 0)

  return {
    used,
    limit,
    percent: Math.round((used / limit) * 100),
    warning: used >= limit * WARNING_FRACTION,
  }
}
