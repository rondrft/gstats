/**
 * The project's identity, served from the Worker.
 *
 * A Worker has no static file server, so anything the landing page references
 * has to arrive from a route. The files themselves stay real files under
 * `assets/brand/` — the README points at the same ones GitHub renders — and
 * Wrangler bundles them through the module rules in `wrangler.toml`. Nothing is
 * base64 in a source file, and there is still no build step.
 *
 * Only what the landing page asks for is bundled. `logo-512.png` and
 * `social-preview.png` live in the repo for use outside the Worker: the first
 * for wherever a raster logo is needed, the second for GitHub's repository
 * social preview, which is uploaded by hand in the repository settings.
 *
 * These are the only responses the service serves that will never change for a
 * given URL, so they are the only ones that get a year and `immutable`. A card
 * is a live figure and is cached in half hours; an icon is a constant. If one
 * ever does change, it changes under a new name.
 */

import faviconSvg from '../assets/brand/favicon.svg'
import favicon32Png from '../assets/brand/favicon-32.png'
import favicon180Png from '../assets/brand/favicon-180.png'
import logoSvg from '../assets/brand/logo.svg'

/** A year, and a promise not to revalidate within it. */
const IMMUTABLE = 'public, max-age=31536000, immutable'

const SVG = 'image/svg+xml; charset=utf-8'
const PNG = 'image/png'

interface BrandAsset {
  body: string | ArrayBuffer
  contentType: string
}

/**
 * Path to file. Flat and explicit rather than derived from the directory: these
 * are public URLs, and a public URL should not move because somebody renamed a
 * file.
 */
const ASSETS: Record<string, BrandAsset> = {
  '/favicon.svg': { body: faviconSvg, contentType: SVG },
  '/favicon-32.png': { body: favicon32Png, contentType: PNG },
  '/favicon-180.png': { body: favicon180Png, contentType: PNG },
  '/logo.svg': { body: logoSvg, contentType: SVG },
}

/** The paths this module answers, for the router and for the tests to iterate. */
export const BRAND_PATHS = Object.keys(ASSETS)

/**
 * The asset at a path, or null if this is not one of ours.
 *
 * Returning null rather than a 404 keeps the routing decision in one place:
 * `index.ts` owns what an unknown path means.
 */
export function brandAsset(pathname: string): Response | null {
  const asset = ASSETS[pathname]
  if (asset === undefined) return null

  return new Response(asset.body, {
    headers: { 'content-type': asset.contentType, 'cache-control': IMMUTABLE },
  })
}
