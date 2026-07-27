/**
 * Text metrics.
 *
 * The card cannot measure anything: it is generated on a server with no font
 * stack, no layout engine and no way to ask how wide a string will be. What it
 * does have is the guarantee that every glyph it draws is monospaced, so the
 * advance width of a run is its length times a constant.
 *
 * The constants below are the conventional proportions of the monospace faces
 * in the card's font stack (SF Mono, Menlo, Consolas, Liberation Mono, and the
 * `ui-monospace` default on each platform). They agree to within a percent or
 * two, which is well inside the margins the layout leaves.
 *
 * These are approximations, and they are only ever used to decide how much room
 * to leave. Nothing is clipped to them, so being a fraction off costs a fraction
 * of a pixel of asymmetry rather than a truncated label.
 */

/** Advance width of one glyph, as a fraction of the font size. */
const ADVANCE_RATIO = 0.6

/** Baseline to the top of an ascender, as a fraction of the font size. */
const ASCENT_RATIO = 0.78

/** Baseline to the bottom of a descender, as a fraction of the font size. */
const DESCENT_RATIO = 0.27

/**
 * Width of a run of text.
 *
 * Counts UTF-16 code units, which is exact for everything the card draws:
 * labels are ASCII, and the bar glyph U+2588 is a single unit that monospace
 * faces render one cell wide.
 */
export function textWidth(text: string, fontSize: number): number {
  return text.length * fontSize * ADVANCE_RATIO
}

/** Half a run's width, which is what centred text needs. */
export function halfTextWidth(text: string, fontSize: number): number {
  return textWidth(text, fontSize) / 2
}

export function ascentOf(fontSize: number): number {
  return fontSize * ASCENT_RATIO
}

export function descentOf(fontSize: number): number {
  return fontSize * DESCENT_RATIO
}
