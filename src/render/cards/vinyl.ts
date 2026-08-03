/**
 * `vinyl` — a record and its sleeve notes.
 *
 * A disc on the left, a tracklist on the right. The only design that animates
 * on a loop, because a record that is not turning is a coaster.
 *
 * WHAT TURNS AND WHAT DOES NOT. The grooves and the tonearm rotate; the centre
 * label, which carries the lifetime total, stays put. A number that revolves
 * once every eight seconds is decoration rather than information, and the whole
 * argument for putting it on the label is that it is the figure worth reading.
 *
 * The grooves are drawn at very low contrast on purpose. At full strength the
 * concentric circles stop reading as a record and start reading as a target.
 */

import type { CardData } from '../../github/types'
import { credit, frame, motion, plate, round, svgDocument, text } from '../chrome'
import { mix } from '../color'
import { abbreviate } from '../langs'
import { layoutRow } from '../layout'
import { textWidth } from '../metrics'
import { describe, visibleStats } from './modules'
import type { CardRenderer, RenderOptions } from './registry'

const DISC_RADIUS = 52
const LABEL_RADIUS = 20
const SPINDLE_RADIUS = 2.5

/** Innermost and outermost groove, and how many to draw between them. */
const GROOVE_INNER = LABEL_RADIUS + 4
const GROOVE_OUTER = DISC_RADIUS - 4
const GROOVE_COUNT = 9

const TRACK_HEIGHT = 17
const SIDE_SIZE = 8
const TITLE_SIZE = 10
const VALUE_SIZE = 11
const TOTAL_SIZE = 15

/** One revolution every eight seconds: present, but never the loudest thing. */
const SPIN_SECONDS = 8

function renderVinyl(data: CardData, { params, strings }: RenderOptions): string {
  const { style } = params
  const stats = visibleStats(data, params, strings)
  const showLangs = !params.hide.has('langs')

  const tracks = buildTracks(stats, data, showLangs)
  const trackWidth = Math.max(
    140,
    ...tracks.map(
      (track) => textWidth(track.title, TITLE_SIZE) + textWidth(track.value, VALUE_SIZE) + 46,
    ),
  )

  const row = layoutRow(
    [
      { width: DISC_RADIUS * 2, height: DISC_RADIUS * 2 },
      { width: trackWidth, height: Math.max(tracks.length * TRACK_HEIGHT, 40) },
    ],
    { gap: 26, margin: 20, height: 150 },
  )

  const discX = (row.x[0] ?? 0) + DISC_RADIUS
  const listX = row.x[1] ?? 0

  const markup =
    plate(row.width, row.height, style) +
    frame(row.width, row.height, style) +
    disc(discX, row.middle, data, style) +
    tracklist(tracks, listX, trackWidth, row.middle, style) +
    credit(row.width, row.height, style)

  return svgDocument(
    {
      width: row.width,
      height: row.height,
      label: describe(data, stats),
      css: motion(spinRules(), style.animate, '.spin'),
    },
    markup,
  )
}

function disc(
  cx: number,
  cy: number,
  data: CardData,
  style: { bg: string; text: string; muted: string; ring: string; accent: string; locale: string },
): string {
  const body = mix(style.bg, style.text, 0.13)
  const groove = mix(body, style.text, 0.14)
  const step = (GROOVE_OUTER - GROOVE_INNER) / (GROOVE_COUNT - 1)

  const grooves = Array.from(
    { length: GROOVE_COUNT },
    (_, index) =>
      `<circle r="${round(GROOVE_INNER + index * step)}" fill="none" stroke="${groove}" stroke-width="0.6"/>`,
  ).join('')

  // A single radial seam, so the rotation is visible on a disc that is otherwise
  // rotationally symmetric and would appear motionless.
  const seam = `<line x1="0" y1="-${GROOVE_INNER}" x2="0" y2="-${GROOVE_OUTER}" stroke="${groove}" stroke-width="0.8" opacity="0.8"/>`

  const total = new Intl.NumberFormat(style.locale === 'es' ? 'es' : 'en').format(
    data.totalContributions,
  )
  // The label is the size a label is; the number gives way rather than spilling
  // over the edge of it.
  const totalSize = Math.max(9, Math.min(TOTAL_SIZE, (LABEL_RADIUS * 1.6) / (total.length * 0.6)))

  return (
    `<g transform="translate(${round(cx)} ${round(cy)})">` +
    `<circle r="${DISC_RADIUS}" fill="${body}"/>` +
    `<g class="spin">${grooves}${seam}</g>` +
    `<circle r="${LABEL_RADIUS}" fill="${style.accent}"/>` +
    `<circle r="${SPINDLE_RADIUS}" fill="${style.bg}"/>` +
    // Below the spindle, the way a label is printed. Centred on it, the hole
    // would punch through the middle of the number.
    text(total, {
      x: 0,
      y: round(SPINDLE_RADIUS + totalSize * 0.9),
      size: round(totalSize),
      fill: style.bg,
      anchor: 'middle',
      weight: 600,
    }) +
    `</g>` +
    tonearm(cx, cy, style.muted)
  )
}

/** Rests on the outer edge, angled in, with a counterweight at the pivot. */
function tonearm(cx: number, cy: number, stroke: string): string {
  const pivotX = round(cx + DISC_RADIUS + 4)
  const pivotY = round(cy - DISC_RADIUS + 6)
  // The head rests on the grooves, clear of the label. An arm that crosses the
  // label sits on top of the one number the disc is carrying.
  const headX = round(cx + DISC_RADIUS * 0.5)
  const headY = round(cy + DISC_RADIUS * 0.6)

  return (
    `<g stroke="${stroke}" stroke-linecap="round" opacity="0.75">` +
    `<line x1="${pivotX}" y1="${pivotY}" x2="${headX}" y2="${headY}" stroke-width="2"/>` +
    `<circle cx="${pivotX}" cy="${pivotY}" r="3.5" fill="${stroke}" stroke="none"/>` +
    `<circle cx="${headX}" cy="${headY}" r="2" fill="${stroke}" stroke="none"/>` +
    `</g>`
  )
}

interface Track {
  side: string
  title: string
  value: string
}

/**
 * Sides A and B: the numbers on one, the languages on the other, which is what
 * the two halves of a record are for.
 */
function buildTracks(
  stats: readonly { label: string; formatted: string }[],
  data: CardData,
  showLangs: boolean,
): Track[] {
  const tracks: Track[] = stats.map((stat, index) => ({
    side: `A${index + 1}`,
    title: stat.label,
    value: stat.formatted,
  }))

  if (!showLangs) return tracks

  // However many arrive is however many side B has room for: the ceiling is
  // declared as `MAX_LANGUAGES.vinyl` and applied before the card is drawn.
  data.languages.forEach((language, index) => {
    tracks.push({
      side: `B${index + 1}`,
      title: abbreviate(language.name),
      value: `${Math.round(language.pct * 100)}%`,
    })
  })

  return tracks
}

function tracklist(
  tracks: readonly Track[],
  x: number,
  width: number,
  middle: number,
  style: { text: string; muted: string },
): string {
  const first = middle - ((tracks.length - 1) * TRACK_HEIGHT) / 2

  return tracks
    .map((track, index) => {
      const y = round(first + index * TRACK_HEIGHT)
      const rule =
        index === 0
          ? ''
          : `<line x1="${round(x)}" y1="${round(y - TRACK_HEIGHT / 2)}" x2="${round(x + width)}" ` +
            `y2="${round(y - TRACK_HEIGHT / 2)}" stroke="${style.muted}" stroke-width="0.4" opacity="0.4"/>`

      return (
        rule +
        text(track.side, { x, y: y + 3, size: SIDE_SIZE, fill: style.muted, letterSpacing: 0.5 }) +
        text(track.title, { x: x + 24, y: y + 3, size: TITLE_SIZE, fill: style.text }) +
        text(track.value, {
          x: x + width,
          y: y + 3,
          size: VALUE_SIZE,
          fill: style.text,
          anchor: 'end',
        })
      )
    })
    .join('')
}

/**
 * `transform-origin: 0 0` is explicit because the group already sits at the
 * disc's centre; without it the browser would default to the element's own
 * bounding box and the record would wobble instead of turning.
 */
function spinRules(): string {
  return (
    `@keyframes spin{to{transform:rotate(360deg)}}` +
    `.spin{transform-origin:0 0;animation:spin ${SPIN_SECONDS}s linear infinite}`
  )
}

export const vinyl: CardRenderer = { id: 'vinyl', render: renderVinyl }
