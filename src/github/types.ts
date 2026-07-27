/**
 * Shapes shared between the GitHub layer, the cache and the renderer.
 *
 * `StatsData` is the unit of caching: it is everything the card needs and
 * nothing about how the card looks, so a request that only changes the theme
 * reuses the entry a previous request paid for.
 */

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

export interface StatsData {
  login: string
  /** Display name, absent on accounts that never set one. */
  name: string | null
  /** Account creation date, `YYYY-MM-DD` UTC. */
  createdAt: string
  totalContributions: number
  streaks: Streaks
  languages: LanguageStat[]
  /** Epoch milliseconds, so a cached entry can report its own age. */
  fetchedAt: number
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
