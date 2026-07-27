# Contributing

Thanks for taking the time. This is a small project and the bar for a useful
contribution is low — a bug report with a URL that reproduces it is already
valuable.

## Getting set up

```bash
pnpm install
cp .dev.vars.example .dev.vars   # then put a GitHub token in it
pnpm dev
```

An unscoped personal access token is enough; see
[docs/self-hosting.md](docs/self-hosting.md#2-create-a-github-token). Without
one, the Worker still runs and the landing page still works — every card just
says `GITHUB_TOKEN is not set`.

Before opening a pull request:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

`pnpm format` applies the formatter and the safe lint fixes.

## How the code is laid out

```
src/
  index.ts          routing, response headers, the never-return-an-error rule
  params.ts         query string parsing, validation, sanitisation
  stats.ts          cache -> GitHub -> stale fallback
  purge.ts          POST /purge: auth, rate limit, targeted invalidation
  streak.ts         streak arithmetic, pure and I/O free
  cache.ts          KV wrapper and cache key derivation
  i18n.ts           card copy and locale-aware formatting
  landing.ts        the self-contained landing page
  languages.ts      language ranking: cap, recency weight, exclusions
  github/
    client.ts       GraphQL transport, rate limit accounting, TokenProvider
    contributions.ts
    languages.ts
    types.ts        shapes shared across layers
  render/
    cards/          the design registry and its implementations
    chrome.ts       plate, frame and fonts shared by every design
    layout.ts       measures the content and centres it
    metrics.ts      monospace text measurement
    ring.ts         ring geometry
    icons.ts        embedded Tabler paths
    langs.ts        language block
    themes.ts       colour presets
    error-card.ts   the failure card
    color.ts        hex parsing and track derivation
    xml.ts          escaping
```

## Conventions worth knowing

**The card renders inside an `<img>`.** GitHub serves README images through
Camo with scripting and external subresource loading disabled. No JavaScript, no
remote fonts, no remote images, no `@import`. CSS animation does work. Anything
added to the SVG has to survive those constraints.

**Nothing untrusted is interpolated unescaped.** Every value that originates in
a query string or in the GitHub API goes through `escapeXml`, and colours go
through a whitelist in `params.ts` before they reach an attribute. New parameters
follow the same route.

**A malformed parameter is never fatal.** It falls back to its default. The
reader cannot see an error body, so the card has to render regardless.

**Geometry is derived, not typed in.** `src/render/ring.ts` computes the arc
lengths from the radius and the gap. If you find yourself writing a literal that
depends on another literal, derive it instead.

**Nothing outside `layout.ts` decides where anything goes.** The card is
measured first and drawn second: `layoutCard` returns the width, the ring
centres, the shared axis and the language block's placement, and the
designs consume them. That is what keeps the composition centred when a label changes,
a locale changes or a module is hidden — a coordinate written anywhere else is a
piece that will not move with the rest. If you add something to the card, teach
the layout to measure it. `test/layout.test.ts` asserts that the four margins
around the content box stay equal in every configuration.

**Streak arithmetic is pure.** `computeStreaks` takes the calendar and the
reference day as arguments and reads no clock. It is the piece most likely to be
wrong in subtle ways, so it carries the densest tests. Anything that changes it
needs a test that fails before the change.

**The cache stores data, not SVG.** KV holds serialised `StatsData`; the card is
built from it on every request. Style parameters are therefore absent from the
cache key, and a request in a different theme reuses the entry an earlier request
paid for. A new parameter belongs in the key only if it changes what is fetched
from GitHub.

One consequence is worth knowing before you go looking for a bug: a release that
changes the renderer takes effect on the next request, because nothing rendered
was ever stored. What it cannot reach is the copy Camo and the reader's browser
are already holding — that is governed by `Cache-Control`, not by KV, and it is
the *only* reason a card can look stale after a deploy.

**The two caches are separate levers.** `Cache-Control: max-age` decides how
often Camo comes back; those returns are answered from KV and cost no GitHub
quota, only Worker invocations. `KV_FRESH_SECONDS` decides how often the service
asks GitHub, which spends the quota every profile on the instance shares. They
used to be the same number, which made a reader wait for the sum of both. Keep
them apart: short response, long data, and `POST /purge` for anyone who needs a
figure sooner.

**The cache key carries the build.** `SERVICE_VERSION` is part of the key, so a
deploy starts from an empty cache and cannot read entries written against an
older shape of `StatsData`. Deploys pass the commit they were built from. The
cost is a burst of upstream traffic after each release, proportional to how many
distinct profiles are active, which is worth remembering on a busy instance.

## Adding a design

Designs live in `src/render/cards/`. Read the contract at the top of
`registry.ts` first — it is short, and it is the part that cannot be undone once
somebody has pasted a URL into a README.

A design gets its coordinates from `layoutRow` and decides none of its own, uses
`chrome.ts` for the plate and frame so it honours `theme` for free, and takes its
numbers from `visibleStats` in `modules.ts` so it honours `hide` and `locale` for
free too. `test/cards.test.ts` runs the same battery over every registered id —
theme, locale, hide, `animate=false`, escaping, empty accounts, six-digit
numbers, size budget — so a new entry in the registry is a new set of tests
without writing any.

## Adding a theme

Add an entry to `THEMES` in `src/render/themes.ts`. Ring tracks are derived from
the ring colour, so there is nothing else to fill in. The landing page and the
parameter validation both read the list, so a new theme appears in the generator
on its own.

## Adding a locale

Add an entry to `LOCALES` in `src/i18n.ts`. Keep the labels short — they sit
under a 54px ring — and check that the longest error message still fits inside
the error card, which is sized for the widest translation.

## Reporting a bug

Include the full `/api` URL that reproduces it. If it is a rendering problem, say
which browser, and whether it happens when the SVG is opened directly as well as
in a README — Camo caching accounts for a good share of "it will not update"
reports, and that one is documented rather than fixable.
