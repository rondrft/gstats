/**
 * Shared card furniture.
 *
 * Every design draws the same three things before it draws anything of its own:
 * a background plate, an optional scanline texture and an inner frame. Keeping
 * them here is what makes `theme` mean the same thing across designs — a card
 * that reimplemented its own background would quietly stop honouring the
 * reader's colours, which the registry contract forbids.
 */

import type { StyleParams } from '../params'
import { SERVICE_NAME } from '../service'
import { FRAME_INSET } from './layout'
import { escapeXml } from './xml'

/**
 * System monospace. No design may load a font: GitHub serves README images
 * through Camo with external subresource loading disabled, so a webfont would
 * silently fall back to whatever the reader happens to have.
 */
export const MONO_STACK =
  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"

/** System serif, for the designs whose voice is editorial rather than terminal. */
export const SERIF_STACK =
  "ui-serif, Georgia, 'Iowan Old Style', 'Times New Roman', 'Liberation Serif', serif"

export const round = (n: number) => Math.round(n * 100) / 100

export interface DocumentOptions {
  width: number
  height: number
  /** Read aloud in place of the card, and shown as the image's tooltip. */
  label: string
  /** Contents of the inline stylesheet, or '' for none. */
  css?: string
  fontFamily?: string
}

/** Wraps a design's markup in a complete, standalone SVG document. */
export function svgDocument(
  { width, height, label, css, fontFamily }: DocumentOptions,
  body: string,
): string {
  const escaped = escapeXml(label)
  const style = css === undefined || css.length === 0 ? '' : `<style>${css}</style>`

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" role="img" aria-label="${escaped}" ` +
    `font-family="${fontFamily ?? MONO_STACK}">` +
    `<title>${escaped}</title>` +
    style +
    body +
    `</svg>`
  )
}

/**
 * Background plate, plus the scanline texture when the theme is wearing it.
 *
 * The pattern is a 4x4 tile carrying a 2px band, which at this scale reads as
 * CRT banding without turning into moire when a browser scales the card down.
 * The id is document-local; each card is its own `<img>` document, so two cards
 * on one page cannot collide.
 */
export function plate(width: number, height: number, style: StyleParams): string {
  const rect = `<rect width="${width}" height="${height}" rx="${style.radius}" fill="${style.bg}"/>`
  if (!style.scanlines) return rect

  return (
    `<defs><pattern id="scanlines" width="4" height="4" patternUnits="userSpaceOnUse">` +
    `<rect width="4" height="2" fill="${style.accent}" opacity="0.05"/></pattern></defs>` +
    rect +
    `<rect width="${width}" height="${height}" rx="${style.radius}" fill="url(#scanlines)"/>`
  )
}

/** Inner frame, or nothing when the caller switched the border off. */
export function frame(
  width: number,
  height: number,
  style: StyleParams,
  inset = FRAME_INSET,
): string {
  if (style.border === 'none' || style.border === 'transparent') return ''
  // Concentric with the outer corner: the inset shrinks the radius by the same
  // amount, so the two curves stay parallel instead of drifting apart.
  const radius = Math.max(0, style.radius - 4)
  return (
    `<rect x="${inset}" y="${inset}" width="${round(width - inset * 2)}" ` +
    `height="${round(height - inset * 2)}" rx="${radius}" fill="none" ` +
    `stroke="${style.border}" stroke-width="0.5"/>`
  )
}

/** Opt-in project credit, tucked below the frame in the bottom corner. */
export function credit(width: number, height: number, style: StyleParams): string {
  if (!style.showCredit) return ''
  return (
    `<text x="${round(width - FRAME_INSET / 2)}" y="${height - 3}" text-anchor="end" ` +
    `font-size="7" fill="${style.muted}" opacity="0.55">${SERVICE_NAME}</text>`
  )
}

/**
 * Wraps animation rules so a reader who asked for less motion gets the resting
 * state. Designs pair this with resting values written into the attributes, so
 * a renderer that ignores CSS entirely still shows a correct card.
 */
export function motion(rules: string, animate: boolean, selector: string): string {
  if (!animate || rules.length === 0) return ''
  return `${rules}@media (prefers-reduced-motion:reduce){${selector}{animation:none}}`
}

/** Convenience for a `<text>` node with the common attributes. */
export interface TextOptions {
  x: number
  y: number
  size: number
  fill: string
  anchor?: 'start' | 'middle' | 'end'
  weight?: number | string
  family?: string
  opacity?: number
  letterSpacing?: number
  preserveSpace?: boolean
}

export function text(content: string, options: TextOptions): string {
  const parts = [
    `x="${round(options.x)}"`,
    `y="${round(options.y)}"`,
    `font-size="${options.size}"`,
  ]
  if (options.anchor !== undefined) parts.push(`text-anchor="${options.anchor}"`)
  if (options.weight !== undefined) parts.push(`font-weight="${options.weight}"`)
  if (options.family !== undefined) parts.push(`font-family="${options.family}"`)
  if (options.letterSpacing !== undefined) parts.push(`letter-spacing="${options.letterSpacing}"`)
  if (options.opacity !== undefined) parts.push(`opacity="${options.opacity}"`)
  if (options.preserveSpace === true) parts.push('xml:space="preserve"')
  parts.push(`fill="${options.fill}"`)

  return `<text ${parts.join(' ')}>${escapeXml(content)}</text>`
}
