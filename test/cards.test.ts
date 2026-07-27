import { describe, expect, it } from 'vitest'
import { CARD_IDS, DEFAULT_CARD, renderCard, resolveRenderer } from '../src/render/cards'
import { calendarFixture, paramsFixture, statsFixture } from './helpers/fixtures'

const SIZE_BUDGET = 12 * 1024
const byteLength = (svg: string) => new TextEncoder().encode(svg).length

const render = (query: string) => renderCard(statsFixture(), paramsFixture(query))
const widthOf = (svg: string) => Number(/ width="(\d+)"/.exec(svg)?.[1] ?? 0)

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

  it('stays inside the size budget at the largest language count', () => {
    expect(byteLength(render(`${base}&langs_count=8`))).toBeLessThan(SIZE_BUDGET)
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
