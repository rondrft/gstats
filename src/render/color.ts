/**
 * Colour helpers.
 *
 * Only two operations are needed: parsing the hex forms the API accepts, and
 * dimming a colour to produce a ring track. Everything else the SVG needs is a
 * literal from the theme or from the GitHub API.
 */

/** Non-colour fills that must be passed through to SVG untouched. */
const KEYWORDS = new Set(['none', 'transparent'])

interface Rgb {
  r: number
  g: number
  b: number
}

/**
 * Expands `#abc` / `#abcd` / `#aabbcc` / `#aabbccdd` into channel values.
 * Alpha, when present, is dropped: tracks are drawn as flat colours and the
 * card composites nothing beneath them.
 */
function parseHex(color: string): Rgb | null {
  const hex = color.startsWith('#') ? color.slice(1) : color
  const expanded =
    hex.length === 3 || hex.length === 4
      ? hex
          .slice(0, 3)
          .split('')
          .map((c) => c + c)
          .join('')
      : hex.length === 6 || hex.length === 8
        ? hex.slice(0, 6)
        : null

  if (expanded === null || !/^[0-9a-fA-F]{6}$/.test(expanded)) return null

  const value = Number.parseInt(expanded, 16)
  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  }
}

function toHex({ r, g, b }: Rgb): string {
  const channel = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

/**
 * Derives the unfilled portion of a ring from its progress colour.
 *
 * The track has to stay visible against the card background without competing
 * with the progress arc, so the hue is preserved and the brightness is cut to a
 * fraction of the original. Deriving instead of theming means a caller who
 * passes `?ring=%23ff0088` gets a coherent track for free.
 *
 * Non-hex inputs (`none`, `transparent`, or anything that failed validation)
 * are returned unchanged — there is nothing sensible to dim.
 */
export function trackColor(color: string, factor = 0.22): string {
  if (KEYWORDS.has(color.toLowerCase())) return color
  const rgb = parseHex(color)
  if (rgb === null) return color
  return toHex({ r: rgb.r * factor, g: rgb.g * factor, b: rgb.b * factor })
}

/**
 * Blends `from` towards `to`, with `t` running 0 to 1.
 *
 * Designs use this to build ramps and raised panels out of the theme's own
 * colours instead of hard-coding a palette. A design that names its own colours
 * stops honouring `theme`, which the registry contract forbids; deriving them
 * keeps every design correct in every theme, including ones added later.
 *
 * Non-hex inputs are returned unchanged — there is nothing to interpolate
 * between `transparent` and a colour.
 */
export function mix(from: string, to: string, t: number): string {
  if (KEYWORDS.has(from.toLowerCase()) || KEYWORDS.has(to.toLowerCase())) return from
  const a = parseHex(from)
  const b = parseHex(to)
  if (a === null || b === null) return from

  const amount = Math.max(0, Math.min(1, t))
  return toHex({
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
  })
}

/** Normalises a validated colour to a form SVG accepts (`abc` -> `#abc`). */
export function normalizeColor(color: string): string {
  if (KEYWORDS.has(color.toLowerCase())) return color.toLowerCase()
  return color.startsWith('#') ? color : `#${color}`
}
