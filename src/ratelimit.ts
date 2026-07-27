/**
 * Per-IP limits on `/api`.
 *
 * The instance URL is public and the GitHub token behind it is not. A loop over
 * invented logins is all cache misses, and every miss is three to five upstream
 * queries plus a KV write — so an unprotected instance is an invitation to spend
 * somebody else's budget. These are the two limits that make sharing the URL
 * safe.
 *
 * Both are counted for cache hits as well as misses. What is being protected is
 * not only the GitHub quota: a hit still costs a Worker invocation, and the
 * scarce resource on the free plan is writes, which a miss also spends.
 *
 * ## Requests per minute — the native binding
 *
 * Cloudflare's Rate Limiting binding runs inside the Worker and needs no zone,
 * which is the whole reason it is used here rather than a WAF rule: a WAF rule
 * is configured per zone, and a `workers.dev` subdomain is not a zone anybody
 * can add rules to. See `docs/limits.md`.
 *
 * The binding's window is fixed at ten or sixty seconds by the platform, and its
 * allowance is declared in `wrangler.toml` rather than read at runtime. So the
 * declared allowance is treated as a *token budget per minute* and the
 * configurable limit decides how many tokens one request costs. At the default
 * of thirty requests a minute against a sixty-token budget that is two calls per
 * request, both answered inside the colo.
 *
 * ## Distinct logins per hour — the one that stops a scraper
 *
 * A reader loads one or two profiles. A scraper walks hundreds, and every new
 * login is a guaranteed miss. Counting *distinct* logins per address separates
 * those two populations far more sharply than counting requests does.
 *
 * An hour cannot be expressed with a sixty-second window, so this ledger is kept
 * in the isolate rather than in the binding. That makes it lossy: isolates are
 * recycled, and an address whose requests land on a second isolate gets a second
 * allowance. It is still worth having — a busy Worker serves a colo's traffic
 * from very few isolates, so in practice this cuts an enumeration run by an
 * order of magnitude — but it is a brake, and the hard cross-isolate ceiling is
 * the requests-per-minute limit above. `docs/pending.md` records what an exact
 * version would cost.
 *
 * Nothing here writes to KV. A ledger in KV would cost one write per reader
 * address per hour, against a budget of a thousand writes a day — the defence
 * would have been more expensive than the abuse.
 */

/**
 * Tokens each address may spend per minute, and the value that must be kept in
 * step with `simple.limit` under `[[ratelimits]]` in `wrangler.toml`.
 *
 * The binding does not report its own configuration, so this is the only place
 * the two can be reconciled. `test/ratelimit.test.ts` pins the composition from
 * the outside — it counts how many requests actually get through — so a change
 * to one and not the other fails the suite rather than silently doubling the
 * limit in production.
 */
export const RATE_LIMIT_TOKENS_PER_MINUTE = 60

/** Requests per minute per address, unless `API_RATE_LIMIT` says otherwise. */
export const DEFAULT_REQUESTS_PER_MINUTE = 30

/** Distinct logins per hour per address, unless `PROFILE_RATE_LIMIT` says otherwise. */
export const DEFAULT_PROFILES_PER_HOUR = 20

const MINUTE_SECONDS = 60
const HOUR_MS = 3_600_000

/**
 * How many addresses the ledger will track before it gives up and starts over.
 *
 * A bound is required — the map is reachable from a public endpoint — and
 * discarding the whole thing is the right response to hitting it. Trimming the
 * oldest entries would be more code and would protect the wrong party: whatever
 * filled twenty thousand slots in an hour is the traffic this exists to stop,
 * and a reset costs it nothing it was not already going to get by rotating
 * addresses.
 */
const MAX_TRACKED_CLIENTS = 20_000

export type RateLimitReason = 'requests' | 'profiles'

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; reason: RateLimitReason; retryAfterSeconds: number }

const ALLOWED: RateLimitDecision = { allowed: true }

export interface RateLimitCheck {
  /**
   * The `API_RATE_LIMITER` binding, or undefined on an instance that has not
   * declared it. Absent means the per-minute limit is not enforced at all,
   * which `/health` reports rather than hides.
   */
  limiter: RateLimit | undefined
  /** `CF-Connecting-IP`, or null when there is nothing to attribute the request to. */
  ip: string | null
  /** The requested login, or null when the request did not carry a usable one. */
  username: string | null
  requestsPerMinute: number
  profilesPerHour: number
  /** Epoch milliseconds. Injected so tests control the hour boundary. */
  now: number
}

/**
 * Reads one of the two limits from the environment.
 *
 * Anything unparseable falls back to the default rather than failing the
 * request: a typo in a variable should not take the instance down, and it
 * should not silently switch the protection off either.
 */
export function resolveLimit(raw: string | undefined, fallback: number, max: number): number {
  const value = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(value) || value < 1) return fallback
  return Math.min(max, value)
}

/**
 * Tokens one request spends.
 *
 * A limit that does not divide the token budget rounds *down* to the nearest
 * achievable number of requests, which is the safe direction: asking for
 * forty-five a minute against sixty tokens gets thirty, never ninety.
 */
export function tokensPerRequest(requestsPerMinute: number): number {
  const cost = Math.ceil(RATE_LIMIT_TOKENS_PER_MINUTE / requestsPerMinute)
  return Math.min(RATE_LIMIT_TOKENS_PER_MINUTE, Math.max(1, cost))
}

interface ClientLedger {
  /** Which hour this set belongs to; a change empties it. */
  hour: number
  logins: Set<string>
}

const ledger = new Map<string, ClientLedger>()

/**
 * Empties the isolate's ledger.
 *
 * Module state outlives a single test, and a test that inherits another's
 * counters is a test that passes for the wrong reason. Production never calls
 * this — an hour rolling over is what clears an entry there.
 */
export function forgetTrackedClients(): void {
  ledger.clear()
}

/** How many addresses the ledger is currently holding. Reported by `/health`. */
export function trackedClientCount(): number {
  return ledger.size
}

export async function checkRateLimits(check: RateLimitCheck): Promise<RateLimitDecision> {
  // Without an address there is nothing to attribute a limit to. This is the
  // local case — `wrangler dev` and the test suite — rather than anything a
  // deployed instance sees, since Cloudflare sets the header on every request
  // that reaches the edge.
  if (check.ip === null || check.ip.length === 0) return ALLOWED

  const requests = await withinRequestLimit(check)
  if (!requests.allowed) return requests

  return withinProfileLimit(check)
}

async function withinRequestLimit(check: RateLimitCheck): Promise<RateLimitDecision> {
  if (check.limiter === undefined) return ALLOWED

  const cost = tokensPerRequest(check.requestsPerMinute)
  const key = `ip:${check.ip}`

  // The calls are concurrent because the binding serialises them per key
  // anyway. A rejected request still spends what it asked for, which is the
  // conventional behaviour and the one that makes a hammering client back off
  // rather than discover a cheaper failure mode.
  const outcomes = await Promise.all(
    Array.from({ length: cost }, () => check.limiter?.limit({ key })),
  )

  if (outcomes.every((outcome) => outcome?.success !== false)) return ALLOWED

  return { allowed: false, reason: 'requests', retryAfterSeconds: MINUTE_SECONDS }
}

function withinProfileLimit(check: RateLimitCheck): RateLimitDecision {
  if (check.username === null) return ALLOWED

  const hour = Math.floor(check.now / HOUR_MS)
  const login = check.username.toLowerCase()

  if (ledger.size >= MAX_TRACKED_CLIENTS) ledger.clear()

  let client = ledger.get(check.ip as string)
  if (client === undefined || client.hour !== hour) {
    client = { hour, logins: new Set() }
    ledger.set(check.ip as string, client)
  }

  // A login already counted this hour is free however many times it is asked
  // for again — the limit is on breadth, not on volume. Volume is what the
  // per-minute limit above is for.
  if (client.logins.has(login)) return ALLOWED

  if (client.logins.size >= check.profilesPerHour) {
    return {
      allowed: false,
      reason: 'profiles',
      retryAfterSeconds: Math.ceil((HOUR_MS - (check.now % HOUR_MS)) / 1000),
    }
  }

  client.logins.add(login)
  return ALLOWED
}
