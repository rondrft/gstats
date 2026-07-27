/**
 * Query-string parsing.
 *
 * Two rules govern this module:
 *
 *   - Nothing reaches the renderer or the network without passing a whitelist.
 *     Colours in particular are interpolated straight into SVG attributes, so an
 *     unvalidated value would be an injection vector.
 *   - A malformed parameter is never fatal. Callers embed the card in a README
 *     with an `<img>` tag and cannot see an error body, so anything that fails
 *     validation silently falls back to its default. The one exception is
 *     `username`, which has no sensible default.
 */

import { DEFAULT_LOCALE, LOCALE_NAMES } from './i18n'
import type { LangMode } from './languages'
import { CARD_IDS, DEFAULT_CARD } from './render/cards/registry'
import { normalizeColor } from './render/color'
import { DEFAULT_THEME, resolveTheme, THEME_NAMES, type Theme } from './render/themes'

/**
 * GitHub logins: alphanumeric, single internal hyphens, 1-39 characters.
 * Applied before any fetch so that hostile input never reaches the API.
 */
export const USERNAME_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/

/**
 * Hex colours in their four legal lengths, with or without a leading `#`.
 * Deliberately stricter than "3 to 8 hex digits": 5- and 7-digit values are not
 * colours and would render as black.
 */
const COLOR_PATTERN = /^#?(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

const COLOR_KEYWORDS = new Set(['none', 'transparent'])

export const MODULES = ['total', 'streak', 'best', 'langs'] as const
export type ModuleName = (typeof MODULES)[number]

export const LANG_STYLES = ['blocks', 'bars'] as const
export type LangStyle = (typeof LANG_STYLES)[number]

export const LANG_MODES = ['bytes', 'repos'] as const

export const DEFAULTS = {
  radius: 6,
  langsCount: 4,
  cacheSeconds: 7200,
  scanlines: true,
  animate: true,
  showCredit: false,
  langStyle: 'blocks' as LangStyle,
  langMode: 'bytes' as LangMode,
  card: DEFAULT_CARD,
} as const

export const LIMITS = {
  radius: { min: 0, max: 24 },
  langsCount: { min: 1, max: 8 },
  /**
   * The floor keeps a popular card from burning the shared hourly quota; the
   * ceiling keeps a card from looking abandoned.
   */
  cacheSeconds: { min: 1800, max: 86400 },
} as const

/** Inputs that change which bytes we ask GitHub for, or how they are ranked. */
export interface DataParams {
  username: string
  langsCount: number
  excludeLangs: string[]
  /** Languages to re-admit from the default exclusion list. */
  includeLangs: string[]
  langMode: LangMode
  hide: Set<ModuleName>
}

/** Inputs that only change how the fetched data is painted. */
export interface StyleParams {
  /** Which design renders the card. Unknown values resolve to the default. */
  card: string
  themeName: string
  bg: string
  border: string
  text: string
  muted: string
  ring: string
  accent: string
  accentText: string
  radius: number
  scanlines: boolean
  animate: boolean
  showCredit: boolean
  langStyle: LangStyle
  locale: string
}

export interface CardParams extends DataParams {
  style: StyleParams
  cacheSeconds: number
}

export type ParseResult =
  | { ok: true; params: CardParams }
  | { ok: false; reason: 'missing-username' | 'invalid-username'; style: StyleParams }

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null) return fallback
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function parseBool(raw: string | null, fallback: boolean): boolean {
  if (raw === null) return fallback
  const value = raw.trim().toLowerCase()
  if (value === 'true' || value === '1' || value === 'yes' || value === '') return true
  if (value === 'false' || value === '0' || value === 'no') return false
  return fallback
}

/**
 * Returns a colour safe to interpolate into an SVG attribute, or the fallback.
 * `none` and `transparent` are passed through because they are the only way to
 * ask for an unpainted background or a hidden frame.
 */
function parseColor(raw: string | null, fallback: string): string {
  if (raw === null) return fallback
  const value = raw.trim()
  if (COLOR_KEYWORDS.has(value.toLowerCase())) return value.toLowerCase()
  if (!COLOR_PATTERN.test(value)) return fallback
  return normalizeColor(value)
}

function parseCsv(raw: string | null): string[] {
  if (raw === null) return []
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

/** Case-insensitive membership test against a closed set, with a fallback. */
function oneOf<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  const value = raw?.trim().toLowerCase()
  return (allowed as readonly string[]).includes(value ?? '') ? (value as T) : fallback
}

function parseHidden(raw: string | null): Set<ModuleName> {
  const known = new Set<string>(MODULES)
  const hidden = parseCsv(raw)
    .map((entry) => entry.toLowerCase())
    .filter((entry): entry is ModuleName => known.has(entry))
  return new Set(hidden)
}

function parseStyle(query: URLSearchParams): StyleParams {
  const themeName = query.get('theme')?.toLowerCase() ?? DEFAULT_THEME
  const theme: Theme = resolveTheme(themeName)
  const ring = parseColor(query.get('ring'), theme.ring)
  const accent = parseColor(query.get('accent'), theme.accent)
  const locale = query.get('locale')?.toLowerCase() ?? DEFAULT_LOCALE
  const langStyle = query.get('lang_style')?.toLowerCase()

  return {
    card: oneOf(query.get('card'), CARD_IDS, DEFAULT_CARD),
    themeName: THEME_NAMES.includes(themeName) ? themeName : DEFAULT_THEME,
    bg: parseColor(query.get('bg'), theme.bg),
    border: parseColor(query.get('border'), theme.border),
    text: parseColor(query.get('text'), theme.text),
    muted: parseColor(query.get('muted'), theme.muted),
    ring,
    accent,
    // The streak number tracks the accent unless the caller overrode the accent,
    // in which case the theme's paired text colour would clash.
    accentText: query.get('accent') === null ? theme.accentText : accent,
    radius: clampInt(query.get('radius'), DEFAULTS.radius, LIMITS.radius.min, LIMITS.radius.max),
    scanlines: parseBool(query.get('scanlines'), DEFAULTS.scanlines),
    animate: parseBool(query.get('animate'), DEFAULTS.animate),
    showCredit: parseBool(query.get('show_credit'), DEFAULTS.showCredit),
    langStyle: (LANG_STYLES as readonly string[]).includes(langStyle ?? '')
      ? (langStyle as LangStyle)
      : DEFAULTS.langStyle,
    locale: LOCALE_NAMES.includes(locale) ? locale : DEFAULT_LOCALE,
  }
}

export function parseParams(query: URLSearchParams): ParseResult {
  const style = parseStyle(query)
  const username = query.get('username')?.trim() ?? ''

  if (username.length === 0) return { ok: false, reason: 'missing-username', style }
  if (!USERNAME_PATTERN.test(username)) return { ok: false, reason: 'invalid-username', style }

  return {
    ok: true,
    params: {
      username,
      langsCount: clampInt(
        query.get('langs_count'),
        DEFAULTS.langsCount,
        LIMITS.langsCount.min,
        LIMITS.langsCount.max,
      ),
      excludeLangs: parseCsv(query.get('exclude_langs')).map((lang) => lang.toLowerCase()),
      includeLangs: parseCsv(query.get('include_langs')).map((lang) => lang.toLowerCase()),
      langMode: oneOf(query.get('lang_mode'), LANG_MODES, DEFAULTS.langMode),
      hide: parseHidden(query.get('hide')),
      style,
      cacheSeconds: clampInt(
        query.get('cache_seconds'),
        DEFAULTS.cacheSeconds,
        LIMITS.cacheSeconds.min,
        LIMITS.cacheSeconds.max,
      ),
    },
  }
}
