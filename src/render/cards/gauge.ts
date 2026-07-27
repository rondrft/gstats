/**
 * `gauge` — an instrument panel.
 *
 * Three dials and a language readout. The dials carry no text at all: a number
 * printed inside a gauge is a label pretending to be an instrument, and it
 * crowds the one thing the dial is for. The value sits under the dial, large,
 * with its name smaller beneath it.
 *
 * WHAT EACH NEEDLE MEANS. A needle that points somewhere arbitrary is worse
 * than no needle, because it looks like a measurement:
 *
 *   total  — the current calendar year against the reader's best calendar year.
 *            Full deflection means this is their strongest year so far. The
 *            lifetime figure below it has no ceiling and could not drive a
 *            needle honestly, so the dial measures the year and the text
 *            reports the total.
 *   streak — the current run against the longest one this account has managed.
 *            Full deflection is a personal record in progress.
 *   best   — pinned at maximum. The record is its own ceiling; the needle is
 *            structure here rather than data, and it is the same admission the
 *            terminal design makes about its full rings.
 */

import type { StatsData } from '../../github/types'
import { credit, frame, motion, plate, round, svgDocument, text } from '../chrome'
import { mix } from '../color'
import { abbreviate, barFraction } from '../langs'
import { layoutRow } from '../layout'
import { textWidth } from '../metrics'
import { describe, visibleStats, wantsLanguages } from './modules'
import type { CardRenderer, RenderOptions } from './registry'

const RADIUS = 26
const DIAL_SIZE = RADIUS * 2

const VALUE_SIZE = 17
const LABEL_SIZE = 8
const LANG_SIZE = 9

/** Dial, then the value, then the name. */
const VALUE_BASELINE = DIAL_SIZE + 18
const LABEL_BASELINE = VALUE_BASELINE + 12
const BLOCK_HEIGHT = LABEL_BASELINE + 3

/** The needle sweeps 270 degrees, with zero at the bottom left. */
const SWEEP = 270
const START_ANGLE = -135

/** Ticks every ten degrees across the sweep, and none across the dead quarter. */
const TICK_STEP = 10
const TICK_LENGTH = 2

const NEEDLE_LENGTH = RADIUS - 7
const ANIMATION = '0.9s cubic-bezier(0.34, 1.4, 0.64, 1) both'

const LANG_ROW_HEIGHT = 13
const BAR_WIDTH = 46
const BAR_HEIGHT = 5

function renderGauge(data: StatsData, { params, strings }: RenderOptions): string {
  const { style } = params
  const stats = visibleStats(data, params, strings)
  const showLangs = wantsLanguages(params)

  const dials = stats.map((stat) => ({
    width: Math.max(
      DIAL_SIZE,
      textWidth(stat.formatted, VALUE_SIZE),
      textWidth(stat.label, LABEL_SIZE),
    ),
    height: BLOCK_HEIGHT,
  }))

  const languages = data.languages.slice(0, 4)
  const langLabelWidth = Math.max(
    22,
    ...languages.map((language) => textWidth(abbreviate(language.name), LANG_SIZE)),
  )
  const panelWidth =
    languages.length === 0
      ? textWidth(strings.noLanguages, LANG_SIZE)
      : langLabelWidth + 6 + BAR_WIDTH + 6 + textWidth('100%', LANG_SIZE)

  const blocks = showLangs
    ? [
        ...dials,
        { width: panelWidth, height: Math.max(BLOCK_HEIGHT, languages.length * LANG_ROW_HEIGHT) },
      ]
    : dials

  const row = layoutRow(blocks, { gap: 24, margin: 24, height: 150 })
  const fractions = stats.map((stat) => needleFraction(stat.module, data))

  const markup =
    plate(row.width, row.height, style) +
    frame(row.width, row.height, style) +
    stats
      .map((stat, index) =>
        dial(
          stat,
          fractions[index] ?? 0,
          (row.x[index] ?? 0) + (blocks[index]?.width ?? 0) / 2,
          (row.y[index] ?? 0) + RADIUS,
          index,
          style,
        ),
      )
      .join('') +
    (showLangs
      ? panel(
          languages,
          row.x[dials.length] ?? 0,
          row.middle,
          langLabelWidth,
          strings.noLanguages,
          style,
        )
      : '') +
    credit(row.width, row.height, style)

  return svgDocument(
    {
      width: row.width,
      height: row.height,
      label: describe(data, stats),
      css: motion(
        sweepRules(
          fractions,
          stats.map((_, index) => ({
            cx: (row.x[index] ?? 0) + (blocks[index]?.width ?? 0) / 2,
            cy: (row.y[index] ?? 0) + RADIUS,
          })),
        ),
        style.animate,
        '.needle',
      ),
    },
    markup,
  )
}

/** See the header: each of these is a deliberate choice, not a default. */
function needleFraction(module: string, data: StatsData): number {
  if (module === 'streak') {
    const best = data.streaks.longest.length
    return best === 0 ? 0 : clamp(data.streaks.current.length / best)
  }
  if (module === 'total') {
    const best = data.bestYearContributions
    return best === 0 ? 0 : clamp(data.yearContributions / best)
  }
  return 1
}

const clamp = (value: number) => Math.max(0, Math.min(1, value))

function dial(
  stat: { formatted: string; label: string; module: string },
  fraction: number,
  cx: number,
  cy: number,
  index: number,
  style: { bg: string; text: string; muted: string; ring: string; accent: string },
): string {
  const face = mix(style.bg, style.text, 0.07)
  const ink = stat.module === 'streak' ? style.accent : style.ring
  const angle = round(START_ANGLE + SWEEP * fraction)

  return (
    `<circle cx="${round(cx)}" cy="${round(cy)}" r="${RADIUS}" fill="${face}" ` +
    `stroke="${style.muted}" stroke-width="0.5" opacity="0.9"/>` +
    ticks(cx, cy, style.muted) +
    `<line x1="${round(cx)}" y1="${round(cy)}" x2="${round(cx)}" y2="${round(cy - NEEDLE_LENGTH)}" ` +
    `stroke="${ink}" stroke-width="2" stroke-linecap="round" ` +
    `transform="rotate(${angle} ${round(cx)} ${round(cy)})" class="needle n${index}"/>` +
    `<circle cx="${round(cx)}" cy="${round(cy)}" r="2.5" fill="${ink}"/>` +
    text(stat.formatted, {
      x: cx,
      y: cy - RADIUS + VALUE_BASELINE,
      size: VALUE_SIZE,
      fill: style.text,
      anchor: 'middle',
    }) +
    text(stat.label, {
      x: cx,
      y: cy - RADIUS + LABEL_BASELINE,
      size: LABEL_SIZE,
      fill: style.muted,
      anchor: 'middle',
    })
  )
}

/**
 * The scale, as one dashed circle rather than twenty-eight lines.
 *
 * `pathLength="360"` reparameterises the circumference into degrees, so the dash
 * pattern can be written directly in the units the sweep is described in. The
 * final gap closes the quarter the needle never enters.
 */
function ticks(cx: number, cy: number, stroke: string): string {
  const count = SWEEP / TICK_STEP
  const gap = TICK_STEP - TICK_LENGTH
  const pattern = `${Array.from({ length: count }, () => `${TICK_LENGTH} ${gap}`).join(' ')} ${TICK_LENGTH} ${360 - SWEEP - TICK_LENGTH}`
  const r = RADIUS - 4

  // The circle's path starts at three o'clock; the sweep starts 225 degrees
  // earlier, at the bottom left.
  return (
    `<circle cx="${round(cx)}" cy="${round(cy)}" r="${r}" fill="none" stroke="${stroke}" ` +
    `stroke-width="4" pathLength="360" stroke-dasharray="${pattern}" ` +
    `transform="rotate(-225 ${round(cx)} ${round(cy)})" opacity="0.45"/>`
  )
}

/**
 * Needles sweep up from zero rather than appearing at their reading, with a
 * slight overshoot at the end so they settle the way a real one does.
 *
 * The resting rotation is in the `transform` attribute as well as in the final
 * keyframe, so a renderer that ignores the stylesheet still shows the reading.
 */
function sweepRules(
  fractions: readonly number[],
  pivots: readonly { cx: number; cy: number }[],
): string {
  return fractions
    .map((fraction, index) => {
      const angle = round(START_ANGLE + SWEEP * fraction)
      const pivot = pivots[index]
      if (pivot === undefined) return ''
      // The origin is given in viewBox units rather than as `center` with
      // `transform-box: fill-box`. A line's fill box has no area, so that pair
      // would pivot around an undefined point and the needle would fly off.
      return (
        `@keyframes sw${index}{from{transform:rotate(${START_ANGLE}deg)}to{transform:rotate(${angle}deg)}}` +
        `.n${index}{transform-origin:${round(pivot.cx)}px ${round(pivot.cy)}px;` +
        `animation:sw${index} ${ANIMATION}}`
      )
    })
    .join('')
}

/** Language readout: name, proportional bar, percentage. */
function panel(
  languages: readonly { name: string; color: string | null; pct: number }[],
  x: number,
  middle: number,
  labelWidth: number,
  emptyLabel: string,
  style: { text: string; muted: string; ring: string },
): string {
  if (languages.length === 0) {
    return text(emptyLabel, { x, y: middle + 3, size: LANG_SIZE, fill: style.muted })
  }

  const first = middle - ((languages.length - 1) * LANG_ROW_HEIGHT) / 2
  const barX = x + labelWidth + 6
  const leader = Math.max(...languages.map((language) => language.pct))

  return languages
    .map((language, index) => {
      const y = round(first + index * LANG_ROW_HEIGHT)
      // Share of the leading language, not of the whole: see `barFraction`.
      // Against 100% a normal breakdown draws four bars of nearly equal width.
      const filled = Math.max(1, round(barFraction(language.pct, leader) * BAR_WIDTH))
      return (
        text(abbreviate(language.name), { x, y: y + 3, size: LANG_SIZE, fill: style.text }) +
        `<rect x="${round(barX)}" y="${round(y - 2)}" width="${BAR_WIDTH}" height="${BAR_HEIGHT}" ` +
        `rx="1" fill="${style.muted}" opacity="0.22"/>` +
        `<rect x="${round(barX)}" y="${round(y - 2)}" width="${filled}" height="${BAR_HEIGHT}" ` +
        `rx="1" fill="${language.color ?? style.ring}"/>` +
        text(`${Math.round(language.pct * 100)}%`, {
          x: barX + BAR_WIDTH + 6,
          y: y + 3,
          size: LANG_SIZE,
          fill: style.muted,
        })
      )
    })
    .join('')
}

export const gauge: CardRenderer = { id: 'gauge', render: renderGauge }
