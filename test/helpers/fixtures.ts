import type { CompactCalendar, LanguageStat, StatsData } from '../../src/github/types'
import type { RepoSample } from '../../src/languages'
import { type CardParams, parseParams } from '../../src/params'

/** Fixed so that snapshots and date subtitles do not drift with the clock. */
export const FIXED_NOW = Date.parse('2026-07-26T12:00:00Z')

/**
 * A synthetic year with a plausible rhythm: busier on weekdays, quiet in
 * stretches, and a run of dense days near the end so the heatmap has something
 * to grade. Seeded, so every run and every snapshot sees the same year.
 */
export function calendarFixture(span = 371, seed = 12345): CompactCalendar {
  let state = seed
  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }

  const counts = Array.from({ length: span }, (_, index) => {
    const weekday = (index + 3) % 7
    if (weekday === 0 || weekday === 6) return next() < 0.6 ? 0 : Math.floor(next() * 4)
    if (next() < 0.25) return 0
    return 1 + Math.floor(next() * 12)
  })

  return { from: '2025-07-21', counts }
}

/**
 * A stored sample that ranks back to exactly the shares given.
 *
 * The cache no longer holds a finished ranking, so a test that wants to say
 * "41%" has to say it in the units the ranking actually consumes. One repository
 * per language, every one recently pushed, sized by the share it should come out
 * with. Two properties of `rankLanguages` make that exact rather than
 * approximate: below seven repositories the per-repository cap does not engage
 * at all, and a repository holding a single language contributes precisely its
 * own bytes. So the percentages out are the percentages in — provided they sum
 * to one, which is why the default list below carries a fifth language that the
 * default `langs_count` then slices off.
 */
export function repoSampleFixture(languages: readonly LanguageStat[]): RepoSample {
  return {
    langs: languages.map(({ name, color }) => ({ name, color })),
    repos: languages.map((language, index) => ({
      w: 1,
      p: index,
      e: [[index, Math.round(language.pct * 1_000_000)]],
    })),
  }
}

/** Sums to one, so the top four come out at 41, 25, 17 and 10 per cent. */
const LANGUAGES: LanguageStat[] = [
  { name: 'TypeScript', color: '#3178c6', size: 0, pct: 0.41 },
  { name: 'Rust', color: '#dea584', size: 0, pct: 0.25 },
  { name: 'Python', color: '#3572A5', size: 0, pct: 0.17 },
  { name: 'Go', color: '#00ADD8', size: 0, pct: 0.1 },
  { name: 'Kotlin', color: '#A97BFF', size: 0, pct: 0.07 },
]

/**
 * `languages` is a convenience: it is not a field of `StatsData` any more, and
 * is compiled into the repository sample the ranking reads. Pass `repos`
 * directly to exercise the stored shape itself.
 */
export function statsFixture(
  overrides: Partial<StatsData> & { languages?: readonly LanguageStat[] } = {},
): StatsData {
  const { languages, ...rest } = overrides

  return {
    login: 'rondrft',
    name: 'Ron',
    createdAt: '2019-04-11',
    totalContributions: 4821,
    yearContributions: 1204,
    bestYearContributions: 1610,
    calendar: calendarFixture(),
    streaks: {
      current: { length: 37, start: '2026-06-20', end: '2026-07-26' },
      longest: { length: 112, start: '2024-01-02', end: '2024-04-22' },
    },
    repos: repoSampleFixture(languages ?? LANGUAGES),
    fetchedAt: FIXED_NOW,
    ...rest,
  }
}

/** Builds params the same way a real request would, from a query string. */
export function paramsFixture(query = 'username=rondrft'): CardParams {
  const result = parseParams(new URLSearchParams(query))
  if (!result.ok) throw new Error(`fixture query is not valid: ${query}`)
  return result.params
}
