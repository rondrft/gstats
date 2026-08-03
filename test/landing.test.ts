import { describe, expect, it } from 'vitest'
import { BRAND_PATHS } from '../src/brand'
import { landingPage } from '../src/landing'
import { DEFAULTS, LIMITS } from '../src/params'
import { CARD_IDS, LANGS_CEILING, MAX_LANGUAGES } from '../src/render/cards/registry'
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
    expect(meta('property', 'og:title')).toContain('gstats')
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

  /**
   * The snippet is the one thing on this page that ends up in somebody else's
   * README, so both forms are pinned. HTML is offered first because it is the one
   * that gives the card a link; markdown is the same card with nothing round it,
   * which is also the answer to "what if I do not want the link".
   */
  it('offers both snippet forms, with the linked one first', () => {
    expect(page).toContain('data-format="html" class="on"')
    expect(page).toContain('data-format="markdown"')
    expect(script).toContain("var format = 'html'")

    expect(script).toContain(`'<a href="' + repo + '"><img alt="'`)
    expect(script).toContain(`return '![' + alt + '](' + url + ')'`)
  })

  /**
   * Both forms are built from the one URL the controls produced, so `hide`, the
   * colour overrides and everything else are in the snippet whichever is showing.
   */
  it('builds both forms from the URL the controls produced', () => {
    expect(script).toContain('snippet.value = snippetFor(origin + path, username)')
    expect(script).toContain('navigator.clipboard.writeText(snippet.value)')
  })

  /**
   * The username is whatever somebody typed and it lands inside an attribute in
   * what they are about to paste. Nothing is injected into this page, so this is
   * about handing over a snippet that is well formed rather than about XSS here.
   */
  it('escapes what it writes into an HTML attribute', () => {
    for (const rule of [`replace(/&/g, '&amp;')`, `replace(/"/g, '&quot;')`]) {
      expect(script).toContain(rule)
    }
    expect(script).toContain('attribute(alt)')
    expect(script).toContain('attribute(url)')
  })

  it('leaves defaults out of the generated snippet', () => {
    // A snippet full of redundant parameters is harder to read and to hand-edit.
    expect(script).toContain("if (value('card') !== 'terminal')")
    expect(script).toContain("if (theme !== 'phosphor')")
    expect(script).toContain("if (value('lang_mode') !== 'bytes')")
  })

  /**
   * The count was a free text field, which invites a value the service will
   * quietly clamp — and a control that accepts what the service will not honour
   * is part of why a card drawing three languages for six read as a bug. Every
   * option here is a value some design can actually draw.
   */
  it('offers the count as a dropdown over the range the service supports', () => {
    expect(page).not.toMatch(/<input[^>]+id="langs_count"/)
    expect(page).toMatch(/<select id="langs_count">/)

    const control = /<select id="langs_count">([\s\S]*?)<\/select>/.exec(page)?.[1] ?? ''
    const offered = [...control.matchAll(/<option value="(\d+)"/g)].map((match) => Number(match[1]))

    expect(offered).toEqual(Array.from({ length: LIMITS.langsCount.max }, (_, index) => index + 1))
    expect(LIMITS.langsCount.max).toBe(LANGS_CEILING)
    expect(control).toContain(`<option value="${DEFAULTS.langsCount}" selected>`)
  })

  /**
   * Three designs draw fewer than the largest does, and the page has to say so
   * before somebody picks a number the card will not honour — that shortfall
   * was invisible everywhere: on the card, in the table, and in this control.
   */
  it('narrows the count to what the chosen design draws, and says so', () => {
    expect(script).toContain(`var LANG_CEILINGS = ${JSON.stringify(MAX_LANGUAGES)}`)
    expect(script).toContain("var ceiling = LANG_CEILINGS[value('card')]")
    expect(script).toContain('langsCount.disabled = ceiling === 0')
    expect(page).toContain('id="langs_hint"')

    // The other half of the shortfall, and the one no ceiling explains.
    expect(script).toContain('under 0.5%')
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
   * of the text. A long URL is the normal case here, not the exception — and the
   * HTML form is longer than the markdown one it replaced, so it needs the room.
   */
  it('wraps the snippet instead of scrolling it', () => {
    const stylesheet = /<style>([\s\S]*?)<\/style>/.exec(page)?.[1] ?? ''

    expect(page).toMatch(/<textarea id="snippet"[^>]*rows="3"/)
    expect(stylesheet).toContain('white-space: pre-wrap')

    // The copy button used to float over the box's top right corner, which is
    // why the text reserved four and a half rem of it. It sits in a row of its
    // own now, with the format toggle, so nothing overlaps the text.
    expect(stylesheet).toContain('.snippet-bar {')
    expect(stylesheet).not.toContain('.snippet button { position: absolute')
  })

  it('fills the column beside the controls with a reference table', () => {
    expect(page).toContain('class="panel reference"')
    expect(page).toContain('<code>hide</code>')
    expect(page).toContain('<code>cache_seconds</code>')
  })
})

/**
 * The generator repaints the preview by assigning to an `<img>` src, and that
 * is a card request. `input` fires on every keystroke, so typing a login used to
 * fetch a card for every prefix of it — and most prefixes of a real login are
 * themselves real logins, so each one became a cache entry, three to five GitHub
 * queries and a KV write against the scarcest resource the service has.
 *
 * A textual assertion would not catch this coming back, so the script is run.
 */
interface Fired {
  srcWrites: string[]
  type: (text: string) => void
  advance: (ms: number) => void
  /** Sets a control and fires the change the form listens for. */
  choose: (id: string, value: string) => void
  read: (id: string) => Record<string, unknown>
  snippet: () => string
}

/**
 * The page's script against a stub DOM.
 *
 * Shared by the two things worth running rather than reading: the debounce, and
 * the language count narrowing itself to the chosen design. Both are behaviour
 * that a textual assertion would keep passing after it broke.
 */
function run(): Fired {
  const srcWrites: string[] = []
  const handlers: Record<string, ((event: unknown) => void)[]> = {}
  let clock = 0
  const timers: { at: number; id: number; run: () => void }[] = []
  let nextTimer = 1

  const node = (id: string) => {
    // The count is a `<select>`, so it has options for the script to narrow.
    const options =
      id === 'langs_count'
        ? Array.from({ length: LIMITS.langsCount.max }, (_, index) => ({
            value: String(index + 1),
            hidden: false,
            disabled: false,
          }))
        : []

    const self: Record<string, unknown> = {
      value: id === 'username' ? 'rondrft' : id === 'langs_count' ? '4' : '',
      checked: id !== 'credit' && id !== 'bars',
      addEventListener: (type: string, fn: (event: unknown) => void) => {
        if (id !== 'controls') return
        handlers[type] ??= []
        handlers[type].push(fn)
      },
      querySelectorAll: () => options,
      getAttribute: () => null,
      closest: () => null,
    }
    if (id === 'card') self.value = 'terminal'
    if (id === 'theme') self.value = 'phosphor'
    if (id === 'locale') self.value = 'en'
    if (id === 'lang_mode') self.value = 'bytes'
    if (['ring', 'accent', 'bg'].includes(id)) self.value = '#000000'
    if (id === 'preview') {
      Object.defineProperty(self, 'src', {
        set: (next: string) => srcWrites.push(next),
        get: () => srcWrites.at(-1) ?? '',
      })
    }
    return self
  }

  const cache = new Map<string, unknown>()
  const documentStub = {
    getElementById: (id: string) => {
      if (!cache.has(id)) cache.set(id, node(id))
      return cache.get(id)
    },
  }

  const setTimeoutStub = (fn: () => void, ms: number) => {
    const id = nextTimer++
    timers.push({ at: clock + ms, id, run: fn })
    return id
  }
  const clearTimeoutStub = (id: number) => {
    const index = timers.findIndex((timer) => timer.id === id)
    if (index >= 0) timers.splice(index, 1)
  }

  new Function('document', 'setTimeout', 'clearTimeout', script)(
    documentStub,
    setTimeoutStub,
    clearTimeoutStub,
  )

  const fire = (type: string) => {
    for (const fn of handlers[type] ?? []) fn({})
  }

  return {
    srcWrites,
    type: (text: string) => {
      const field = documentStub.getElementById('username') as { value: string }
      field.value = text
      fire('input')
    },
    choose: (id: string, value: string) => {
      ;(documentStub.getElementById(id) as { value: string }).value = value
      fire('change')
    },
    read: (id: string) => documentStub.getElementById(id) as Record<string, unknown>,
    snippet: () => String((documentStub.getElementById('snippet') as { value: string }).value),
    advance: (ms: number) => {
      clock += ms
      // Only the due ones. Draining the whole queue would fire the pending
      // debounce early and the test would pass on a page that never debounced.
      const due = timers.filter((timer) => timer.at <= clock)
      for (const timer of due) timers.splice(timers.indexOf(timer), 1)
      for (const timer of due) timer.run()
    },
  }
}

describe('the preview does not fire on every keystroke', () => {
  it('collapses a typed login into one request instead of one per prefix', () => {
    const page = run()

    // What a visitor typing "bautista-diaz" produced: b, ba, bau, ...
    const login = 'bautista-diaz'
    for (let cut = 1; cut <= login.length; cut += 1) {
      page.type(login.slice(0, cut))
      page.advance(120) // faster than the debounce, as typing is
    }

    expect(page.srcWrites).toHaveLength(0)

    page.advance(1000)
    expect(page.srcWrites).toHaveLength(1)
    expect(page.srcWrites[0]).toContain(`username=${login}`)
  })

  /** Colours are not in the cache key, so redrawing for one is a wasted call. */
  it('does not refetch a card it is already showing', () => {
    const page = run()

    page.type('octocat')
    page.advance(1000)
    expect(page.srcWrites).toHaveLength(1)

    page.type('octocat')
    page.advance(1000)
    expect(page.srcWrites).toHaveLength(1)
  })
})

/**
 * The control that made the shortfall invisible. A free text field accepted six
 * for a design that draws three, the service clamped it in silence, and nothing
 * between the two ever said so. Run rather than read: a dropdown whose options
 * are correct in the markup and never narrowed is the same bug with a nicer
 * appearance.
 */
describe('the language count is narrowed to the chosen design', () => {
  it('offers only what the design draws, and clamps a value beyond it', () => {
    const page = run()
    const control = page.read('langs_count')
    const optionsBeyond = (ceiling: number) =>
      (
        control.querySelectorAll as () => { value: string; hidden: boolean; disabled: boolean }[]
      )().filter((option) => Number(option.value) > ceiling)

    page.choose('langs_count', '6')
    expect(page.snippet()).toContain('langs_count=6')
    for (const option of optionsBeyond(MAX_LANGUAGES.terminal)) {
      expect(option.disabled).toBe(false)
    }

    // The vinyl lists three. The six the user had chosen is not one of its
    // options any more, and the value comes down with it.
    page.choose('card', 'vinyl')
    expect(control.value).toBe(String(MAX_LANGUAGES.vinyl))
    for (const option of optionsBeyond(MAX_LANGUAGES.vinyl)) {
      expect(option.hidden).toBe(true)
      expect(option.disabled).toBe(true)
    }

    // And three is what the vinyl would draw anyway, so it leaves the snippet.
    expect(page.snippet()).not.toContain('langs_count=')
  })

  it('disables the control for a design that draws no languages', () => {
    const page = run()

    page.choose('card', 'heatmap')

    expect(page.read('langs_count').disabled).toBe(true)
    expect(String(page.read('langs_hint').textContent)).toContain('no languages')
    expect(page.snippet()).not.toContain('langs_count=')
  })
})
