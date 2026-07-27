/**
 * Orchestration between the cache and GitHub.
 *
 * The interesting behaviour here is degradation. A README image has no way to
 * signal "try again later", so every path that can produce something is
 * preferred over every path that produces an error:
 *
 *   fresh cache -> upstream -> stale cache -> error card
 *
 * The stale step is what keeps a popular instance usable when the hourly quota
 * runs down, which is the failure mode that has killed most services of this
 * kind.
 */

import type { KvRateLimitStore } from './cache'
import { type CacheEntry, cacheKey, isFresh, KV_FRESH_SECONDS, type StatsCache } from './cache'
import type { GitHubClient } from './github/client'
import { compactCalendar, fetchContributions } from './github/contributions'
import { fetchLanguages } from './github/languages'
import type { LanguageStat, StatsData } from './github/types'
import type { CardParams } from './params'
import { computeStreaks, utcToday } from './streak'

/**
 * Remaining requests below which the service stops spending quota on cache
 * misses that it can answer from a stale entry. The headroom is deliberate:
 * requests in flight and other instances sharing the token can consume the
 * remainder before the next reading is written.
 */
const LOW_QUOTA_THRESHOLD = 100

export type CacheStatus = 'HIT' | 'MISS' | 'STALE'

export interface StatsResult {
  data: StatsData
  status: CacheStatus
}

export interface StatsDeps {
  client: GitHubClient
  cache: StatsCache
  rateLimits: KvRateLimitStore
  /** Epoch milliseconds. Injected so tests control time. */
  now: number
  /** Deployed build, mixed into the cache key so a release retires its entries. */
  build: string
}

export async function getStats(deps: StatsDeps, params: CardParams): Promise<StatsResult> {
  const key = cacheKey(params, deps.build)
  const cached = await deps.cache.read(key)

  if (cached !== null && isFresh(cached, deps.now)) {
    return { data: cached.data, status: 'HIT' }
  }

  if (cached !== null && (await runningLow(deps))) {
    return { data: cached.data, status: 'STALE' }
  }

  try {
    const data = await fetchAndStore(deps, params, key)
    return { data, status: 'MISS' }
  } catch (error) {
    // Record the reading even on failure — a 403 carries the headers that tell
    // the next request to stop trying.
    await deps.rateLimits.write(deps.client.rateLimit, deps.now)
    if (cached !== null) return { data: cached.data, status: 'STALE' }
    throw error
  }
}

/**
 * Fetches and replaces the entry regardless of whether one is already fresh.
 *
 * This is what the scheduled warmer runs. `getStats` would look at a fresh entry
 * and correctly decide not to fetch, which is the opposite of the point: the
 * warmer's whole job is to make the entry fresh again *before* a reader arrives.
 *
 * Throws on failure, and writes nothing when it does. That is the important
 * half — the previous entry stays exactly where it was, because a figure from
 * some hours ago is worth more to a reader than a miss they have to wait for.
 */
export async function refreshStats(deps: StatsDeps, params: CardParams): Promise<StatsData> {
  return fetchAndStore(deps, params, cacheKey(params, deps.build))
}

async function fetchAndStore(deps: StatsDeps, params: CardParams, key: string): Promise<StatsData> {
  const data = await fetchStats(deps, params)
  // Freshness is the cache's own policy, not the caller's: `cache_seconds`
  // says how long a *client* may reuse the card, which is a separate lever.
  const entry: CacheEntry = { data, freshUntil: deps.now + KV_FRESH_SECONDS * 1000 }
  await Promise.all([
    deps.cache.write(key, entry),
    deps.rateLimits.write(deps.client.rateLimit, deps.now),
  ])
  return data
}

/**
 * Whether the last observed quota was low enough to prefer a stale answer.
 *
 * A reading from before the window reset says nothing about the current window,
 * so it is ignored rather than trusted.
 */
async function runningLow(deps: StatsDeps): Promise<boolean> {
  const state = await deps.rateLimits.read()
  if (state === null || state.remaining === null) return false
  if (state.reset !== null && state.reset * 1000 <= deps.now) return false
  return state.remaining < LOW_QUOTA_THRESHOLD
}

async function fetchStats(deps: StatsDeps, params: CardParams): Promise<StatsData> {
  const today = utcToday(new Date(deps.now))
  const wantsLanguages = !params.hide.has('langs')

  // Both halves are independent; running them together roughly halves the
  // latency of a cache miss, which is the only latency a reader ever sees.
  const [contributions, languages] = await Promise.allSettled([
    fetchContributions(deps.client, params.username, {
      today,
      includeHistory: !params.hide.has('total'),
    }),
    wantsLanguages
      ? fetchLanguages(deps.client, params.username, {
          limit: params.langsCount,
          exclude: params.excludeLangs,
          include: params.includeLangs,
          mode: params.langMode,
          now: deps.now,
        })
      : Promise.resolve<LanguageStat[]>([]),
  ])

  if (contributions.status === 'rejected') throw contributions.reason

  return {
    login: contributions.value.login,
    name: contributions.value.name,
    createdAt: contributions.value.createdAt,
    totalContributions: contributions.value.total,
    yearContributions: contributions.value.year,
    bestYearContributions: contributions.value.bestYear,
    streaks: computeStreaks(contributions.value.calendar, today),
    calendar: compactCalendar(contributions.value.calendar, today),
    // A language query that fails degrades to an empty block rather than taking
    // the whole card down: the contribution half is already correct and
    // complete, and a partial card is more useful than an error.
    languages: languages.status === 'fulfilled' ? languages.value : [],
    fetchedAt: deps.now,
  }
}
