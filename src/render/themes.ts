/**
 * Colour presets.
 *
 * A theme supplies defaults for every colour knob the API exposes; individual
 * query parameters override whatever the theme provides. Ring tracks are not
 * part of a theme — they are derived from the ring colour at render time (see
 * `trackColor`) so that custom colours work without asking the caller for a
 * second value.
 */

export interface Theme {
  bg: string
  border: string
  text: string
  muted: string
  ring: string
  accent: string
  /** Colour of the number inside the accent (streak) ring. */
  accentText: string
}

/**
 * The default, and the fallback for anything unrecognised: green phosphor on a
 * near-black background, with amber reserved for the one value that changes day
 * to day.
 */
const PHOSPHOR: Theme = {
  bg: '#080D08',
  border: '#1D9E75',
  text: '#9FE1CB',
  muted: '#1D9E75',
  ring: '#5DCAA5',
  accent: '#EF9F27',
  accentText: '#FAC775',
}

export const THEMES: Record<string, Theme> = {
  phosphor: PHOSPHOR,
  amber: {
    bg: '#0F0A02',
    border: '#8A5A12',
    text: '#F2C879',
    muted: '#A8721E',
    ring: '#E0A33C',
    accent: '#FF6B35',
    accentText: '#FFA07A',
  },
  ice: {
    bg: '#050B14',
    border: '#1B4F72',
    text: '#BFE4F5',
    muted: '#3A7CA5',
    ring: '#4EC3E0',
    accent: '#C77DFF',
    accentText: '#E0B8FF',
  },
  mono: {
    bg: '#000000',
    border: '#666666',
    text: '#FFFFFF',
    muted: '#999999',
    ring: '#FFFFFF',
    accent: '#FFFFFF',
    accentText: '#FFFFFF',
  },
  light: {
    bg: '#FFFFFF',
    border: '#D0D7DE',
    text: '#1F2328',
    muted: '#656D76',
    ring: '#1F883D',
    accent: '#BC4C00',
    accentText: '#BC4C00',
  },
}

export const DEFAULT_THEME = 'phosphor'

export const THEME_NAMES = Object.keys(THEMES)

export function resolveTheme(name: string | undefined): Theme {
  if (name === undefined) return PHOSPHOR
  return THEMES[name.toLowerCase()] ?? PHOSPHOR
}
