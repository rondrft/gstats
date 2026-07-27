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
  streak.ts         streak arithmetic, pure and I/O free
  cache.ts          KV wrapper and cache key derivation
  i18n.ts           card copy and locale-aware formatting
  landing.ts        the self-contained landing page
  github/
    client.ts       GraphQL transport, rate limit accounting, TokenProvider
    contributions.ts
    languages.ts
    types.ts        shapes shared across layers
  render/
    card.ts         composition and layout
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

**Streak arithmetic is pure.** `computeStreaks` takes the calendar and the
reference day as arguments and reads no clock. It is the piece most likely to be
wrong in subtle ways, so it carries the densest tests. Anything that changes it
needs a test that fails before the change.

**The cache stores data, not SVG.** Style parameters are deliberately absent
from the cache key, so a request in a different theme reuses the entry an earlier
request paid for. A new parameter belongs in the key only if it changes what is
fetched from GitHub.

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
