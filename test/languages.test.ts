import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EXCLUDED,
  MIN_SHARE,
  type RankOptions,
  REPO_CAP,
  type RepoLanguages,
  rankLanguages,
  recencyWeight,
  sampleRepos,
} from '../src/languages'

const NOW = Date.parse('2026-07-27T00:00:00Z')

const DAY = 86_400_000
const daysAgo = (days: number) => new Date(NOW - days * DAY).toISOString()

function repo(
  _name: string,
  edges: [string, number][],
  options: { pushedAt?: string; primary?: string } = {},
): RepoLanguages {
  return {
    pushedAt: options.pushedAt ?? daysAgo(10),
    primaryLanguage: options.primary ?? edges[0]?.[0] ?? null,
    edges: edges.map(([language, size]) => ({ name: language, color: null, size })),
  }
}

/**
 * Ranking now reads the stored sample rather than the fetched repositories, so
 * the fixtures go through the same compaction production does — which is also
 * where the recency weight is resolved, and so where `NOW` is spent.
 */
function rank(repos: RepoLanguages[], overrides: Partial<RankOptions> = {}) {
  return rankLanguages(sampleRepos(repos, NOW), {
    mode: 'bytes',
    limit: 8,
    exclude: [],
    include: [],
    ...overrides,
  })
}

const shareOf = (result: ReturnType<typeof rank>, name: string) =>
  result.find((language) => language.name === name)?.pct ?? 0

describe('recency weighting', () => {
  it('grades a repository by how recently it was pushed to', () => {
    expect(recencyWeight(daysAgo(1), NOW)).toBe(1)
    expect(recencyWeight(daysAgo(180), NOW)).toBe(1)
    expect(recencyWeight(daysAgo(200), NOW)).toBe(0.5)
    expect(recencyWeight(daysAgo(364), NOW)).toBe(0.5)
    expect(recencyWeight(daysAgo(400), NOW)).toBe(0.25)
    expect(recencyWeight(daysAgo(3000), NOW)).toBe(0.25)
  })

  it('treats an unknown or unparseable date as stale rather than dropping it', () => {
    expect(recencyWeight(null, NOW)).toBe(0.25)
    expect(recencyWeight('not-a-date', NOW)).toBe(0.25)
  })

  /**
   * The behaviour the weight exists for: the same code, abandoned, should not
   * outrank what somebody is writing now.
   */
  it('demotes a language that only lives in old repositories', () => {
    const repos = [
      repo('legacy', [['Java', 900_000]], { pushedAt: daysAgo(900) }),
      repo('current', [['Rust', 300_000]], { pushedAt: daysAgo(5) }),
    ]

    const result = rank(repos)

    expect(result[0]?.name).toBe('Rust')
    expect(shareOf(result, 'Rust')).toBeGreaterThan(shareOf(result, 'Java'))
  })
})

describe('per-repository cap', () => {
  /**
   * The failure this cap exists for: one enormous repository deciding the whole
   * card. Ten small ones should be able to outweigh it.
   */
  it('stops a dominant repository from deciding the list', () => {
    const monorepo = repo('monorepo', [['Java', 10_000_000]])
    const others = Array.from({ length: 12 }, (_, index) =>
      repo(`small-${index}`, [['Rust', 40_000]]),
    )

    const capped = rank([monorepo, ...others])
    const uncapped = rank([monorepo])

    // Uncapped, Java is everything. Capped, it is bounded near the cap and Rust
    // — twelve repositories of it — leads.
    expect(shareOf(uncapped, 'Java')).toBeCloseTo(1, 5)
    expect(shareOf(capped, 'Java')).toBeLessThanOrEqual(REPO_CAP + 0.001)
    expect(capped[0]?.name).toBe('Rust')
  })

  it('leaves a single repository alone, since there is nothing to bound it against', () => {
    const result = rank([
      repo('only', [
        ['Go', 500],
        ['Rust', 500],
      ]),
    ])

    expect(shareOf(result, 'Go')).toBeCloseTo(0.5, 5)
    expect(shareOf(result, 'Rust')).toBeCloseTo(0.5, 5)
  })

  /**
   * Below 1/cap repositories the cap cannot be met by all of them at once, and
   * forcing it would flatten the account to equal shares. On a two-repository
   * account the larger one legitimately is most of the work.
   */
  it('stays out of the way on an account too small for the cap to bind', () => {
    const result = rank([repo('big', [['Go', 900_000]]), repo('small', [['Rust', 100_000]])])

    expect(shareOf(result, 'Go')).toBeCloseTo(0.9, 5)
    expect(shareOf(result, 'Rust')).toBeCloseTo(0.1, 5)
  })

  it('engages as soon as enough repositories exist to satisfy it', () => {
    const build = (count: number) => [
      repo('big', [['Go', 900_000]]),
      ...Array.from({ length: count - 1 }, (_, index) => repo(`r${index}`, [['Rust', 10_000]])),
    ]

    // Six repositories: 6 x 15% cannot cover the whole account, so no cap.
    expect(shareOf(rank(build(6)), 'Go')).toBeGreaterThan(REPO_CAP)
    // Seven can, and from there the ceiling holds.
    expect(shareOf(rank(build(7)), 'Go')).toBeLessThanOrEqual(REPO_CAP + 0.001)
  })
})

describe('exclusions', () => {
  const markup = [
    repo('site', [
      ['HTML', 400_000],
      ['CSS', 300_000],
      ['TypeScript', 100_000],
    ]),
  ]

  it('drops the by-product languages by default', () => {
    const result = rank(markup)

    expect(result.map((language) => language.name)).toEqual(['TypeScript'])
  })

  it('covers every name the default list claims to', () => {
    const repos = DEFAULT_EXCLUDED.map((name, index) =>
      repo(`r${index}`, [
        [titleCase(name), 1000],
        ['Rust', 10],
      ]),
    )

    const result = rank(repos)

    expect(result.map((language) => language.name)).toEqual(['Rust'])
  })

  it('re-admits only the language that was asked for', () => {
    const result = rank(markup, { include: ['css'] }).map((language) => language.name)

    expect(result).toContain('CSS')
    expect(result).toContain('TypeScript')
    expect(result).not.toContain('HTML')
  })

  it('still lets the caller exclude something the defaults allow', () => {
    const result = rank(
      [
        repo('r', [
          ['Rust', 100],
          ['Go', 100],
        ]),
      ],
      { exclude: ['rust'] },
    )

    expect(result.map((language) => language.name)).toEqual(['Go'])
  })

  it('matches names case-insensitively', () => {
    const result = rank(
      [
        repo('r', [
          ['TypeScript', 100],
          ['Go', 100],
        ]),
      ],
      {
        exclude: ['typescript'],
      },
    )

    expect(result.map((language) => language.name)).toEqual(['Go'])
  })
})

describe('noise floor', () => {
  it('drops anything under half a percent', () => {
    const result = rank([
      repo('r', [
        ['Rust', 100_000],
        ['Go', 100],
      ]),
    ])

    expect(shareOf(result, 'Go')).toBe(0)
    expect(result).toHaveLength(1)
  })

  it('keeps a language sitting exactly on the floor', () => {
    const result = rank([
      repo('r', [
        ['Rust', 995],
        ['Go', 5],
      ]),
    ])

    expect(shareOf(result, 'Go')).toBeGreaterThanOrEqual(MIN_SHARE)
    expect(result).toHaveLength(2)
  })
})

describe('lang_mode=repos', () => {
  /**
   * The two modes answer different questions, so on a portfolio with one huge
   * project in a language used nowhere else they should disagree.
   */
  it('orders differently from bytes on the same data', () => {
    const repos = [
      repo('one-big-thing', [['Scala', 4_000_000]]),
      repo('a', [['Rust', 20_000]]),
      repo('b', [['Rust', 20_000]]),
      repo('c', [['Rust', 20_000]]),
      repo('d', [['Rust', 20_000]]),
    ]

    const byBytes = rank(repos).map((language) => language.name)
    const byRepos = rank(repos, { mode: 'repos' }).map((language) => language.name)

    expect(byRepos[0]).toBe('Rust')
    expect(byRepos).not.toEqual(byBytes)
  })

  it('counts a repository once however large it is', () => {
    const result = rank([repo('huge', [['Go', 9_000_000]]), repo('tiny', [['Rust', 12]])], {
      mode: 'repos',
    })

    expect(shareOf(result, 'Go')).toBeCloseTo(0.5, 5)
    expect(shareOf(result, 'Rust')).toBeCloseTo(0.5, 5)
  })

  /**
   * A site whose bulk is markup is still a TypeScript project. Discarding it
   * because Linguist called it HTML would lose the repository entirely.
   */
  it('falls through to the next language when the primary one is excluded', () => {
    const result = rank(
      [
        repo(
          'site',
          [
            ['HTML', 900_000],
            ['TypeScript', 20_000],
          ],
          { primary: 'HTML' },
        ),
      ],
      { mode: 'repos' },
    )

    expect(result.map((language) => language.name)).toEqual(['TypeScript'])
  })

  it('applies the recency weight, since the question is about current practice', () => {
    const result = rank(
      [
        repo('old', [['Java', 100]], { pushedAt: daysAgo(900) }),
        repo('new', [['Rust', 100]], { pushedAt: daysAgo(3) }),
      ],
      { mode: 'repos' },
    )

    expect(result[0]?.name).toBe('Rust')
    expect(shareOf(result, 'Rust')).toBeCloseTo(0.8, 5)
  })
})

describe('degenerate input', () => {
  it('returns nothing for an account with no repositories', () => {
    expect(rank([])).toEqual([])
  })

  it('returns nothing when every language was excluded', () => {
    expect(
      rank([
        repo('site', [
          ['HTML', 100],
          ['CSS', 100],
        ]),
      ]),
    ).toEqual([])
  })

  it('returns nothing when every repository is empty', () => {
    expect(rank([repo('empty', []), repo('also-empty', [])])).toEqual([])
  })

  it('honours the limit', () => {
    const repos = ['Rust', 'Go', 'Python', 'Ruby', 'Zig'].map((language, index) =>
      repo(`r${index}`, [[language, 1000 - index]]),
    )

    expect(rank(repos, { limit: 3 })).toHaveLength(3)
  })
})

/**
 * What the cache now carries, and the only thing that made moving the ranking
 * out of the fetch a real trade rather than a free one.
 *
 * The obvious store — the fetched `RepoLanguages[]` — is about 53 KB at the
 * pagination cap, nearly all of it the same few language names and Linguist
 * colours repeated across three thousand edges. Interning them takes a real
 * account at the cap to roughly 11 KB, which is what makes this affordable on
 * every profile rather than only on the ones using a non-default setting.
 *
 * The ceiling that matters is not this: KV bills writes per operation, not per
 * byte, so a larger entry costs nothing against the budget in docs/limits.md.
 * The bound here exists so that the *next* field added to a repository is
 * measured rather than assumed.
 */
describe('the stored sample', () => {
  const LANGUAGES = [
    'TypeScript',
    'JavaScript',
    'Python',
    'Rust',
    'Go',
    'Ruby',
    'Java',
    'Kotlin',
    'Swift',
    'C',
    'C++',
    'C#',
    'PHP',
    'Elixir',
    'Haskell',
    'Lua',
    'Perl',
    'Scala',
    'Clojure',
    'Zig',
    'Nix',
  ]

  /** The pagination cap: 300 repositories of ten languages each. */
  const atCap = Array.from({ length: 300 }, (_, index) =>
    repo(
      `r${index}`,
      Array.from({ length: 10 }, (_unused, slot): [string, number] => [
        LANGUAGES[(index * 7 + slot * 3) % LANGUAGES.length] ?? 'C',
        1_000_000 - slot * 1000,
      ]),
    ),
  )

  it('interns names and colours instead of repeating them', () => {
    const sample = sampleRepos(atCap, NOW)

    expect(sample.repos).toHaveLength(300)
    // One table entry per distinct language, not one per edge.
    expect(sample.langs.length).toBeLessThanOrEqual(LANGUAGES.length)
  })

  /**
   * The saving, stated as the ratio rather than as a number somebody would have
   * to re-measure. `atCap` is deliberately harsher than any real account — every
   * one of its 300 repositories carries the full ten languages — so the naive
   * form here is worse than the 53 KB a real account at the cap produces, and
   * the ratio is the honest thing to hold onto.
   */
  it('costs a fraction of storing what was fetched', () => {
    const interned = JSON.stringify(sampleRepos(atCap, NOW)).length
    const naive = JSON.stringify(atCap).length

    expect(interned).toBeLessThan(naive / 3)
  })

  it('stays small enough to sit in every entry', () => {
    const bytes = new TextEncoder().encode(JSON.stringify(sampleRepos(atCap, NOW))).length

    // 41 KB for this synthetic ceiling; a real account at the cap measures about
    // 11 KB. Both are nothing against KV's 25 MB per value, and KV bills writes
    // per operation rather than per byte, so neither touches the budget in
    // docs/limits.md. The bound is here so the next field added to a repository
    // is measured rather than assumed.
    expect(bytes).toBeLessThan(64 * 1024)
  })
})

const titleCase = (value: string) =>
  value
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
