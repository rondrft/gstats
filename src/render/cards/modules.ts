/**
 * The three numbers, resolved once for every design.
 *
 * `hide` and `locale` are contract obligations that every design owes the
 * reader, and six independent implementations of "filter the modules, translate
 * the labels, format the digits" is six chances to forget one. A design asks for
 * the visible modules and gets them already filtered, translated and formatted.
 */

import type { CardData } from '../../github/types'
import { formatDayRange, formatNumber, interpolate, type Strings } from '../../i18n'
import type { CardParams, ModuleName } from '../../params'
import { abbreviate } from '../langs'

export interface StatModule {
  module: ModuleName
  /** Raw value, for designs that need to compute an angle or a share. */
  value: number
  /** Locale-formatted value, which is what gets drawn. */
  formatted: string
  label: string
  /** Date range or account age, depending on the module. */
  detail: string
}

export function visibleStats(data: CardData, params: CardParams, strings: Strings): StatModule[] {
  const { current, longest } = data.streaks
  const { locale } = params.style
  const thisYear = new Date(data.fetchedAt).getUTCFullYear()

  const range = (start: string | null, end: string | null) =>
    start === null || end === null ? strings.noStreak : formatDayRange(start, end, locale, thisYear)

  const all: StatModule[] = [
    {
      module: 'total',
      value: data.totalContributions,
      formatted: formatNumber(data.totalContributions, locale),
      label: strings.total,
      detail: interpolate(strings.since, { year: Number(data.createdAt.slice(0, 4)) }),
    },
    {
      module: 'streak',
      value: current.length,
      formatted: formatNumber(current.length, locale),
      label: strings.streak,
      detail: range(current.start, current.end),
    },
    {
      module: 'best',
      value: longest.length,
      formatted: formatNumber(longest.length, locale),
      label: strings.best,
      detail: range(longest.start, longest.end),
    },
  ]

  return all.filter((stat) => !params.hide.has(stat.module))
}

/** Whether the language block was asked for. Its emptiness is a separate matter. */
export function wantsLanguages(params: CardParams): boolean {
  return !params.hide.has('langs')
}

/**
 * Text alternative for the whole card.
 *
 * A card is a wall of shapes; this is the only place a profile is described in
 * words, and it is what a screen reader and the image tooltip both read.
 */
export function describe(data: CardData, stats: readonly StatModule[]): string {
  const who = data.name === null ? data.login : `${data.name} (${data.login})`
  const parts = stats.map((stat) => `${stat.formatted} ${stat.label}`)
  return parts.length === 0 ? who : `${who}: ${parts.join(', ')}`
}

/** `ts 41%` style summary, for designs that show languages on one line. */
export function languageSummary(data: CardData, separator = '  '): string {
  return data.languages
    .map((language) => `${abbreviate(language.name)} ${Math.round(language.pct * 100)}%`)
    .join(separator)
}
