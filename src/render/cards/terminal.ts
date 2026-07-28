/**
 * `terminal` — the original design, and the default.
 *
 * Three rings and a language column, in the palette of a phosphor CRT.
 *
 * This design is frozen. It is what every URL written before `?card=` existed
 * resolves to, so a change here rewrites cards in READMEs nobody is watching.
 * A different look ships as `terminal-v2`; see the contract in `registry.ts`.
 *
 * Everything about it is constrained by where it ends up. GitHub serves README
 * images through Camo as `<img>`, which means no scripts, no external fonts, no
 * remote images and no CSS from outside the document. What does survive is
 * inline CSS animation, so that is the only dynamic element the card uses — and
 * even then the resting state is written into the attributes, so a renderer that
 * ignores the animation still shows a correct card.
 *
 * The layout adapts to which modules are visible: hiding a ring closes the gap
 * rather than leaving a hole, and hiding the language block narrows the card
 * instead of padding it with empty space.
 */

import type { CardData } from '../../github/types'
import type { Strings } from '../../i18n'
import type { CardParams, StyleParams } from '../../params'
import { credit, frame, plate, round, svgDocument } from '../chrome'
import { type IconName, icon } from '../icons'
import { langsBlock, measureLangs } from '../langs'
import {
  type ColumnContent,
  LABEL_BASELINE,
  LABEL_FONT_SIZE,
  layoutCard,
  SUBTITLE_BASELINE,
  SUBTITLE_FONT_SIZE,
  VALUE_BASELINE,
} from '../layout'
import { ring, valueFontSize } from '../ring'
import { escapeXml } from '../xml'
import { describe, type StatModule, visibleStats } from './modules'
import type { CardRenderer, RenderOptions } from './registry'

/** Staggering the rings reads as one gesture rather than three simultaneous ones. */
const ANIMATION_STAGGER_SECONDS = 0.12
const ANIMATION_DURATION = '0.9s'
const ANIMATION_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'

/** The shared per-module figures, plus what only a ring needs. */
interface RingSpec extends StatModule {
  /** Fraction of the arc to paint, 0-1. */
  pct: number
  color: string
  valueColor: string
  icon: IconName
}

/**
 * Measures the card, then draws it.
 *
 * The two halves are kept apart on purpose. Nothing below decides where
 * anything goes — `layoutCard` owns every coordinate — so a change to a label,
 * a locale or the set of visible modules moves the whole composition together
 * instead of leaving one piece behind at a hard-coded offset.
 */
function renderTerminal(data: CardData, { params, strings }: RenderOptions): string {
  const { style } = params
  const specs = ringSpecs(data, params, strings)
  const showLangs = !params.hide.has('langs')

  const layout = layoutCard(
    specs.map(columnContent),
    showLangs ? measureLangs(data.languages, strings.noLanguages) : { lineCount: 0, width: 0 },
  )

  const drawn = specs.map((spec, index) => {
    const cx = layout.ringCentres[index] ?? 0
    return {
      spec,
      cx,
      ...ring({
        cx,
        cy: layout.cy,
        pct: spec.pct,
        color: spec.color,
        background: style.bg,
        index,
        animate: style.animate,
      }),
    }
  })

  const body =
    plate(layout.width, layout.height, style) +
    frame(layout.width, layout.height, style) +
    drawn.map(({ spec, cx, markup }) => markup + ringText(spec, cx, layout.cy, style)).join('') +
    (layout.langs === null
      ? ''
      : langsBlock({
          languages: data.languages,
          placement: layout.langs,
          text: style.text,
          muted: style.muted,
          fallbackColor: style.ring,
          style: style.langStyle,
          emptyLabel: strings.noLanguages,
        })) +
    credit(layout.width, layout.height, style)

  return svgDocument(
    {
      width: layout.width,
      height: layout.height,
      label: describe(data, specs),
      css: animationStyles(drawn.map(({ keyframes }) => keyframes)),
    },
    body,
  )
}

export const terminal: CardRenderer = { id: 'terminal', render: renderTerminal }

/** Reduces a ring to the strings the layout needs in order to measure it. */
function columnContent(spec: RingSpec): ColumnContent {
  return {
    value: spec.formatted,
    valueFontSize: valueFontSize(spec.formatted),
    label: spec.label,
    subtitle: spec.detail,
  }
}

/**
 * The visible modules, each given the geometry and colour a ring needs.
 *
 * The figures, the labels and the date ranges come from `visibleStats`, which
 * every design shares — that is what makes `hide` and `locale` behave the same
 * everywhere instead of once per design.
 */
function ringSpecs(data: CardData, params: CardParams, strings: Strings): RingSpec[] {
  const { current, longest } = data.streaks
  const { style } = params

  const ringOf: Record<string, Omit<RingSpec, keyof StatModule>> = {
    // No denominator exists for a lifetime total, so the ring is a frame rather
    // than a measurement and is always full. Inventing a maximum here — "1000
    // contributions is 100%" — would be decoration pretending to be data, and
    // the number in the middle already carries the information.
    total: { pct: 1, color: style.ring, valueColor: style.text, icon: 'chartBar' },
    // The only ring with an honest denominator: today's streak measured against
    // this account's own record. It reaches full exactly when the reader is
    // having their best run ever, which is the thing worth showing.
    streak: {
      pct: longest.length === 0 ? 0 : current.length / longest.length,
      color: style.accent,
      valueColor: style.accentText,
      icon: 'flame',
    },
    // The record is its own maximum.
    best: { pct: 1, color: style.ring, valueColor: style.text, icon: 'trophy' },
  }

  return visibleStats(data, params, strings).flatMap((stat) => {
    const ring = ringOf[stat.module]
    return ring === undefined ? [] : [{ ...stat, ...ring }]
  })
}

function ringText(spec: RingSpec, cx: number, cy: number, style: StyleParams): string {
  const value = spec.formatted
  const fontSize = valueFontSize(value)
  const x = round(cx)

  return (
    icon(spec.icon, cx, cy, spec.color) +
    `<text x="${x}" y="${round(cy + VALUE_BASELINE)}" text-anchor="middle" ` +
    `font-size="${fontSize}" fill="${spec.valueColor}">${escapeXml(value)}</text>` +
    `<text x="${x}" y="${round(cy + LABEL_BASELINE)}" text-anchor="middle" ` +
    `font-size="${LABEL_FONT_SIZE}" fill="${style.muted}">${escapeXml(spec.label)}</text>` +
    `<text x="${x}" y="${round(cy + SUBTITLE_BASELINE)}" text-anchor="middle" ` +
    `font-size="${SUBTITLE_FONT_SIZE}" fill="${style.muted}" opacity="0.7">` +
    `${escapeXml(spec.detail)}</text>`
  )
}

/**
 * Inline stylesheet driving the draw-on animation.
 *
 * `animation-fill-mode: both` matters more than it looks: with only `forwards`,
 * a staggered ring would render its resting attribute value during its delay and
 * then snap back to empty when the animation starts. `both` applies the opening
 * frame for the length of the delay instead.
 */
function animationStyles(keyframes: readonly string[]): string {
  const active = keyframes.filter((rule) => rule.length > 0)
  if (active.length === 0) return ''

  const rules = active
    .map((frames, index) => {
      const delay = index * ANIMATION_STAGGER_SECONDS
      return (
        frames +
        `.r${index}{animation:draw-${index} ${ANIMATION_DURATION} ${ANIMATION_EASING} ` +
        `${delay}s both}`
      )
    })
    .join('')

  return `${rules}@media (prefers-reduced-motion:reduce){.ring-progress{animation:none}}`
}
