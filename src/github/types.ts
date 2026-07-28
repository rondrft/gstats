/**
 * Shapes shared between the GitHub layer, the cache and the renderer.
 *
 * `StatsData` is the unit of caching: it is everything the card needs and
 * nothing about how the card looks, so a request that only changes the theme
 * reuses the entry a previous request paid for.
 */

import type { RepoSample } from '../languages'
import type { Streaks } from '../streak'

export interface LanguageStat {
  name: string
  /** Linguist colour reported by GitHub, or `null` when it has none. */
  color: string | null
  /** Bytes attributed to this language across the scanned repositories. */
  size: number
  /** Share of the scanned bytes, 0-1. */
  pct: number
}

/**
 * The trailing year of daily counts, stored positionally rather than as dated
 * records. A year of `{date, count}` objects is roughly fifteen times the JSON,
 * and every byte of it sits in the cache entry of every profile whether or not
 * the reader asked for a design that draws it.
 */
export interface CompactCalendar {
  /** Day of `counts[0]`, `YYYY-MM-DD` UTC. */
  from: string
  /** One entry per consecutive day starting at `from`. */
  counts: number[]
}

export interface StatsData {
  login: string
  /** Display name, absent on accounts that never set one. */
  name: string | null
  /** Account creation date, `YYYY-MM-DD` UTC. */
  createdAt: string
  totalContributions: number
  /** Contributions in the current calendar year so far. */
  yearContributions: number
  /**
   * The account's best calendar year. Gives the current year a denominator that
   * belongs to this reader rather than to an invented scale.
   */
  bestYearContributions: number
  streaks: Streaks
  calendar: CompactCalendar
  /**
   * The repositories, not a finished ranking.
   *
   * Ranking is applied when the card is drawn, which is what keeps `lang_mode`,
   * `langs_count`, `exclude_langs` and `include_langs` out of the cache key —
   * they change how the same bytes are read, never which bytes are fetched, so
   * a reader who wants six languages reuses the entry a reader who wanted four
   * already paid for. `RepoSample` is why that costs kilobytes and not tens of
   * them.
   */
  repos: RepoSample
  /** Epoch milliseconds, so a cached entry can report its own age. */
  fetchedAt: number
}

/**
 * What a design is handed: the stored figures plus the language ranking derived
 * for *this* request's parameters. `renderCard` is the only thing that builds
 * one, so no design has to know the ranking was not simply stored.
 */
export interface CardData extends StatsData {
  languages: LanguageStat[]
}

/** Snapshot of GitHub's rate limit headers from the most recent call. */
export interface RateLimitState {
  remaining: number | null
  limit: number | null
  /** Epoch seconds at which the window resets. */
  reset: number | null
}

export type StatsErrorKind = 'not-found' | 'rate-limited' | 'upstream'

/**
 * Failures are values rather than exceptions: every one of them has to end up
 * as a rendered card, and modelling them explicitly keeps that path total.
 */
export class StatsError extends Error {
  constructor(
    readonly kind: StatsErrorKind,
    message: string,
    /** Minutes until the rate limit window resets, when known. */
    readonly retryAfterMinutes: number | null = null,
  ) {
    super(message)
    this.name = 'StatsError'
  }
}
