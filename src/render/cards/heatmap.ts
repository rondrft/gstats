/**
 * `heatmap` — the trailing year, day by day.
 *
 * The only design that shows something the others cannot. It draws the same
 * contribution calendar the streak calculation already consumes, so it costs
 * nothing extra upstream.
 *
 * Two decisions carry the design.
 *
 * **Intensity is by quartile, not by threshold.** Fixed cut-offs make somebody
 * who averages two contributions a day look like they did nothing all year, and
 * somebody who averages forty look uniformly saturated. Ranking each active day
 * against that account's own distribution gives both of them a grid with
 * contrast, at the cost of the levels not being comparable between people —
 * which they were never really comparable as anyway.
 *
 * **Empty days are a pattern, not elements.** A year is 371 cells; emitting all
 * of them individually put the document over its size budget on its own. The
 * empty grid is one tiled `<rect>`, and only days with activity are drawn on top
 * of it, grouped by level so the fill is written five times rather than once per
 * day.
 */

import type { CompactCalendar, StatsData } from '../../github/types'
import { addDays } from '../../streak'
import { credit, frame, motion, plate, round, svgDocument, text } from '../chrome'
import { mix } from '../color'
import { layoutRow } from '../layout'
import { describe, visibleStats } from './modules'
import type { CardRenderer, RenderOptions } from './registry'

/** Side of one day's square, and the pitch that separates two of them. */
const CELL = 7
const PITCH = 9
const WEEKS = 53
const DAYS = 7

const GRID_WIDTH = WEEKS * PITCH - (PITCH - CELL)
const GRID_HEIGHT = DAYS * PITCH - (PITCH - CELL)

const HEADER_SIZE = 13
const LABEL_SIZE = 9
const MONTH_SIZE = 10

/** Header baseline, month labels, then the grid. */
const HEADER_BASELINE = HEADER_SIZE
const MONTH_BASELINE = HEADER_BASELINE + 20
const GRID_TOP = MONTH_BASELINE + 6
const BLOCK_HEIGHT = GRID_TOP + GRID_HEIGHT

/** One column of reveal per 8ms, which crosses the year in under half a second. */
const WIPE_MS = WEEKS * 8

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Columns a three-letter month name occupies, and so the closest two may sit. */
const MONTH_MIN_COLUMNS = 3

function renderHeatmap(data: StatsData, { params, strings }: RenderOptions): string {
  const { style } = params
  const stats = visibleStats(data, params, strings)

  const layout = layoutRow([{ width: GRID_WIDTH, height: BLOCK_HEIGHT }], { height: 0, margin: 22 })
  const left = layout.x[0] ?? 0
  const top = layout.y[0] ?? 0

  const ramp = intensityRamp(style.bg, style.ring, style.accent)
  const levels = levelsFor(data.calendar)

  const body =
    plate(layout.width, layout.height, style) +
    frame(layout.width, layout.height, style) +
    header(stats, left, top + HEADER_BASELINE, style) +
    monthLabels(data.calendar, left, top + MONTH_BASELINE, style.muted) +
    grid(levels, left, top + GRID_TOP, ramp, style.animate) +
    credit(layout.width, layout.height, style)

  return svgDocument(
    {
      width: layout.width,
      height: layout.height,
      label: describe(data, stats),
      css: motion(wipeRules(), style.animate, '.wipe'),
    },
    body,
  )
}

/**
 * Five fills, from "nothing happened" to "a lot happened", built out of the
 * theme's own colours so the grid belongs to whichever palette is in use.
 * The top level reaches for the accent, which is the only place the card admits
 * a second hue and marks the reader's best days.
 */
function intensityRamp(bg: string, ring: string, accent: string): string[] {
  return [
    mix(bg, ring, 0.1),
    mix(bg, ring, 0.35),
    mix(bg, ring, 0.6),
    mix(bg, ring, 0.85),
    mix(ring, accent, 0.45),
  ]
}

/**
 * Assigns each day a level 0-4.
 *
 * Quartiles are taken over the days that had any activity at all; a year is
 * mostly zeros, and including them would push every quartile boundary to zero
 * and flatten the grid to two levels.
 */
function levelsFor(calendar: CompactCalendar): number[] {
  const active = calendar.counts.filter((count) => count > 0).sort((a, b) => a - b)
  if (active.length === 0) return calendar.counts.map(() => 0)

  const at = (fraction: number) =>
    active[Math.min(active.length - 1, Math.floor(active.length * fraction))] ?? 0
  const [q1, q2, q3] = [at(0.25), at(0.5), at(0.75)]

  return calendar.counts.map((count) => {
    if (count <= 0) return 0
    if (count <= q1) return 1
    if (count <= q2) return 2
    if (count <= q3) return 3
    return 4
  })
}

/**
 * The grid: an empty plate under the days that had activity.
 *
 * The first column is padded so that rows correspond to weekdays — the calendar
 * starts on whatever day it starts on, and a grid whose rows drift is unreadable.
 */
function grid(
  levels: readonly number[],
  x: number,
  y: number,
  ramp: readonly string[],
  animate: boolean,
): string {
  const offset = weekdayOfFirst(levels.length)
  const byLevel: string[][] = [[], [], [], [], []]

  levels.forEach((level, index) => {
    if (level <= 0) return
    const slot = index + offset
    const column = Math.floor(slot / DAYS)
    if (column >= WEEKS) return
    byLevel[level]?.push(`<use href="#d" x="${column * PITCH}" y="${(slot % DAYS) * PITCH}"/>`)
  })

  const cells = byLevel
    .map((uses, level) =>
      uses.length === 0 ? '' : `<g fill="${ramp[level]}">${uses.join('')}</g>`,
    )
    .join('')

  // The reveal is a clip rectangle sliding in from the left in whole columns,
  // rather than 53 separately delayed groups. It is a fraction of the bytes and
  // its resting state — fully uncovered — is what a renderer that ignores CSS
  // shows.
  const clip = animate
    ? `<clipPath id="wipe"><rect class="wipe" width="${GRID_WIDTH}" height="${GRID_HEIGHT}"/></clipPath>`
    : ''
  const open = animate ? `<g clip-path="url(#wipe)">` : '<g>'

  return (
    `<defs><rect id="d" width="${CELL}" height="${CELL}" rx="1.5"/>${clip}</defs>` +
    `<g transform="translate(${round(x)} ${round(y)})">` +
    `<rect width="${GRID_WIDTH}" height="${GRID_HEIGHT}" fill="url(#empty)"/>` +
    open +
    cells +
    `</g></g>` +
    `<defs><pattern id="empty" width="${PITCH}" height="${PITCH}" patternUnits="userSpaceOnUse">` +
    `<use href="#d" fill="${ramp[0]}"/></pattern></defs>`
  )
}

function wipeRules(): string {
  return (
    `@keyframes wipe{from{transform:translateX(-${GRID_WIDTH}px)}to{transform:translateX(0)}}` +
    `.wipe{animation:wipe ${WIPE_MS}ms steps(${WEEKS},end) both}`
  )
}

/**
 * Days to pad before the first cell so each row is one weekday.
 *
 * The calendar always ends on the reference day, so the first day's weekday is
 * derived from the span rather than stored.
 */
function weekdayOfFirst(span: number): number {
  return (WEEKS * DAYS - span) % DAYS
}

function header(
  stats: readonly { formatted: string; label: string }[],
  x: number,
  y: number,
  style: { text: string; muted: string },
): string {
  let cursor = x
  return stats
    .map((stat) => {
      const value = text(stat.formatted, {
        x: cursor,
        y,
        size: HEADER_SIZE,
        fill: style.text,
      })
      const width = stat.formatted.length * HEADER_SIZE * 0.6
      const label = text(stat.label, {
        x: cursor + width + 5,
        y,
        size: LABEL_SIZE,
        fill: style.muted,
      })
      cursor += width + 5 + stat.label.length * LABEL_SIZE * 0.6 + 16
      return value + label
    })
    .join('')
}

/**
 * A month name above the first column that falls in it, which is how a reader
 * anchors a position in the grid to a time of year.
 */
function monthLabels(calendar: CompactCalendar, x: number, y: number, fill: string): string {
  const offset = weekdayOfFirst(calendar.counts.length)
  const labels: string[] = []
  let previous = ''
  let lastLabelled = Number.NEGATIVE_INFINITY

  for (let column = 0; column < WEEKS; column += 1) {
    const dayIndex = column * DAYS - offset
    if (dayIndex < 0 || dayIndex >= calendar.counts.length) continue
    const month = addDays(calendar.from, dayIndex).slice(5, 7)
    if (month === previous) continue
    previous = month
    // A three-letter name is three columns wide. The window opens on a partial
    // month, so the first two boundaries can fall a column apart and overprint
    // each other; the later of the two is the one worth keeping.
    if (column - lastLabelled < MONTH_MIN_COLUMNS) {
      labels.pop()
    }
    // Skip a label that would collide with the card's right edge.
    if (column > WEEKS - 3) continue
    lastLabelled = column
    labels.push(
      text(MONTHS[Number(month) - 1] ?? '', {
        x: x + column * PITCH,
        y,
        size: MONTH_SIZE,
        fill,
      }),
    )
  }

  return labels.join('')
}

export const heatmap: CardRenderer = { id: 'heatmap', render: renderHeatmap }
