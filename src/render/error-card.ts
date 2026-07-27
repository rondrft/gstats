/**
 * Failure card.
 *
 * The service never answers a card request with a non-200 status or with JSON.
 * A reader looking at a README sees an `<img>`: a 404 renders as the browser's
 * broken-image glyph, which tells them nothing and tells the profile owner even
 * less. A card that says "user not found" in the same typeface as the real thing
 * is diagnosable at a glance.
 *
 * The same reasoning applies to caching. Failures are short-lived — a typo is
 * not, but a rate limit and an upstream blip are — so an error card is served
 * with a one minute lifetime rather than the two hours a real card gets.
 */

import type { StatsErrorKind } from '../github/types'
import { interpolate, resolveLocale } from '../i18n'
import type { StyleParams } from '../params'
import { CARD_HEIGHT } from './card'
import { icon } from './icons'
import { ring } from './ring'
import { escapeXml } from './xml'

/**
 * Narrow: one ring and one line of text, with nothing to align to. The width is
 * set by the longest message any locale can produce — the rate limit line in
 * Spanish — so that no translation overflows the frame.
 */
const WIDTH = 400

/** How long a client may reuse an error card, in seconds. */
export const ERROR_CACHE_SECONDS = 60

const FRAME_INSET = 12
const FONT_STACK =
  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"

/**
 * Everything the card can report. `StatsErrorKind` covers upstream failures;
 * the other two are local misconfiguration, one by the caller and one by
 * whoever deployed the Worker.
 */
export type ErrorCardKind = StatsErrorKind | 'missing-username' | 'not-configured'

export interface ErrorCardOptions {
  kind: ErrorCardKind
  style: StyleParams
  /** Substituted into the rate limit message when known. */
  retryAfterMinutes?: number | null
}

export function renderErrorCard({ kind, style, retryAfterMinutes }: ErrorCardOptions): string {
  const strings = resolveLocale(style.locale)
  const messages: Record<ErrorCardKind, string> = {
    'not-found': strings.userNotFound,
    'missing-username': strings.missingUsername,
    'not-configured': strings.notConfigured,
    'rate-limited': interpolate(strings.rateLimited, { minutes: retryAfterMinutes ?? 60 }),
    upstream: strings.upstreamError,
  }
  const message = messages[kind]

  const cy = CARD_HEIGHT / 2
  const cx = 60
  // An empty ring: the shape is recognisable as this service's card, and a
  // hollow one reads as "nothing to show" without needing a separate icon set.
  const { markup } = ring({ cx, cy, pct: 0, color: style.accent, index: 0, animate: false })

  const frame =
    style.border === 'none' || style.border === 'transparent'
      ? ''
      : `<rect x="${FRAME_INSET}" y="${FRAME_INSET}" width="${WIDTH - FRAME_INSET * 2}" ` +
        `height="${CARD_HEIGHT - FRAME_INSET * 2}" rx="${Math.max(0, style.radius - 4)}" ` +
        `fill="none" stroke="${style.border}" stroke-width="0.5"/>`

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${CARD_HEIGHT}" ` +
    `viewBox="0 0 ${WIDTH} ${CARD_HEIGHT}" role="img" aria-label="${escapeXml(message)}" ` +
    `font-family="${FONT_STACK}">` +
    `<title>${escapeXml(message)}</title>` +
    `<rect width="${WIDTH}" height="${CARD_HEIGHT}" rx="${style.radius}" fill="${style.bg}"/>` +
    frame +
    markup +
    icon('flame', cx, cy, style.accent) +
    `<text x="${cx}" y="${cy + 7}" text-anchor="middle" font-size="20" ` +
    `fill="${style.accent}">!</text>` +
    `<text x="${cx + 45}" y="${cy + 4}" font-size="11" fill="${style.text}">` +
    `${escapeXml(message)}</text>` +
    `</svg>`
  )
}
