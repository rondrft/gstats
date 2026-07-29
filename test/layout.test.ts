import { describe, expect, it } from 'vitest'
import { renderCard } from '../src/render/cards'
import {
  CARD_HEIGHT,
  type ColumnContent,
  FRAME_INSET,
  type LangsContent,
  layoutCard,
} from '../src/render/layout'
import { paramsFixture, statsFixture } from './helpers/fixtures'

/**
 * The layout works in reals and the renderer rounds to two decimals, so margins
 * are compared with a tolerance rather than for exact equality. Anything inside
 * this is invisible; anything outside it is the bug this module exists to fix.
 */
const TOLERANCE = 0.01

function column(overrides: Partial<ColumnContent> = {}): ColumnContent {
  return {
    value: '4,821',
    valueFontSize: 15,
    label: 'contributions',
    subtitle: 'since 2019',
    ...overrides,
  }
}

const THREE_COLUMNS: ColumnContent[] = [
  column(),
  column({ value: '37', valueFontSize: 20, label: 'current streak', subtitle: 'Jun 20 - Jul 26' }),
  column({
    value: '112',
    valueFontSize: 19,
    label: 'longest streak',
    subtitle: 'Jan 2 - Apr 22, 2024',
  }),
]

const FOUR_LANGUAGES: LangsContent = { lineCount: 4, width: 112.2 }
const NO_LANGUAGES: LangsContent = { lineCount: 0, width: 0 }

/** Margins on all four sides of the measured content box. */
function margins(columns: ColumnContent[], langs: LangsContent) {
  const layout = layoutCard(columns, langs)
  return {
    left: layout.content.left,
    right: layout.width - layout.content.right,
    top: layout.content.top,
    bottom: layout.height - layout.content.bottom,
  }
}

describe('margin symmetry', () => {
  const cases: [string, ColumnContent[], LangsContent][] = [
    ['three rings and four languages', THREE_COLUMNS, FOUR_LANGUAGES],
    ['three rings, no languages', THREE_COLUMNS, NO_LANGUAGES],
    ['one ring and four languages', [THREE_COLUMNS[1] ?? column()], FOUR_LANGUAGES],
    ['two rings', THREE_COLUMNS.slice(0, 2), NO_LANGUAGES],
    ['languages only', [], FOUR_LANGUAGES],
    ['eight languages', THREE_COLUMNS, { lineCount: 8, width: 112.2 }],
    ['one language', THREE_COLUMNS, { lineCount: 1, width: 112.2 }],
  ]

  for (const [name, columns, langs] of cases) {
    it(`centres the content box for ${name}`, () => {
      const { left, right, top, bottom } = margins(columns, langs)

      expect(Math.abs(left - right)).toBeLessThanOrEqual(TOLERANCE)
      expect(Math.abs(top - bottom)).toBeLessThanOrEqual(TOLERANCE)
    })
  }

  /**
   * The regression this module was written for: the widest column is the last
   * one, so a group centred on its middle ring hangs off to the right.
   */
  it('stays centred when the outer columns are different widths', () => {
    const lopsided = [
      column({ label: 'a', subtitle: 'b' }),
      column(),
      column({ label: 'an extremely long label', subtitle: 'and a longer subtitle still' }),
    ]

    const { left, right } = margins(lopsided, FOUR_LANGUAGES)

    expect(Math.abs(left - right)).toBeLessThanOrEqual(TOLERANCE)
  })

  it('does not centre on the ring axis, which is what looked wrong', () => {
    const layout = layoutCard(THREE_COLUMNS, FOUR_LANGUAGES)

    // The content sits low if the axis is centred, so the corrected axis has to
    // be above the middle of the card by a visible amount.
    expect(layout.cy).toBeLessThan(CARD_HEIGHT / 2 - 5)
  })
})

/**
 * The same property, one level down.
 *
 * `layoutCard` is checked above by calling it. `pass` is the design that cannot
 * be checked that way: its frame starts below the coloured band rather than at
 * the card's top edge, so it is the one design that does not use
 * `chrome.frame`, and what it draws has to be read back out of the document.
 *
 * The defect this pins had every pair symmetric about the card's own axis and
 * still looked wrong. The frame was typed in at 8, the band's type at 14 and the
 * content at 20, so the left edge showed three alignments with no two of them
 * the same distance from the edge. Everything is now derived from the content box
 * `layoutRow` measures: the type sits on its edges, and the frame exactly halfway
 * between it and the card on every side the frame has.
 */
describe('pass margins', () => {
  const BAND_HEIGHT = 26

  function geometry(query: string) {
    const svg = renderCard(statsFixture(), paramsFixture(`username=x&card=pass&${query}`))
    const document = /^<svg [^>]*width="(\d+)" height="(\d+)"/.exec(svg)
    const frame = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="2"/.exec(
      svg,
    )
    if (document === null || frame === null) throw new Error(`nothing to measure in ${query}`)

    const attribute = (match: RegExpMatchArray, index: number) => Number(match[index])
    const x = attribute(frame, 1)
    const y = attribute(frame, 2)

    // Lines set from their start, and the one line set from its end. The stub is
    // centred and belongs to neither. Picking them out by baseline rather than
    // by the order they are written keeps the test measuring the card.
    const lines = (pattern: RegExp) =>
      [...svg.matchAll(pattern)].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }))
    const starts = lines(/<text x="([\d.]+)" y="([\d.]+)"(?![^>]*text-anchor)/g)
    const ends = lines(/<text x="([\d.]+)" y="([\d.]+)"[^>]*text-anchor="end"/g)
    const highest = (candidates: { x: number; y: number }[]) =>
      candidates.reduce((best, line) => (line.y < best.y ? line : best)).x
    const lowest = (candidates: { x: number; y: number }[]) =>
      candidates.reduce((best, line) => (line.y > best.y ? line : best)).x

    return {
      width: attribute(document, 1),
      height: attribute(document, 2),
      frame: { left: x, right: x + attribute(frame, 3), top: y, bottom: y + attribute(frame, 4) },
      /** The three lines that make up the card's left edge, top to bottom. */
      leftEdge: [highest(starts), Math.min(...starts.map((line) => line.x)), lowest(starts)],
      /** The login on the band, the only line hung from the right. */
      login: highest(ends),
    }
  }

  const cases: [string, string][] = [
    ['everything shown', ''],
    ['hide=total', 'hide=total'],
    ['hide=best', 'hide=best'],
    ['hide=langs', 'hide=langs'],
    ['hide=total,best', 'hide=total,best'],
    ['in Spanish', 'locale=es'],
    ['eight languages', 'langs_count=8'],
    ['square corners', 'radius=0'],
    ['the roundest corners', 'radius=24'],
  ]

  for (const [name, query] of cases) {
    it(`gives the type one edge a side, with ${name}`, () => {
      const { width, leftEdge, login } = geometry(query)
      const [brand, ...rest] = leftEdge

      // The brand on the band, the first column under it and the date range at
      // the bottom are one line, not three within a few units of each other.
      for (const line of rest) {
        expect(Math.abs(line - (brand ?? 0))).toBeLessThanOrEqual(TOLERANCE)
      }
      // The login ends as far from its edge as that line starts from this one.
      expect(Math.abs(width - login - (brand ?? 0))).toBeLessThanOrEqual(TOLERANCE)
    })

    it(`hangs the frame midway between card and content, with ${name}`, () => {
      const { width, height, frame, leftEdge } = geometry(query)
      const content = leftEdge[0] ?? 0

      // Symmetric across the card, and the same air on the three sides it has:
      // the two edges, the bottom, and the band it starts under.
      expect(Math.abs(frame.left - (width - frame.right))).toBeLessThanOrEqual(TOLERANCE)
      expect(Math.abs(frame.left - (height - frame.bottom))).toBeLessThanOrEqual(TOLERANCE)
      expect(Math.abs(frame.left - (frame.top - BAND_HEIGHT))).toBeLessThanOrEqual(TOLERANCE)

      // Halfway: as far from the card's edge as it is from the first column.
      expect(Math.abs(frame.left - (content - frame.left))).toBeLessThanOrEqual(TOLERANCE)
    })
  }

  it('draws no frame at all when the border is switched off', () => {
    const svg = renderCard(statsFixture(), paramsFixture('username=x&card=pass&border=none'))

    expect(svg).not.toContain('rx="2"')
  })
})

describe('containment', () => {
  it('keeps every language row inside the frame at the largest count', () => {
    const layout = layoutCard(THREE_COLUMNS, { lineCount: 8, width: 112.2 })
    const langs = layout.langs
    if (langs === null) throw new Error('expected a language block')

    const lastBaseline = langs.firstBaseline + 7 * langs.lineHeight

    expect(langs.firstBaseline).toBeGreaterThan(FRAME_INSET)
    expect(lastBaseline).toBeLessThan(CARD_HEIGHT - FRAME_INSET)
  })

  it('keeps the design line height when there is room for it', () => {
    const layout = layoutCard(THREE_COLUMNS, FOUR_LANGUAGES)

    expect(layout.langs?.lineHeight).toBe(20)
  })

  it('never lets the content overflow the card it sized', () => {
    const layout = layoutCard(THREE_COLUMNS, { lineCount: 8, width: 112.2 })

    expect(layout.content.left).toBeGreaterThanOrEqual(0)
    expect(layout.content.right).toBeLessThanOrEqual(layout.width)
    expect(layout.content.top).toBeGreaterThanOrEqual(0)
    expect(layout.content.bottom).toBeLessThanOrEqual(layout.height)
  })
})

describe('adaptation', () => {
  it('widens the ring pitch rather than letting long labels collide', () => {
    const wide = [
      column({ label: 'x'.repeat(40), subtitle: '' }),
      column({ label: 'x'.repeat(40), subtitle: '' }),
    ]

    const layout = layoutCard(wide, NO_LANGUAGES)
    const [first, second] = layout.ringCentres

    expect(second ?? 0).toBeGreaterThan((first ?? 0) + 120)
  })

  it('narrows the card when modules are hidden', () => {
    const full = layoutCard(THREE_COLUMNS, FOUR_LANGUAGES).width
    const noLangs = layoutCard(THREE_COLUMNS, NO_LANGUAGES).width
    const oneRing = layoutCard([column()], NO_LANGUAGES).width

    expect(noLangs).toBeLessThan(full)
    expect(oneRing).toBeLessThan(noLangs)
  })
})

/**
 * A record of the geometry every supported configuration resolves to. The
 * assertions above prove the margins are equal; this pins down what they are,
 * so a change to a font size, a label or a constant has to be acknowledged
 * rather than slipping through as a quiet drift.
 */
describe('layout snapshot', () => {
  it('records the geometry of each configuration', () => {
    const cases: [string, ColumnContent[], LangsContent][] = [
      ['default', THREE_COLUMNS, FOUR_LANGUAGES],
      ['hide=langs', THREE_COLUMNS, NO_LANGUAGES],
      ['hide=total', THREE_COLUMNS.slice(1), FOUR_LANGUAGES],
      ['hide=total,streak,best', [], FOUR_LANGUAGES],
      ['langs_count=8', THREE_COLUMNS, { lineCount: 8, width: 112.2 }],
      ['no public repos', THREE_COLUMNS, { lineCount: 1, width: 99 }],
    ]

    const rows = cases.map(([name, columns, langs]) => {
      const layout = layoutCard(columns, langs)
      const { left, right, top, bottom } = margins(columns, langs)
      return [
        name,
        `${layout.width}x${layout.height}`,
        `cy=${round(layout.cy)}`,
        `rings=[${layout.ringCentres.map(round).join(', ')}]`,
        `margins h=${round(left)}/${round(right)} v=${round(top)}/${round(bottom)}`,
      ].join('  |  ')
    })

    expect(rows.join('\n')).toMatchSnapshot()
  })

  it('agrees with the coordinates the renderer actually emits', () => {
    const svg = renderCard(statsFixture(), paramsFixture())
    const layout = layoutCard(THREE_COLUMNS, FOUR_LANGUAGES)

    // The fixture is the same content the columns above describe, so the
    // rendered document has to carry the layout's own numbers.
    expect(svg).toContain(`width="${layout.width}"`)
    for (const cx of layout.ringCentres) {
      expect(svg).toContain(`cx="${round(cx)}"`)
    }
  })
})

const round = (n: number) => Math.round(n * 100) / 100
