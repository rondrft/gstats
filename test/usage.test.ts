import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { cacheKey, KvStatsCache, loginFromCacheKey } from '../src/cache'
import worker, { type Env } from '../src/index'
import { parseParams } from '../src/params'
import {
  forgetRequestTally,
  readProfileUsage,
  readRequestUsage,
  recordRequest,
  rollUpProfiles,
} from '../src/usage'
import { statsFixture } from './helpers/fixtures'

const testEnv = env as unknown as Env
const kv = testEnv.STATS_CACHE

const DAY_MS = 86_400_000

/**
 * Ahead of the clock rather than at a fixed date. Both figures are windowed and
 * both are stored per UTC day, so a test that picked a date near today's would
 * eventually start sharing a window with the two tests below that go through the
 * Worker and therefore run against the real clock.
 */
const BASE = Date.now() + 400 * DAY_MS

/**
 * The rollup refuses to run again inside its own interval, so each one takes a
 * day of its own rather than being throttled by the test before it. KV is shared
 * across a file and the ledger is a single key, which is the same reason.
 */
let day = 0
function nextDay(): number {
  day += 1
  return BASE + day * DAY_MS
}

/**
 * The request figure sums a week of daily records, so a day of its own is not
 * enough separation — a test a day later would still see the one before it.
 * These are a month apart, and far enough into the future not to meet the real
 * clock the end-to-end tests run against.
 */
let block = 0
function nextMonth(): number {
  block += 1
  return BASE + block * 30 * DAY_MS
}

/** Puts a real stats entry in the cache, the way a miss would. */
async function cache(username: string, query = ''): Promise<void> {
  const parsed = parseParams(new URLSearchParams(`username=${username}&${query}`))
  if (!parsed.ok) throw new Error(`not a valid login: ${username}`)
  await new KvStatsCache(kv).write(cacheKey(parsed.params, 'test-build'), {
    data: statsFixture(),
    freshUntil: Date.now() + 60_000,
  })
}

async function activeAt(now: number): Promise<number> {
  return (await readProfileUsage(kv, now)).active30d
}

/** Everything fetched at all, one-shot lookups included. */
async function seenAt(now: number): Promise<number> {
  return (await readProfileUsage(kv, now)).seen30d
}

beforeEach(() => {
  forgetRequestTally()
})

/**
 * The point of the whole module: the ceiling in docs/limits.md is expressed in
 * active profiles, and until this existed an instance could not tell whether it
 * was at twenty of them or at two hundred.
 */
describe('counting distinct profiles', () => {
  it('counts a login the cache holds an entry for', async () => {
    const now = nextDay()
    const before = await seenAt(now)

    await cache('rollup-one')
    await rollUpProfiles(kv, now)

    expect(await seenAt(now)).toBe(before + 1)
  })

  /**
   * `docs/limits.md` defines an active profile as one somebody is loading often
   * enough that its entry is refetched as soon as it goes stale — four misses a
   * day, which is where the whole ceiling comes from. A login fetched once and
   * never again costs one write in its life and is not that.
   *
   * The distinction is not academic. The landing page's generator used to fetch
   * a card on every keystroke, so one visitor typing one login left a trail of
   * its prefixes in the cache — and most prefixes of a real login are real
   * logins, so a count that could not tell a lookup from a tenant reported
   * thirty-five profiles where fewer than ten people were being served.
   */
  it('does not count a login seen on only one day as active', async () => {
    const now = nextDay()
    // From an empty ledger, so every login in the cache is a first sighting and
    // the active count has to be exactly nothing.
    await kv.delete('usage:profiles')

    await cache('rollup-oneshot')
    await rollUpProfiles(kv, now)

    expect(await seenAt(now)).toBeGreaterThan(0)
    expect(await activeAt(now)).toBe(0)
  })

  it('counts it once it is still there the next day', async () => {
    // Two days from the allocator rather than one plus a day, so the ledger's
    // clock never runs ahead of the test after this one — a rollup stamped in
    // the future is a rollup the next test silently skips.
    const first = nextDay()
    const second = nextDay()

    await cache('rollup-returning')
    await rollUpProfiles(kv, first)
    await rollUpProfiles(kv, second)

    expect(await activeAt(second)).toBeGreaterThan(0)
  })

  /**
   * A login does not have *an* entry — it has one per combination of the
   * parameters that shape what is fetched. Counting entries would report a
   * profile more than once for no reason a reader of the figure could guess.
   */
  it('counts a login once however many entries it has', async () => {
    const now = nextDay()
    const before = await seenAt(now)

    await cache('rollup-two')
    await cache('rollup-two', 'hide=langs')
    await cache('rollup-two', 'tz=Europe/Madrid')
    await rollUpProfiles(kv, now)

    expect(await seenAt(now)).toBe(before + 1)
  })

  it('does not run again inside its own interval', async () => {
    const now = nextDay()
    await rollUpProfiles(kv, now)
    const settled = await seenAt(now)

    await cache('rollup-throttled')
    await rollUpProfiles(kv, now + 60_000)

    expect(await seenAt(now)).toBe(settled)
  })

  /**
   * The window is what makes the figure mean "active" rather than "ever seen".
   * A profile whose entries have long since expired stops counting, which is the
   * whole reason the ledger stamps a day rather than a flag.
   */
  it('forgets a profile that has not been seen for thirty days', async () => {
    const now = nextDay()

    await cache('rollup-lapsed')
    await rollUpProfiles(kv, now)
    expect(await seenAt(now)).toBeGreaterThan(0)

    // Same ledger, read a month later. Nothing has to be deleted for this: the
    // stamp is what expires, and the next rollup drops it.
    expect(await seenAt(now + 31 * DAY_MS)).toBe(0)
  })

  it('reports when it last ran, so a stopped cron is visible', async () => {
    const now = nextDay()
    await rollUpProfiles(kv, now)

    expect((await readProfileUsage(kv, now)).updatedAt).toBe(now)
  })

  /**
   * The rollup is only ever reached from the scheduled handler, so a module
   * that works perfectly and is never called would look exactly like this one.
   * Warming shares that handler and must not be able to skip it.
   */
  it('is folded by the cron, whether or not warming is configured', async () => {
    await kv.delete('usage:profiles')
    await cache('rollup-by-cron')

    const pending: Promise<unknown>[] = []
    const context = {
      waitUntil: (promise: Promise<unknown>) => {
        pending.push(promise)
      },
      passThroughOnException: () => {},
    } as unknown as ExecutionContext

    await worker.scheduled(
      { scheduledTime: Date.now(), cron: '*/15 * * * *', noRetry: () => {} },
      testEnv,
      context,
    )
    await Promise.all(pending)

    const usage = await readProfileUsage(kv)
    expect(usage.updatedAt).not.toBeNull()
    expect(usage.seen30d).toBeGreaterThan(0)
  })
})

/**
 * Usernames are public and are in the cache keys already. The ledger is the one
 * record here that outlives them, and it has no use for the identity — so it
 * does not carry one. Not a security boundary; a statement of purpose.
 */
describe('what the ledger stores', () => {
  it('holds no login, only a count per opaque token', async () => {
    const now = nextDay()
    await cache('rollup-private')
    await rollUpProfiles(kv, now)

    const raw = (await kv.get('usage:profiles')) ?? ''

    expect(raw).not.toContain('rollup-private')
    expect(raw.length).toBeGreaterThan(0)
  })

  it('records nothing about whoever asked', async () => {
    const now = nextDay()
    await worker.fetch(
      new Request('https://stats.example.com/api?username=octocat', {
        headers: {
          'cf-connecting-ip': '203.0.113.9',
          'user-agent': 'a distinctive agent string',
          referer: 'https://github.com/somebody',
        },
      }),
      testEnv,
    )
    await rollUpProfiles(kv, now)

    const listing = await kv.list({ prefix: 'usage:' })
    const stored = await Promise.all(listing.keys.map((key) => kv.get(key.name)))
    const everything = stored.join('\n')

    expect(everything).not.toContain('203.0.113.9')
    expect(everything).not.toContain('a distinctive agent string')
    expect(everything).not.toContain('github.com/somebody')
  })
})

describe('reading a login back out of a key', () => {
  it('finds the login in a real key', () => {
    const parsed = parseParams(new URLSearchParams('username=OctoCat'))
    if (!parsed.ok) throw new Error('fixture')

    expect(loginFromCacheKey(cacheKey(parsed.params, 'abc1234'))).toBe('octocat')
  })

  /** A build id is whatever SERVICE_VERSION was, which may not be colon-free. */
  it('survives a build id with a colon in it', () => {
    expect(loginFromCacheKey('v3:branch:1234:octocat:deadbeef')).toBe('octocat')
  })

  it('ignores the other things stored under the same root', () => {
    expect(loginFromCacheKey('v3:rate-limit')).toBeNull()
    expect(loginFromCacheKey('budget:writes:2026-07-27')).toBeNull()
    expect(loginFromCacheKey('usage:profiles')).toBeNull()
  })
})

/**
 * The other half of the question: two hundred profiles nobody looks at are not
 * the same load as twenty that are embedded in busy READMEs.
 */
describe('counting requests', () => {
  it('accumulates in the isolate without touching KV', async () => {
    const now = nextMonth()
    for (let request = 0; request < 10; request += 1) await recordRequest(kv, now)

    expect((await readRequestUsage(kv, now)).last7d).toBe(10)

    // Nothing flushed yet, so a cold isolate would see nothing of it.
    forgetRequestTally()
    expect((await readRequestUsage(kv, now)).last7d).toBe(0)
  })

  it('flushes once enough have accumulated', async () => {
    const now = nextMonth()
    for (let request = 0; request < 200; request += 1) await recordRequest(kv, now)

    forgetRequestTally()
    expect((await readRequestUsage(kv, now)).last7d).toBe(200)
  })

  /**
   * Dropping the old day's pending count at midnight would lose up to a full
   * interval out of every day, for the sake of one write per isolate per day.
   */
  it('flushes what it is holding when the day turns over', async () => {
    const now = nextMonth()
    for (let request = 0; request < 5; request += 1) await recordRequest(kv, now)
    await recordRequest(kv, now + DAY_MS)

    forgetRequestTally()
    expect((await readRequestUsage(kv, now + DAY_MS)).last7d).toBe(5)
  })

  it('counts the window and not what fell out of it', async () => {
    const now = nextMonth()
    for (let request = 0; request < 200; request += 1) await recordRequest(kv, now)
    forgetRequestTally()

    expect((await readRequestUsage(kv, now + 3 * DAY_MS)).last7d).toBe(200)
    expect((await readRequestUsage(kv, now + 8 * DAY_MS)).last7d).toBe(0)
  })

  it('counts a card request end to end', async () => {
    const before = (await readRequestUsage(kv)).last7d
    await worker.fetch(new Request('https://stats.example.com/api?username=octocat'), testEnv)

    expect((await readRequestUsage(kv)).last7d).toBe(before + 1)
  })

  /** `/health` and the landing page are not card traffic and are not counted. */
  it('does not count anything but /api', async () => {
    const before = (await readRequestUsage(kv)).last7d
    await worker.fetch(new Request('https://stats.example.com/'), testEnv)
    await worker.fetch(new Request('https://stats.example.com/health'), testEnv)

    expect((await readRequestUsage(kv)).last7d).toBe(before)
  })
})

describe('/health reports both figures', () => {
  it('carries the profile count and the week', async () => {
    const response = await worker.fetch(new Request('https://stats.example.com/health'), testEnv)
    const body = (await response.json()) as {
      profiles: { active30d: number; updatedAt: number | null }
      requests: { last7d: number }
    }

    expect(typeof body.profiles.active30d).toBe('number')
    expect(typeof body.requests.last7d).toBe('number')
  })

  it('says the ledger has never been folded rather than pretending it has', async () => {
    await kv.delete('usage:profiles')

    const response = await worker.fetch(new Request('https://stats.example.com/health'), testEnv)
    const body = (await response.json()) as {
      profiles: { active30d: number; updatedAt: number | null }
    }

    expect(body.profiles.updatedAt).toBeNull()
    expect(body.profiles.active30d).toBe(0)
  })
})

/**
 * `/health` answers "how many", which is the capacity question and needs no
 * identities. This is the other question — "which" — and it exists because
 * looking at real profiles is how edge cases get found.
 */
describe('GET /profiles', () => {
  const withToken = { ...testEnv, PURGE_TOKEN: 'operator-secret' }

  const get = (environment: Env, authorization?: string) =>
    worker.fetch(
      new Request(
        'https://stats.example.com/profiles',
        authorization === undefined ? {} : { headers: { authorization } },
      ),
      environment,
    )

  /**
   * A `401` would confirm to an anonymous caller that a list of users is kept
   * here, which is precisely what the rest of this module is arranged not to
   * advertise.
   */
  it('does not admit to existing without the token', async () => {
    expect((await get(withToken)).status).toBe(404)
    expect((await get(withToken, 'Bearer wrong')).status).toBe(404)
    expect((await get(testEnv, 'Bearer operator-secret')).status).toBe(404)
  })

  it('lists the logins the cache is holding', async () => {
    await cache('profiles-endpoint')

    const response = await get(withToken, 'Bearer operator-secret')
    const body = (await response.json()) as { count: number; logins: string[]; window: string }

    expect(response.status).toBe(200)
    expect(body.logins).toContain('profiles-endpoint')
    expect(body.count).toBe(body.logins.length)
    // The listing can only speak for as long as an entry lives, and says so.
    expect(body.window).toContain('7 days')
  })

  it('is derived from the cache and not from the hashed ledger', async () => {
    await kv.delete('usage:profiles')
    await cache('profiles-no-ledger')

    const body = (await (await get(withToken, 'Bearer operator-secret')).json()) as {
      logins: string[]
    }

    expect(body.logins).toContain('profiles-no-ledger')
  })

  it('is not counted as card traffic', async () => {
    const before = (await readRequestUsage(kv)).last7d
    await get(withToken, 'Bearer operator-secret')

    expect((await readRequestUsage(kv)).last7d).toBe(before)
  })
})
