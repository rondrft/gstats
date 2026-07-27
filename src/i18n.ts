/**
 * Card copy.
 *
 * Strings are short by construction — the ring labels have to fit under a 54px
 * circle — so translations are inlined rather than loaded from a bundle. Adding
 * a locale is a matter of appending one entry here.
 */

export interface Strings {
  total: string
  streak: string
  best: string
  /** Subtitle under the total ring. `{year}` is the account's first year. */
  since: string
  /** Subtitle under a ring whose streak is zero. */
  noStreak: string
  /** Shown in place of the language block for accounts with nothing to measure. */
  noLanguages: string
  /** Shown when a username fails validation or does not resolve. */
  userNotFound: string
  /** Shown when the `username` parameter is absent altogether. */
  missingUsername: string
  /** `{minutes}` is substituted with the wait implied by GitHub's reset header. */
  rateLimited: string
  /**
   * Shown when this instance, not GitHub, is the one refusing. `{minutes}` is
   * the wait it will honour. Distinct copy from `rateLimited` on purpose: one
   * is a shared quota nobody can do anything about, the other is a limit on
   * the caller's own traffic and is the caller's to fix.
   */
  tooManyRequests: string
  upstreamError: string
  /** Shown to a self-hoster who has not set `GITHUB_TOKEN`. */
  notConfigured: string
}

/**
 * English is the fallback for every unknown locale, so it is bound to its own
 * constant rather than looked up. Everything else is optional.
 */
const EN: Strings = {
  total: 'contributions',
  streak: 'current streak',
  best: 'longest streak',
  since: 'since {year}',
  noStreak: 'no streak yet',
  noLanguages: 'no public repos',
  userNotFound: 'user not found',
  missingUsername: 'missing ?username=',
  rateLimited: 'rate limited, retry in {minutes}m',
  tooManyRequests: 'too many requests, wait {minutes}m',
  upstreamError: 'upstream error',
  notConfigured: 'GITHUB_TOKEN is not set',
}

const ES: Strings = {
  total: 'contribuciones',
  streak: 'racha actual',
  best: 'racha mas larga',
  since: 'desde {year}',
  noStreak: 'sin racha',
  noLanguages: 'sin repos publicos',
  userNotFound: 'usuario inexistente',
  missingUsername: 'falta ?username=',
  rateLimited: 'limite alcanzado, reintenta en {minutes}m',
  tooManyRequests: 'demasiadas peticiones, espera {minutes}m',
  upstreamError: 'error del servidor',
  notConfigured: 'GITHUB_TOKEN no esta configurado',
}

const LOCALES: Record<string, Strings> = { en: EN, es: ES }

export const DEFAULT_LOCALE = 'en'

export const LOCALE_NAMES = Object.keys(LOCALES)

export function resolveLocale(locale: string | undefined): Strings {
  if (locale === undefined) return EN
  return LOCALES[locale.toLowerCase()] ?? EN
}

/** Substitutes `{name}` placeholders. Unknown names are left in place. */
export function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = values[name]
    return value === undefined ? match : String(value)
  })
}

/**
 * Formats an integer with the locale's thousands separator.
 *
 * Falls back to the raw digits if the runtime does not carry data for the
 * requested locale, which is preferable to throwing inside a renderer.
 */
export function formatNumber(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(value)
  } catch {
    return String(value)
  }
}

/**
 * Renders a streak's extent as `Mar 3 - Jul 26`.
 *
 * Formatting is pinned to UTC to match how the streak itself is computed; a
 * range rendered in the reader's zone could disagree with the number above it by
 * a day. The year is appended only when the range ended in an earlier year, so
 * the common case stays short enough to sit under a ring.
 */
export function formatDayRange(
  start: string,
  end: string,
  locale: string,
  currentYear: number,
): string {
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', timeZone: 'UTC' }
  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat(locale, options)
  } catch {
    formatter = new Intl.DateTimeFormat(DEFAULT_LOCALE, options)
  }

  const render = (date: string) => formatter.format(new Date(`${date}T00:00:00Z`))
  const endYear = Number(end.slice(0, 4))
  const suffix = endYear === currentYear ? '' : `, ${endYear}`

  return start === end ? `${render(start)}${suffix}` : `${render(start)} - ${render(end)}${suffix}`
}
