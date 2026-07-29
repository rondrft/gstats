/**
 * `press` — a newspaper front page.
 *
 * Serif throughout, a centred headline over a double rule, a dateline, then the
 * numbers set as columns divided by hairlines.
 *
 * The current streak is the only thing on the card in a second colour. That is
 * the whole reason it works: a page with one accent directs the eye, and a page
 * with four is a brochure. The accent is the theme's, so the restraint survives
 * whichever palette the reader picked.
 *
 * Serif here means the system's serif. No design may load a font — GitHub serves
 * README images with external subresource loading disabled — so the stack falls
 * back through the faces that ship with each platform.
 */

import type { CardData } from '../../github/types'
import { credit, frame, MONO_STACK, plate, round, SERIF_STACK, svgDocument, text } from '../chrome'
import { abbreviate } from '../langs'
import { layoutRow } from '../layout'
import { textWidth } from '../metrics'
import { describe, visibleStats } from './modules'
import type { CardRenderer, RenderOptions } from './registry'

const MARGIN = 22

/** Space between adjacent columns. The dividing hairlines go down its middle. */
const GAP = 26

const HEADLINE_SIZE = 24
const DATELINE_SIZE = 9
const VALUE_SIZE = 32
const LABEL_SIZE = 8
const LANG_SIZE = 9

const HEADLINE_BASELINE = 34
const RULE_Y = 44
const DATELINE_BASELINE = 60
const COLUMN_TOP = 72
const COLUMN_HEIGHT = 54
const HEIGHT = COLUMN_TOP + COLUMN_HEIGHT + MARGIN

/** Widest headline that fits before it has to be cut. */
const HEADLINE_MAX = 26

/** Extra advance per character from the tracking on the column labels. */
const LABEL_TRACKING = 1.4

const labelWidth = (label: string) => textWidth(label, LABEL_SIZE) + label.length * LABEL_TRACKING

function renderPress(data: CardData, { params, strings }: RenderOptions): string {
  const { style } = params
  const stats = visibleStats(data, params, strings)
  const showLangs = !params.hide.has('langs')

  const columns = stats.map((stat) => ({
    // The label is set in caps with tracking, so it is wider than the raw
    // string measures. Ignoring that let it run under the column rule.
    width: Math.max(textWidth(stat.formatted, VALUE_SIZE), labelWidth(stat.label), 62),
    height: COLUMN_HEIGHT,
  }))

  const langLines = data.languages
    .slice(0, 4)
    .map((language) => `${abbreviate(language.name)} ${Math.round(language.pct * 100)}%`)
  const langWidth = Math.max(
    54,
    ...langLines.map((line) => textWidth(line, LANG_SIZE)),
    textWidth(strings.noLanguages, LANG_SIZE) * 0.6,
  )

  const blocks = showLangs ? [...columns, { width: langWidth, height: COLUMN_HEIGHT }] : columns

  const row = layoutRow(blocks, { gap: GAP, margin: MARGIN, height: HEIGHT })
  const headline = truncate(data.name ?? data.login, HEADLINE_MAX)

  const markup =
    plate(row.width, HEIGHT, style) +
    // The inset is this design's own proportion and stays where it is: a
    // masthead wants more air outside its rules than the frame would leave at
    // the shared 12, and moving a published card's frame is a visible change to
    // something somebody has already embedded. It is an argument to the shared
    // frame rather than a coordinate written down twice, which is the thing that
    // went wrong on `pass`.
    frame(row.width, HEIGHT, style, 8) +
    text(headline, {
      x: row.width / 2,
      y: HEADLINE_BASELINE,
      size: HEADLINE_SIZE,
      fill: style.text,
      anchor: 'middle',
      family: SERIF_STACK,
    }) +
    doubleRule(row.content, style.muted) +
    dateline(data, row.content, style) +
    divisions(row, blocks.length, style.muted) +
    stats
      .map((stat, index) => statColumn(stat, row.x[index] ?? 0, blocks[index]?.width ?? 0, style))
      .join('') +
    (showLangs
      ? languageColumn(langLines, row.x[columns.length] ?? 0, strings.noLanguages, style)
      : '') +
    credit(row.width, HEIGHT, style)

  return svgDocument(
    {
      width: row.width,
      height: HEIGHT,
      label: describe(data, stats),
      fontFamily: SERIF_STACK,
    },
    markup,
  )
}

/**
 * Two rules, one heavy and one hair, which is what a masthead does.
 *
 * They run between the content's own edges rather than between two copies of
 * `MARGIN`. The card's width is rounded to a whole number, so the content lands
 * within half a unit of the margin it asked for and not on it — a rule written
 * from the constant is very slightly out of line with the column beneath it. It
 * is far below anything anybody can see, and it is the same mistake that was
 * visible on `pass`: a coordinate that has to agree with the layout, written
 * down somewhere the layout cannot reach.
 */
function doubleRule(content: { left: number; right: number }, stroke: string): string {
  const x = round(content.left)
  const width = round(content.right - content.left)
  return (
    `<rect x="${x}" y="${RULE_Y}" width="${width}" height="1.6" fill="${stroke}"/>` +
    `<rect x="${x}" y="${RULE_Y + 4}" width="${width}" height="0.5" fill="${stroke}" opacity="0.7"/>`
  )
}

function dateline(
  data: CardData,
  content: { left: number; right: number },
  style: { muted: string; locale: string },
): string {
  const printed = new Date(data.fetchedAt).toISOString().slice(0, 10)
  return (
    text(data.login, {
      x: content.left,
      y: DATELINE_BASELINE,
      size: DATELINE_SIZE,
      fill: style.muted,
      letterSpacing: 1.2,
    }) +
    text(printed, {
      x: content.right,
      y: DATELINE_BASELINE,
      size: DATELINE_SIZE,
      fill: style.muted,
      anchor: 'end',
      family: MONO_STACK,
    })
  )
}

/** Hairlines down the middle of each gutter, never at the outer edges. */
function divisions(row: { x: number[]; width: number }, count: number, stroke: string): string {
  const rules: string[] = []
  for (let index = 1; index < count; index += 1) {
    const x = round((row.x[index] ?? 0) - GAP / 2)
    rules.push(
      `<line x1="${x}" y1="${COLUMN_TOP - 6}" x2="${x}" y2="${COLUMN_TOP + COLUMN_HEIGHT - 6}" ` +
        `stroke="${stroke}" stroke-width="0.5" opacity="0.6"/>`,
    )
  }
  return rules.join('')
}

function statColumn(
  stat: { module: string; formatted: string; label: string },
  x: number,
  width: number,
  style: { text: string; muted: string; accent: string },
): string {
  const centre = x + width / 2
  // The one accent on the page, spent on the number that moves.
  const fill = stat.module === 'streak' ? style.accent : style.text

  return (
    text(stat.formatted, {
      x: centre,
      y: COLUMN_TOP + VALUE_SIZE,
      size: VALUE_SIZE,
      fill,
      anchor: 'middle',
      family: SERIF_STACK,
    }) +
    text(stat.label.toUpperCase(), {
      x: centre,
      y: COLUMN_TOP + VALUE_SIZE + 16,
      size: LABEL_SIZE,
      fill: style.muted,
      anchor: 'middle',
      letterSpacing: LABEL_TRACKING,
    })
  )
}

function languageColumn(
  lines: readonly string[],
  x: number,
  emptyLabel: string,
  style: { text: string; muted: string },
): string {
  if (lines.length === 0) {
    return text(emptyLabel, {
      x,
      y: COLUMN_TOP + 16,
      size: LANG_SIZE,
      fill: style.muted,
      family: MONO_STACK,
    })
  }

  return lines
    .map((line, index) =>
      text(line, {
        x,
        y: COLUMN_TOP + 14 + index * 13,
        size: LANG_SIZE,
        fill: style.text,
        family: MONO_STACK,
        preserveSpace: true,
      }),
    )
    .join('')
}

/** Cuts an over-long name at a word boundary where it can, with an ellipsis. */
function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  const cut = value.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

export const press: CardRenderer = { id: 'press', render: renderPress }
