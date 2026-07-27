import { env } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cacheKey, KvRateLimitStore, MemoryStatsCache } from '../src/cache'
import { GitHubClient, StaticTokenProvider } from '../src/github/client'
import worker, { type Env } from '../src/index'
import { parseParams } from '../src/params'
import { MAX_WARM_USERS, parseWarmUsers, warmUsers } from '../src/warm'
import { stubGitHub } from './helpers/github-stub'

const testEnv = env as unknown as Env
const NOW = Date.parse('2026-07-27T12:00:00Z')

/** Records the order and spacing of refreshes without spending real time. */
function deps(overrides: Partial<Parameters<typeof warmUsers>[1]> = {}) {
  const pauses: number[] = []
  const cache = new MemoryStatsCache()
  return {
    pauses,
    cache,
    options: {
      client: new GitHubClient(new StaticTokenProvider('t')),
      cache,
      rateLimits: new KvRateLimitStore(testEnv.STATS_CACHE),
      now: NOW,
      build: 'test',
      sleep: (ms: number) => {
        pauses.push(ms)
        return Promise.resolve()
      },
      ...overrides,
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('parsing WARM_USERS', () => {
  it('reads a comma separated list, trimming and de-duplicating', () => {
    expect(parseWarmUsers(' octocat , defunkt ,octocat').users).toEqual(['octocat', 'defunkt'])
  })

  it('is empty when nothing is configured', () => {
    for (const raw of [undefined, '', '   ', ',,,']) {
      expect(parseWarmUsers(raw)).toEqual({ users: [], skipped: [] })
    }
  })

  /**
   * A typo in an environment variable is otherwise invisible: the symptom is
   * one profile quietly never warming, which nobody traces back to a comma.
   */
  it('reports entries that are not GitHub logins rather than dropping them', () => {
    const { users, skipped } = parseWarmUsers('octocat, not a login, -bad-, defunkt')

    expect(users).toEqual(['octocat', 'defunkt'])
    expect(skipped).toEqual(['not a login', '-bad-'])
  })

  it('caps the list, and says which names it left out', () => {
    const many = Array.from({ length: 14 }, (_, index) => `user${index}`)

    const { users, skipped } = parseWarmUsers(many.join(','))

    expect(users).toHaveLength(MAX_WARM_USERS)
    expect(skipped).toEqual(many.slice(MAX_WARM_USERS))
  })
})

describe('warming', () => {
  /** An instance that did not ask for this should not be able to tell it exists. */
  it('does nothing at all when nothing is configured', async () => {
    const github = stubGitHub()
    const { options, cache } = deps()

    const run = await warmUsers(undefined, options)

    expect(run).toBeNull()
    expect(github.calls).toBe(0)
    expect(await cache.read(keyFor('octocat'))).toBeNull()
  })

  it('leaves the entry fresh so the next visitor never pays for a miss', async () => {
    stubGitHub()
    const { options, cache } = deps()

    await warmUsers('octocat', options)
    const entry = await cache.read(keyFor('octocat'))

    expect(entry).not.toBeNull()
    expect(entry?.freshUntil).toBeGreaterThan(NOW)
    expect(entry?.data.login).toBe('octocat')
  })

  /**
   * Refresh, not purge. Purging on a timer would guarantee the opposite of the
   * point: the first reader after every interval would be the one waiting.
   */
  it('replaces a fresh entry instead of leaving it or removing it', async () => {
    stubGitHub()
    const { options, cache } = deps()

    await warmUsers('octocat', options)
    const first = await cache.read(keyFor('octocat'))

    const later = { ...options, now: NOW + 60_000 }
    await warmUsers('octocat', later)
    const second = await cache.read(keyFor('octocat'))

    expect(second).not.toBeNull()
    expect(second?.data.fetchedAt).toBeGreaterThan(first?.data.fetchedAt ?? 0)
  })

  /**
   * Ten profiles firing at once is exactly the spike against a shared quota
   * that the rest of the design is arranged to avoid.
   */
  it('refreshes one at a time, with a pause in between', async () => {
    stubGitHub()
    const { options, pauses } = deps()

    await warmUsers('a,b,c', options)

    // Two gaps for three profiles: the first does not wait for anything.
    expect(pauses).toHaveLength(2)
    expect(pauses.every((ms) => ms > 0)).toBe(true)
  })

  it('reports which profiles it refreshed', async () => {
    stubGitHub()
    const { options } = deps()

    const run = await warmUsers('octocat,defunkt', options)

    expect(run?.refreshed).toEqual(['octocat', 'defunkt'])
    expect(run?.failed).toEqual([])
    expect(run?.ranAt).toBe(NOW)
  })

  describe('when a refresh fails', () => {
    /** Rejects only for `doomed`, so the run has a survivor either side of it. */
    function stubFailingFor(login: string) {
      return stubGitHub({
        respond: (_kind, variables) =>
          variables.login === login ? { errors: [{ message: 'upstream exploded' }] } : undefined,
      })
    }

    it('carries on to the next profile', async () => {
      stubFailingFor('doomed')
      const { options } = deps()

      const run = await warmUsers('first,doomed,last', options)

      expect(run?.refreshed).toEqual(['first', 'last'])
      expect(run?.failed).toEqual([{ username: 'doomed', error: expect.any(String) }])
    })

    /**
     * The reason this refreshes rather than purges, stated as a test: a figure
     * from some hours ago beats a miss the reader has to wait for.
     */
    it('never removes the entry it failed to replace', async () => {
      stubGitHub()
      const { options, cache } = deps()
      await warmUsers('doomed', options)
      const before = await cache.read(keyFor('doomed'))
      expect(before).not.toBeNull()

      vi.unstubAllGlobals()
      stubFailingFor('doomed')
      const run = await warmUsers('doomed', { ...options, now: NOW + 60_000 })

      expect(run?.failed).toHaveLength(1)
      expect(await cache.read(keyFor('doomed'))).toEqual(before)
    })
  })
})

describe('the cron trigger', () => {
  // The handler hands its work to `waitUntil`, so the test has to collect what
  // was handed over and await it rather than awaiting the handler itself.
  // Takes a complete env rather than overrides, so a test can leave a variable
  // out entirely — merging would put it straight back.
  const fire = async (environment: Env) => {
    const pending: Promise<unknown>[] = []
    const context = {
      waitUntil: (promise: Promise<unknown>) => {
        pending.push(promise)
      },
      passThroughOnException: () => {},
    } as unknown as ExecutionContext

    await worker.scheduled(
      { scheduledTime: NOW, cron: '*/15 * * * *', noRetry: () => {} },
      environment,
      context,
    )
    await Promise.all(pending)
  }

  it('makes no requests on an instance that did not configure it', async () => {
    const github = stubGitHub()

    await fire(testEnv)

    expect(github.calls).toBe(0)
  })

  it('warms the configured profiles and records the run for /health', async () => {
    const github = stubGitHub()

    await fire({ ...testEnv, WARM_USERS: 'cronwarmed' })

    expect(github.calls).toBeGreaterThan(0)

    const health = (await (
      await worker.fetch(new Request('https://stats.example.com/health'), {
        ...testEnv,
        WARM_USERS: 'cronwarmed',
      })
    ).json()) as { warming: { configured: string[]; lastRun: { refreshed: string[] } | null } }

    expect(health.warming.configured).toEqual(['cronwarmed'])
    expect(health.warming.lastRun?.refreshed).toContain('cronwarmed')
  })

  it('leaves the warmed profile a hit for its next visitor', async () => {
    const github = stubGitHub()

    await fire({ ...testEnv, WARM_USERS: 'nevermisses' })
    const callsAfterWarm = github.calls

    const response = await worker.fetch(
      new Request('https://stats.example.com/api?username=nevermisses'),
      testEnv,
    )

    expect(response.headers.get('x-cache')).toBe('HIT')
    expect(github.calls).toBe(callsAfterWarm)
  })

  it('surfaces a misconfigured entry at /health rather than swallowing it', async () => {
    const health = (await (
      await worker.fetch(new Request('https://stats.example.com/health'), {
        ...testEnv,
        WARM_USERS: 'octocat, not a login',
      })
    ).json()) as { warming: { configured: string[]; ignored: string[] } }

    expect(health.warming.configured).toEqual(['octocat'])
    expect(health.warming.ignored).toEqual(['not a login'])
  })

  it('does nothing without a GitHub token, rather than failing every interval', async () => {
    const github = stubGitHub()
    const { GITHUB_TOKEN: _unset, ...withoutToken } = testEnv

    await fire({ ...withoutToken, WARM_USERS: 'octocat' })

    expect(github.calls).toBe(0)
  })
})

/** Warming touches the default parameter combination, which is what the key is. */
function keyFor(username: string): string {
  const parsed = parseParams(new URLSearchParams({ username }))
  if (!parsed.ok) throw new Error(`bad fixture login: ${username}`)
  return cacheKey(parsed.params, 'test')
}

/**
 * The shipped configuration is what every self-hoster starts from. A login left
 * in `WARM_USERS` would quietly spend their GitHub quota and their KV write
 * budget refreshing somebody else's profile, on an instance they never asked to
 * do that — and nothing about the running service would look wrong.
 */
describe('the shipped default', () => {
  it('warms nobody', () => {
    expect(parseWarmUsers(testEnv.WARM_USERS).users).toEqual([])
  })
})
