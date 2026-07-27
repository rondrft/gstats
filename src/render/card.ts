/**
 * Card composition.
 *
 * Everything here is constrained by where the card ends up. GitHub serves README
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

import type { StatsData } from '../github/types'
import { formatDayRange, formatNumber, interpolate, resolveLocale, type Strings } from '../i18n'
import type { CardParams, ModuleName, StyleParams } from '../params'
import { type IconName, icon } from './icons'
import { langsBlock, measureLangs } from './langs'
import {
  CARD_HEIGHT,
  type CardLayout,
  type ColumnContent,
  FRAME_INSET,
  LABEL_BASELINE,
  LABEL_FONT_SIZE,
  layoutCard,
  SUBTITLE_BASELINE,
  SUBTITLE_FONT_SIZE,
  VALUE_BASELINE,
} from './layout'
import { ring, valueFontSize } from './ring'
import { escapeXml } from './xml'

export { CARD_HEIGHT }

const FONT_STACK =
  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"

/** Staggering the rings reads as one gesture rather than three simultaneous ones. */
const ANIMATION_STAGGER_SECONDS = 0.12
const ANIMATION_DURATION = '0.9s'
const ANIMATION_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'

interface RingSpec {
  module: ModuleName
  value: number
  label: string
  subtitle: string
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
export function renderCard(data: StatsData, params: CardParams): string {
  const { style } = params
  const strings = resolveLocale(style.locale)
  const specs = ringSpecs(data, params, strings)
  const showLangs = !params.hide.has('langs')

  const layout = layoutCard(
    specs.map((spec) => columnContent(spec, style.locale)),
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
        index,
        animate: style.animate,
      }),
    }
  })

  const body =
    background(layout, style) +
    frame(layout, style) +
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
    (style.showCredit ? credit(layout, style) : '')

  const styleBlock = animationStyles(drawn.map(({ keyframes }) => keyframes))
  const label = escapeXml(ariaLabel(data, specs, style.locale))

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" ` +
    `viewBox="0 0 ${layout.width} ${layout.height}" role="img" ` +
    `aria-label="${label}" font-family="${FONT_STACK}">` +
    `<title>${label}</title>` +
    styleBlock +
    body +
    `</svg>`
  )
}

/** Reduces a ring to the strings the layout needs in order to measure it. */
function columnContent(spec: RingSpec, locale: string): ColumnContent {
  const value = formatNumber(spec.value, locale)
  return {
    value,
    valueFontSize: valueFontSize(value),
    label: spec.label,
    subtitle: spec.subtitle,
  }
}

function ringSpecs(data: StatsData, params: CardParams, strings: Strings): RingSpec[] {
  const { current, longest } = data.streaks
  const firstYear = Number(data.createdAt.slice(0, 4))
  const thisYear = new Date(data.fetchedAt).getUTCFullYear()

  const range = (start: string | null, end: string | null) =>
    start === null || end === null
      ? strings.noStreak
      : formatDayRange(start, end, params.style.locale, thisYear)

  const all: RingSpec[] = [
    {
      module: 'total',
      value: data.totalContributions,
      label: strings.total,
      subtitle: interpolate(strings.since, { year: firstYear }),
      // No denominator exists for a lifetime total, so the ring is a frame
      // rather than a measurement and is always full. Inventing a maximum here
      // — "1000 contributions is 100%" — would be decoration pretending to be
      // data, and the number in the middle already carries the information.
      pct: 1,
      color: params.style.ring,
      valueColor: params.style.text,
      icon: 'chartBar',
    },
    {
      module: 'streak',
      value: current.length,
      label: strings.streak,
      subtitle: range(current.start, current.end),
      // The only ring with an honest denominator: today's streak measured
      // against this account's own record. It reaches full exactly when the
      // reader is having their best run ever, which is the thing worth showing.
      pct: longest.length === 0 ? 0 : current.length / longest.length,
      color: params.style.accent,
      valueColor: params.style.accentText,
      icon: 'flame',
    },
    {
      module: 'best',
      value: longest.length,
      label: strings.best,
      subtitle: range(longest.start, longest.end),
      // The record is its own maximum.
      pct: 1,
      color: params.style.ring,
      valueColor: params.style.text,
      icon: 'trophy',
    },
  ]

  return all.filter((spec) => !params.hide.has(spec.module))
}

function ringText(spec: RingSpec, cx: number, cy: number, style: StyleParams): string {
  const value = formatNumber(spec.value, style.locale)
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
    `${escapeXml(spec.subtitle)}</text>`
  )
}

/** Coordinates come out of the layout as reals; two decimals is plenty. */
const round = (n: number) => Math.round(n * 100) / 100

/**
 * Background plate plus the scanline texture.
 *
 * The pattern is a 4x4 tile carrying a 2px band, which at this scale reads as
 * the horizontal banding of a CRT without turning into moire when the browser
 * scales the card down. The id is document-local; each card is its own `<img>`
 * document, so two cards in one README cannot collide.
 */
function background({ width, height }: CardLayout, style: StyleParams): string {
  const plate = `<rect width="${width}" height="${height}" rx="${style.radius}" fill="${style.bg}"/>`
  if (!style.scanlines) return plate

  return (
    `<defs><pattern id="scanlines" width="4" height="4" patternUnits="userSpaceOnUse">` +
    `<rect width="4" height="2" fill="${style.accent}" opacity="0.05"/></pattern></defs>` +
    plate +
    `<rect width="${width}" height="${height}" rx="${style.radius}" fill="url(#scanlines)"/>`
  )
}

function frame({ width, height }: CardLayout, style: StyleParams): string {
  if (style.border === 'none' || style.border === 'transparent') return ''
  // Concentric with the outer corner: the inset shrinks the radius by the same
  // amount, so the two curves stay parallel instead of drifting apart.
  const radius = Math.max(0, style.radius - 4)
  return (
    `<rect x="${FRAME_INSET}" y="${FRAME_INSET}" width="${width - FRAME_INSET * 2}" ` +
    `height="${height - FRAME_INSET * 2}" rx="${radius}" fill="none" ` +
    `stroke="${style.border}" stroke-width="0.5"/>`
  )
}

function credit({ width, height }: CardLayout, style: StyleParams): string {
  return (
    `<text x="${width - FRAME_INSET / 2}" y="${height - 3}" text-anchor="end" ` +
    `font-size="7" fill="${style.muted}" opacity="0.55">phosphor-stats</text>`
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
  const active = keyframes.filter((frame) => frame.length > 0)
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

  return (
    `<style>${rules}` +
    `@media (prefers-reduced-motion:reduce){.ring-progress{animation:none}}</style>`
  )
}

/**
 * Text alternative for screen readers and for the `<img>` title.
 *
 * The card is otherwise a wall of shapes; this is the only place the profile is
 * described in words.
 */
function ariaLabel(data: StatsData, specs: readonly RingSpec[], locale: string): string {
  const who = data.name === null ? data.login : `${data.name} (${data.login})`
  const parts = specs.map((spec) => `${formatNumber(spec.value, locale)} ${spec.label}`)
  return parts.length === 0 ? who : `${who}: ${parts.join(', ')}`
}
