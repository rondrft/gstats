/**
 * Ring geometry.
 *
 * Every ring is two concentric circles: a dim `track` showing the full arc, and
 * a bright `progress` arc drawn on top of it. Both are stroked circles rather
 * than paths, so the arc length is controlled entirely through `stroke-dasharray`
 * and `stroke-dashoffset`.
 *
 * The ring is not closed. A wedge at twelve o'clock is left unpainted and the
 * module's icon sits in it, which is why the gap has to land in exactly the same
 * place on both circles.
 *
 * Getting there takes two steps:
 *
 *   1. `rotate(-90 cx cy)` moves the path origin from three o'clock (where SVG
 *      starts a `<circle>`) to twelve o'clock.
 *   2. A negative `stroke-dashoffset` of half the gap slides the painted arc
 *      forward, leaving `GAP / 2` unpainted on either side of the origin.
 *
 * Nothing below is a magic number: change `RADIUS` or `GAP` and the arcs, the
 * animation and the icon all follow.
 */

import { trackColor } from './color'

/** Radius of the centreline of the stroke. */
export const RADIUS = 27
export const STROKE_WIDTH = 5

/** Arc length, in user units, left unpainted at the top for the icon. */
export const GAP = 35

export const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** Arc length that represents 100%. */
export const ARC = CIRCUMFERENCE - GAP

/** Distance from the path origin to the start of the painted arc. */
const HALF_GAP = GAP / 2

/** Rounded so the generated SVG stays readable and compact. */
const round = (n: number) => Math.round(n * 100) / 100

export interface RingOptions {
  cx: number
  cy: number
  /** Fill fraction, clamped to 0–1. */
  pct: number
  /** Colour of the progress arc. */
  color: string
  /** Card background, which the track is derived from rather than dimmed to. */
  background: string
  /** Index used to stagger the draw animation and name its keyframes. */
  index: number
  animate: boolean
}

export interface RingParts {
  /** `<circle>` markup for the track and the progress arc. */
  markup: string
  /** Keyframes for this ring's draw animation, or '' when animation is off. */
  keyframes: string
}

export function ring({ cx, cy, pct, color, background, index, animate }: RingOptions): RingParts {
  const filled = round(ARC * Math.min(1, Math.max(0, pct)))
  // Centres arrive from the layout as reals, so they are rounded here rather
  // than assumed to be whole numbers.
  const x = round(cx)
  const y = round(cy)
  const rotation = `rotate(-90 ${x} ${y})`
  const restingOffset = round(-HALF_GAP)
  const common = `cx="${x}" cy="${y}" r="${RADIUS}" fill="none" stroke-width="${STROKE_WIDTH}"`

  // The track's dash pattern has period `CIRCUMFERENCE`, so it repeats exactly
  // once around the circle and the single gap lands at the top.
  const track =
    `<circle ${common} stroke="${trackColor(color, background)}" ` +
    `stroke-dasharray="${round(ARC)} ${GAP}" stroke-dashoffset="${restingOffset}" ` +
    `transform="${rotation}"/>`

  // The progress arc uses an oversized second value so the pattern cannot repeat.
  // That leaves a single dash free to slide in from before the path origin, which
  // is what produces the draw-on effect; anything that scrolls past position 0 is
  // clipped, so the arc appears to grow rather than slide.
  const animationClass = animate ? ` class="ring-progress r${index}"` : ''
  const progress =
    `<circle ${common} stroke="${color}" stroke-linecap="round" ` +
    `stroke-dasharray="${filled} ${round(CIRCUMFERENCE)}" ` +
    `stroke-dashoffset="${restingOffset}" transform="${rotation}"${animationClass}/>`

  // `from` is the arc's own length: at that offset the dash sits entirely before
  // the path origin and nothing is painted.
  const keyframes = animate
    ? `@keyframes draw-${index}{from{stroke-dashoffset:${filled}}to{stroke-dashoffset:${restingOffset}}}`
    : ''

  return { markup: track + progress, keyframes }
}

/**
 * Font size for the number inside a ring.
 *
 * The usable width is the inner diameter minus the stroke, and the string is
 * monospaced, so a five-digit total would spill past the arc at the base size.
 * Sizes are keyed on the rendered length rather than the raw digit count
 * because locale-aware formatting adds separators that occupy a full cell.
 */
export function valueFontSize(rendered: string): number {
  switch (rendered.length) {
    case 0:
    case 1:
    case 2:
      return 20
    case 3:
      return 19
    case 4:
      return 17
    case 5:
      return 15
    default:
      return 12
  }
}
