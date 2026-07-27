# phosphor-stats

GitHub stats cards for your README. Contributions, streaks and languages, rendered as SVG on the edge.

[![CI](https://github.com/rondrft/phosphor-stats/actions/workflows/ci.yml/badge.svg)](https://github.com/rondrft/phosphor-stats/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-1D9E75?style=flat-square&labelColor=080D08)](LICENSE)
[![Stars](https://img.shields.io/github/stars/rondrft/phosphor-stats?style=flat-square&labelColor=080D08&color=EF9F27)](https://github.com/rondrft/phosphor-stats/stargazers)

![A phosphor-stats card](docs/assets/hero.svg)

If it is useful to you, [a star](https://github.com/rondrft/phosphor-stats) helps other people find it.

---

## Usage

Paste this into your README and replace `USERNAME` with your GitHub login:

```markdown
![My GitHub stats](https://phosphor-stats.rondrft.workers.dev/api?username=USERNAME)
```

Or build one visually at **[phosphor-stats.rondrft.workers.dev](https://phosphor-stats.rondrft.workers.dev)** — pick a theme, toggle the modules, copy the snippet.

> The host above is the public instance. If you deploy your own, swap it for your
> own Worker URL and nothing else changes.

Only public data is used, and no account ever needs to authorise anything.

## Themes

Set one with `&theme=`. Individual colours can be overridden on top of any theme.

<table>
<tr><td><code>phosphor</code> <em>(default)</em></td></tr>
<tr><td><img src="docs/assets/theme-phosphor.svg" alt="phosphor theme"></td></tr>
<tr><td><code>?theme=amber</code></td></tr>
<tr><td><img src="docs/assets/theme-amber.svg" alt="amber theme"></td></tr>
<tr><td><code>?theme=ice</code></td></tr>
<tr><td><img src="docs/assets/theme-ice.svg" alt="ice theme"></td></tr>
<tr><td><code>?theme=mono</code></td></tr>
<tr><td><img src="docs/assets/theme-mono.svg" alt="mono theme"></td></tr>
<tr><td><code>?theme=light</code></td></tr>
<tr><td><img src="docs/assets/theme-light.svg" alt="light theme"></td></tr>
</table>

## Designs

Pick one with `&card=`. Every design honours `theme`, `hide`, `locale` and
`animate`, so the two axes are independent.

| `?card=` | What it is |
| --- | --- |
| `terminal` *(default)* | Three rings and a language column. |
| `heatmap` | The trailing year, day by day. The only design that shows something the others cannot. |
| `pass` | A boarding pass, with the streak on a perforated stub. |
| `press` | A newspaper front page, set in serif. |
| `gauge` | An instrument panel. Needles, no numbers inside the dials. |
| `vinyl` | A record and its tracklist. Turns, once every eight seconds. |

A published design never changes and is never removed: the URL in your README is
a promise, and a redesign would silently rewrite a page you are not watching. A
new look ships under a new id.

## How languages are counted

Summing bytes across an account measures how much code exists, which is not what
a reader thinks they are looking at. One generated stylesheet, one vendored
dependency or one committed bundle outweighs a year of deliberate work. Three
corrections are applied by default:

- **No repository contributes more than 15%** of the ranking. A monorepo still
  counts for more than a scratch project; it just cannot decide the card by
  itself. The cap engages once an account has enough repositories for it to be
  satisfiable — below seven it would only flatten everything to equal shares.
- **Recent work counts for more.** A repository pushed to in the last six months
  counts fully, one within a year counts half, anything older a quarter.
- **By-product languages are excluded**: `HTML`, `CSS`, `SCSS`, `Dockerfile`,
  `Makefile`, `Shell`, `Batchfile`, `Roff`, `TeX` and `Jupyter Notebook`. Bring
  any of them back with `include_langs`, and remove more with `exclude_langs`.
  Anything under 0.5% is dropped as noise.

None of this measures skill or effort, and it could not. It is a heuristic tuned
to be wrong less often than raw byte counts are.

### `lang_mode`

```markdown
<!-- bytes (default): weighted, capped byte counts -->
![](https://phosphor-stats.rondrft.workers.dev/api?username=USERNAME&lang_mode=bytes)

<!-- repos: how many repositories each language leads -->
![](https://phosphor-stats.rondrft.workers.dev/api?username=USERNAME&lang_mode=repos)
```

`repos` ignores size entirely and counts the repositories a language is the main
one in. It is cruder, and for a lot of profiles it is closer to the truth — a
portfolio of eight small Rust services and one enormous inherited Java monolith
reads very differently under the two.

```markdown
<!-- put CSS back in, and drop Go -->
![](https://phosphor-stats.rondrft.workers.dev/api?username=USERNAME&include_langs=CSS&exclude_langs=Go)
```

### Private repositories

**This service cannot see them, and should not be able to.** A GitHub token
reaches exactly what its owner reaches, so a third party's private repositories
are unreachable, without exception. Giving the shared token private access would
publish the language breakdown of the private code belonging to whoever
configured it — that is a leak wearing a feature's clothes, and there is no
version of it that is safe to offer publicly.

What does work: [self-host](docs/self-hosting.md#private-repositories) with your
own token and restrict the instance to your own username. Your private code
stays yours and nothing is exposed.

Separately, and worth knowing: turning on **Settings → Profile → Include private
contributions on my profile** makes your contribution total count private work
without revealing anything about it. It costs nothing and a lot of people do not
know it exists.

## Variants

`?lang_style=bars` swaps the block characters for rectangles tinted with each
language's own colour:

![bar language style](docs/assets/lang-style-bars.svg)

`?hide=langs` drops the language column, and the card narrows to fit:

![card without the language block](docs/assets/hide-langs.svg)

## Parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `username` | string | — | **Required.** A GitHub login. |
| `card` | string | `terminal` | Design: `terminal`, `heatmap`, `pass`, `press`, `gauge`, `vinyl`. |
| `theme` | string | `phosphor` | `phosphor`, `amber`, `ice`, `mono`, `light`. |
| `lang_mode` | string | `bytes` | How languages are ranked. See below. |
| `include_langs` | csv | — | Re-admit a language from the default exclusions. |
| `ring` | hex | theme | Colour of the contribution and record rings. |
| `accent` | hex | theme | Colour of the streak ring and its icon. |
| `bg` | hex | theme | Card background. Accepts `transparent`. |
| `text` | hex | theme | Colour of the numbers and the language rows. |
| `muted` | hex | theme | Colour of the labels. |
| `border` | hex | theme | Inner frame. `none` hides it. |
| `radius` | 0–24 | `6` | Corner radius of the card. |
| `hide` | csv | — | Modules to omit: `total`, `streak`, `best`, `langs`. |
| `langs_count` | 1–8 | `4` | How many languages to list. |
| `exclude_langs` | csv | — | Languages to leave out, case-insensitive. |
| `lang_style` | string | `blocks` | `blocks` or `bars`. |
| `scanlines` | bool | `true` | CRT banding over the background. |
| `animate` | bool | `true` | Draw-on animation for the rings. |
| `locale` | string | `en` | Label language: `en` or `es`. |
| `show_credit` | bool | `false` | Adds a small project credit to the card. |
| `cache_seconds` | 1800–86400 | instance default | How long a client may reuse the card. |

Colours are accepted with or without a leading `#`, in 3, 4, 6 or 8 digits.
Anything that fails validation falls back to the theme rather than breaking the
card. Out-of-range numbers are clamped, not rejected.

The card never returns an error status. A username that does not exist, an
exhausted rate limit or an upstream failure all render as a readable card with a
`200`, because a non-200 in a README shows up as a broken image and tells the
reader nothing.

## Self-hosting

The public instance is **best effort**. It runs on a single GitHub token with a
shared budget of 5,000 requests per hour, and nobody is on call for it. If your
README matters to you, run your own — it takes about five minutes and gives you
your own budget.

**→ [docs/self-hosting.md](docs/self-hosting.md)**

```bash
git clone https://github.com/rondrft/phosphor-stats
cd phosphor-stats && pnpm install
pnpm wrangler kv namespace create STATS_CACHE   # paste the id into wrangler.toml
pnpm wrangler secret put GITHUB_TOKEN
pnpm wrangler deploy
```

## Known limitations

- **GitHub caches the image.** READMEs are served through Camo, GitHub's image
  proxy. It respects `Cache-Control` but can keep serving an older copy for a
  while after it expires. A card that has not caught up yet is expected
  behaviour, not a bug — and if you self-host you can
  [purge it on every push](docs/purging.md).
- **Streaks are computed in UTC.** A day boundary has to be drawn somewhere, and
  a Worker runs in whichever data centre is closest to the reader — anything
  derived from local time would give a different answer per continent. If you
  live far from UTC your streak may tick over at an unfamiliar hour.
- **A zero on today does not break your streak.** The day is not over yet. The
  streak only ends once yesterday is also empty.
- **Public repositories only,** and forks are excluded from the language totals
  so that forking a large project does not rewrite your breakdown.
- **Languages are sampled**, not exhaustive: the 300 most recently pushed
  repositories are scanned. Beyond that the percentages do not move visibly, and
  the quota is better spent elsewhere.
- **The hourly quota is shared** on the public instance. When it runs low the
  service starts serving slightly stale cards rather than failing.

## Keeping a card current

A commit and the card showing it are separated by two caches: the 30 minutes
Camo is told to hold the image, and the six hours the service holds your
figures. The second is the expensive one — every lapse costs GitHub API calls
from a budget the whole instance shares — so instead of shortening it for
everybody there is a way to invalidate one profile:

```
POST /purge?username=<login>
Authorization: Bearer <PURGE_TOKEN>
```

It deletes and returns JSON; the next view of the card does the fetching. Fifty
pushes in ten minutes are fifty cheap deletes and one API call.

This needs the instance's token, and **the public instance does not share
its own** — a shared purge key would let anybody drain its quota. If you want it,
[self-host](docs/self-hosting.md) and follow
[docs/purging.md](docs/purging.md), which includes a GitHub Action that purges on
every push.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md)
for the layout of the codebase and how to run it locally. Participation is
governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Licence

[MIT](LICENSE).

Icons are from [Tabler Icons](https://github.com/tabler/tabler-icons), also MIT
licensed, embedded as paths rather than loaded at runtime.
