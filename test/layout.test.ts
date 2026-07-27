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
