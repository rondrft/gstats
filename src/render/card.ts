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
import { langsBlock } from './langs'
import { ring, valueFontSize } from './ring'
import { escapeXml } from './xml'

export const CARD_HEIGHT = 150

/** Distance from the card edge to the inner frame. */
const FRAME_INSET = 12

/** Horizontal space allotted to one ring, including its label. */
const RING_SLOT = 120

/** Left margin before the first ring's slot begins. */
const RINGS_PAD = 58

/** Gap between the last ring's slot and the language block. */
const LANGS_GAP = 22

/**
 * Width reserved for the language block. The widest possible line is 17
 * monospace cells at 11px, roughly 112 units, so 120 leaves the text clear of
 * the right margin at every language count.
 */
const LANGS_WIDTH = 120

const RIGHT_PAD = 40

/** Vertical offsets relative to the ring centre. */
const VALUE_BASELINE = 7
const LABEL_BASELINE = 47
const SUBTITLE_BASELINE = 58

const LABEL_FONT_SIZE = 11
const SUBTITLE_FONT_SIZE = 8

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

export function renderCard(data: StatsData, params: CardParams): string {
  const { style } = params
  const strings = resolveLocale(style.locale)
  const specs = ringSpecs(data, params, strings)
  const showLangs = !params.hide.has('langs')

  const ringsWidth = specs.length > 0 ? RINGS_PAD + specs.length * RING_SLOT : 0
  const width = Math.max(
    RINGS_PAD * 2,
    ringsWidth + (showLangs ? LANGS_GAP + LANGS_WIDTH + RIGHT_PAD : RINGS_PAD),
  )
  const centerY = CARD_HEIGHT / 2

  const drawn = specs.map((spec, index) => {
    const cx = RINGS_PAD + index * RING_SLOT + RING_SLOT / 2
    return {
      spec,
      cx,
      ...ring({ cx, cy: centerY, pct: spec.pct, color: spec.color, index, animate: style.animate }),
    }
  })

  const body =
    background(width, style) +
    frame(width, style) +
    drawn.map(({ spec, cx, markup }) => markup + ringText(spec, cx, centerY, style)).join('') +
    (showLangs
      ? langsBlock({
          languages: data.languages,
          x: ringsWidth + LANGS_GAP,
          cy: centerY,
          text: style.text,
          muted: style.muted,
          fallbackColor: style.ring,
          style: style.langStyle,
          emptyLabel: strings.noLanguages,
        })
      : '') +
    (style.showCredit ? credit(width, style) : '')

  const styleBlock = animationStyles(drawn.map(({ keyframes }) => keyframes))

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${CARD_HEIGHT}" ` +
    `viewBox="0 0 ${width} ${CARD_HEIGHT}" role="img" ` +
    `aria-label="${escapeXml(ariaLabel(data, specs, style.locale))}" ` +
    `font-family="${FONT_STACK}">` +
    `<title>${escapeXml(ariaLabel(data, specs, style.locale))}</title>` +
    styleBlock +
    body +
    `</svg>`
  )
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

  return (
    icon(spec.icon, cx, cy, spec.color) +
    `<text x="${cx}" y="${cy + VALUE_BASELINE}" text-anchor="middle" font-size="${fontSize}" ` +
    `fill="${spec.valueColor}">${escapeXml(value)}</text>` +
    `<text x="${cx}" y="${cy + LABEL_BASELINE}" text-anchor="middle" ` +
    `font-size="${LABEL_FONT_SIZE}" fill="${style.muted}">${escapeXml(spec.label)}</text>` +
    `<text x="${cx}" y="${cy + SUBTITLE_BASELINE}" text-anchor="middle" ` +
    `font-size="${SUBTITLE_FONT_SIZE}" fill="${style.muted}" opacity="0.7">` +
    `${escapeXml(spec.subtitle)}</text>`
  )
}

/**
 * Background plate plus the scanline texture.
 *
 * The pattern is a 4x4 tile carrying a 2px band, which at this scale reads as
 * the horizontal banding of a CRT without turning into moire when the browser
 * scales the card down. The id is document-local; each card is its own `<img>`
 * document, so two cards in one README cannot collide.
 */
function background(width: number, style: StyleParams): string {
  const plate = `<rect width="${width}" height="${CARD_HEIGHT}" rx="${style.radius}" fill="${style.bg}"/>`
  if (!style.scanlines) return plate

  return (
    `<defs><pattern id="scanlines" width="4" height="4" patternUnits="userSpaceOnUse">` +
    `<rect width="4" height="2" fill="${style.accent}" opacity="0.05"/></pattern></defs>` +
    plate +
    `<rect width="${width}" height="${CARD_HEIGHT}" rx="${style.radius}" fill="url(#scanlines)"/>`
  )
}

function frame(width: number, style: StyleParams): string {
  if (style.border === 'none' || style.border === 'transparent') return ''
  // Concentric with the outer corner: the inset shrinks the radius by the same
  // amount, so the two curves stay parallel instead of drifting apart.
  const radius = Math.max(0, style.radius - 4)
  return (
    `<rect x="${FRAME_INSET}" y="${FRAME_INSET}" width="${width - FRAME_INSET * 2}" ` +
    `height="${CARD_HEIGHT - FRAME_INSET * 2}" rx="${radius}" fill="none" ` +
    `stroke="${style.border}" stroke-width="0.5"/>`
  )
}

function credit(width: number, style: StyleParams): string {
  return (
    `<text x="${width - FRAME_INSET / 2}" y="${CARD_HEIGHT - 3}" text-anchor="end" ` +
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
