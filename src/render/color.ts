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
 * The track is a faint version of the arc: same hue, close enough to the
 * background to read as absence rather than as a second value. Deriving it
 * instead of theming it means a caller who passes `?ring=%23ff0088` gets a
 * coherent track for free.
 *
 * It is a step *from the background towards the colour*, not a dimming of the
 * colour. Those are the same thing on a dark theme and opposites on a light one,
 * which is a bug this shipped with: multiplying `#BC4C00` by 0.22 gives
 * `#291100`, a near-black on white with 18:1 contrast against the background.
 * Since the track always paints the full arc, that made a 33% streak ring read
 * as about 80% full — the track was the boldest thing in it. Mixing from the
 * background gives 1.4:1, in line with what the dark themes always had.
 *
 * Non-hex inputs (`none`, `transparent`, or anything that failed validation)
 * fall back to dimming the colour itself; there is nothing to interpolate
 * between. **Nothing in the card path reaches that branch any more.** Every
 * caller passes `StyleParams.surface`, which is a real colour even when the
 * plate is not painted — the same fallback, decided once for every derived tone
 * rather than separately here. It stays because a function that takes a colour
 * should not be the one place that assumes its caller resolved one.
 */
export function trackColor(color: string, background: string, factor = 0.22): string {
  if (KEYWORDS.has(color.toLowerCase())) return color
  if (KEYWORDS.has(background.toLowerCase())) {
    // No background to recede into — `bg=transparent` sits on whatever the page
    // is. Dimming the colour is the only option left, and it is at least
    // predictable.
    const rgb = parseHex(color)
    return rgb === null ? color : toHex({ r: rgb.r * factor, g: rgb.g * factor, b: rgb.b * factor })
  }
  return mix(background, color, factor)
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

/**
 * WCAG relative luminance, and the contrast ratio between two colours.
 *
 * Here because two separate decisions turn on a measured ratio rather than on
 * how a colour looks in one theme somebody happened to be testing: the ring
 * track has to stay *under* a ratio so it reads as absence, and the heatmap's
 * first active level has to stay *over* one so a single contribution is not
 * mistaken for an idle day. Both were got wrong by eye first.
 *
 * A colour that cannot be parsed — `none`, `transparent` — returns 1, which is
 * "no information" rather than a number to act on. Every caller treats it as a
 * ratio it cannot improve.
 */
export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a)
  const second = relativeLuminance(b)
  if (first === null || second === null) return 1

  const lighter = Math.max(first, second)
  const darker = Math.min(first, second)
  return (lighter + 0.05) / (darker + 0.05)
}

function relativeLuminance(color: string): number | null {
  const rgb = parseHex(color)
  if (rgb === null) return null

  const channel = (value: number) => {
    const scaled = value / 255
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
  }

  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
}

/** Normalises a validated colour to a form SVG accepts (`abc` -> `#abc`). */
export function normalizeColor(color: string): string {
  if (KEYWORDS.has(color.toLowerCase())) return color.toLowerCase()
  return color.startsWith('#') ? color : `#${color}`
}
