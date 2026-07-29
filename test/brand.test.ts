import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { BRAND_PATHS, brandAsset } from '../src/brand'
import worker, { type Env } from '../src/index'
import { SERVICE_NAME } from '../src/service'

const testEnv = env as unknown as Env

function fetchBrand(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return worker.fetch(new Request(`https://stats.example.com${path}`, { headers }), testEnv)
}

/**
 * A Worker has no static file server, so every icon the landing page references
 * is a route. These assert the two things that make such a route worth having
 * over a 404: the right type, so a browser renders it, and a long enough
 * lifetime that nobody fetches it twice.
 */
describe('brand routes', () => {
  it('serves every declared path', async () => {
    expect(BRAND_PATHS.length).toBeGreaterThan(0)

    for (const path of BRAND_PATHS) {
      const response = await fetchBrand(path)
      expect(response.status, path).toBe(200)
    }
  })

  it('types each one by what it actually is', async () => {
    for (const path of BRAND_PATHS) {
      const response = await fetchBrand(path)
      const expected = path.endsWith('.svg') ? 'image/svg+xml' : 'image/png'

      expect(response.headers.get('content-type'), path).toContain(expected)
    }
  })

  /** An icon is a constant. It is the only thing here that can honestly say so. */
  it('lets a client keep them for a year', async () => {
    for (const path of BRAND_PATHS) {
      const cacheControl = (await fetchBrand(path)).headers.get('cache-control')

      expect(cacheControl, path).toContain('max-age=31536000')
      expect(cacheControl, path).toContain('immutable')
    }
  })

  /** Bundled as bytes rather than base64 in a source file, so this checks bytes. */
  it('serves real files rather than empty ones', async () => {
    for (const path of BRAND_PATHS) {
      const bytes = new Uint8Array(await (await fetchBrand(path)).arrayBuffer())
      expect(bytes.byteLength, path).toBeGreaterThan(100)

      if (path.endsWith('.png')) {
        // PNG magic number. A truncated or text-mangled binary fails here
        // rather than in somebody's browser.
        expect([...bytes.slice(0, 4)], path).toEqual([0x89, 0x50, 0x4e, 0x47])
      } else {
        expect(new TextDecoder().decode(bytes), path).toContain('<svg')
      }
    }
  })

  /**
   * The icons carry the service's name as their accessible one, which is the
   * only text in them and the one thing in a binary-ish asset that a rename has
   * to reach. It missed them once.
   */
  it('calls the service by its current name', async () => {
    for (const path of BRAND_PATHS.filter((path) => path.endsWith('.svg'))) {
      const svg = await (await fetchBrand(path)).text()

      expect(svg, path).toContain(`aria-label="${SERVICE_NAME}"`)
    }
  })

  it('leaves an unknown path a 404', async () => {
    expect((await fetchBrand('/favicon.ico')).status).toBe(404)
    expect(brandAsset('/not-ours.svg')).toBeNull()
  })

  /**
   * Same reasoning as `/health` and the landing page: these are constants, they
   * cost nothing to serve, and a browser fetches the icon alongside the page
   * rather than as a separate act of traffic. Throttling them would only break
   * the tab icon of somebody who happens to share an address with a scraper.
   */
  it('is not touched by the rate limit', async () => {
    const ip = '198.51.100.7'
    const tight = { ...testEnv, API_RATE_LIMIT: '6' }

    let refused = false
    for (let attempt = 0; attempt < 12 && !refused; attempt += 1) {
      const response = await worker.fetch(
        new Request('https://stats.example.com/api?username=rondrft', {
          headers: { 'cf-connecting-ip': ip },
        }),
        tight,
      )
      refused = response.status === 429
    }
    expect(refused, 'the address should be over its limit by now').toBe(true)

    for (const path of BRAND_PATHS) {
      const response = await fetchBrand(path, { 'cf-connecting-ip': ip })
      expect(response.status, path).toBe(200)
    }
  })
})
