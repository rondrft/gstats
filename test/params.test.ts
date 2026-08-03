import { describe, expect, it } from 'vitest'
import { DEFAULTS, LIMITS, parseParams } from '../src/params'
import { LANGS_CEILING, MAX_LANGUAGES } from '../src/render/cards/registry'

function parse(query: string) {
  return parseParams(new URLSearchParams(query))
}

/** Convenience for the many cases that are expected to produce valid params. */
function parseOk(query: string) {
  const result = parse(query)
  if (!result.ok) throw new Error(`expected params, got ${result.reason}`)
  return result.params
}

describe('username', () => {
  it('accepts the shapes GitHub itself accepts', () => {
    for (const login of ['a', 'rondrft', 'a-b', 'Some-User-42', 'a'.repeat(39)]) {
      expect(parse(`username=${login}`).ok, login).toBe(true)
    }
  })

  it('rejects logins GitHub could never issue', () => {
    const rejected = [
      '-leading',
      'trailing-',
      'double--hyphen',
      'a'.repeat(40),
      'has space',
      'has.dot',
      'has_underscore',
      'ünïcode',
    ]

    for (const login of rejected) {
      const result = parse(`username=${encodeURIComponent(login)}`)
      expect(result.ok, login).toBe(false)
    }
  })

  it('distinguishes an absent username from an unusable one', () => {
    expect(parse('')).toMatchObject({ ok: false, reason: 'missing-username' })
    expect(parse('username=')).toMatchObject({ ok: false, reason: 'missing-username' })
    expect(parse('username=%20%20')).toMatchObject({ ok: false, reason: 'missing-username' })
    expect(parse('username=not+valid')).toMatchObject({ ok: false, reason: 'invalid-username' })
  })

  /**
   * The username is validated before it can reach a URL, a GraphQL variable or
   * the SVG document, so hostile values have to be rejected outright rather than
   * escaped later.
   */
  it('rejects injection attempts outright', () => {
    const attacks = [
      '"><script>alert(1)</script>',
      "'/><foreignObject>",
      '../../etc/passwd',
      'user&callback=x',
      'a"onload="alert(1)',
      '<![CDATA[x]]>',
    ]

    for (const attack of attacks) {
      const result = parse(`username=${encodeURIComponent(attack)}`)
      expect(result.ok, attack).toBe(false)
    }
  })
})

describe('colours', () => {
  it('accepts every legal hex length, with or without the hash', () => {
    const style = parseOk('username=x&bg=%23fff&text=abcd&ring=%23112233&accent=11223344').style

    expect(style.bg).toBe('#fff')
    expect(style.text).toBe('#abcd')
    expect(style.ring).toBe('#112233')
    expect(style.accent).toBe('#11223344')
  })

  it('accepts the two keywords that have no hex equivalent', () => {
    const style = parseOk('username=x&bg=transparent&border=none').style

    expect(style.bg).toBe('transparent')
    expect(style.border).toBe('none')
  })

  it('falls back to the theme rather than passing anything through', () => {
    const attacks = [
      'red"/><script>alert(1)</script>',
      '#zzz',
      'url(javascript:alert(1))',
      '#12345',
      '#1234567',
      'rgb(1,2,3)',
      '"',
    ]

    for (const attack of attacks) {
      const style = parseOk(`username=x&bg=${encodeURIComponent(attack)}`).style
      expect(style.bg, attack).toBe('#080D08')
    }
  })

  it('pairs the streak number with a custom accent instead of the theme default', () => {
    expect(parseOk('username=x').style.accentText).toBe('#FAC775')
    expect(parseOk('username=x&accent=%23ff0000').style.accentText).toBe('#ff0000')
  })
})

describe('numeric parameters', () => {
  it('clamps rather than rejecting out-of-range values', () => {
    expect(parseOk('username=x&radius=999').style.radius).toBe(24)
    expect(parseOk('username=x&radius=-5').style.radius).toBe(0)
    expect(parseOk('username=x&langs_count=99').langsCount).toBe(8)
    expect(parseOk('username=x&langs_count=0').langsCount).toBe(1)
    expect(parseOk('username=x&cache_seconds=1').maxAgeOverride).toBe(1800)
    expect(parseOk('username=x&cache_seconds=999999').maxAgeOverride).toBe(86400)
  })

  /**
   * The accepted range is the largest ceiling any design has, so that a value
   * the parser lets through is one some card can honour. The generator now only
   * offers these, which is the point: a free text field accepted anything and
   * the difference between "clamped" and "this design draws fewer" was invisible.
   */
  it('takes every value in the range and clamps to the largest design ceiling', () => {
    expect(LIMITS.langsCount.max).toBe(LANGS_CEILING)
    expect(LANGS_CEILING).toBe(Math.max(...Object.values(MAX_LANGUAGES)))

    for (let count = LIMITS.langsCount.min; count <= LIMITS.langsCount.max; count += 1) {
      expect(parseOk(`username=x&langs_count=${count}`).langsCount).toBe(count)
    }

    expect(parseOk(`username=x&langs_count=${LIMITS.langsCount.max + 1}`).langsCount).toBe(
      LIMITS.langsCount.max,
    )
  })

  it('falls back to the default when the value is not a number', () => {
    expect(parseOk('username=x&radius=nope').style.radius).toBe(DEFAULTS.radius)
    expect(parseOk('username=x&langs_count=').langsCount).toBe(DEFAULTS.langsCount)
    // An unreadable value leaves the instance default in charge rather than
    // pinning the card to a number nobody asked for.
    expect(parseOk('username=x&cache_seconds=NaN').maxAgeOverride).toBeNull()
    expect(parseOk('username=x').maxAgeOverride).toBeNull()
  })
})

describe('lists', () => {
  it('keeps only module names it knows', () => {
    const params = parseOk('username=x&hide=streak,%20langs%20,bogus,TOTAL')

    expect([...params.hide].sort()).toEqual(['langs', 'streak', 'total'])
  })

  it('lowercases excluded languages so matching is case-insensitive', () => {
    expect(parseOk('username=x&exclude_langs=HTML,%20CSS').excludeLangs).toEqual(['html', 'css'])
  })

  it('treats an empty list as no filter', () => {
    expect(parseOk('username=x&exclude_langs=,,').excludeLangs).toEqual([])
    expect([...parseOk('username=x&hide=').hide]).toEqual([])
  })
})

describe('enumerations', () => {
  it('falls back to the default theme and locale for unknown names', () => {
    expect(parseOk('username=x&theme=hacker').style.themeName).toBe('phosphor')
    expect(parseOk('username=x&locale=klingon').style.locale).toBe('en')
    expect(parseOk('username=x&lang_style=pie').style.langStyle).toBe('blocks')
  })

  it('matches theme and locale names case-insensitively', () => {
    expect(parseOk('username=x&theme=AMBER').style.themeName).toBe('amber')
    expect(parseOk('username=x&locale=ES').style.locale).toBe('es')
  })
})

describe('booleans', () => {
  it('accepts the spellings people actually type', () => {
    expect(parseOk('username=x&animate=false').style.animate).toBe(false)
    expect(parseOk('username=x&animate=0').style.animate).toBe(false)
    expect(parseOk('username=x&animate=NO').style.animate).toBe(false)
    expect(parseOk('username=x&show_credit=true').style.showCredit).toBe(true)
    // A bare flag reads as "on", which is how query strings are usually written
    // by hand.
    expect(parseOk('username=x&show_credit').style.showCredit).toBe(true)
  })

  it('ignores values it cannot interpret', () => {
    expect(parseOk('username=x&scanlines=maybe').style.scanlines).toBe(DEFAULTS.scanlines)
  })
})

describe('tz', () => {
  it('defaults to null, which the streak reads as Anywhere on Earth', () => {
    expect(parseOk('username=x').tz).toBeNull()
  })

  it('accepts an IANA zone and canonicalises its spelling', () => {
    expect(parseOk('username=x&tz=Europe/Madrid').tz).toBe('Europe/Madrid')
    expect(parseOk('username=x&tz=america/new_york').tz).toBe('America/New_York')
    expect(parseOk('username=x&tz=  Asia/Tokyo  ').tz).toBe('Asia/Tokyo')
  })

  /**
   * A misspelt zone is the default, never an error. The reader of a README
   * cannot see an error body, and a streak drawn against a different midnight
   * is not worth a broken image.
   */
  it('falls back to the default for anything it does not recognise', () => {
    for (const bad of ['', 'nowhere', 'UTC+5', 'Mars/Olympus_Mons', '../etc/passwd']) {
      expect(parseOk(`username=x&tz=${encodeURIComponent(bad)}`).tz).toBeNull()
    }
  })
})

describe('style parameters on a rejected request', () => {
  /**
   * The error card is drawn with whatever style survived parsing, so a themed
   * card that fails still looks like it belongs to the same README.
   */
  it('are still parsed so the error card matches the theme', () => {
    const result = parse('theme=ice&radius=12')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.style.themeName).toBe('ice')
    expect(result.style.radius).toBe(12)
  })
})
