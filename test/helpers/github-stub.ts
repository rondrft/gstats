import { vi } from 'vitest'

/**
 * Stand-in for api.github.com.
 *
 * The suite never leaves the isolate. Requests are routed by the shape of the
 * GraphQL document rather than by URL, since every call in the service hits the
 * same endpoint, and the stub records how many times it was called so tests can
 * assert that the cache actually prevented work.
 */

export interface StubOptions {
  /** Overrides the successful payload for a given query kind. */
  respond?: (kind: QueryKind, variables: Record<string, unknown>) => unknown | undefined
  /** Rate limit headers to report on every response. */
  headers?: Record<string, string>
  /** Status to return instead of 200. */
  status?: number
}

export type QueryKind = 'bootstrap' | 'history' | 'languages'

export interface GitHubStub {
  fetch: ReturnType<typeof vi.fn>
  /** Number of upstream calls made since the stub was installed. */
  readonly calls: number
}

const DAY_MS = 86_400_000

/** Daily counts of the fixture calendar, oldest first, ending on the run date. */
const FIXTURE_COUNTS = [0, 4, 2, 7, 1, 3, 5]

function classify(query: string): QueryKind {
  if (query.includes('repositories(')) return 'languages'
  if (query.includes('createdAt')) return 'bootstrap'
  return 'history'
}

const isoDay = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10)

/**
 * The calendar is anchored to the day the suite runs rather than to a fixed
 * date. A current streak is by definition relative to today, so a hard-coded
 * fixture would start failing the morning after it was written.
 */
export function fixtureDay(offsetFromToday: number): string {
  return isoDay(Date.now() + offsetFromToday * DAY_MS)
}

/** A calendar with a live six-day streak ending today. */
function recentWeeks() {
  const oldest = FIXTURE_COUNTS.length - 1
  return [
    {
      contributionDays: FIXTURE_COUNTS.map((contributionCount, index) => ({
        date: fixtureDay(index - oldest),
        contributionCount,
      })),
    },
  ]
}

function defaultPayload(kind: QueryKind, query: string): unknown {
  if (kind === 'bootstrap') {
    return {
      user: {
        login: 'rondrft',
        name: 'Ron',
        createdAt: '2019-04-11T09:30:00Z',
        contributionsCollection: {
          contributionCalendar: { totalContributions: 812, weeks: recentWeeks() },
        },
      },
    }
  }

  if (kind === 'history') {
    // Mirror back exactly the aliases the client asked for, so the batching
    // logic is exercised rather than assumed.
    const user: Record<string, unknown> = {}
    for (const [, year] of query.matchAll(/(y\d{4}): contributionsCollection/g)) {
      if (year === undefined) continue
      user[year] = { contributionCalendar: { totalContributions: 500 } }
    }
    return { user }
  }

  return {
    user: {
      repositories: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [
          {
            name: 'phosphor-stats',
            languages: {
              edges: [
                { size: 82_000, node: { name: 'TypeScript', color: '#3178c6' } },
                { size: 12_000, node: { name: 'HTML', color: '#e34c26' } },
              ],
            },
          },
        ],
      },
    },
  }
}

/**
 * Installs the stub as the global `fetch` for the duration of the test. The
 * Worker under test runs in this same isolate, so it picks the stub up.
 */
export function stubGitHub(options: StubOptions = {}): GitHubStub {
  const headers = {
    'x-ratelimit-limit': '5000',
    'x-ratelimit-remaining': '4999',
    'x-ratelimit-reset': String(Math.floor((Date.now() + 3_600_000) / 1000)),
    ...options.headers,
  }

  const fetchStub = vi.fn(async (_input: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as {
      query: string
      variables: Record<string, unknown>
    }
    const kind = classify(body.query)
    const override = options.respond?.(kind, body.variables)
    const payload = override ?? { data: defaultPayload(kind, body.query) }

    return new Response(JSON.stringify(override === undefined ? payload : override), {
      status: options.status ?? 200,
      headers: { ...headers, 'content-type': 'application/json' },
    })
  })

  vi.stubGlobal('fetch', fetchStub)

  return {
    fetch: fetchStub,
    get calls() {
      return fetchStub.mock.calls.length
    },
  }
}
