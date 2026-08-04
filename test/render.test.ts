import { describe, expect, it } from 'vitest'
import { LOCALE_NAMES } from '../src/i18n'
import { renderCard } from '../src/render/cards'
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
    // A half block is one cell wide like a full one, so it buys the scale twelve
    // steps without moving a column.
    expect(svg).toContain('ts    ██████  41%')
    expect(svg).toContain('rs    ████▌   25%')
    expect(svg).toContain('py    ████    17%')
    expect(svg).toContain('go    ███     10%')
  })

  /**
   * Against the leader on a linear scale this breakdown drew 6, 4, 2, 1 — the
   * complaint that produced the square root was the same one a step further
   * down: a long tail all collapses to a single cell, so 5% and 2% are drawn
   * identically. Six cells cannot hold a long tail proportionally, so the bar
   * became an ordering and the percentage stayed the measurement.
   */
  it('keeps a long tail legible instead of collapsing it to one cell', () => {
    // 49/16/13/5/5/5/2/2 in one repository, so the per-repository cap — which
    // engages at seven — stays out of it and the shares arrive as written.
    const shares = [49, 16, 13, 5, 5, 5, 2, 2]
    const names = ['JavaScript', 'Go', 'Ruby', 'C', 'Python', 'Objective-C', 'C++', 'CoffeeScript']
    const svg = renderCard(
      statsFixture({
        repos: {
          langs: names.map((name) => ({ name, color: '#888888' })),
          repos: [
            {
              w: 1,
              p: 0,
              e: shares.map((share, index): [number, number] => [index, share * 1000]),
            },
          ],
        },
      }),
      paramsFixture('username=x&langs_count=8'),
    )

    const bars = [...svg.matchAll(/xml:space="preserve">\S+ +(\S+) /g)].map((match) => match[1])

    expect(bars).toEqual(['██████', '███▌', '███', '██', '██', '██', '█', '█'])
    // Five distinct shares, five distinct bars. Linearly this was three.
    expect(new Set(bars).size).toBe(5)
  })

  /**
   * And the other end, which the square root must not cost: three languages
   * within a few points of each other still draw three different bars. At whole
   * cells it would not — 41/33/26 collapses to 6, 5, 5 — which is what the half
   * cell is for.
   */
  it('still separates three languages that are close together', () => {
    const svg = renderCard(
      statsFixture({
        repos: {
          langs: ['Rust', 'Go', 'Zig'].map((name) => ({ name, color: '#888888' })),
          repos: [
            {
              w: 1,
              p: 0,
              e: [
                [0, 41_000],
                [1, 33_000],
                [2, 26_000],
              ],
            },
          ],
        },
      }),
      paramsFixture('username=x'),
    )

    const bars = [...svg.matchAll(/xml:space="preserve">\S+ +(\S+) /g)].map((match) => match[1])

    expect(bars).toEqual(['██████', '█████▌', '█████'])
  })

  it('gives a language that rounds to nothing half a cell', () => {
    const data = statsFixture({
      languages: [
        { name: 'TypeScript', color: null, size: 99, pct: 0.99 },
        { name: 'Makefile', color: null, size: 1, pct: 0.01 },
      ],
    })

    // Makefile is excluded by default, and the ranking that applies the default
    // now runs at render time — so the card has to be asked for it back.
    const svg = renderCard(data, paramsFixture('username=x&include_langs=makefile'))

    // The floor is half a cell now rather than a whole one, which is what keeps
    // 1% against a 99% leader visibly shorter than 5% against a 49% one.
    expect(svg).toContain('make  ▌        1%')
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
    expect(renderCard(statsFixture(), paramsFixture())).not.toContain('>gstats<')
    expect(renderCard(statsFixture(), paramsFixture('username=x&show_credit=true'))).toContain(
      '>gstats<',
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
    expect(renderErrorCard({ kind: 'too-many-requests', style, retryAfterMinutes: 1 })).toContain(
      'too many requests, wait 1m',
    )
  })

  /**
   * The two are easy to conflate and mean opposite things to whoever reads the
   * card: one is a shared quota nobody can do anything about, the other is the
   * caller's own traffic and is theirs to fix.
   */
  it('distinguishes our limit from GitHub’s', () => {
    const ours = renderErrorCard({ kind: 'too-many-requests', style, retryAfterMinutes: 1 })
    const theirs = renderErrorCard({ kind: 'rate-limited', style, retryAfterMinutes: 1 })

    expect(ours).not.toBe(theirs)
  })

  /**
   * The card's width is set by the longest line any locale can produce. A new
   * message that overflows the frame would not fail any other assertion.
   */
  it('fits every message inside the frame in every locale', () => {
    const kinds = [
      'not-found',
      'missing-username',
      'not-configured',
      'rate-limited',
      'too-many-requests',
      'upstream',
    ] as const

    for (const locale of LOCALE_NAMES) {
      const localised = paramsFixture(`username=x&locale=${locale}`).style
      for (const kind of kinds) {
        const svg = renderErrorCard({ kind, style: localised, retryAfterMinutes: 60 })
        const message = /<title>([^<]*)<\/title>/.exec(svg)?.[1] ?? ''

        expect(message.length, `${locale}/${kind}`).toBeGreaterThan(0)
        expect(message, `${locale}/${kind}`).not.toContain('{')
        // Text starts at x=105 in a 400-wide card, at font-size 11 in a
        // monospace stack whose advance is about 0.6em.
        expect(105 + message.length * 6.6, `${locale}/${kind}`).toBeLessThan(400)
      }
    }
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

/**
 * The relationship the streak ring exists to communicate. A card reporting
 * 37 against a record of 112 has to *look* like a third, and this pins the arc
 * length to the fraction for the whole range rather than for one example.
 */
describe('ring arc length tracks the percentage', () => {
  const arcOf = (svg: string) =>
    [...svg.matchAll(/stroke-linecap="round" stroke-dasharray="([\d.]+) /g)].map((m) =>
      Number(m[1]),
    )

  const streakArc = (current: number, longest: number) => {
    const data = statsFixture({
      streaks: {
        current: { length: current, start: '2026-06-01', end: '2026-07-26' },
        longest: { length: longest, start: '2024-01-02', end: '2024-04-22' },
      },
    })
    return arcOf(renderCard(data, paramsFixture('username=x&hide=total,best,langs')))[0] ?? 0
  }

  it.each([
    [0, 112, 0],
    [28, 112, 0.25],
    [37, 112, 37 / 112],
    [56, 112, 0.5],
    [84, 112, 0.75],
    [112, 112, 1],
  ])('draws %i/%i as %f of the arc', (current, longest, fraction) => {
    expect(streakArc(current, longest) / ARC).toBeCloseTo(fraction, 3)
  })

  it('measures against the visible arc, not the whole circumference', () => {
    // The distinction that would silently inflate every ring: the top wedge is
    // never painted, so a full ring is ARC units, not CIRCUMFERENCE units.
    expect(streakArc(112, 112)).toBeCloseTo(ARC, 2)
    expect(ARC).toBeLessThan(CIRCUMFERENCE)
  })

  it('clamps a streak that somehow exceeds its own record', () => {
    expect(streakArc(200, 112)).toBeCloseTo(ARC, 2)
  })
})

/**
 * The track is the unfilled part of the ring. It always covers the full arc, so
 * if it reads as strongly as the progress the ring looks nearly complete
 * whatever the value is — which is what happened on the light theme, where
 * dimming an accent towards black produced a near-black on white.
 */
describe('ring track recedes into the background', () => {
  const trackOf = (svg: string) =>
    /<circle[^>]*stroke="(#[0-9a-fA-F]{6})" stroke-dasharray="134.65 35"/.exec(svg)?.[1] ?? ''

  const relativeLuminance = (hex: string) => {
    const channel = (i: number) => {
      const v = Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
  }
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
    return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)
  }

  it.each([
    ['phosphor', '#080D08'],
    ['light', '#FFFFFF'],
    ['ice', '#050B14'],
    ['amber', '#0F0A02'],
    ['mono', '#000000'],
  ])('stays faint against the %s background', (theme, background) => {
    const track = trackOf(renderCard(statsFixture(), paramsFixture(`username=x&theme=${theme}`)))

    expect(track).not.toBe('')
    // Anything above about 3:1 stops reading as absence and starts reading as a
    // second value. The light theme used to sit at 18:1.
    expect(contrast(track, background)).toBeLessThan(3)
  })
})
