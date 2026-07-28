import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetWriteFailures, recordWriteFailure } from '../src/budget'
import { forgetObservedRateLimit, KvStatsCache } from '../src/cache'
import worker, { type Env } from '../src/index'
import { KvPurgeLimiter } from '../src/purge'
import { KvWarmStore } from '../src/warm'
import { statsFixture } from './helpers/fixtures'
import { stubGitHub } from './helpers/github-stub'

const testEnv = env as unknown as Env

/**
 * What the free plan actually does at a thousand writes: reads keep working,
 * every `put` is refused. The error text is Cloudflare's.
 *
 * This is the expected failure mode rather than an exotic one, and
 * `docs/limits.md` is explicit about which way it has to break — "the figures
 * freeze", not "every card on the instance breaks at once". These tests are
 * that sentence, enforced.
 */
function exhaustedKv(real: KVNamespace): KVNamespace {
  return new Proxy(real, {
    get(target, property, receiver) {
      if (property === 'put') {
        return () => Promise.reject(new Error('KV PUT failed: 429 Too Many Requests'))
      }
      const value = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as KVNamespace
}

const outOfWrites = (): Env => ({ ...testEnv, STATS_CACHE: exhaustedKv(testEnv.STATS_CACHE) })

const get = (path: string, environment: Env = testEnv) =>
  worker.fetch(new Request(`https://stats.example.com${path}`), environment)

beforeEach(() => {
  forgetWriteFailures()
  forgetObservedRateLimit()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('an instance that has run out of KV writes', () => {
  it('still draws the card it just fetched', async () => {
    stubGitHub()

    const response = await get('/api?username=kvdown1', outOfWrites())
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8')
    // The figures were fetched successfully; only storing them failed, and the
    // card was already built from them before the write was attempted.
    expect(body).toContain('contributions')
    expect(body).not.toContain('upstream error')
    expect(body).not.toContain('user not found')
  })

  /** The entry that could not be replaced is still the entry that gets served. */
  it('serves an entry written before the writes started failing', async () => {
    stubGitHub()
    await get('/api?username=kvdown2')

    const response = await get('/api?username=kvdown2', outOfWrites())

    expect(response.status).toBe(200)
    expect(response.headers.get('x-cache')).toBe('HIT')
    await expect(response.text()).resolves.toContain('contributions')
  })

  /**
   * The distinction that matters: figures freeze, they do not disappear. Every
   * profile keeps answering, request after request, with nothing cached.
   *
   * Asserting the status alone would prove nothing — an error card is a 200 too,
   * by design — so what is checked is that the card carries figures.
   */
  it('keeps answering every request rather than breaking one profile at a time', async () => {
    stubGitHub()
    const broken = outOfWrites()

    for (const login of ['kvdown3', 'kvdown4', 'kvdown5']) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const response = await get(`/api?username=${login}`, broken)
        const body = await response.text()
        const where = `${login} attempt ${attempt}`

        expect(response.status, where).toBe(200)
        expect(body, where).toContain('contributions')
        expect(body, where).not.toContain('upstream error')
      }
    }
  })

  it('answers /health rather than failing on the write counter', async () => {
    const response = await get('/health', outOfWrites())
    const body = (await response.json()) as { status: string; writes: { used: number } }

    expect(response.status).toBe(200)
    expect(body.writes).toBeDefined()
  })

  /** A purge whose brake cannot be incremented still purges. */
  it('lets the brake fail open rather than refusing a purge', async () => {
    const limiter = new KvPurgeLimiter(exhaustedKv(testEnv.STATS_CACHE), Date.now())

    await expect(limiter.hit('kvdown-token')).resolves.toBe(false)
  })

  it('does not reject out of the scheduled handler', async () => {
    stubGitHub()
    const pending: Promise<unknown>[] = []

    await worker.scheduled?.(
      {} as ScheduledController,
      { ...outOfWrites(), WARM_USERS: 'kvdown6' },
      {
        waitUntil: (promise: Promise<unknown>) => pending.push(promise),
        passThroughOnException: () => {},
      } as unknown as ExecutionContext,
    )

    await expect(Promise.all(pending)).resolves.toBeDefined()
  })

  it('swallows the error at every write site rather than only the cache', async () => {
    const broken = exhaustedKv(testEnv.STATS_CACHE)

    await expect(
      new KvStatsCache(broken).write('kvdown-probe', {
        data: statsFixture(),
        freshUntil: Date.now() + 1000,
      }),
    ).resolves.toBeUndefined()

    await expect(
      new KvWarmStore(broken).write({
        ranAt: Date.now(),
        durationMs: 1,
        refreshed: [],
        failed: [],
        skipped: [],
      }),
    ).resolves.toBeUndefined()
  })
})

/**
 * Swallowed is not the same as unnoticed. Before this the only evidence an
 * instance had run out of writes was cards quietly going stale — which is also
 * what a healthy quiet instance looks like.
 */
describe('the failure is reported', () => {
  it('names the operation and the reason', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    stubGitHub()

    await get('/api?username=kvdown7', outOfWrites())

    expect(warn).toHaveBeenCalled()
    const line = warn.mock.calls.map((call) => String(call[0])).join('\n')
    expect(line).toContain('kv write failed')
    expect(line).toContain('stats-cache')
    expect(line).toContain('429 Too Many Requests')
  })

  /**
   * An exhausted allowance fails every write for the rest of the day, so a line
   * per failure would be a line per cache miss. One a minute, carrying the count
   * it stands for.
   */
  it('reports once a minute and says how many it stood for', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const start = Date.parse('2026-07-27T12:00:00Z')
    const failure = new Error('KV PUT failed: 429 Too Many Requests')

    recordWriteFailure('stats-cache', failure, start)
    expect(warn).toHaveBeenCalledTimes(1)

    for (let second = 1; second < 60; second += 1) {
      recordWriteFailure('stats-cache', failure, start + second * 1000)
    }
    expect(warn).toHaveBeenCalledTimes(1)

    recordWriteFailure('stats-cache', failure, start + 60_000)
    expect(warn).toHaveBeenCalledTimes(2)
    expect(String(warn.mock.calls[1]?.[0])).toContain('59 more since the last report')
  })

  it('says nothing at all while writes are working', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    stubGitHub()

    await get('/api?username=kvdown8')

    const noise = warn.mock.calls
      .map((call) => String(call[0]))
      .filter((l) => l.includes('kv write'))
    expect(noise).toEqual([])
  })
})
