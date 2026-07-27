/**
 * Inlined icon paths.
 *
 * GitHub renders README images through Camo with scripting and external
 * subresource loading disabled, so an icon font or a remote sprite sheet would
 * silently render nothing. The three glyphs the card needs are embedded instead.
 *
 * Source: Tabler Icons (MIT). https://github.com/tabler/tabler-icons
 * Paths are taken verbatim from the 24x24 outline set.
 */

import { RADIUS } from './ring'

export type IconName = 'chartBar' | 'flame' | 'trophy'

const PATHS: Record<IconName, string> = {
  chartBar: 'M4 19h16M4 19V5M8 17v-6M12 17v-9M16 17v-4',
  flame:
    'M12 12c2 -2.96 0 -7 -1 -8c0 3.038 -1.773 4.741 -3 6c-1.226 1.26 -2 3.24 -2 5a6 6 0 1 0 12 0c0 -1.532 -1.056 -3.94 -2 -5c-1.786 3 -2.791 3 -4 2z',
  trophy: 'M8 21h8M12 17v4M7 4h10v8a5 5 0 0 1 -10 0zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1 -3 3',
}

/** Native viewBox of the Tabler outline set. */
const SOURCE_SIZE = 24

/**
 * Scale chosen so the glyph is comfortably narrower than the ring's gap: at
 * 0.7 the icon is 16.8 units wide against 35 units of unpainted arc.
 */
const SCALE = 0.7

/** Side of the glyph's box once scaled. The layout measures the card from here. */
export const ICON_SIZE = SOURCE_SIZE * SCALE

/**
 * Renders an icon centred on the ring's gap at twelve o'clock.
 *
 * The glyph is centred by translating it half its rendered size up and left of
 * the target point; the translation happens before the scale, so the offsets are
 * expressed in final user units.
 */
export function icon(name: IconName, cx: number, cy: number, color: string): string {
  const half = ICON_SIZE / 2
  const x = Math.round((cx - half) * 100) / 100
  const y = Math.round((cy - RADIUS - half) * 100) / 100
  return (
    `<g transform="translate(${x} ${y}) scale(${SCALE})" fill="none" stroke="${color}" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="${PATHS[name]}"/></g>`
  )
}
