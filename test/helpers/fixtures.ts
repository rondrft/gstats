import type { StatsData } from '../../src/github/types'
import { type CardParams, parseParams } from '../../src/params'

/** Fixed so that snapshots and date subtitles do not drift with the clock. */
export const FIXED_NOW = Date.parse('2026-07-26T12:00:00Z')

export function statsFixture(overrides: Partial<StatsData> = {}): StatsData {
  return {
    login: 'rondrft',
    name: 'Ron',
    createdAt: '2019-04-11',
    totalContributions: 4821,
    streaks: {
      current: { length: 37, start: '2026-06-20', end: '2026-07-26' },
      longest: { length: 112, start: '2024-01-02', end: '2024-04-22' },
    },
    languages: [
      { name: 'TypeScript', color: '#3178c6', size: 820_000, pct: 0.41 },
      { name: 'Rust', color: '#dea584', size: 500_000, pct: 0.25 },
      { name: 'Python', color: '#3572A5', size: 340_000, pct: 0.17 },
      { name: 'Go', color: '#00ADD8', size: 200_000, pct: 0.1 },
    ],
    fetchedAt: FIXED_NOW,
    ...overrides,
  }
}

/** Builds params the same way a real request would, from a query string. */
export function paramsFixture(query = 'username=rondrft'): CardParams {
  const result = parseParams(new URLSearchParams(query))
  if (!result.ok) throw new Error(`fixture query is not valid: ${query}`)
  return result.params
}
