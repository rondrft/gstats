import { env } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker, { type Env } from '../src/index'
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
})

describe('routing', () => {
  it('serves the landing page at the root', async () => {
    const response = await get('/')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    await expect(response.text()).resolves.toContain('phosphor-stats')
  })

  it('reports its own state at /health', async () => {
    const response = await get('/health')
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.tokenConfigured).toBe(true)
    expect(body).toHaveProperty('rateLimit')
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
      'public, max-age=7200, s-maxage=7200, stale-while-revalidate=86400',
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
   * asking for a different theme must not cost another round of API calls.
   */
  it('reuses the cached data across styles', async () => {
    const github = stubGitHub()

    await get('/api?username=themed')
    const callsAfterFirst = github.calls
    const themed = await get('/api?username=themed&theme=amber&radius=0&animate=false')

    expect(themed.headers.get('x-cache')).toBe('HIT')
    expect(github.calls).toBe(callsAfterFirst)
    await expect(themed.text()).resolves.toContain('#0F0A02')
  })

  it('refetches when a parameter changes which data is needed', async () => {
    const github = stubGitHub()

    await get('/api?username=shape')
    const callsAfterFirst = github.calls
    const narrower = await get('/api?username=shape&langs_count=2')

    expect(narrower.headers.get('x-cache')).toBe('MISS')
    expect(github.calls).toBeGreaterThan(callsAfterFirst)
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
