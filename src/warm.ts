/**
 * Scheduled cache warming.
 *
 * `POST /purge` is the manual lever: something changed, drop the entry, let the
 * next reader pay for the fetch. This is the standing version of the same idea
 * for a handful of profiles the instance owner cares about — refresh them on a
 * timer so that nobody ever meets a miss, and so the figures are never more
 * than one interval old at the origin.
 *
 * It refreshes rather than purges. Purging on a timer would guarantee the
 * opposite of what is wanted: every interval, the first reader of each warmed
 * profile would be the one waiting on GitHub.
 *
 * This is a convenience for whoever runs the instance, not a subscription
 * service. It is capped, off by default, and every part of it is arranged to
 * spend the shared quota gently.
 */

import type { StatsCache } from './cache'
import type { GitHubClient } from './github/client'
import { parseParams } from './params'
import type { StatsDeps } from './stats'
import { refreshStats } from './stats'

/**
 * Most profiles this will warm.
 *
 * The cap is what keeps it a convenience rather than something people are
 * tempted to run a service on. It also keeps the daily KV write count in a
 * range the free plan can absorb — see docs/purging.md for the arithmetic.
 */
export const MAX_WARM_USERS = 10

/**
 * Pause between one refresh and the next.
 *
 * Serial with a gap, not parallel. Ten profiles firing at once is a spike
 * against a quota shared with every reader of the instance, which is the exact
 * shape of traffic the rest of the design avoids. Spreading them out costs
 * nothing but wall clock, and a scheduled handler has plenty of that.
 */
const PAUSE_MS = 1_000

/** Key holding the outcome of the last run, for `/health`. */
const LAST_RUN_KEY = 'warm:last-run'

/** Kept for two days, so a stopped cron is visible as a stale timestamp. */
const LAST_RUN_TTL = 172_800

export interface WarmFailure {
  username: string
  error: string
}

export interface WarmRun {
  /** Epoch milliseconds the run started. */
  ranAt: number
  durationMs: number
  refreshed: string[]
  failed: WarmFailure[]
  /** Logins in `WARM_USERS` that are not valid GitHub logins. */
  skipped: string[]
}

/**
 * Parses `WARM_USERS`.
 *
 * Anything that is not a GitHub login is reported rather than silently dropped:
 * a typo in an environment variable is otherwise invisible, and the symptom —
 * one profile quietly never warming — is not one anybody would connect back to
 * a stray comma.
 */
export function parseWarmUsers(raw: string | undefined): { users: string[]; skipped: string[] } {
  const entries = (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)

  const users: string[] = []
  const skipped: string[] = []
  const seen = new Set<string>()

  for (const entry of entries) {
    const key = entry.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    // Reuse the same validation the API does, so a login that would not be
    // fetchable on request is not attempted on a timer either.
    if (parseParams(new URLSearchParams({ username: entry })).ok) {
      users.push(entry)
    } else {
      skipped.push(entry)
    }
  }

  return {
    users: users.slice(0, MAX_WARM_USERS),
    skipped: [...skipped, ...users.slice(MAX_WARM_USERS)],
  }
}

export interface WarmDeps {
  client: GitHubClient
  cache: StatsCache
  rateLimits: StatsDeps['rateLimits']
  now: number
  build: string
  /** Injected so tests do not spend the pause in real time. */
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Refreshes each configured profile in turn.
 *
 * Only the default parameter combination is warmed. A profile has one entry per
 * combination of the inputs that shape what is fetched, and warming all of them
 * would multiply the cost by the number of ways somebody could have written the
 * URL. A card using non-default `langs_count` or `lang_mode` still gets its
 * first reader a miss, which is the ordinary behaviour and is documented.
 */
export async function warmUsers(raw: string | undefined, deps: WarmDeps): Promise<WarmRun | null> {
  const { users, skipped } = parseWarmUsers(raw)
  // Nothing configured: no fetches, no writes, no trace. An instance that did
  // not ask for this should not be able to tell it exists.
  if (users.length === 0 && skipped.length === 0) return null

  const sleep = deps.sleep ?? defaultSleep
  const refreshed: string[] = []
  const failed: WarmFailure[] = []

  for (const [index, username] of users.entries()) {
    if (index > 0) await sleep(PAUSE_MS)

    const parsed = parseParams(new URLSearchParams({ username }))
    if (!parsed.ok) continue

    try {
      await refreshStats({ ...deps, rateLimits: deps.rateLimits }, parsed.params)
      refreshed.push(username)
    } catch (error) {
      // One profile failing says nothing about the next, and the entry it
      // failed to replace is still there and still serveable.
      const message = error instanceof Error ? error.message : String(error)
      failed.push({ username, error: message })
      console.warn(`warm: ${username} failed: ${message}`)
    }
  }

  const run: WarmRun = {
    ranAt: deps.now,
    durationMs: Date.now() - deps.now,
    refreshed,
    failed,
    skipped,
  }

  console.log(
    `warm: refreshed ${refreshed.length}, failed ${failed.length}, skipped ${skipped.length}`,
  )

  return run
}

/** Records the last run so `/health` can report whether the timer is alive. */
export class KvWarmStore {
  constructor(private readonly namespace: KVNamespace) {}

  async read(): Promise<WarmRun | null> {
    try {
      return await this.namespace.get<WarmRun>(LAST_RUN_KEY, 'json')
    } catch {
      return null
    }
  }

  async write(run: WarmRun): Promise<void> {
    try {
      await this.namespace.put(LAST_RUN_KEY, JSON.stringify(run), { expirationTtl: LAST_RUN_TTL })
    } catch {
      // Losing the record costs visibility, not correctness.
    }
  }
}
