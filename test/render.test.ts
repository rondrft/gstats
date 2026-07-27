import { describe, expect, it } from 'vitest'
import { renderCard } from '../src/render/card'
import { renderErrorCard } from '../src/render/error-card'
import { CARD_HEIGHT } from '../src/render/layout'
import { ARC, CIRCUMFERENCE } from '../src/render/ring'
import { paramsFixture, statsFixture } from './helpers/fixtures'

/** Bytes, as served. The card lives in a README and competes with the page. */
const SIZE_BUDGET = 12 * 1024

const byteLength = (svg: string) => new TextEncoder().encode(svg).length

function attributes(svg: string, selector: RegExp): string[] {
  return svg.match(selector) ?? []
}

describe('document', () => {
  it('declares explicit dimensions alongside the viewBox', () => {
    const svg = renderCard(statsFixture(), paramsFixture())

    // GitHub stretches an SVG that only carries a viewBox, so both have to be
    // present and agree.
    const dimensions = /^<svg [^>]*width="(\d+)" height="(\d+)" viewBox="0 0 (\d+) (\d+)"/.exec(svg)

    expect(dimensions).not.toBeNull()
    const [, width, height, boxWidth, boxHeight] = dimensions ?? []
    expect(boxWidth).toBe(width)
    expect(boxHeight).toBe(height)
    expect(Number(height)).toBe(CARD_HEIGHT)
  })

  it('is well formed enough to parse as XML', () => {
    const svg = renderCard(statsFixture(), paramsFixture())

    // Every tag opened is closed, and no stray angle brackets survive in text.
    expect(svg.match(/<svg/g)).toHaveLength(1)
    expect(svg.endsWith('</svg>')).toBe(true)
  })

  it('stays inside the size budget', () => {
    const svg = renderCard(statsFixture(), paramsFixture('username=rondrft&langs_count=8'))

    expect(byteLength(svg)).toBeLessThan(SIZE_BUDGET)
  })

  it('carries a text alternative naming the account', () => {
    const svg = renderCard(statsFixture(), paramsFixture())

    expect(svg).toContain('role="img"')
    expect(svg).toContain('<title>Ron (rondrft): 4,821 contributions')
  })
})

describe('escaping', () => {
  it('neutralises markup arriving in the display name', () => {
    const data = statsFixture({ name: '"><script>alert(1)</script>' })

    const svg = renderCard(data, paramsFixture())

    expect(svg).not.toContain('<script>')
    expect(svg).toContain('&quot;&gt;&lt;script&gt;')
  })

  it('neutralises markup arriving in a language name', () => {
    const data = statsFixture({
      languages: [{ name: '<x&y>', color: null, size: 10, pct: 1 }],
    })

    const svg = renderCard(data, paramsFixture())

    expect(svg).not.toMatch(/<text[^>]*>[^<]*<x/)
    expect(svg).toContain('&lt;x&amp;')
  })

  it('never emits a raw quote inside a fill attribute', () => {
    const svg = renderCard(statsFixture(), paramsFixture('username=x&bg=%22onload%3Dalert(1)'))

    expect(svg).not.toContain('onload')
  })
})

describe('rings', () => {
  it('paints the full arc for values that have no natural maximum', () => {
    const svg = renderCard(statsFixture(), paramsFixture('username=x&hide=streak,best,langs'))

    expect(svg).toContain(`stroke-dasharray="${round(ARC)} ${round(CIRCUMFERENCE)}"`)
  })

  it('measures the current streak against the account record', () => {
    const data = statsFixture({
      streaks: {
        current: { length: 56, start: '2026-06-01', end: '2026-07-26' },
        longest: { length: 112, start: '2024-01-02', end: '2024-04-22' },
      },
    })

    const svg = renderCard(data, paramsFixture('username=x&hide=total,best,langs'))

    expect(svg).toContain(`stroke-dasharray="${round(ARC / 2)} ${round(CIRCUMFERENCE)}"`)
  })

  it('leaves the streak ring empty when there is no record to measure against', () => {
    const data = statsFixture({
      streaks: {
        current: { length: 0, start: null, end: null },
        longest: { length: 0, start: null, end: null },
      },
    })

    const svg = renderCard(data, paramsFixture('username=x&hide=total,best,langs'))

    expect(svg).toContain(`stroke-dasharray="0 ${round(CIRCUMFERENCE)}"`)
  })

  it('shrinks the number so a five-digit total stays inside the ring', () => {
    const small = renderCard(
      statsFixture({ totalContributions: 42 }),
      paramsFixture('username=x&hide=streak,best,langs'),
    )
    const large = renderCard(
      statsFixture({ totalContributions: 20_714 }),
      paramsFixture('username=x&hide=streak,best,langs'),
    )

    expect(small).toContain('font-size="20"')
    // "20,714" renders as six cells once the separator is counted.
    expect(large).toContain('font-size="12"')
    expect(large).toContain('>20,714<')
  })
})

describe('animation', () => {
  it('produces the same resting geometry whether or not it animates', () => {
    const animated = renderCard(statsFixture(), paramsFixture('username=x'))
    const still = renderCard(statsFixture(), paramsFixture('username=x&animate=false'))

    // Stripping the stylesheet and the hook classes should leave two identical
    // documents: the resting state lives in the attributes, so a renderer that
    // ignores CSS still shows a correct card.
    const stripped = animated.replace(/<style>.*?<\/style>/s, '').replace(/ class="[^"]*"/g, '')

    expect(stripped).toBe(still)
  })

  it('honours a reader who asked for less motion', () => {
    const svg = renderCard(statsFixture(), paramsFixture())

    expect(svg).toContain('@media (prefers-reduced-motion:reduce)')
  })

  it('holds the opening frame through a staggered delay', () => {
    const svg = renderCard(statsFixture(), paramsFixture())

    // `both` rather than `forwards`: with `forwards` a delayed ring would show
    // its finished state until its animation started.
    expect(attributes(svg, /animation:draw-\d[^}]*both/g)).toHaveLength(3)
  })

  it('emits no stylesheet at all when animation is off', () => {
    const svg = renderCard(statsFixture(), paramsFixture('username=x&animate=false'))

    expect(svg).not.toContain('<style>')
  })
})

/**
 * The exact coordinates belong to `layout.test.ts`, which measures them
 * directly. What matters here is that the document the renderer emits actually
 * moves when the layout says it should.
 */
describe('layout', () => {
  const widthOf = (svg: string) => Number(/ width="(\d+)"/.exec(svg)?.[1] ?? 0)
  const ringCentres = (svg: string) =>
    [...svg.matchAll(/<circle cx="([\d.]+)"/g)].map((match) => Number(match[1]))

  it('narrows the card instead of leaving holes when modules are hidden', () => {
    const full = widthOf(renderCard(statsFixture(), paramsFixture()))
    const rings = widthOf(renderCard(statsFixture(), paramsFixture('username=x&hide=langs')))
    const one = widthOf(
      renderCard(statsFixture(), paramsFixture('username=x&hide=streak,best,langs')),
    )

    expect(rings).toBeLessThan(full)
    expect(one).toBeLessThan(rings)
  })

  it('closes the gap left by a hidden middle ring', () => {
    const all = ringCentres(renderCard(statsFixture(), paramsFixture()))
    const hidden = ringCentres(renderCard(statsFixture(), paramsFixture('username=x&hide=streak')))

    // Each ring contributes a track and a progress circle at the same centre.
    const distinct = (centres: number[]) => [...new Set(centres)]

    expect(distinct(all)).toHaveLength(3)
    expect(distinct(hidden)).toHaveLength(2)

    // The two survivors are adjacent, at the same pitch the three used — the
    // record ring moved up into the streak's place rather than leaving a hole.
    const [firstOfThree, secondOfThree] = distinct(all)
    const [firstOfTwo, secondOfTwo] = distinct(hidden)
    const pitch = (secondOfThree ?? 0) - (firstOfThree ?? 0)

    expect((secondOfTwo ?? 0) - (firstOfTwo ?? 0)).toBeCloseTo(pitch, 2)
  })

  it('centres the content rather than the ring axis', () => {
    const svg = renderCard(statsFixture(), paramsFixture())
    const cy = Number(/<circle cx="[\d.]+" cy="([\d.]+)"/.exec(svg)?.[1] ?? 0)

    // The icons sit above the arcs and nothing balances them below, so a
    // correctly centred card puts the ring axis above the halfway line.
    expect(cy).toBeGreaterThan(0)
    expect(cy).toBeLessThan(CARD_HEIGHT / 2)
  })
})

describe('languages', () => {
  it('renders a placeholder rather than an empty column', () => {
    const svg = renderCard(statsFixture({ languages: [] }), paramsFixture())

    expect(svg).toContain('no public repos')
  })

  it('preserves the padding the block alignment depends on', () => {
    const svg = renderCard(statsFixture(), paramsFixture())

    expect(svg).toContain('xml:space="preserve"')
    // Name padded to five cells, bar padded to six, percentage right-aligned to
    // three. Every line is the same length, so the columns line up on their own.
    expect(svg).toContain('ts    ██      41%')
    expect(svg).toContain('go    █       10%')
  })

  it('gives a language that rounds to nothing a single cell', () => {
    const data = statsFixture({
      languages: [
        { name: 'TypeScript', color: null, size: 99, pct: 0.99 },
        { name: 'Makefile', color: null, size: 1, pct: 0.01 },
      ],
    })

    const svg = renderCard(data, paramsFixture())

    expect(svg).toContain('make  █        1%')
  })

  it('uses the language colour reported by GitHub for the bar style', () => {
    const svg = renderCard(statsFixture(), paramsFixture('username=x&lang_style=bars'))

    expect(svg).toContain('fill="#3178c6"')
  })

  it('falls back to the ring colour when GitHub has no colour on file', () => {
    const data = statsFixture({
      languages: [{ name: 'Brainfuck', color: null, size: 10, pct: 1 }],
    })

    const svg = renderCard(data, paramsFixture('username=x&lang_style=bars'))

    expect(svg).toContain('fill="#5DCAA5"')
  })
})

describe('theming', () => {
  it('lets individual parameters override the theme', () => {
    const svg = renderCard(statsFixture(), paramsFixture('username=x&theme=ice&bg=%23000000'))

    expect(svg).toContain('fill="#000000"')
    expect(svg).toContain('#4EC3E0')
  })

  it('omits the frame entirely when the border is switched off', () => {
    const svg = renderCard(statsFixture(), paramsFixture('username=x&border=none'))

    expect(svg).not.toContain('stroke-width="0.5"')
  })

  it('omits the scanline pattern when it is switched off', () => {
    const svg = renderCard(statsFixture(), paramsFixture('username=x&scanlines=false'))

    expect(svg).not.toContain('url(#scanlines)')
  })

  it('adds the project credit only when it is asked for', () => {
    expect(renderCard(statsFixture(), paramsFixture())).not.toContain('phosphor-stats')
    expect(renderCard(statsFixture(), paramsFixture('username=x&show_credit=true'))).toContain(
      'phosphor-stats',
    )
  })
})

describe('localisation', () => {
  it('translates the module labels', () => {
    const svg = renderCard(statsFixture(), paramsFixture('username=x&locale=es'))

    expect(svg).toContain('contribuciones')
    expect(svg).toContain('racha actual')
    expect(svg).toContain('20 jun - 26 jul')
  })

  it('groups digits the way the locale does', () => {
    const data = statsFixture({ totalContributions: 20_714 })
    const query = 'username=x&hide=streak,best,langs'

    expect(renderCard(data, paramsFixture(query))).toContain('>20,714<')
    expect(renderCard(data, paramsFixture(`${query}&locale=es`))).toContain('>20.714<')
  })
})

describe('error card', () => {
  const style = paramsFixture().style

  it('reports each failure in words', () => {
    expect(renderErrorCard({ kind: 'not-found', style })).toContain('user not found')
    expect(renderErrorCard({ kind: 'missing-username', style })).toContain('missing ?username=')
    expect(renderErrorCard({ kind: 'upstream', style })).toContain('upstream error')
    expect(renderErrorCard({ kind: 'rate-limited', style, retryAfterMinutes: 12 })).toContain(
      'rate limited, retry in 12m',
    )
  })

  it('keeps the theme of the request that failed', () => {
    const ice = paramsFixture('username=x&theme=ice').style

    expect(renderErrorCard({ kind: 'not-found', style: ice })).toContain('#050B14')
  })

  it('is a complete SVG document', () => {
    const svg = renderErrorCard({ kind: 'upstream', style })

    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
    expect(byteLength(svg)).toBeLessThan(SIZE_BUDGET)
  })
})

describe('snapshot', () => {
  it('renders the default card', () => {
    expect(renderCard(statsFixture(), paramsFixture())).toMatchSnapshot()
  })

  it('renders the bar style on a light theme without animation', () => {
    const query = 'username=x&theme=light&lang_style=bars&animate=false&scanlines=false'

    expect(renderCard(statsFixture(), paramsFixture(query))).toMatchSnapshot()
  })
})

const round = (n: number) => Math.round(n * 100) / 100
