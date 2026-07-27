/**
 * Streak arithmetic.
 *
 * Pure, I/O free and timezone free by construction: every date is an ISO
 * `YYYY-MM-DD` string interpreted as UTC, and "today" is an argument rather than
 * something read from the clock. That matters twice over — a Worker runs in
 * whichever colo is closest to the reader, so anything derived from local time
 * would give a different answer per continent, and the whole module stays
 * trivially testable.
 *
 * Dates are compared as calendar days, never as instants, so daylight saving and
 * leap years are handled by the calendar rather than by day-length arithmetic.
 */

export interface ContributionDay {
  /** `YYYY-MM-DD`, UTC. */
  date: string
  count: number
}

export interface StreakRange {
  /** Number of consecutive days with at least one contribution. */
  length: number
  /** First day of the run, or `null` when there is no run. */
  start: string | null
  /** Last day of the run, or `null` when there is no run. */
  end: string | null
}

export interface Streaks {
  current: StreakRange
  longest: StreakRange
}

const MS_PER_DAY = 86_400_000

const EMPTY_RANGE: StreakRange = { length: 0, start: null, end: null }

/** Parses `YYYY-MM-DD` as UTC midnight. Returns NaN for anything else. */
function toTimestamp(date: string): number {
  return Date.parse(`${date}T00:00:00Z`)
}

function toIsoDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

function shiftDays(date: string, delta: number): string {
  return toIsoDate(toTimestamp(date) + delta * MS_PER_DAY)
}

/**
 * Computes the current and longest streaks over a contribution calendar.
 *
 * @param days  Daily counts. Expected in ascending date order, but gaps are
 *              tolerated: a missing day counts as zero, exactly like a present
 *              day with a count of zero.
 * @param today The reference day, `YYYY-MM-DD` in UTC. Supplied by the caller so
 *              that the result does not depend on where the code runs.
 */
export function computeStreaks(days: readonly ContributionDay[], today: string): Streaks {
  const counts = new Map<string, number>()
  for (const day of days) {
    if (Number.isNaN(toTimestamp(day.date))) continue
    counts.set(day.date, day.count)
  }

  if (counts.size === 0) return { current: EMPTY_RANGE, longest: EMPTY_RANGE }

  return {
    current: currentStreak(counts, today),
    longest: longestStreak(counts),
  }
}

/**
 * Walks backwards from `today` for as long as days have contributions.
 *
 * A zero on `today` does not end the streak: the day is still in progress, and
 * showing a streak collapse at 00:01 UTC for someone who simply has not pushed
 * yet is both wrong and demoralising. The walk restarts one day earlier instead.
 * A zero on the day before that is a genuine break.
 */
function currentStreak(counts: Map<string, number>, today: string): StreakRange {
  if (Number.isNaN(toTimestamp(today))) return EMPTY_RANGE

  let cursor = (counts.get(today) ?? 0) > 0 ? today : shiftDays(today, -1)

  const end = (counts.get(cursor) ?? 0) > 0 ? cursor : null
  if (end === null) return EMPTY_RANGE

  let length = 0
  let start = cursor
  // `counts` is finite, so the walk terminates at the first day the calendar
  // does not cover even if every covered day is non-zero.
  while ((counts.get(cursor) ?? 0) > 0) {
    length += 1
    start = cursor
    cursor = shiftDays(cursor, -1)
  }

  return { length, start, end }
}

/**
 * Longest run of consecutive non-zero days anywhere in the calendar.
 *
 * Iterates over calendar days rather than over the array so that a sparse input
 * behaves the same as a dense one. Ties resolve to the earliest run, which is
 * when the record was actually set.
 */
function longestStreak(counts: Map<string, number>): StreakRange {
  const timestamps = [...counts.keys()].map(toTimestamp)
  const first = Math.min(...timestamps)
  const last = Math.max(...timestamps)

  let best: StreakRange = EMPTY_RANGE
  let runLength = 0
  let runStart: string | null = null

  for (let cursor = first; cursor <= last; cursor += MS_PER_DAY) {
    const date = toIsoDate(cursor)
    if ((counts.get(date) ?? 0) > 0) {
      runLength += 1
      if (runLength === 1) runStart = date
      if (runLength > best.length) best = { length: runLength, start: runStart, end: date }
    } else {
      runLength = 0
      runStart = null
    }
  }

  return best
}

/** `YYYY-MM-DD` for the current UTC day. The only clock read in the codebase. */
export function utcToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}
