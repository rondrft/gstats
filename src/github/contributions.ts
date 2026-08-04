/**
 * Contribution history.
 *
 * `contributionsCollection` accepts at most one year per call, so a lifetime
 * total has to be assembled from one window per calendar year since the account
 * was created. Windows are aligned to calendar years rather than to rolling
 * 365-day spans: the windows are then provably disjoint, which is what makes
 * summing their totals correct rather than approximate.
 *
 * Those historical windows are requested as aliased fields of a single query
 * instead of one call each. A ten year old account costs two requests rather
 * than eleven, and the hourly quota is the scarcest resource this service has
 * (see docs/self-hosting.md). Aliased `contributionsCollection` fields are not
 * connections, so the extra GraphQL node cost is negligible.
 *
 * The calendar itself is only requested for the two most recent windows. That
 * covers between 366 and 730 days depending on the time of year — always more
 * than the streak calculation needs — while older windows return a single
 * integer each.
 */

import { addDays, type ContributionDay } from '../streak'
import type { GitHubClient } from './client'
import type { CompactCalendar } from './types'
import { StatsError } from './types'

/**
 * Days of history the heatmap design draws: 53 columns of 7, which is what fits
 * a card and what GitHub itself shows. The streak calculation needs far less,
 * but the same array serves both.
 */
export const CALENDAR_SPAN = 53 * 7

/**
 * Reduces a dated calendar to a positional one ending on `today`.
 *
 * Days the API did not report become zeros rather than gaps, so the array is
 * dense and the renderer can index it by offset without searching.
 *
 * **`today` is the UTC day, not the streak's reference day**, and the two come
 * apart for up to twelve hours out of every twenty-four. Anywhere on Earth is
 * the right boundary for a streak, where being generous means never cutting a
 * run short; it is the wrong one here, where being generous means leaving out a
 * day that has already happened and that GitHub is already drawing. The window
 * was the reference day once, and the last square on the card was missing for
 * half of every day as a result.
 *
 * The span is exact and constant: **the array is always 371 days, so the grid
 * is always 53 full columns.** GitHub's own calendar is aligned to weeks and
 * ends on a partial one, so its last column holds one to seven days and its
 * total span is 365 to 371. This one ends on `today` and counts back, which
 * means the columns are seven consecutive days rather than Sunday to Saturday —
 * they do not line up with GitHub's, and counting columns between the two
 * disagrees for that reason rather than because one is missing. The upside is
 * the one that matters here: every cell is a real day in the past, so there is
 * never a future square sitting in the grid pretending to be an idle one.
 */
export function compactCalendar(days: readonly ContributionDay[], today: string): CompactCalendar {
  const byDate = new Map(days.map((day) => [day.date, day.count]))
  const from = addDays(today, -(CALENDAR_SPAN - 1))
  const counts = Array.from(
    { length: CALENDAR_SPAN },
    (_, index) => byDate.get(addDays(from, index)) ?? 0,
  )
  return { from, counts }
}

const CALENDAR_FIELDS = `weeks { contributionDays { date contributionCount } }`

const BOOTSTRAP_QUERY = `query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    login
    name
    createdAt
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar {
        totalContributions
        ${CALENDAR_FIELDS}
      }
    }
  }
}`

interface CalendarPayload {
  contributionCalendar: {
    totalContributions: number
    weeks?: { contributionDays: { date: string; contributionCount: number }[] }[]
  }
}

interface BootstrapPayload {
  user: {
    login: string
    name: string | null
    createdAt: string
    contributionsCollection: CalendarPayload
  } | null
}

type HistoryPayload = {
  user: Record<string, CalendarPayload> | null
}

export interface ContributionsResult {
  login: string
  name: string | null
  /** `YYYY-MM-DD`, UTC. */
  createdAt: string
  /** Lifetime total, or the current year's total when `includeHistory` is false. */
  total: number
  /** The current calendar year so far. */
  year: number
  /** The best calendar year on record, including the current one. */
  bestYear: number
  /** Daily counts covering at least the last 366 days, ascending. */
  calendar: ContributionDay[]
}

export interface ContributionsOptions {
  /** Reference day, `YYYY-MM-DD` UTC. */
  today: string
  /**
   * Whether to walk back to the account's first year. Skipped when the total is
   * hidden, since nothing else on the card depends on it.
   */
  includeHistory: boolean
}

export async function fetchContributions(
  client: GitHubClient,
  login: string,
  { today, includeHistory }: ContributionsOptions,
): Promise<ContributionsResult> {
  const currentYear = Number(today.slice(0, 4))

  const bootstrap = await client.query<BootstrapPayload>(BOOTSTRAP_QUERY, {
    login,
    from: startOfYear(currentYear),
    to: endOfDay(today),
  })

  const user = bootstrap.user
  if (user === null) throw new StatsError('not-found', `no such user: ${login}`)

  const calendar = new Map<string, number>()
  collectCalendar(user.contributionsCollection, calendar)

  const firstYear = Number(user.createdAt.slice(0, 4))
  const year = user.contributionsCollection.contributionCalendar.totalContributions
  let total = year
  let bestYear = year

  // The previous year is always fetched, even when the total is hidden: without
  // it the calendar would be one day long every 1 January.
  const years = historyYears(firstYear, currentYear, includeHistory)

  if (years.length > 0) {
    const history = await client.query<HistoryPayload>(buildHistoryQuery(years, currentYear - 1), {
      login,
      ...historyVariables(years),
    })

    for (const windowYear of years) {
      const window = history.user?.[aliasFor(windowYear)]
      if (window === undefined) continue
      const windowTotal = window.contributionCalendar.totalContributions
      if (includeHistory) {
        total += windowTotal
        bestYear = Math.max(bestYear, windowTotal)
      }
      collectCalendar(window, calendar)
    }
  }

  return {
    login: user.login,
    name: user.name,
    createdAt: user.createdAt.slice(0, 10),
    total,
    year,
    bestYear,
    calendar: [...calendar.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  }
}

/**
 * Windows to request beyond the current year.
 *
 * With history disabled this is just the previous year, kept for calendar
 * coverage. Accounts created in the current year have no previous year at all.
 */
function historyYears(firstYear: number, currentYear: number, includeHistory: boolean): number[] {
  const oldest = includeHistory ? firstYear : currentYear - 1
  const years: number[] = []
  for (let year = currentYear - 1; year >= Math.max(oldest, firstYear); year -= 1) {
    years.push(year)
  }
  return years
}

const aliasFor = (year: number) => `y${year}`

/** `calendarYear` is the one window in the batch that also returns daily counts. */
function buildHistoryQuery(years: readonly number[], calendarYear: number): string {
  const declarations = years
    .map((year) => `$from${year}: DateTime!, $to${year}: DateTime!`)
    .join(', ')

  const fields = years
    .map(
      (year) =>
        `${aliasFor(year)}: contributionsCollection(from: $from${year}, to: $to${year}) {
          contributionCalendar {
            totalContributions
            ${year === calendarYear ? CALENDAR_FIELDS : ''}
          }
        }`,
    )
    .join('\n')

  return `query($login: String!, ${declarations}) {
  user(login: $login) {
${fields}
  }
}`
}

function historyVariables(years: readonly number[]): Record<string, string> {
  const variables: Record<string, string> = {}
  for (const year of years) {
    variables[`from${year}`] = startOfYear(year)
    variables[`to${year}`] = endOfYear(year)
  }
  return variables
}

function collectCalendar(payload: CalendarPayload, into: Map<string, number>): void {
  for (const week of payload.contributionCalendar.weeks ?? []) {
    for (const day of week.contributionDays) {
      into.set(day.date, day.contributionCount)
    }
  }
}

const startOfYear = (year: number) => `${year}-01-01T00:00:00Z`
const endOfYear = (year: number) => `${year}-12-31T23:59:59Z`
const endOfDay = (date: string) => `${date}T23:59:59Z`
