/**
 * Streak arithmetic.
 *
 * Pure and I/O free: every date is an ISO `YYYY-MM-DD` string, and the reference
 * day is an argument rather than something read from the clock. A Worker runs in
 * whichever colo is closest to the reader, so anything derived from the machine's
 * own local time would give a different answer per continent.
 *
 * Dates are compared as calendar days, never as instants, so daylight saving and
 * leap years are handled by the calendar rather than by day-length arithmetic.
 *
 * ## Which day is "today"
 *
 * A streak needs a day boundary and there is no boundary every reader agrees on.
 * This used to draw it at UTC midnight, which is the worst option for roughly
 * half the planet: for anybody west of Greenwich, a commit late on their Monday
 * evening is already Tuesday in UTC, so through the last hours of their day the
 * card counts a day they have not finished and reports a streak one short.
 *
 * The default is now **Anywhere on Earth** — the date in UTC−12, the last zone
 * to leave any given day. A day counts as long as it is still that day
 * *somewhere*, so no reader ever sees their streak cut before their own day is
 * over. The cost is the opposite error: a new day takes up to a further twelve
 * hours to be picked up. That is much the more benign of the two, because it
 * errs towards a figure that is briefly stale rather than towards one that is
 * wrong and discouraging.
 *
 * `tz` overrides it for anybody who wants their own zone exactly.
 *
 * The arithmetic below never special-cases any of this. It anchors on the most
 * recent day that had activity and measures the gap from there to the reference
 * day, which is what lets one rule cover a reader in UTC−11 and a reader in
 * UTC+14 — whose "today" can be a day *ahead* of Anywhere on Earth, making that
 * gap negative.
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
 * Days the most recent activity may lag the reference day and still count.
 *
 * One, because the reference day is still in progress: collapsing somebody's
 * streak the moment their day ticks over, when they simply have not pushed yet,
 * is both wrong and demoralising. Two days of silence is a genuine break.
 */
const GRACE_DAYS = 1

/**
 * The run of consecutive active days ending at the account's most recent one.
 *
 * Anchoring on the last day with activity rather than on `today` is what makes
 * this work for every reader without a case for each. The gap between the two is
 * then the only question, and it is allowed to be *negative*: a reader in UTC+14
 * can commit on a date that Anywhere on Earth has not reached, and their streak
 * is obviously alive. Anything more than `GRACE_DAYS` behind is broken.
 */
function currentStreak(counts: Map<string, number>, today: string): StreakRange {
  if (Number.isNaN(toTimestamp(today))) return EMPTY_RANGE

  let end: string | null = null
  for (const [date, count] of counts) {
    // ISO dates sort lexicographically, and every key here already parsed.
    if (count > 0 && (end === null || date > end)) end = date
  }
  if (end === null) return EMPTY_RANGE

  const gapDays = Math.round((toTimestamp(today) - toTimestamp(end)) / MS_PER_DAY)
  if (gapDays > GRACE_DAYS) return EMPTY_RANGE

  let length = 0
  let start = end
  let cursor = end
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

/** `YYYY-MM-DD` for the current UTC day. */
export function utcToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/**
 * Anywhere on Earth is UTC−12: the last zone on the planet to leave a date.
 * Shifting the instant back by that much and reading the UTC date off it is the
 * same thing as reading the date in that zone, and needs no timezone database.
 */
const AOE_OFFSET_MS = 12 * 60 * 60 * 1000

/** `YYYY-MM-DD` in UTC−12. The default meaning of "today" for a streak. */
export function anywhereOnEarthToday(now: Date = new Date()): string {
  return utcToday(new Date(now.getTime() - AOE_OFFSET_MS))
}

/**
 * The day a streak is measured against: the reader's zone if they named one,
 * Anywhere on Earth otherwise.
 *
 * A zone that the runtime will not accept falls back to the default rather than
 * throwing. `params.ts` has already checked it against the runtime's own list,
 * so reaching that path means the two disagree — which is still not a reason to
 * hand somebody a broken image.
 */
export function referenceToday(zone: string | null, now: Date = new Date()): string {
  if (zone === null) return anywhereOnEarthToday(now)

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now)

    const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? ''
    const [year, month, day] = [part('year'), part('month'), part('day')]
    if (year === '' || month === '' || day === '') return anywhereOnEarthToday(now)

    return `${year.padStart(4, '0')}-${month}-${day}`
  } catch {
    return anywhereOnEarthToday(now)
  }
}

/** Calendar day `delta` days from `date`, in UTC. */
export function addDays(date: string, delta: number): string {
  return shiftDays(date, delta)
}
