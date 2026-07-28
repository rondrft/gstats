import { env } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KV_FRESH_SECONDS } from '../src/cache'
import worker, { type Env } from '../src/index'
import { PURGE_LIMIT_PER_MINUTE } from '../src/purge'
import { fixtureDay, stubGitHub } from './helpers/github-stub'

const testEnv = env as unknown as Env

function get(path: string): Promise<Response> {
  return worker.fetch(new Request(`https://stats.example.com${path}`), testEnv)
}

/** Mirrors how the card renders a streak's extent, for date-independent asserts. */
function formatRange(start: string, end: string): string {
  const format = new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format
  return `${format(new Date(`${start}T00:00:00Z`))} - ${format(new Date(`${end}T00:00:00Z`))}`
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('routing', () => {
  it('serves the landing page at the root', async () => {
    const response = await get('/')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    await expect(response.text()).resolves.toContain('gstats')
  })

  it('reports its own state at /health', async () => {
    const response = await get('/health')
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.tokenConfigured).toBe(true)
    expect(body).toHaveProperty('rateLimit')
    expect(body).toHaveProperty('writes')
  })

  /**
   * An instance with no binding declared serves every request unthrottled.
   * That is a legitimate way to run a private one and a reckless way to run a
   * public one, so the absence is stated rather than left to be inferred.
   */
  it('says so at /health when nothing is enforcing a limit', async () => {
    expect((await (await get('/health')).json<{ rateLimiting: string }>()).rateLimiting).toBe(
      'enforced',
    )

    const { API_RATE_LIMITER: _undeclared, ...unbound } = testEnv
    const response = await worker.fetch(new Request('https://stats.example.com/health'), unbound)

    expect((await response.json<{ rateLimiting: string }>()).rateLimiting).toBe('disabled')
  })

  it('404s an unknown path', async () => {
    expect((await get('/favicon.ico')).status).toBe(404)
  })

  it('refuses methods it does not implement', async () => {
    const response = await worker.fetch(
      new Request('https://stats.example.com/api', { method: 'POST' }),
      testEnv,
    )

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, HEAD')
  })
})

/**
 * The rule the whole error path exists to satisfy: a README `<img>` shows the
 * browser's broken-image glyph for any non-200, so every failure has to arrive
 * as a drawable 200.
 */
describe('failures are drawn, never signalled', () => {
  it('answers a missing username with a card', async () => {
    const response = await get('/api')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8')
    await expect(response.text()).resolves.toContain('missing ?username=')
  })

  it('answers an impossible username without calling GitHub', async () => {
    const github = stubGitHub()

    const response = await get('/api?username=not%20a%20login')

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toContain('user not found')
    expect(github.calls).toBe(0)
  })

  it('answers a username GitHub does not know with a card', async () => {
    stubGitHub({
      respond: (kind) =>
        kind === 'bootstrap'
          ? { errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a User' }] }
          : undefined,
    })

    const response = await get('/api?username=definitelynotarealaccount')

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toContain('user not found')
  })

  it('answers an upstream failure with a card', async () => {
    stubGitHub({ status: 502, respond: () => ({ errors: [{ message: 'bad gateway' }] }) })

    const response = await get('/api?username=someone')

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toContain('upstream error')
  })

  it('tells a rate-limited reader how long to wait', async () => {
    stubGitHub({
      status: 403,
      headers: { 'x-ratelimit-remaining': '0' },
      respond: () => ({ errors: [{ type: 'RATE_LIMITED' }] }),
    })

    const response = await get('/api?username=someone')
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(body).toMatch(/rate limited, retry in \d+m/)
  })

  it('caches a failure for a minute, not for the full card lifetime', async () => {
    const response = await get('/api')

    expect(response.headers.get('cache-control')).toBe('public, max-age=60')
  })

  it('says so plainly when the deployment has no token', async () => {
    const { GITHUB_TOKEN: _unset, ...unconfigured } = testEnv

    const response = await worker.fetch(
      new Request('https://stats.example.com/api?username=rondrft'),
      unconfigured,
    )

    await expect(response.text()).resolves.toContain('GITHUB_TOKEN is not set')
  })
})

describe('cards', () => {
  it('renders a card and reports the cache miss', async () => {
    stubGitHub()

    const response = await get('/api?username=cachemiss')
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('x-cache')).toBe('MISS')
    expect(response.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=1800, s-maxage=1800, stale-while-revalidate=86400',
    )
    expect(body.startsWith('<svg')).toBe(true)
    expect(body).toContain('contributions')
  })

  it('serves the second request for the same profile from the cache', async () => {
    const github = stubGitHub()

    const first = await get('/api?username=cachehit')
    const callsAfterFirst = github.calls
    const second = await get('/api?username=cachehit')

    expect(first.headers.get('x-cache')).toBe('MISS')
    expect(second.headers.get('x-cache')).toBe('HIT')
    expect(github.calls).toBe(callsAfterFirst)
  })

  /**
   * The reason the cache stores data rather than rendered SVG: a second reader
   * asking for a different theme must not cost another round of API calls, and
   * must still get a card painted in the theme they asked for.
   */
  it('reuses one cache entry across themes', async () => {
    const github = stubGitHub()

    const phosphor = await get('/api?username=themed')
    const callsAfterFirst = github.calls

    const amber = await get('/api?username=themed&theme=amber')
    const ice = await get('/api?username=themed&theme=ice&radius=0&animate=false&locale=es')

    // Neither variant went upstream.
    expect(phosphor.headers.get('x-cache')).toBe('MISS')
    expect(amber.headers.get('x-cache')).toBe('HIT')
    expect(ice.headers.get('x-cache')).toBe('HIT')
    expect(github.calls).toBe(callsAfterFirst)

    // Each was nonetheless rendered fresh, from the one set of cached figures.
    await expect(amber.text()).resolves.toContain('#0F0A02')
    const iceBody = await ice.text()
    expect(iceBody).toContain('#050B14')
    expect(iceBody).toContain('contribuciones')
    expect(iceBody).not.toContain('<style>')
  })

  /**
   * KV holds figures, not pixels, so a release that changes the renderer takes
   * effect on the next request rather than waiting out a TTL. What it cannot
   * reach is the copy Camo and the reader's browser are holding, which is
   * governed by `Cache-Control` and documented as a known limitation.
   */
  it('re-renders a cached profile on every request', async () => {
    const github = stubGitHub()

    await get('/api?username=rerendered')
    const callsAfterFirst = github.calls
    const hidden = await get('/api?username=rerendered&show_credit=true')

    expect(hidden.headers.get('x-cache')).toBe('HIT')
    expect(github.calls).toBe(callsAfterFirst)
    // A render-only parameter changed the output of a cache hit, which it could
    // not do if the entry held a finished document.
    await expect(hidden.text()).resolves.toContain('>gstats<')
  })

  it('refetches when a parameter changes which data is needed', async () => {
    const github = stubGitHub()

    await get('/api?username=shape')
    const callsAfterFirst = github.calls
    // Hiding a module skips its query, so this genuinely fetches something else.
    const narrower = await get('/api?username=shape&hide=langs')

    expect(narrower.headers.get('x-cache')).toBe('MISS')
    expect(github.calls).toBeGreaterThan(callsAfterFirst)
  })

  /**
   * The counterpart, and the reason the language parameters left the cache key:
   * they rank data that has already been fetched, so asking for a different
   * ranking must not cost the shared GitHub quota anything at all.
   */
  it('reranks languages without going back to GitHub', async () => {
    const github = stubGitHub()

    await get('/api?username=reranked')
    const callsAfterFirst = github.calls

    for (const variant of [
      'langs_count=8',
      'lang_mode=repos',
      'exclude_langs=typescript',
      'include_langs=css',
    ]) {
      const response = await get(`/api?username=reranked&${variant}`)
      expect(response.headers.get('x-cache'), variant).toBe('HIT')
    }

    expect(github.calls).toBe(callsAfterFirst)
  })

  it('batches every historical year into a single extra request', async () => {
    const github = stubGitHub()

    await get('/api?username=batched')

    // One bootstrap, one batched history query, one page of languages. An
    // account opened in 2019 must not cost one request per year.
    expect(github.calls).toBe(3)
  })

  it('skips the language query when the module is hidden', async () => {
    const github = stubGitHub()

    await get('/api?username=nolangs&hide=langs')

    expect(github.calls).toBe(2)
  })

  it('computes the streak from the calendar it was given', async () => {
    stubGitHub()

    const body = await (await get('/api?username=streaky')).text()
    const expected = formatRange(fixtureDay(-5), fixtureDay(0))

    // The fixture calendar covers the last seven days with a zero only on the
    // oldest of them, so the streak is the six days that follow it.
    expect(body).toContain('current streak')
    expect(body).toContain('>6<')
    expect(body).toContain(expected)
  })
})

/**
 * A reader used to wait for both caches in series — up to four hours between a
 * commit and a card. They are separate levers and are now set separately: the
 * response expires quickly so Camo comes back often, and KV stays fresh for
 * hours so those returns cost nothing upstream.
 */
describe('the two caches are independent', () => {
  it('serves a card that expires long before its data does', async () => {
    stubGitHub()

    const response = await get('/api?username=layered')
    const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1])

    expect(maxAge).toBe(1800)
    expect(KV_FRESH_SECONDS).toBeGreaterThan(maxAge)
  })

  /**
   * The acceptance test for the whole arrangement: once `max-age` lapses, Camo
   * asks again, and that revalidation must not reach GitHub.
   */
  it('answers a revalidation from KV without calling GitHub', async () => {
    const github = stubGitHub()

    await get('/api?username=revalidated')
    const callsAfterFirst = github.calls
    expect(callsAfterFirst).toBeGreaterThan(0)

    // Camo returning after max-age lapsed is just another request; the entry it
    // meets is still well inside its six hours.
    for (let revalidation = 0; revalidation < 5; revalidation += 1) {
      const response = await get('/api?username=revalidated')
      expect(response.headers.get('x-cache')).toBe('HIT')
    }

    expect(github.calls).toBe(callsAfterFirst)
  })

  it('lets an instance raise max-age without a code change', async () => {
    stubGitHub()

    const response = await worker.fetch(
      new Request('https://stats.example.com/api?username=configured'),
      { ...testEnv, CARD_MAX_AGE: '3600' },
    )

    expect(response.headers.get('cache-control')).toContain('max-age=3600')
  })

  it('clamps a configured value into the range the floor protects', async () => {
    stubGitHub()

    const tooLow = await worker.fetch(
      new Request('https://stats.example.com/api?username=clamped'),
      { ...testEnv, CARD_MAX_AGE: '5' },
    )

    expect(tooLow.headers.get('cache-control')).toContain('max-age=1800')
  })

  it('still honours a per-card override', async () => {
    stubGitHub()

    const response = await get('/api?username=overridden&cache_seconds=7200')

    expect(response.headers.get('cache-control')).toContain('max-age=7200')
  })
})

describe('POST /purge', () => {
  const purge = (query: string, headers: Record<string, string> = {}) =>
    worker.fetch(
      new Request(`https://stats.example.com/purge?${query}`, { method: 'POST', headers }),
      { ...testEnv, PURGE_TOKEN: 's3cret' },
    )

  const authorised = { authorization: 'Bearer s3cret' }

  it('refuses a request with no token', async () => {
    const response = await purge('username=octocat')

    expect(response.status).toBe(401)
    expect(response.headers.get('content-type')).toContain('application/json')
  })

  it('refuses a wrong token, and a malformed header', async () => {
    for (const header of [
      { authorization: 'Bearer wrong' },
      { authorization: 's3cret' },
      { authorization: 'Basic s3cret' },
      { authorization: 'Bearer ' },
    ]) {
      expect((await purge('username=octocat', header)).status).toBe(401)
    }
  })

  /** Scripts call this, and a script cannot read an SVG. */
  it('answers JSON, never a card', async () => {
    const response = await purge('username=octocat', authorised)
    const body = await response.text()

    expect(response.headers.get('content-type')).toContain('application/json')
    expect(body.startsWith('<svg')).toBe(false)
    expect(JSON.parse(body)).toMatchObject({ username: 'octocat' })
  })

  it('rejects a username GitHub could not have issued', async () => {
    expect((await purge('username=not%20a%20login', authorised)).status).toBe(400)
    expect((await purge('', authorised)).status).toBe(400)
  })

  it('says so plainly when the instance has no purge token', async () => {
    const response = await worker.fetch(
      new Request('https://stats.example.com/purge?username=octocat', { method: 'POST' }),
      testEnv,
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('PURGE_TOKEN'),
    })
  })

  it('refuses anything but POST', async () => {
    const response = await worker.fetch(
      new Request('https://stats.example.com/purge?username=octocat'),
      { ...testEnv, PURGE_TOKEN: 's3cret' },
    )

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
  })

  /** The behaviour the endpoint exists for. */
  it('makes the next request a miss, and only the next one', async () => {
    const github = stubGitHub()

    const first = await get('/api?username=purged')
    const cached = await get('/api?username=purged')
    const callsBeforePurge = github.calls

    const purgeResponse = await purge('username=purged', authorised)
    const after = await get('/api?username=purged')
    const afterThat = await get('/api?username=purged')

    expect(first.headers.get('x-cache')).toBe('MISS')
    expect(cached.headers.get('x-cache')).toBe('HIT')
    expect(purgeResponse.status).toBe(200)
    await expect(purgeResponse.json()).resolves.toMatchObject({ purged: 1 })

    expect(after.headers.get('x-cache')).toBe('MISS')
    expect(afterThat.headers.get('x-cache')).toBe('HIT')
    expect(github.calls).toBeGreaterThan(callsBeforePurge)
  })

  /**
   * A login has one entry per combination of the parameters that shape what is
   * fetched, so purging has to clear all of them or the reader still sees an
   * old card at whichever URL they actually used.
   */
  it('clears every variant of a login, not just one', async () => {
    stubGitHub()

    await get('/api?username=variants')
    await get('/api?username=variants&hide=langs')
    await get('/api?username=variants&tz=Pacific/Auckland')

    const response = await purge('username=variants', authorised)

    await expect(response.json()).resolves.toMatchObject({ purged: 3 })
  })

  it('leaves other logins alone', async () => {
    stubGitHub()

    await get('/api?username=keeper')
    await purge('username=someoneelse', authorised)

    expect((await get('/api?username=keeper')).headers.get('x-cache')).toBe('HIT')
  })

  it('reports nothing purged when there was nothing cached', async () => {
    const response = await purge('username=neverseen', authorised)

    await expect(response.json()).resolves.toMatchObject({ purged: 0 })
  })

  it('does not call GitHub — the next reader pays for that', async () => {
    const github = stubGitHub()

    await get('/api?username=nofetch')
    const callsAfterFirst = github.calls
    await purge('username=nofetch', authorised)

    expect(github.calls).toBe(callsAfterFirst)
  })

  /**
   * Its own token, because the counter is per token and the suite shares one
   * KV namespace — an allowance already spent by the tests above would make
   * this measure the leftovers instead of the limit.
   */
  it('brakes a runaway caller at ten a minute', async () => {
    const token = 'runaway-token'
    const hammer = () =>
      worker.fetch(
        new Request('https://stats.example.com/purge?username=hammered', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        }),
        { ...testEnv, PURGE_TOKEN: token },
      )

    const statuses: number[] = []
    for (let attempt = 0; attempt < 13; attempt += 1) {
      statuses.push((await hammer()).status)
    }

    expect(statuses.filter((status) => status === 200)).toHaveLength(PURGE_LIMIT_PER_MINUTE)
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0)
    // The refusals come after the allowance, not interleaved with it.
    expect(statuses.slice(0, PURGE_LIMIT_PER_MINUTE).every((status) => status === 200)).toBe(true)
  })
})

/**
 * The step that turns a quota problem into an outage. Entries survive seven days
 * against six hours of freshness precisely so that when GitHub is unreachable
 * there is still something correct to serve — a card a few hours behind beats an
 * error card, every time.
 */
describe('stale-while-error', () => {
  const breakUpstream = (kind: 'rate-limited' | 'server' | 'network') => {
    if (kind === 'rate-limited') {
      return stubGitHub({
        status: 403,
        headers: { 'x-ratelimit-remaining': '0' },
        respond: () => ({ errors: [{ type: 'RATE_LIMITED' }] }),
      })
    }
    if (kind === 'server') {
      return stubGitHub({ status: 502, respond: () => ({ errors: [{ message: 'bad gateway' }] }) })
    }
    const dead = vi.fn(() => Promise.reject(new Error('connection reset')))
    vi.stubGlobal('fetch', dead)
    return {
      fetch: dead,
      get calls() {
        return dead.mock.calls.length
      },
    }
  }

  /**
   * Freshness is six hours, so reaching the failure path means being past it.
   * Moving the clock is the only honest way to get there — an entry that is
   * still fresh is answered from KV and never attempts a fetch at all.
   */
  const afterFreshness = () => {
    const later = Date.now() + (KV_FRESH_SECONDS + 3600) * 1000
    vi.spyOn(Date, 'now').mockReturnValue(later)
  }

  it.each(['rate-limited', 'server', 'network'] as const)(
    'serves the expired entry when GitHub fails with a %s error',
    async (kind) => {
      const login = `stale${kind.replace('-', '')}`
      stubGitHub()
      expect((await get(`/api?username=${login}`)).headers.get('x-cache')).toBe('MISS')

      vi.unstubAllGlobals()
      afterFreshness()
      breakUpstream(kind)

      const response = await get(`/api?username=${login}`)
      const body = await response.text()

      expect(response.status).toBe(200)
      expect(response.headers.get('x-cache')).toBe('STALE')
      expect(response.headers.get('x-stale')).toBe('true')
      expect(response.headers.get('cache-control')).toBe('public, max-age=600')
      // A real card, not the failure card.
      expect(body).toContain('contributions')
      expect(body).not.toContain('upstream error')
      expect(body).not.toContain('rate limited')
    },
  )

  /**
   * `stale-while-revalidate` would let Camo keep showing the stale card past
   * even the ten minutes, which is the opposite of what is wanted while the
   * service is trying to recover.
   */
  it('does not tell clients to hold a stale card beyond its own lifetime', async () => {
    stubGitHub()
    await get('/api?username=staleswr')
    vi.unstubAllGlobals()
    afterFreshness()
    breakUpstream('server')

    const response = await get('/api?username=staleswr')

    expect(response.headers.get('x-cache')).toBe('STALE')
    expect(response.headers.get('cache-control')).not.toContain('stale-while-revalidate')
  })

  it('falls through to the error card only when nothing is cached', async () => {
    breakUpstream('server')

    const response = await get('/api?username=nothingcached')

    expect(response.status).toBe(200)
    expect(response.headers.get('x-stale')).toBeNull()
    await expect(response.text()).resolves.toContain('upstream error')
  })

  it('marks a healthy card as neither stale nor cached-from-error', async () => {
    stubGitHub()

    const response = await get('/api?username=healthy')

    expect(response.headers.get('x-stale')).toBeNull()
    expect(response.headers.get('cache-control')).toContain('stale-while-revalidate')
  })
})
