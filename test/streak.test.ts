import { describe, expect, it } from 'vitest'
import {
  anywhereOnEarthToday,
  type ContributionDay,
  computeStreaks,
  referenceToday,
  utcToday,
} from '../src/streak'

/**
 * Builds a calendar from a compact notation: consecutive days starting at
 * `from`, one count per entry. Keeps the fixtures readable enough that the case
 * under test is obvious from the literal.
 */
function calendar(from: string, counts: number[]): ContributionDay[] {
  const start = Date.parse(`${from}T00:00:00Z`)
  return counts.map((count, index) => ({
    date: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
    count,
  }))
}

describe('computeStreaks', () => {
  it('reports nothing for an account with no calendar at all', () => {
    const { current, longest } = computeStreaks([], '2026-07-26')

    expect(current).toEqual({ length: 0, start: null, end: null })
    expect(longest).toEqual({ length: 0, start: null, end: null })
  })

  it('reports nothing for a new account whose every day is zero', () => {
    const { current, longest } = computeStreaks(calendar('2026-07-20', [0, 0, 0, 0]), '2026-07-23')

    expect(current.length).toBe(0)
    expect(longest.length).toBe(0)
  })

  it('counts a streak that runs up to today', () => {
    const days = calendar('2026-07-20', [0, 3, 1, 2, 5, 1, 4])

    const { current } = computeStreaks(days, '2026-07-26')

    expect(current).toEqual({ length: 6, start: '2026-07-21', end: '2026-07-26' })
  })

  /**
   * The rule that separates a correct implementation from the usual one. The
   * current day is still in progress, so a zero on it cannot end anything.
   */
  it('keeps the streak alive when today has no contributions yet', () => {
    const days = calendar('2026-07-20', [0, 3, 1, 2, 5, 1, 0])

    const { current } = computeStreaks(days, '2026-07-26')

    expect(current).toEqual({ length: 5, start: '2026-07-21', end: '2026-07-25' })
  })

  it('ends the streak when yesterday is also empty', () => {
    const days = calendar('2026-07-20', [3, 1, 2, 5, 0, 0, 0])

    const { current } = computeStreaks(days, '2026-07-26')

    expect(current).toEqual({ length: 0, start: null, end: null })
  })

  it('treats a day missing from the calendar as a zero', () => {
    const days = [
      { date: '2026-07-24', count: 4 },
      // 2026-07-25 absent entirely
      { date: '2026-07-26', count: 2 },
    ]

    const { current, longest } = computeStreaks(days, '2026-07-26')

    expect(current.length).toBe(1)
    expect(longest.length).toBe(1)
  })

  it('handles a streak of exactly one day', () => {
    const days = calendar('2026-07-24', [0, 0, 7])

    const { current, longest } = computeStreaks(days, '2026-07-26')

    expect(current).toEqual({ length: 1, start: '2026-07-26', end: '2026-07-26' })
    expect(longest).toEqual({ length: 1, start: '2026-07-26', end: '2026-07-26' })
  })

  it('ignores leading empty days when finding the longest run', () => {
    const days = calendar('2026-01-01', [0, 0, 0, 0, 0, 1, 1, 1, 0, 1])

    const { longest } = computeStreaks(days, '2026-07-26')

    expect(longest).toEqual({ length: 3, start: '2026-01-06', end: '2026-01-08' })
  })

  it('counts across a leap day', () => {
    const days = calendar('2024-02-26', [0, 1, 1, 1, 1, 0])

    const { longest } = computeStreaks(days, '2024-03-05')

    // 27 Feb through 1 Mar, which is four days only because 2024 has a 29th.
    expect(longest).toEqual({ length: 4, start: '2024-02-27', end: '2024-03-01' })
  })

  it('does not invent a leap day in a common year', () => {
    const days = calendar('2023-02-26', [0, 1, 1, 1, 0])

    const { longest } = computeStreaks(days, '2023-03-05')

    expect(longest).toEqual({ length: 3, start: '2023-02-27', end: '2023-03-01' })
  })

  it('reports the same range twice when the current streak is the record', () => {
    const days = calendar('2026-07-20', [0, 1, 1, 1, 1, 1, 1])

    const { current, longest } = computeStreaks(days, '2026-07-26')

    expect(current).toEqual(longest)
  })

  it('breaks ties on the longest streak in favour of the earliest run', () => {
    const days = calendar('2026-01-01', [1, 1, 0, 1, 1])

    const { longest } = computeStreaks(days, '2026-07-26')

    expect(longest).toEqual({ length: 2, start: '2026-01-01', end: '2026-01-02' })
  })

  it('accepts input in any order', () => {
    const ascending = calendar('2026-07-22', [1, 1, 1, 0, 0])
    const shuffled = [...ascending].reverse()

    expect(computeStreaks(shuffled, '2026-07-26')).toEqual(computeStreaks(ascending, '2026-07-26'))
  })

  it('discards entries that are not calendar dates', () => {
    const days = [
      { date: 'not-a-date', count: 99 },
      { date: '2026-07-26', count: 1 },
    ]

    expect(computeStreaks(days, '2026-07-26').current.length).toBe(1)
  })

  /**
   * A calendar ending before yesterday cannot support a current streak, however
   * long the run inside it was.
   */
  it('does not resurrect a streak from stale data', () => {
    const days = calendar('2026-07-01', [1, 1, 1, 1, 1])

    const { current, longest } = computeStreaks(days, '2026-07-26')

    expect(current.length).toBe(0)
    expect(longest.length).toBe(5)
  })

  /**
   * The case the Anywhere on Earth default exists to serve, and the reason the
   * walk anchors on the last active day instead of on the reference day.
   *
   * A reader in UTC+14 commits on their Monday, which is still Sunday for
   * Anywhere on Earth. Their most recent day is a day *ahead* of the reference,
   * so the gap between them is negative — and their streak is very obviously
   * alive. Measuring forward from the reference day could not see it at all.
   */
  it('counts a streak whose last day is ahead of the reference day', () => {
    const days = calendar('2026-07-20', [1, 1, 1, 1, 1, 1, 1])

    const { current } = computeStreaks(days, '2026-07-25')

    expect(current).toEqual({ length: 7, start: '2026-07-20', end: '2026-07-26' })
  })

  it('allows exactly one day of silence, and no more', () => {
    const days = calendar('2026-07-20', [1, 1, 1, 1, 1, 0, 0])

    // Last activity on the 24th: one day behind the 25th, two behind the 26th.
    expect(computeStreaks(days, '2026-07-25').current.length).toBe(5)
    expect(computeStreaks(days, '2026-07-26').current.length).toBe(0)
  })

  /**
   * Two readers, the same calendar, different zones. The one still finishing
   * yesterday must not be told their streak has ended.
   */
  it('gives a reader west of UTC the day their own clock says it is', () => {
    const days = calendar('2026-07-20', [1, 1, 1, 1, 1, 1, 0])

    // 2026-07-26 is the UTC day; AoE is still on the 25th, where the run ended.
    expect(computeStreaks(days, utcToday(new Date('2026-07-26T04:00:00Z'))).current.length).toBe(6)
    expect(
      computeStreaks(days, anywhereOnEarthToday(new Date('2026-07-26T04:00:00Z'))).current.length,
    ).toBe(6)
  })
})

describe('utcToday', () => {
  it('reads the calendar day in UTC, not in the local zone', () => {
    // 23:30 UTC on the 25th is already the 26th in Sydney and still the 25th in
    // New York. The answer must not depend on which one the Worker woke up in.
    expect(utcToday(new Date('2026-07-25T23:30:00Z'))).toBe('2026-07-25')
    expect(utcToday(new Date('2026-07-26T00:30:00Z'))).toBe('2026-07-26')
  })
})

describe('anywhereOnEarthToday', () => {
  /**
   * The whole point of the default. Through the first twelve hours of a UTC day
   * it is still yesterday, because it is still yesterday somewhere — which is
   * exactly the window in which the UTC answer was cutting people's streaks off
   * before their own day had ended.
   */
  it('is still yesterday until noon UTC', () => {
    expect(anywhereOnEarthToday(new Date('2026-07-26T00:30:00Z'))).toBe('2026-07-25')
    expect(anywhereOnEarthToday(new Date('2026-07-26T11:59:00Z'))).toBe('2026-07-25')
    expect(anywhereOnEarthToday(new Date('2026-07-26T12:00:00Z'))).toBe('2026-07-26')
    expect(anywhereOnEarthToday(new Date('2026-07-26T23:30:00Z'))).toBe('2026-07-26')
  })

  it('never runs ahead of the UTC day', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const now = new Date(`2026-07-26T${String(hour).padStart(2, '0')}:00:00Z`)
      expect(anywhereOnEarthToday(now) <= utcToday(now)).toBe(true)
    }
  })
})

describe('referenceToday', () => {
  it('falls back to Anywhere on Earth when no zone is named', () => {
    const now = new Date('2026-07-26T03:00:00Z')
    expect(referenceToday(null, now)).toBe('2026-07-25')
  })

  it('reads the date in the named zone', () => {
    // 03:00 UTC is the previous evening in Buenos Aires and mid-afternoon in
    // Auckland, which is a day the other side of Anywhere on Earth.
    const now = new Date('2026-07-26T03:00:00Z')
    expect(referenceToday('America/Argentina/Buenos_Aires', now)).toBe('2026-07-26')
    expect(referenceToday('Pacific/Auckland', now)).toBe('2026-07-26')
    expect(referenceToday('Pacific/Kiritimati', new Date('2026-07-26T13:00:00Z'))).toBe(
      '2026-07-27',
    )
  })

  it('falls back rather than throwing on a zone the runtime rejects', () => {
    const now = new Date('2026-07-26T03:00:00Z')
    expect(referenceToday('Mars/Olympus_Mons', now)).toBe('2026-07-25')
  })
})
