import { describe, expect, it } from 'vitest'
import { cacheKey, hasCurrentShape, shouldPublishAlert } from '../src/cache'
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

/**
 * This reading used to be written to KV on a five-minute sample, which cost a
 * fixed 288 writes a day per instance — 29% of the free plan's whole allowance
 * — to keep one diagnostic field on `/health` current. It now lives in a module
 * variable, and KV holds only the case that is not diagnostic: an instance
 * actually running out, which has to survive the isolate that noticed.
 */
describe('publishing a low quota reading', () => {
  const at = (minutes: number) => Date.parse('2026-07-27T12:00:00Z') + minutes * 60_000
  const stored = (remaining: number, minutes: number) => ({
    remaining,
    limit: 5000,
    reset: null,
    observedAt: at(minutes),
  })

  it('publishes when KV has never heard of the problem', () => {
    expect(shouldPublishAlert(null, at(0))).toBe(true)
  })

  it('publishes when KV still shows a healthy budget', () => {
    expect(shouldPublishAlert(stored(4000, 0), at(1))).toBe(true)
  })

  /**
   * Below the line every fresh isolate would otherwise write once, and that is
   * exactly when the instance is busiest and least able to afford it.
   */
  it('does not republish an alert KV already carries', () => {
    expect(shouldPublishAlert(stored(900, 0), at(1))).toBe(false)
    expect(shouldPublishAlert(stored(900, 0), at(4))).toBe(false)
  })

  it('refreshes a stale alert so the reading does not rot', () => {
    expect(shouldPublishAlert(stored(900, 0), at(5))).toBe(true)
    expect(shouldPublishAlert(stored(900, 0), at(45))).toBe(true)
  })

  it('publishes over a reading whose remaining is unknown', () => {
    expect(shouldPublishAlert({ ...stored(0, 0), remaining: null }, at(1))).toBe(true)
  })
})
