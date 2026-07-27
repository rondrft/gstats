/**
 * Targeted cache invalidation.
 *
 * A reader waits for two caches in series: the `max-age` Camo honours, and how
 * long KV considers an entry fresh. Shortening the second for everybody buys
 * propagation with quota from a budget every user of the instance shares, which
 * is the wrong trade. This is the other lever: leave both caches long, and let
 * whoever knows their own figures changed say so.
 *
 * The endpoint deletes and nothing else. It does not fetch, so fifty pushes in
 * ten minutes are fifty cheap deletes and one fetch — by whoever loads the card
 * next. Fetching here would turn a burst of pushes into a burst of API calls,
 * which is exactly the cost the whole design is arranged to avoid.
 */

import { cachePrefix, type StatsCache } from './cache'
import { USERNAME_PATTERN } from './params'

/**
 * Requests per minute per token.
 *
 * The token is the access control; this is a brake on a runaway loop — a CI job
 * stuck in a retry, or somebody's `while true`. Ten a minute is far above any
 * legitimate push cadence and far below anything that would matter.
 */
export const PURGE_LIMIT_PER_MINUTE = 10

const MINUTE_MS = 60_000

export type PurgeOutcome =
  | { status: 200; body: { purged: number; username: string } }
  | { status: 401 | 400 | 429 | 503; body: { error: string } }

export interface PurgeRequest {
  /** Value of the `Authorization` header, or null when absent. */
  authorization: string | null
  username: string | null
  /** The configured secret. Absent means the endpoint is switched off. */
  secret: string | undefined
  cache: StatsCache
  limiter: PurgeLimiter
  build: string
}

export interface PurgeLimiter {
  /** Records one attempt and reports whether it is over the limit. */
  hit(tokenId: string): Promise<boolean>
}

export async function handlePurge(request: PurgeRequest): Promise<PurgeOutcome> {
  if (request.secret === undefined || request.secret.length === 0) {
    // No secret to protect, so nothing is given away by saying so — and a
    // self-hoster debugging a 401 deserves to know which end is misconfigured.
    return { status: 503, body: { error: 'purging is disabled: PURGE_TOKEN is not set' } }
  }

  const presented = bearer(request.authorization)
  if (presented === null || !timingSafeEqual(presented, request.secret)) {
    return {
      status: 401,
      body: { error: 'a valid Authorization: Bearer <PURGE_TOKEN> is required' },
    }
  }

  const username = request.username?.trim() ?? ''
  if (!USERNAME_PATTERN.test(username)) {
    return { status: 400, body: { error: 'username is missing or not a GitHub login' } }
  }

  if (await request.limiter.hit(fingerprint(presented))) {
    return {
      status: 429,
      body: { error: `at most ${PURGE_LIMIT_PER_MINUTE} purges per minute per token` },
    }
  }

  const purged = await request.cache.purge(cachePrefix(username, request.build))
  return { status: 200, body: { purged, username: username.toLowerCase() } }
}

function bearer(header: string | null): string | null {
  if (header === null) return null
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim())
  return match?.[1] ?? null
}

/**
 * Compares without leaking the answer through timing.
 *
 * The length is allowed to leak — it is compared first, and hiding it would
 * mean hashing, which is more machinery than a shared secret of unbounded
 * length needs.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index)
  }
  return difference === 0
}

/** Identifies a token in a counter key without storing the token itself. */
function fingerprint(token: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Counts purges per token per minute, in KV.
 *
 * KV is eventually consistent, so a burst arriving at several colos at once can
 * overshoot before the counter catches up. That is acceptable here and worth
 * being explicit about: this is a brake, not a gate. The gate is the token, and
 * a caller who holds it is not the threat model — a caller who holds it and has
 * a bug is, and a loose counter stops that just as well.
 *
 * Buckets are fixed minutes rather than a sliding window, which means a caller
 * can spend two buckets' worth across a boundary. Same reasoning.
 */
export class KvPurgeLimiter implements PurgeLimiter {
  constructor(
    private readonly namespace: KVNamespace,
    private readonly now: number,
  ) {}

  async hit(tokenId: string): Promise<boolean> {
    const bucket = Math.floor(this.now / MINUTE_MS)
    const key = `purge-rate:${tokenId}:${bucket}`

    let used = 0
    try {
      used = Number.parseInt((await this.namespace.get(key)) ?? '0', 10) || 0
    } catch {
      // A counter that cannot be read is not a reason to refuse the request.
      return false
    }

    if (used >= PURGE_LIMIT_PER_MINUTE) return true

    try {
      // Two minutes, so the bucket outlives its own window without accumulating.
      await this.namespace.put(key, String(used + 1), { expirationTtl: 120 })
    } catch {
      // Losing the increment loosens the brake; refusing the purge would break
      // the feature. The looser failure is the better one.
    }

    return false
  }
}
