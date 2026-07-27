import { describe, expect, it } from 'vitest'
import { cacheKey, hasCurrentShape } from '../src/cache'
import { type CardParams, parseParams } from '../src/params'

function params(query: string): CardParams {
  const result = parseParams(new URLSearchParams(query))
  if (!result.ok) throw new Error(`not a valid query: ${query}`)
  return result.params
}

const BUILD = 'abc1234'

const keyFor = (query: string, build = BUILD) => cacheKey(params(query), build)

/**
 * The entry holds `StatsData` and nothing else — the SVG is built per request
 * from whatever the cache returns. These tests pin the consequence of that: the
 * key must not know anything about how the card looks, or every theme would pay
 * for its own round of GitHub calls.
 */
describe('style parameters do not participate in the key', () => {
  const base = 'username=octocat'

  const styleOnly = [
    'theme=amber',
    'theme=light',
    'ring=%23ff0000',
    'accent=%2300ff00',
    'bg=transparent',
    'text=%23ffffff',
    'muted=%23888888',
    'border=none',
    'radius=24',
    'scanlines=false',
    'animate=false',
    'show_credit=true',
    'lang_style=bars',
    'locale=es',
    'cache_seconds=1800',
  ]

  for (const parameter of styleOnly) {
    it(`ignores ${parameter}`, () => {
      expect(keyFor(`${base}&${parameter}`)).toBe(keyFor(base))
    })
  }

  it('gives two different themes the same entry', () => {
    expect(keyFor(`${base}&theme=amber`)).toBe(keyFor(`${base}&theme=ice`))
  })

  it('ignores every style parameter at once', () => {
    expect(keyFor(`${base}&${styleOnly.join('&')}`)).toBe(keyFor(base))
  })
})

describe('data parameters do participate in the key', () => {
  const base = 'username=octocat'

  it('separates entries by username, case-insensitively', () => {
    expect(keyFor('username=octocat')).not.toBe(keyFor('username=defunkt'))
    expect(keyFor('username=OctoCat')).toBe(keyFor('username=octocat'))
  })

  it('separates entries when the language count changes', () => {
    expect(keyFor(`${base}&langs_count=4`)).not.toBe(keyFor(`${base}&langs_count=8`))
  })

  it('separates entries when the exclusions change', () => {
    expect(keyFor(`${base}&exclude_langs=html`)).not.toBe(keyFor(base))
  })

  /** Hiding a module skips its query, so it changes what was fetched. */
  it('separates entries when a module is hidden', () => {
    expect(keyFor(`${base}&hide=langs`)).not.toBe(keyFor(base))
    expect(keyFor(`${base}&hide=total`)).not.toBe(keyFor(`${base}&hide=langs`))
  })

  it('does not care about the order or case of a list', () => {
    expect(keyFor(`${base}&hide=langs,total`)).toBe(keyFor(`${base}&hide=TOTAL,langs`))
    expect(keyFor(`${base}&exclude_langs=css,html`)).toBe(keyFor(`${base}&exclude_langs=HTML,css`))
  })
})

/**
 * The bug this guards: an entry written before `languages` changed meaning was
 * still being served, because the only thing distinguishing it was the build id
 * — and under `wrangler dev` the build id is a constant read from
 * `wrangler.toml`. The key is now also versioned by what an entry means, and
 * anything that slips through both is rejected on read.
 */
describe('shape validation', () => {
  const current = {
    freshUntil: 1,
    data: {
      login: 'octocat',
      name: null,
      createdAt: '2019-01-01',
      totalContributions: 10,
      yearContributions: 5,
      bestYearContributions: 8,
      streaks: {
        current: { length: 0, start: null, end: null },
        longest: { length: 0, start: null, end: null },
      },
      calendar: { from: '2025-07-21', counts: [0, 1] },
      languages: [],
      fetchedAt: 0,
    },
  }

  it('accepts an entry the current code can read', () => {
    expect(hasCurrentShape(current)).toBe(true)
  })

  it('rejects an entry written before the calendar existed', () => {
    const { calendar: _gone, ...withoutCalendar } = current.data

    expect(hasCurrentShape({ ...current, data: withoutCalendar })).toBe(false)
  })

  it('rejects entries missing any field a renderer dereferences', () => {
    for (const field of [
      'login',
      'totalContributions',
      'yearContributions',
      'bestYearContributions',
      'languages',
      'streaks',
    ] as const) {
      const { [field]: _dropped, ...rest } = current.data
      expect(hasCurrentShape({ ...current, data: rest }), field).toBe(false)
    }
  })

  it('rejects anything that is not an entry at all', () => {
    for (const junk of [null, undefined, 'string', 42, [], {}, { data: null }]) {
      expect(hasCurrentShape(junk)).toBe(false)
    }
  })
})

describe('build namespacing', () => {
  it('retires every entry when the build changes', () => {
    expect(keyFor('username=octocat', 'abc1234')).not.toBe(keyFor('username=octocat', 'def5678'))
  })

  it('is stable within a build', () => {
    expect(keyFor('username=octocat')).toBe(keyFor('username=octocat'))
  })

  it('reads as <schema>:<build>:<login>:<hash>', () => {
    expect(keyFor('username=OctoCat')).toMatch(/^v\d+:abc1234:octocat:[0-9a-f]{8}$/)
  })
})
