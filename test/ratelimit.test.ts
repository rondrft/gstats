import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker, { type Env } from '../src/index'
import {
  checkRateLimits,
  DEFAULT_PROFILES_PER_HOUR,
  DEFAULT_REQUESTS_PER_MINUTE,
  forgetTrackedClients,
  RATE_LIMIT_TOKENS_PER_MINUTE,
  resolveLimit,
  tokensPerRequest,
} from '../src/ratelimit'
import { stubGitHub } from './helpers/github-stub'

const testEnv = env as unknown as Env

/**
 * Every test picks its own address. The limiter is real — `vitest-pool-workers`
 * runs the binding declared in `wrangler.toml` — so counters are shared across a
 * file the same way they would be shared across a colo.
 */
let addresses = 0
function nextAddress(): string {
  addresses += 1
  return `203.0.113.${addresses}`
}

function card(path: string, ip: string, overrides: Partial<Env> = {}): Promise<Response> {
  return worker.fetch(
    new Request(`https://stats.example.com${path}`, { headers: { 'cf-connecting-ip': ip } }),
    { ...testEnv, ...overrides },
  )
}

beforeEach(() => {
  forgetTrackedClients()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('reading the configured limits', () => {
  it('falls back to the default rather than switching the limit off', () => {
    for (const raw of [undefined, '', 'thirty', '0', '-5', 'NaN']) {
      expect(resolveLimit(raw, 30, 60), String(raw)).toBe(30)
    }
  })

  it('takes a number it can use', () => {
    expect(resolveLimit('12', 30, 60)).toBe(12)
  })

  /** Asking for more than the declared budget cannot be honoured, so it is clamped. */
  it('clamps a request above the token budget', () => {
    expect(resolveLimit('600', 30, 60)).toBe(60)
  })
})

/**
 * The binding has no runtime way to report the allowance it was declared with,
 * so the request limit is expressed as what one request costs against it.
 */
describe('token cost', () => {
  it('spends one token per request at the declared budget', () => {
    expect(tokensPerRequest(RATE_LIMIT_TOKENS_PER_MINUTE)).toBe(1)
  })

  it('spends two at the default of thirty a minute', () => {
    expect(tokensPerRequest(DEFAULT_REQUESTS_PER_MINUTE)).toBe(2)
  })

  /** Rounding down the achievable limit is the safe direction to be wrong in. */
  it('never resolves to a limit looser than asked for', () => {
    for (let limit = 1; limit <= RATE_LIMIT_TOKENS_PER_MINUTE; limit += 1) {
      const achievable = Math.floor(RATE_LIMIT_TOKENS_PER_MINUTE / tokensPerRequest(limit))
      expect(achievable, `limit=${limit}`).toBeLessThanOrEqual(limit)
    }
  })
})

describe('requests per minute, per address', () => {
  it('lets an ordinary reader through', async () => {
    stubGitHub()
    const ip = nextAddress()

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await card('/api?username=rondrft', ip)).status).toBe(200)
    }
  })

  /**
   * Six a minute is ten tokens a request against a budget of sixty, so the
   * seventh is refused. The default of thirty would take thirty-one requests to
   * demonstrate and would be no more convincing.
   */
  it('refuses the request after the budget is spent', async () => {
    stubGitHub()
    const ip = nextAddress()
    const tight = { API_RATE_LIMIT: '6' }

    for (let attempt = 0; attempt < 6; attempt += 1) {
      expect((await card('/api?username=rondrft', ip, tight)).status).toBe(200)
    }

    const refused = await card('/api?username=rondrft', ip, tight)

    expect(refused.status).toBe(429)
    expect(refused.headers.get('x-rate-limit')).toBe('requests')
  })

  it('counts each address separately', async () => {
    stubGitHub()
    const tight = { API_RATE_LIMIT: '6' }
    const noisy = nextAddress()

    for (let attempt = 0; attempt < 7; attempt += 1)
      await card('/api?username=rondrft', noisy, tight)

    expect((await card('/api?username=rondrft', nextAddress(), tight)).status).toBe(200)
  })

  /**
   * The point of counting hits: they cost an invocation, and a limit that only
   * applied to misses would be avoided by asking for one popular profile in a
   * loop.
   */
  it('counts a cache hit against the limit', async () => {
    const github = stubGitHub()
    const ip = nextAddress()
    const tight = { API_RATE_LIMIT: '6' }

    const first = await card('/api?username=hitcounter', ip, tight)
    expect(first.headers.get('x-cache')).toBe('MISS')

    let refused: Response | null = null
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await card('/api?username=hitcounter', ip, tight)
      if (response.status === 429) {
        refused = response
        break
      }
      expect(response.headers.get('x-cache')).toBe('HIT')
    }

    expect(refused?.status).toBe(429)
    // Every one of those after the first was served from KV, so nothing beyond
    // the opening miss reached GitHub — and it was still throttled.
    expect(github.calls).toBeLessThanOrEqual(5)
  })

  it('does nothing at all on an instance with no binding declared', async () => {
    stubGitHub()
    const ip = nextAddress()
    const { API_RATE_LIMITER: _undeclared, ...withoutBinding } = testEnv
    const unbound: Env = { ...withoutBinding, API_RATE_LIMIT: '1' }

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await worker.fetch(
        new Request('https://stats.example.com/api?username=rondrft', {
          headers: { 'cf-connecting-ip': ip },
        }),
        unbound,
      )
      expect(response.status).toBe(200)
    }
  })
})

/**
 * The limit that separates a reader from a scraper. A reader loads one or two
 * profiles however many times; a scraper walks logins it has never asked for,
 * and every one of them is a guaranteed miss.
 */
describe('distinct logins per hour, per address', () => {
  const now = Date.parse('2026-07-27T12:00:00Z')
  const base = {
    limiter: undefined,
    requestsPerMinute: DEFAULT_REQUESTS_PER_MINUTE,
    profilesPerHour: DEFAULT_PROFILES_PER_HOUR,
  }

  it('never charges the same login twice', async () => {
    const ip = nextAddress()

    for (let attempt = 0; attempt < 200; attempt += 1) {
      const decision = await checkRateLimits({ ...base, ip, username: 'rondrft', now })
      expect(decision.allowed).toBe(true)
    }
  })

  it('stops at the budget and says how long to wait', async () => {
    const ip = nextAddress()

    for (let index = 0; index < DEFAULT_PROFILES_PER_HOUR; index += 1) {
      const decision = await checkRateLimits({ ...base, ip, username: `login${index}`, now })
      expect(decision.allowed, `login${index}`).toBe(true)
    }

    const refused = await checkRateLimits({ ...base, ip, username: 'onemore', now })

    expect(refused).toEqual({
      allowed: false,
      reason: 'profiles',
      retryAfterSeconds: 3600,
    })
  })

  /** A login already counted stays free once the budget is gone. */
  it('keeps serving the logins it already counted', async () => {
    const ip = nextAddress()

    for (let index = 0; index < DEFAULT_PROFILES_PER_HOUR + 5; index += 1) {
      await checkRateLimits({ ...base, ip, username: `login${index}`, now })
    }

    const known = await checkRateLimits({ ...base, ip, username: 'login0', now })
    expect(known.allowed).toBe(true)
  })

  it('gives each address its own budget', async () => {
    const noisy = nextAddress()
    for (let index = 0; index < DEFAULT_PROFILES_PER_HOUR + 1; index += 1) {
      await checkRateLimits({ ...base, ip: noisy, username: `login${index}`, now })
    }

    const quiet = await checkRateLimits({ ...base, ip: nextAddress(), username: 'someone', now })
    expect(quiet.allowed).toBe(true)
  })

  it('starts the budget over on the next hour', async () => {
    const ip = nextAddress()
    for (let index = 0; index < DEFAULT_PROFILES_PER_HOUR + 1; index += 1) {
      await checkRateLimits({ ...base, ip, username: `login${index}`, now })
    }

    const later = await checkRateLimits({
      ...base,
      ip,
      username: 'freshhour',
      now: now + 3_600_000,
    })
    expect(later.allowed).toBe(true)
  })

  /** Case is not a way to buy a second allowance for the same profile. */
  it('treats a login as one login however it is cased', async () => {
    const ip = nextAddress()

    for (const login of ['RonDrft', 'rondrft', 'RONDRFT']) {
      expect((await checkRateLimits({ ...base, ip, username: login, now })).allowed).toBe(true)
    }

    for (let index = 0; index < DEFAULT_PROFILES_PER_HOUR - 1; index += 1) {
      await checkRateLimits({ ...base, ip, username: `login${index}`, now })
    }

    const refused = await checkRateLimits({ ...base, ip, username: 'lastone', now })
    expect(refused.allowed).toBe(false)
  })

  it('has nothing to attribute a limit to without an address', async () => {
    for (let index = 0; index < DEFAULT_PROFILES_PER_HOUR + 10; index += 1) {
      const decision = await checkRateLimits({ ...base, ip: null, username: `login${index}`, now })
      expect(decision.allowed).toBe(true)
    }
  })

  it('does not charge a request that carried no usable login', async () => {
    const ip = nextAddress()

    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect((await checkRateLimits({ ...base, ip, username: null, now })).allowed).toBe(true)
    }

    for (let index = 0; index < DEFAULT_PROFILES_PER_HOUR; index += 1) {
      const decision = await checkRateLimits({ ...base, ip, username: `login${index}`, now })
      expect(decision.allowed, `login${index}`).toBe(true)
    }
  })
})

/**
 * The one non-200 on `/api`. A broken image in somebody's README says nothing;
 * a card that says what happened says everything, so the refusal is drawn even
 * though its real audience is reading headers rather than pixels.
 */
describe('the refusal is a card', () => {
  it('carries a status, a wait and an SVG body', async () => {
    stubGitHub()
    const ip = nextAddress()
    const tight = { API_RATE_LIMIT: '6' }

    let refused: Response | null = null
    for (let attempt = 0; attempt < 12 && refused === null; attempt += 1) {
      const response = await card('/api?username=rondrft', ip, tight)
      if (response.status === 429) refused = response
    }

    expect(refused).not.toBeNull()
    expect(refused?.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8')
    expect(refused?.headers.get('retry-after')).toBe('60')
    // A refusal that lapses in a minute must not be pinned to the URL by an
    // intermediary that will still be holding it an hour later.
    expect(refused?.headers.get('cache-control')).toBe('no-store')

    const body = await (refused as Response).text()
    expect(body).toContain('<svg')
    expect(body).toContain('too many requests')
    expect(body).not.toContain('{minutes}')
  })

  it('draws the refusal in the locale the caller asked for', async () => {
    stubGitHub()
    const ip = nextAddress()
    const tight = { API_RATE_LIMIT: '6' }

    let refused: Response | null = null
    for (let attempt = 0; attempt < 12 && refused === null; attempt += 1) {
      const response = await card('/api?username=rondrft&locale=es&theme=ice', ip, tight)
      if (response.status === 429) refused = response
    }

    await expect((refused as Response).text()).resolves.toContain('demasiadas peticiones')
  })

  /** Anyone diagnosing a throttled instance reaches for these two first. */
  it('leaves /health and the landing page alone', async () => {
    const ip = nextAddress()
    const tight = { API_RATE_LIMIT: '6' }

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await card('/api?username=rondrft', ip, tight)
    }

    expect((await card('/health', ip, tight)).status).toBe(200)
    expect((await card('/', ip, tight)).status).toBe(200)
  })

  /**
   * `/purge` is called by its owner's CI and already carries a per-token brake.
   * An address limit on top of it would throttle the owner's own workflow.
   */
  it('leaves /purge to its own limit', async () => {
    const ip = nextAddress()
    const tight = { API_RATE_LIMIT: '6' }

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await card('/api?username=rondrft', ip, tight)
    }

    const response = await worker.fetch(
      new Request('https://stats.example.com/purge?username=rondrft', {
        method: 'POST',
        headers: { 'cf-connecting-ip': ip },
      }),
      { ...testEnv, ...tight },
    )

    // 401 for the missing token, which is the point: it was answered by the
    // purge handler rather than refused by the address limit.
    expect(response.status).not.toBe(429)
  })
})
