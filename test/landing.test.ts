import { describe, expect, it } from 'vitest'
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
