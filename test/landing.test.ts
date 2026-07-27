import { describe, expect, it } from 'vitest'
import { BRAND_PATHS } from '../src/brand'
import { landingPage } from '../src/landing'
import { CARD_IDS } from '../src/render/cards/registry'
import { THEME_NAMES } from '../src/render/themes'

const page = landingPage('https://stats.example.com')

/** The single inline script, which is the whole behaviour of the page. */
const script = /<script>([\s\S]*?)<\/script>/.exec(page)?.[1] ?? ''

describe('landing page', () => {
  /**
   * The page is a template literal inside a template literal. A stray backtick
   * or `${` in the embedded script is a syntax error that ships silently — the
   * HTML still renders, and every control simply stops working.
   */
  it('embeds a script that parses', () => {
    expect(script.length).toBeGreaterThan(0)
    expect(() => new Function(script)).not.toThrow()
  })

  /**
   * A shared link with no tags is a blank rectangle, which reads as a dead link
   * rather than as a page nobody wrote tags for. Every scraper needs the image
   * absolute, which is the part that silently degrades if somebody makes it
   * relative later.
   */
  it('carries the sharing tags every network reads', () => {
    const meta = (attribute: string, name: string) =>
      new RegExp(`<meta ${attribute}="${name}" content="([^"]+)"`).exec(page)?.[1]

    expect(meta('property', 'og:type')).toBe('website')
    expect(meta('property', 'og:title')).toContain('phosphor-stats')
    expect(meta('property', 'og:description')?.length ?? 0).toBeGreaterThan(30)
    expect(meta('property', 'og:url')).toBe('https://stats.example.com/')
    expect(meta('name', 'twitter:card')).toBe('summary_large_image')

    for (const image of [meta('property', 'og:image'), meta('name', 'twitter:image')]) {
      expect(image).toMatch(/^https:\/\//)
      expect(image).toContain('social-preview.png')
    }
  })

  /** The page advertises the instance it was served from, not this one. */
  it('takes og:url from the origin the request arrived on', () => {
    expect(landingPage('https://stats.example.org')).toContain(
      '<meta property="og:url" content="https://stats.example.org/">',
    )
  })

  /** Inlining it would put the file's gradient ids in the page's own document. */
  it('wears the logo beside the title, from a route rather than inlined', () => {
    expect(page).toContain('<img class="mark" src="/logo.svg"')
    expect(BRAND_PATHS).toContain('/logo.svg')
    expect(page).not.toContain('linearGradient')
  })

  it('points at icons the Worker actually serves', () => {
    const hrefs = [...page.matchAll(/<link rel="[^"]*icon"[^>]*href="([^"]+)"/g)].map(
      (match) => match[1],
    )

    expect(hrefs.length).toBeGreaterThan(0)
    for (const href of hrefs) {
      expect(BRAND_PATHS, `${href} is linked but not served`).toContain(href)
    }
  })

  it('offers every published design and every theme', () => {
    for (const id of CARD_IDS) {
      expect(page).toContain(`data-card="${id}"`)
      expect(page).toContain(`<option value="${id}">`)
    }
    for (const theme of THEME_NAMES) {
      expect(page).toContain(`data-theme-preview="${theme}"`)
    }
  })

  /**
   * Two axes cannot be a flat grid: six designs times six themes is thirty-six
   * cards nobody scrolls through. One design at a time, six themes beneath it.
   */
  it('repaints every theme preview when the design changes', () => {
    expect(script).toContain('data-theme-preview')
    expect(script).toContain('repaintGallery')
    expect(script).toMatch(/designs\.addEventListener\('click'/)
  })

  it('loads a chosen pairing into the generator', () => {
    expect(script).toContain("document.getElementById('card').value = galleryCard")
    expect(script).toContain('data-theme')
  })

  it('leaves defaults out of the generated snippet', () => {
    // A snippet full of redundant parameters is harder to read and to hand-edit.
    expect(script).toContain("if (value('card') !== 'terminal')")
    expect(script).toContain("if (theme !== 'phosphor')")
    expect(script).toContain("if (value('lang_mode') !== 'bytes')")
  })

  it('references no script or stylesheet it cannot serve itself', () => {
    expect(page).not.toMatch(/<script[^>]+src=/)
    expect(page).not.toMatch(/<link[^>]+stylesheet/)
  })
})

/**
 * The top of the page used to read as a pile of unrelated blocks while the
 * bottom read as a structured set, and the difference was that the bottom put
 * everything in a bordered container and the top did not. These pin the rules
 * that closed the gap.
 */
describe('visual structure', () => {
  it('defines the panel once and uses it for every container', () => {
    expect(page).toMatch(/\.panel \{/)

    // Hero card, controls, preview, snippet, reference, and one per theme cell.
    const uses = page.match(/class="[^"]*\bpanel\b/g) ?? []
    expect(uses.length).toBeGreaterThanOrEqual(5 + THEME_NAMES.length)

    for (const container of [
      'hero-card',
      'controls',
      'preview-card',
      'snippet',
      'reference',
      'gallery-card',
    ]) {
      expect(page).toMatch(new RegExp(`class="panel ${container}"`))
    }
  })

  it('spaces everything from two variables and nothing else', () => {
    const stylesheet = /<style>([\s\S]*?)<\/style>/.exec(page)?.[1] ?? ''

    expect(stylesheet).toContain('--gap:')
    expect(stylesheet).toContain('--section:')

    // Any rem-valued margin or gap that is not one of the two, or a fraction of
    // a line, is the kind of one-off that made the rhythm unreadable.
    // The two definitions themselves are not strays; anything else is.
    const strays = [
      ...stylesheet.matchAll(/(?<!-)\b(?:margin|gap|margin-top|margin-bottom):\s*([\d.]+)rem/g),
    ]
      .map((match) => Number(match[1]))
      .filter((value) => value > 0.5)

    expect(strays).toEqual([])
  })

  it('gives every colour picker a label and a way back to the theme', () => {
    for (const id of ['ring', 'accent', 'bg']) {
      expect(page).toMatch(new RegExp(`<label for="${id}">`))
    }
    expect(page).toContain('id="reset-colors"')
    expect(script).toContain('adoptThemeColors')
  })

  /**
   * The snippet was a single scrolling line with the copy button sitting on top
   * of the text. A long URL is the normal case here, not the exception.
   */
  it('wraps the snippet instead of scrolling it, clear of the copy button', () => {
    const stylesheet = /<style>([\s\S]*?)<\/style>/.exec(page)?.[1] ?? ''

    expect(page).toMatch(/<textarea id="markdown"[^>]*rows="2"/)
    expect(stylesheet).toContain('white-space: pre-wrap')

    const padding = /padding:\s*[\d.]+rem\s+([\d.]+)rem/.exec(
      /textarea \{([\s\S]*?)\}/.exec(stylesheet)?.[1] ?? '',
    )
    // Wider than the button, which is absolutely positioned over that corner.
    expect(Number(padding?.[1] ?? 0)).toBeGreaterThan(3)
  })

  it('fills the column beside the controls with a reference table', () => {
    expect(page).toContain('class="panel reference"')
    expect(page).toContain('<code>hide</code>')
    expect(page).toContain('<code>cache_seconds</code>')
  })
})
