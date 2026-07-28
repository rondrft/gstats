/**
 * `pass` — a boarding pass.
 *
 * A coloured band, a body, a perforated stub. The stub carries the number that
 * changes daily, which is the one worth putting where a thumb would tear.
 *
 * The brief for this design calls for cream paper, and the registry contract
 * requires that every design honour `theme`. Those pull against each other, and
 * the contract wins: "paper" here is the theme's own background raised a few
 * percent towards its text colour, so the panel reads as stock in a dark theme
 * and as paper in a light one. Choosing `theme=light` gives the literal article.
 */

import type { CardData } from '../../github/types'
import { credit, MONO_STACK, plate, round, svgDocument, text } from '../chrome'
import { mix } from '../color'
import { layoutRow } from '../layout'
import { textWidth } from '../metrics'
import { describe, languageSummary, visibleStats } from './modules'
import type { CardRenderer, RenderOptions } from './registry'

const HEIGHT = 150
const BAND_HEIGHT = 26
const MARGIN = 20

const BRAND_SIZE = 10
const LOGIN_SIZE = 12
const VALUE_SIZE = 26
const LABEL_SIZE = 8
const STUB_VALUE_SIZE = 34
const FOOTER_SIZE = 8

/** Share of the width the stub occupies, measured from the right edge. */
const PERFORATION_AT = 0.78

const BARCODE_HEIGHT = 22
const BARCODE_WIDTH = 76

/**
 * Air on each side of the stub's contents, inside the block it is laid out as.
 *
 * The stub carries the largest number on the card and the barcode under it, and
 * at the shared margin it had thirteen units to the tear and twenty to the card
 * edge — the tightest thing on the design. Padding the block rather than the
 * card keeps `layoutRow` the only thing choosing coordinates.
 */
const STUB_PADDING = 10

/** Radius of the notch punched at each end of the tear line. */
const NOTCH_RADIUS = 4

function renderPass(data: CardData, { params, strings }: RenderOptions): string {
  const { style } = params
  const stats = visibleStats(data, params, strings)

  // Each stat is as wide as the wider of its number and its label.
  const columns = stats.map((stat) => ({
    width: Math.max(textWidth(stat.formatted, VALUE_SIZE), textWidth(stat.label, LABEL_SIZE), 44),
    height: VALUE_SIZE + LABEL_SIZE + 8,
  }))

  const streak = stats.find((stat) => stat.module === 'streak') ?? stats[0]
  const stubWidth =
    Math.max(
      BARCODE_WIDTH,
      streak === undefined ? 0 : textWidth(streak.formatted, STUB_VALUE_SIZE),
    ) +
    STUB_PADDING * 2

  const GAP = 26
  const body = layoutRow([...columns, { width: stubWidth, height: BARCODE_HEIGHT }], {
    gap: GAP,
    margin: MARGIN,
    height: HEIGHT,
  })

  const paper = mix(style.bg, style.text, 0.06)
  const onBand = mix(style.bg, style.text, 0.05)
  // The tear falls in the gap before the stub. Deriving it from the layout keeps
  // it in the right place when a module is hidden; the nominal 78% is what the
  // full card happens to work out to.
  const stubX = body.x[columns.length] ?? body.width * PERFORATION_AT
  const perforationX = round(stubX - GAP / 2)

  // The band and the footer span the card; only the middle row is laid out.
  const markup =
    plate(body.width, HEIGHT, style) +
    `<rect width="${body.width}" height="${HEIGHT}" rx="${style.radius}" fill="${paper}"/>` +
    band(body.width, style, onBand, data.login) +
    // The frame surrounds the body only. Running it through the coloured band
    // would draw a hairline across the one solid area on the card.
    bodyFrame(body.width, style) +
    perforation(perforationX, style.muted, style.bg) +
    stats
      .map((stat, index) => {
        const column = columns[index]
        if (column === undefined) return ''
        const x = body.x[index] ?? 0
        return (
          text(stat.label, { x, y: 74, size: LABEL_SIZE, fill: style.muted }) +
          text(stat.formatted, { x, y: 74 + VALUE_SIZE, size: VALUE_SIZE, fill: style.text })
        )
      })
      .join('') +
    stub(streak, stubX, stubWidth, data.login, style) +
    footer(data, stats, perforationX, style) +
    credit(body.width, HEIGHT, style)

  return svgDocument({ width: body.width, height: HEIGHT, label: describe(data, stats) }, markup)
}

/** Solid header: the service on the left, the traveller on the right. */
function band(
  width: number,
  style: { accent: string; radius: number },
  ink: string,
  login: string,
): string {
  return (
    `<path d="M0 ${BAND_HEIGHT}V${style.radius}a${style.radius} ${style.radius} 0 0 1 ${style.radius} -${style.radius}` +
    `h${round(width - style.radius * 2)}a${style.radius} ${style.radius} 0 0 1 ${style.radius} ${style.radius}` +
    `v${BAND_HEIGHT - style.radius}z" fill="${style.accent}"/>` +
    text('PHOSPHOR STATS', {
      x: 14,
      y: 17,
      size: BRAND_SIZE,
      fill: ink,
      letterSpacing: 1.5,
    }) +
    text(login.toUpperCase(), {
      x: width - 14,
      y: 18,
      size: LOGIN_SIZE,
      fill: ink,
      anchor: 'end',
      letterSpacing: 1,
    })
  )
}

/** Hairline around the body, starting below the band. */
function bodyFrame(width: number, style: { border: string; muted: string }): string {
  if (style.border === 'none' || style.border === 'transparent') return ''
  const top = BAND_HEIGHT + 8
  return (
    `<rect x="8" y="${top}" width="${round(width - 16)}" height="${round(HEIGHT - top - 8)}" ` +
    `rx="2" fill="none" stroke="${style.border}" stroke-width="0.5"/>`
  )
}

/**
 * The tear line, with a notch punched at each end. The notches are filled with
 * the card's own background so they read as holes punched through the paper
 * rather than as dots drawn on it.
 *
 * They are half discs, not circles. A full circle centred on the body's top edge
 * puts half of itself — four units — on top of the solid accent band, where a
 * background-coloured disc reads as a blot sitting on the band instead of as a
 * hole in the edge below it. **Reported from production, on the orange theme
 * where the contrast makes it obvious.** Each notch now opens into the body and
 * stops exactly at the edge it is punched into.
 */
function perforation(x: number, stroke: string, bg: string): string {
  const r = NOTCH_RADIUS
  // Sweep 0 bulges downwards from the top edge, sweep 1 upwards from the bottom;
  // in SVG's y-down space those are the directions that open into the body.
  const notch = (y: number, sweep: 0 | 1) =>
    `<path d="M${round(x - r)} ${y}A${r} ${r} 0 0 ${sweep} ${round(x + r)} ${y}Z" fill="${bg}"/>`

  return (
    `<line x1="${x}" y1="${BAND_HEIGHT + 6}" x2="${x}" y2="${HEIGHT - 6}" stroke="${stroke}" ` +
    `stroke-width="1" stroke-dasharray="2 3" opacity="0.5"/>` +
    notch(BAND_HEIGHT, 0) +
    notch(HEIGHT, 1)
  )
}

/** The torn-off half: the number that changes, over a code that never does. */
function stub(
  streak: { formatted: string; label: string } | undefined,
  x: number,
  width: number,
  login: string,
  style: { text: string; muted: string; accent: string },
): string {
  if (streak === undefined) return ''
  const centre = x + width / 2

  return (
    text(streak.label, {
      x: centre,
      y: 56,
      size: LABEL_SIZE,
      fill: style.muted,
      anchor: 'middle',
    }) +
    text(streak.formatted, {
      x: centre,
      y: 56 + STUB_VALUE_SIZE,
      size: STUB_VALUE_SIZE,
      fill: style.accent,
      anchor: 'middle',
    }) +
    barcode(login, centre - BARCODE_WIDTH / 2, 102, style.muted)
  )
}

/**
 * The date range on the left, the languages on the right, on one baseline.
 *
 * Both stay on the body side of the tear: text running under the perforation
 * reads as a printing error rather than as a stub.
 */
function footer(
  data: CardData,
  stats: readonly { detail: string }[],
  perforationX: number,
  style: { muted: string },
): string {
  const detail = stats[0]?.detail ?? ''
  const languages = languageSummary(data, '   ')
  const baseline = HEIGHT - 13

  return (
    text(detail, { x: MARGIN, y: baseline, size: FOOTER_SIZE, fill: style.muted }) +
    text(languages, {
      x: perforationX - 10,
      y: baseline,
      size: FOOTER_SIZE,
      fill: style.muted,
      family: MONO_STACK,
      anchor: 'end',
    })
  )
}

/**
 * Decorative barcode, derived from the login.
 *
 * It encodes nothing — no scanner will read it — but it is deterministic, so the
 * same account always shows the same code. A random one would change on every
 * render and turn a card into something that flickers when a README reloads.
 */
export function barcode(seed: string, x: number, y: number, fill: string): string {
  let state = fnv1a(seed)
  const next = () => {
    // xorshift32: the same sequence for the same seed, on every runtime.
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x100000000
  }

  const bars: string[] = []
  let cursor = 0
  while (cursor < BARCODE_WIDTH - 4) {
    const barWidth = 1 + Math.floor(next() * 3)
    const gap = 1 + Math.floor(next() * 2)
    bars.push(
      `<rect x="${round(x + cursor)}" y="${y}" width="${barWidth}" height="${BARCODE_HEIGHT}"/>`,
    )
    cursor += barWidth + gap
  }

  return `<g fill="${fill}">${bars.join('')}</g>`
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0 || 1
}

export const pass: CardRenderer = { id: 'pass', render: renderPass }
