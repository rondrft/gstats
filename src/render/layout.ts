/**
 * Card layout.
 *
 * Placing the content by fixing the ring centres at 118, 238 and 358 with a
 * vertical centre of 75 looks centred and is not. Two things break it:
 *
 *   - A ring column is wider than its ring. "longest streak" is 92 units of
 *     text around a 59 unit circle, and the date beneath it can be wider still,
 *     so the group's real left and right edges come from the outermost labels
 *     rather than from the arcs. The columns are not even the same width as one
 *     another, which means the group's own centre is not its middle ring.
 *   - The content is not vertically symmetric about the ring centre. It runs
 *     from the top of the icon, which sits above the arc, down to the descender
 *     of the date line sixty units below, so centring the ring axis leaves the
 *     whole block sitting low in the card.
 *
 * This module measures the bounding box of everything that will be drawn and
 * centres that instead, then hands back coordinates to draw at. Every number it
 * returns is derived, so a hidden module, a longer translation or a different
 * language count all stay centred with nothing else to adjust.
 */

import { ICON_SIZE } from './icons'
import { ascentOf, descentOf, halfTextWidth, textWidth } from './metrics'
import { RADIUS, STROKE_WIDTH } from './ring'

export const CARD_HEIGHT = 150

/** Distance from the card edge to the inner frame. */
export const FRAME_INSET = 12

/** Space between the content's bounding box and the card edge, on every side. */
const MARGIN = 60

/**
 * Nominal horizontal pitch between ring centres. Widened automatically if a
 * translation makes a column broader than this leaves room for.
 */
const RING_PITCH = 120

/** Smallest acceptable gap between the widest parts of two adjacent columns. */
const MIN_COLUMN_GAP = 16

/** Gap between the ring group and the language block. */
const LANGS_GAP = 22

/** Baselines of the three text rows in a ring column, relative to its centre. */
export const VALUE_BASELINE = 7
export const LABEL_BASELINE = 47
export const SUBTITLE_BASELINE = 58

export const LABEL_FONT_SIZE = 11
export const SUBTITLE_FONT_SIZE = 8

export const LANGS_FONT_SIZE = 11

/** Design line height for the language block, tightened only if it overflows. */
const LANGS_LINE_HEIGHT = 20

/** Outermost ink of a ring, which is half a stroke beyond its radius. */
const RING_HALF_WIDTH = RADIUS + STROKE_WIDTH / 2

/** The icon sits centred on the gap at the top of the arc, above the ink. */
const COLUMN_TOP = -(RADIUS + ICON_SIZE / 2)

/** The date line is the lowest thing drawn in a column. */
const COLUMN_BOTTOM = SUBTITLE_BASELINE + descentOf(SUBTITLE_FONT_SIZE)

/** What a ring column needs to expose in order to be measured. */
export interface ColumnContent {
  /** The number as it will be rendered, thousands separators included. */
  value: string
  valueFontSize: number
  label: string
  subtitle: string
}

export interface LangsContent {
  /** Number of text rows. Zero when the block is hidden entirely. */
  lineCount: number
  /** Width of the widest row. */
  width: number
}

export interface LangsPlacement {
  x: number
  /** Baseline of the first row. */
  firstBaseline: number
  lineHeight: number
}

export interface BoundingBox {
  left: number
  right: number
  top: number
  bottom: number
}

export interface CardLayout {
  width: number
  height: number
  /** Shared vertical axis of every ring. */
  cy: number
  /** Centre of each ring, in order. */
  ringCentres: number[]
  langs: LangsPlacement | null
  /** The measured box, exposed so its margins can be asserted. */
  content: BoundingBox
}

/**
 * How far a column's ink reaches either side of its centre.
 *
 * Every row is centre-anchored, so the column's half width is the widest of
 * them — usually the label or the date, and only rarely the ring itself.
 */
function columnHalfWidth(column: ColumnContent): number {
  return Math.max(
    RING_HALF_WIDTH,
    halfTextWidth(column.value, column.valueFontSize),
    halfTextWidth(column.label, LABEL_FONT_SIZE),
    halfTextWidth(column.subtitle, SUBTITLE_FONT_SIZE),
  )
}

/**
 * Line height that keeps the language block inside the frame.
 *
 * Eight languages at the design spacing are taller than the card, which pushed
 * the first and last rows outside the frame. Tightening the leading is less
 * disruptive than growing the card or silently dropping a row.
 */
function langsLineHeight(lineCount: number): number {
  if (lineCount < 2) return LANGS_LINE_HEIGHT
  const available = CARD_HEIGHT - FRAME_INSET * 2 - langsInkPadding()
  return Math.min(LANGS_LINE_HEIGHT, available / (lineCount - 1))
}

/** Ink above the first baseline plus ink below the last one. */
function langsInkPadding(): number {
  return ascentOf(LANGS_FONT_SIZE) + descentOf(LANGS_FONT_SIZE)
}

export function layoutCard(columns: readonly ColumnContent[], langs: LangsContent): CardLayout {
  const halves = columns.map(columnHalfWidth)
  const widest = halves.length > 0 ? Math.max(...halves) : 0

  // A uniform pitch keeps the rings evenly spaced, which is what reads as
  // deliberate. It only grows if two worst-case columns would otherwise touch.
  const pitch = Math.max(RING_PITCH, widest * 2 + MIN_COLUMN_GAP)

  const firstHalf = halves[0] ?? 0
  const lastHalf = halves[halves.length - 1] ?? 0
  const ringsSpan = halves.length > 0 ? (halves.length - 1) * pitch + firstHalf + lastHalf : 0

  const showLangs = langs.lineCount > 0
  const gap = ringsSpan > 0 && showLangs ? LANGS_GAP : 0
  const contentWidth = ringsSpan + gap + (showLangs ? langs.width : 0)

  // Deriving the width from the content is what makes the two side margins
  // equal: there is no leftover to distribute unevenly. The floor only matters
  // for a card with nearly everything hidden.
  const width = Math.max(FRAME_INSET * 2 + MARGIN, Math.round(contentWidth + MARGIN * 2))
  const contentLeft = (width - contentWidth) / 2

  const {
    top: topOffset,
    bottom: bottomOffset,
    firstBaseline,
  } = verticalExtent(halves.length > 0, langs.lineCount)

  // Place the axis so that the box, rather than the ring centres, lands in the
  // middle. The frame is inset by the same amount above and below, so centring
  // on the card and centring on the frame are the same operation.
  const cy = (CARD_HEIGHT - (bottomOffset - topOffset)) / 2 - topOffset

  return {
    width,
    height: CARD_HEIGHT,
    cy,
    ringCentres: halves.map((_, index) => contentLeft + firstHalf + index * pitch),
    langs: showLangs
      ? {
          x: contentLeft + ringsSpan + gap,
          firstBaseline: cy + firstBaseline,
          lineHeight: langsLineHeight(langs.lineCount),
        }
      : null,
    content: {
      left: contentLeft,
      right: contentLeft + contentWidth,
      top: cy + topOffset,
      bottom: cy + bottomOffset,
    },
  }
}

/**
 * Vertical extents of the whole content, and the language block's first
 * baseline, all relative to the shared axis.
 *
 * The language block is centred against the ring columns rather than against
 * the axis itself: the columns are asymmetric about the axis, and a block of
 * text hung from the same axis would visibly sit high next to them.
 */
function verticalExtent(
  hasRings: boolean,
  lineCount: number,
): { top: number; bottom: number; firstBaseline: number } {
  const columnMiddle = hasRings ? (COLUMN_TOP + COLUMN_BOTTOM) / 2 : 0

  if (lineCount === 0) {
    return { top: COLUMN_TOP, bottom: COLUMN_BOTTOM, firstBaseline: 0 }
  }

  const span = (lineCount - 1) * langsLineHeight(lineCount)
  const langsHeight = span + langsInkPadding()
  const langsTop = columnMiddle - langsHeight / 2

  return {
    top: hasRings ? Math.min(COLUMN_TOP, langsTop) : langsTop,
    bottom: hasRings ? Math.max(COLUMN_BOTTOM, langsTop + langsHeight) : langsTop + langsHeight,
    firstBaseline: langsTop + ascentOf(LANGS_FONT_SIZE),
  }
}

/** Width of a run at the language block's font size, for callers measuring rows. */
export function langsTextWidth(text: string): number {
  return textWidth(text, LANGS_FONT_SIZE)
}

/** A rectangle of content a design wants placed. */
export interface Block {
  width: number
  height: number
}

export interface RowLayout {
  width: number
  height: number
  /** Left edge of each block, in order. */
  x: number[]
  /** Top edge of each block, in order. Each is centred on the row's axis. */
  y: number[]
  /** Vertical centre shared by every block. */
  middle: number
  content: BoundingBox
}

export interface RowOptions {
  /** Space between adjacent blocks. */
  gap?: number
  /** Margin on all four sides. The card grows to accommodate it. */
  margin?: number
  /** Preferred height. Grows if a block does not fit inside the margins. */
  height?: number
}

/**
 * Lays a row of blocks out, centred, with equal margins on all four sides.
 *
 * This is the primitive every design is built on, `layoutCard` included in
 * spirit. A design describes what it needs as boxes and is told where to draw
 * them; it never picks a coordinate. That is what keeps a card centred when a
 * module is hidden, a translation is longer, or a number gains a digit — and
 * what makes the margin-symmetry test meaningful rather than a tautology about
 * constants somebody typed in.
 */
export function layoutRow(blocks: readonly Block[], options: RowOptions = {}): RowLayout {
  const gap = options.gap ?? LANGS_GAP
  const margin = options.margin ?? MARGIN

  const contentWidth =
    blocks.reduce((sum, block) => sum + block.width, 0) + Math.max(0, blocks.length - 1) * gap
  const contentHeight = blocks.reduce((tallest, block) => Math.max(tallest, block.height), 0)

  const width = Math.max(FRAME_INSET * 2, Math.round(contentWidth + margin * 2))
  const height = Math.max(options.height ?? CARD_HEIGHT, Math.ceil(contentHeight + margin * 2))

  const left = (width - contentWidth) / 2
  const middle = height / 2

  const x: number[] = []
  let cursor = left
  for (const block of blocks) {
    x.push(cursor)
    cursor += block.width + gap
  }

  return {
    width,
    height,
    x,
    y: blocks.map((block) => middle - block.height / 2),
    middle,
    content: {
      left,
      right: left + contentWidth,
      top: middle - contentHeight / 2,
      bottom: middle + contentHeight / 2,
    },
  }
}
