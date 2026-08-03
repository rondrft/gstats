import { describe, expect, it } from 'vitest'
import {
  CARD_IDS,
  DEFAULT_CARD,
  MAX_LANGUAGES,
  renderCard,
  renderCardWithLanguages,
  resolveRenderer,
} from '../src/render/cards'
import { SERVICE_NAME } from '../src/service'
import { calendarFixture, paramsFixture, statsFixture } from './helpers/fixtures'

const SIZE_BUDGET = 12 * 1024
const byteLength = (svg: string) => new TextEncoder().encode(svg).length

/**
 * Language rows actually drawn, counted the one way that works for all six.
 *
 * Every design prints exactly one percentage per language and no percentage
 * anywhere else — the tracklist, the panel and the single-line summary all
 * differ in markup and agree on that. The premise is held by a test below
 * rather than assumed, because the whole point of counting is to catch a design
 * drawing a different number from the one it reports.
 */
const drawnLanguages = (svg: string) => (svg.match(/%/g) ?? []).length

const render = (query: string) => renderCard(statsFixture(), paramsFixture(query))
const widthOf = (svg: string) => Number(/ width="(\d+)"/.exec(svg)?.[1] ?? 0)

/**
 * The largest card each design can be asked to draw.
 *
 * Measuring the budget against the ordinary fixture is what let a 13.5 KB
 * heatmap reach production. Two things were wrong with it. The heatmap draws one
 * element per day that had *any* activity, so its size tracks how busy the
 * account is, and the fixture's synthetic year is idle about a third of the time
 * — a daily committer has 371 active days where it has roughly 240. And asking
 * for `langs_count=8` against a fixture holding four languages draws four rows,
 * so the largest language block was never actually rendered.
 *
 * Everything is at the end of its range here at once: a full year with no gaps,
 * six-figure numbers, a long display name and eight languages to list.
 *
 * The eight have to be eight the ranking will actually return. The widest
 * abbreviation here used to belong to `Jupyter Notebook`, which is on the
 * default exclusion list — so the largest card was drawing seven rows and this
 * budget was measured against a language block one line shorter than the one
 * that ships. `Swift` abbreviates to the same five cells and survives.
 */
const WORST_CASE = statsFixture({
  name: 'A Person With An Extremely Long Display Name Indeed',
  totalContributions: 482_193,
  yearContributions: 128_402,
  bestYearContributions: 128_402,
  streaks: {
    current: { length: 371, start: '2025-07-21', end: '2026-07-26' },
    longest: { length: 371, start: '2025-07-21', end: '2026-07-26' },
  },
  // Every day active, and spread across the range so all five levels are used.
  calendar: {
    from: '2025-07-21',
    counts: Array.from({ length: 371 }, (_, index) => 1 + ((index * 7) % 23)),
  },
  languages: [
    { name: 'Swift', color: '#F05138', size: 900_000, pct: 0.22 },
    { name: 'TypeScript', color: '#3178c6', size: 800_000, pct: 0.2 },
    { name: 'Objective-C++', color: '#6866fb', size: 700_000, pct: 0.17 },
    { name: 'JavaScript', color: '#f1e05a', size: 600_000, pct: 0.15 },
    { name: 'Python', color: '#3572A5', size: 400_000, pct: 0.1 },
    { name: 'Rust', color: '#dea584', size: 300_000, pct: 0.07 },
    { name: 'Kotlin', color: '#A97BFF', size: 200_000, pct: 0.05 },
    { name: 'Go', color: '#00ADD8', size: 150_000, pct: 0.04 },
  ],
})

describe('registry', () => {
  it('resolves every published id to its own renderer', () => {
    for (const id of CARD_IDS) {
      expect(resolveRenderer(id).id).toBe(id)
    }
  })

  /**
   * A typo in a README must degrade to a working card. An error status there is
   * the browser's broken-image glyph, which tells the reader nothing.
   */
  it('falls back to the default for anything it does not know', () => {
    for (const unknown of ['', 'nope', 'TERMINAL ', '../etc/passwd', 'terminal-v2']) {
      expect(resolveRenderer(unknown).id).toBe(DEFAULT_CARD)
    }
  })

  it('answers an unknown card parameter with the default design', () => {
    expect(render('username=x&card=nonesuch')).toBe(render('username=x'))
  })

  /**
   * The contract in `registry.ts`: `terminal` is what every URL written before
   * `?card=` existed resolves to.
   */
  it('keeps terminal as the default', () => {
    expect(DEFAULT_CARD).toBe('terminal')
    expect(render('username=x')).toBe(render('username=x&card=terminal'))
  })
})

describe.each(CARD_IDS)('%s', (card) => {
  const base = `username=x&card=${card}`

  it('is a complete SVG document with agreeing dimensions', () => {
    const svg = render(base)
    const dimensions = /^<svg [^>]*width="(\d+)" height="(\d+)" viewBox="0 0 (\d+) (\d+)"/.exec(svg)

    expect(dimensions).not.toBeNull()
    const [, width, height, boxWidth, boxHeight] = dimensions ?? []
    expect(boxWidth).toBe(width)
    expect(boxHeight).toBe(height)
    expect(svg.endsWith('</svg>')).toBe(true)
  })

  it('stays inside the size budget on the largest card it can be asked for', () => {
    const svg = renderCard(WORST_CASE, paramsFixture(`${base}&langs_count=8`))
    expect(byteLength(svg)).toBeLessThan(SIZE_BUDGET)
  })

  it('honours the theme', () => {
    // Every design paints its plate from the theme, so the background colour of
    // an alternative theme has to appear somewhere in the document.
    expect(render(`${base}&theme=ice`)).toContain('#050B14')
    expect(render(`${base}&theme=light`)).toContain('#FFFFFF')
  })

  it('honours a colour override on top of the theme', () => {
    expect(render(`${base}&bg=%23123456`)).toContain('#123456')
  })

  it('honours the locale', () => {
    const spanish = render(`${base}&locale=es`)

    // Every design shows at least one module label, and `press` upper-cases it.
    expect(spanish.toLowerCase()).toContain('contribuciones')
  })

  /**
   * Narrowing is the usual consequence, but not the contract: a design whose
   * width is set by something else — the heatmap's fixed 53 columns, the
   * vinyl's tracklist — keeps its size. What every design owes is that the
   * hidden module leaves no trace and no gap behind it.
   */
  it('honours hide, dropping the module without leaving a hole', () => {
    const full = render(base)
    const hidden = render(`${base}&hide=streak,best`)

    expect(hidden).not.toContain('current streak')
    expect(hidden).not.toContain('longest streak')
    expect(full).toContain('current streak')
    expect(widthOf(hidden)).toBeLessThanOrEqual(widthOf(full))
  })

  /**
   * `langs` is the module a design is most likely to draw from somewhere other
   * than its layout — a footer line, a tracklist — and so the one `hide` is
   * most likely to miss. `pass` printed its language summary under
   * `hide=langs` for six designs' worth of history, and on a card narrowed by
   * another hidden module it landed on top of the date range.
   */
  it('honours hide=langs, leaving no share behind', () => {
    const shows = render(base).includes('41%')

    // Named rather than skipped: the heatmap's whole subject is the calendar and
    // it lists no languages, so there is nothing there for `hide` to remove. Any
    // other design losing its language block is a regression, not an exemption.
    expect(shows).toBe(card !== 'heatmap')
    expect(render(`${base}&hide=langs`)).not.toContain('41%')
  })

  /**
   * The service has one name. The `phosphor` theme keeps its own — that one is a
   * parameter value sitting in other people's READMEs — but nothing on a card
   * may still be calling the service what it was called before.
   */
  /** The premise `drawnLanguages` counts on: no percentage without a language. */
  it('prints no percentage outside its language block', () => {
    expect(drawnLanguages(render(`${base}&hide=langs`))).toBe(0)
  })

  /**
   * `langs_count` is a maximum, and three designs have a lower one of their own.
   *
   * Both halves of that were invisible. The ranking honoured the parameter all
   * the way to eight and then a `slice(0, 3)` inside `vinyl` cut it back, so
   * `langs_count=6` drew three with nothing anywhere to say why — reported as
   * the parameter being ignored, which is exactly what it looks like. The
   * ceilings stay, since a ceiling is part of a published card, but they are
   * declared in `MAX_LANGUAGES` and each design is held to the one it declares
   * at every value the parameter accepts.
   */
  it('draws as many languages as it was asked for, up to its own ceiling', () => {
    const ceiling = MAX_LANGUAGES[card]

    for (const requested of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { svg, languages } = renderCardWithLanguages(
        WORST_CASE,
        paramsFixture(`${base}&langs_count=${requested}&animate=false`),
      )

      expect(languages.available).toBe(8)
      expect(languages.ceiling).toBe(ceiling)
      expect(languages.shown).toBe(Math.min(requested, ceiling))
      // What it says it drew is what it drew.
      expect(drawnLanguages(svg)).toBe(languages.shown)
    }
  })

  /**
   * The other half of the shortfall, and the ordinary one: the profile has
   * fewer languages than the card was asked for. `available` is what makes that
   * distinguishable from a design ignoring the parameter.
   */
  it('reports how many the profile had when it draws fewer than asked', () => {
    const { svg, languages } = renderCardWithLanguages(
      statsFixture({
        languages: [
          { name: 'Java', color: '#b07219', size: 0, pct: 0.42 },
          { name: 'Kotlin', color: '#A97BFF', size: 0, pct: 0.3 },
          { name: 'TypeScript', color: '#3178c6', size: 0, pct: 0.28 },
        ],
      }),
      paramsFixture(`${base}&langs_count=8&animate=false`),
    )

    expect(languages.available).toBe(3)
    expect(languages.shown).toBe(Math.min(3, MAX_LANGUAGES[card]))
    expect(drawnLanguages(svg)).toBe(languages.shown)
  })

  it('draws the project name only as the current one', () => {
    const svg = render(`${base}&show_credit=true`)

    expect(svg).toContain(SERVICE_NAME)
    expect(svg.toLowerCase()).not.toMatch(/phosphor[\s-]*stats/)
  })

  it('emits no stylesheet when animation is switched off', () => {
    expect(render(`${base}&animate=false`)).not.toContain('<style>')
  })

  it('escapes markup arriving in the display name', () => {
    const hostile = renderCard(
      statsFixture({ name: '"><script>alert(1)</script>' }),
      paramsFixture(base),
    )

    expect(hostile).not.toContain('<script>')
    expect(hostile).toContain('&lt;script&gt;')
  })

  it('survives an account with nothing to show', () => {
    const empty = renderCard(
      statsFixture({
        name: null,
        languages: [],
        totalContributions: 0,
        yearContributions: 0,
        bestYearContributions: 0,
        streaks: {
          current: { length: 0, start: null, end: null },
          longest: { length: 0, start: null, end: null },
        },
        calendar: { from: '2025-07-21', counts: Array.from({ length: 371 }, () => 0) },
      }),
      paramsFixture(base),
    )

    expect(empty.startsWith('<svg')).toBe(true)
    expect(empty.endsWith('</svg>')).toBe(true)
    expect(empty).not.toContain('NaN')
    expect(empty).not.toContain('Infinity')
  })

  it('survives six-digit numbers and a very long name', () => {
    const extreme = renderCard(
      statsFixture({
        name: 'A Person With An Extremely Long Display Name Indeed',
        totalContributions: 482_193,
      }),
      paramsFixture(base),
    )

    expect(extreme).not.toContain('NaN')
    expect(byteLength(extreme)).toBeLessThan(SIZE_BUDGET)
  })

  it('renders no remote references of any kind', () => {
    const svg = render(base)

    // Camo strips these; a design that needs one is broken where it is used.
    expect(svg).not.toMatch(/<image\b/)
    expect(svg).not.toContain('@import')
    // The SVG namespace is the one URL a standalone document must carry.
    expect(svg.replace('http://www.w3.org/2000/svg', '')).not.toMatch(/https?:\/\//)
  })

  it('renders the same card twice for the same input', () => {
    expect(render(base)).toBe(render(base))
  })

  it('matches its snapshot', () => {
    expect(render(`${base}&animate=false`)).toMatchSnapshot()
  })
})

describe('heatmap', () => {
  /**
   * Fixed thresholds make a two-a-day contributor look inactive and a
   * forty-a-day one uniformly saturated. Quartiles over each account's own
   * active days give both a grid with contrast.
   */
  it('grades by quartile, so both a light and a heavy year show contrast', () => {
    // Two people with the same rhythm and very different volumes. Scaling has to
    // build the busier year rather than clamp the quieter one, or the fixture
    // itself would have no spread left to grade.
    const levelsUsed = (perActiveDay: number) => {
      const counts = calendarFixture().counts.map((count, index) =>
        count === 0 ? 0 : 1 + ((index * 7 + count) % perActiveDay),
      )
      const svg = renderCard(
        statsFixture({ calendar: { from: '2025-07-21', counts } }),
        paramsFixture('username=x&card=heatmap&animate=false'),
      )
      return new Set(svg.match(/<g fill="#[0-9a-f]{6}"/g) ?? []).size
    }

    // Two a day and forty a day both reach four distinct active levels.
    expect(levelsUsed(2)).toBeGreaterThanOrEqual(2)
    expect(levelsUsed(4)).toBeGreaterThanOrEqual(4)
    expect(levelsUsed(40)).toBeGreaterThanOrEqual(4)
  })

  it('draws no active cells at all for a blank year', () => {
    const svg = renderCard(
      statsFixture({ calendar: { from: '2025-07-21', counts: Array(371).fill(0) } }),
      paramsFixture('username=x&card=heatmap&animate=false'),
    )

    expect(svg).not.toMatch(/<use href="#d" x=/)
    expect(svg).toContain('url(#empty)')
  })

  it('reveals column by column, and rests fully revealed', () => {
    const svg = render('username=x&card=heatmap')

    expect(svg).toContain('steps(53,end)')
    expect(svg).toContain('@media (prefers-reduced-motion:reduce)')
  })
})

describe('pass', () => {
  it('derives the barcode from the login, and only from the login', () => {
    const bars = (login: string) =>
      renderCard(statsFixture({ login }), paramsFixture('username=x&card=pass'))
        .match(/<rect x="[\d.]+" y="102"[^/]*\/>/g)
        ?.join('') ?? ''

    expect(bars('rondrft')).toBe(bars('rondrft'))
    expect(bars('rondrft')).not.toBe(bars('octocat'))
    expect(bars('rondrft').length).toBeGreaterThan(0)
  })

  it('prints the login on the band in capitals', () => {
    expect(render('username=x&card=pass')).toContain('RONDRFT')
  })
})

describe('gauge', () => {
  /**
   * The instrument is the dial; a number printed inside it is a label wearing a
   * costume. Every value sits below its dial.
   */
  it('puts no text inside a dial', () => {
    const svg = render('username=x&card=gauge&animate=false')

    const dialCentres = [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="26"/g)].map(
      (match) => ({ cx: Number(match[1]), cy: Number(match[2]) }),
    )
    const texts = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"/g)].map((match) => ({
      x: Number(match[1]),
      y: Number(match[2]),
    }))

    expect(dialCentres).toHaveLength(3)
    for (const dial of dialCentres) {
      for (const node of texts) {
        const inside = Math.hypot(node.x - dial.cx, node.y - dial.cy) < 26 && node.y < dial.cy + 26
        expect(inside, `text at ${node.x},${node.y} sits inside a dial`).toBe(false)
      }
    }
  })

  it('sweeps the needles from zero and pivots them on the dial centre', () => {
    const svg = render('username=x&card=gauge')

    expect(svg).toMatch(/@keyframes sw0\{from\{transform:rotate\(-135deg\)\}/)
    // `transform-box: fill-box` would pivot a zero-area line around nothing.
    expect(svg).not.toContain('transform-box')
    expect(svg).toMatch(/transform-origin:[\d.]+px [\d.]+px/)
  })

  it('pins the record needle at full deflection', () => {
    expect(render('username=x&card=gauge&animate=false')).toContain('rotate(135 ')
  })
})

describe('vinyl', () => {
  it('turns, once every eight seconds, forever', () => {
    const svg = render('username=x&card=vinyl')

    expect(svg).toContain('animation:spin 8s linear infinite')
  })

  it('stands still when animation is switched off', () => {
    const svg = render('username=x&card=vinyl&animate=false')

    expect(svg).not.toContain('animation')
    expect(svg).not.toContain('@keyframes')
  })

  it('keeps the total on the label rather than on the turning part', () => {
    const svg = render('username=x&card=vinyl&animate=false')
    const spinning = /<g class="spin">(.*?)<\/g>/s.exec(svg)?.[1] ?? ''

    expect(spinning).not.toContain('<text')
    expect(svg).toContain('4,821')
  })
})
