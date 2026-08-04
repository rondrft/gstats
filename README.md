<p align="center">
  <img src="assets/brand/logo.svg" width="96" height="96" alt="gstats">
</p>

# gstats

GitHub stats cards for your README. Contributions, streaks and languages, rendered as SVG on the edge.

[![CI](https://github.com/rondrft/gstats/actions/workflows/ci.yml/badge.svg)](https://github.com/rondrft/gstats/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-1D9E75?style=flat-square&labelColor=080D08)](LICENSE)
[![Stars](https://img.shields.io/github/stars/rondrft/gstats?style=flat-square&labelColor=080D08&color=EF9F27)](https://github.com/rondrft/gstats/stargazers)

![A gstats card](docs/assets/terminal.svg)

```html
<a href="https://github.com/rondrft/gstats"><img alt="My GitHub stats" src="https://gstats.rondrft.workers.dev/api?username=USERNAME" /></a>
```

That is the whole thing. Replace `USERNAME`, paste it in — no account to connect,
no permission to grant, nothing to authorise. Only public data is used.

**The link around the card is optional.** It points here, and removing it changes
nothing: not the card, not the parameters, not how it is cached, and nothing on
this service looks for it. The plain form works exactly as well —

```markdown
![My GitHub stats](https://gstats.rondrft.workers.dev/api?username=USERNAME)
```

— and GitHub renders the identical image from either, because it rewrites the
`src` through its own image proxy in both cases. The only difference is where a
click goes: with the link, here; without it, to the image on its own.

> **Already using `phosphor-stats.rondrft.workers.dev`?** It still works, and it
> is not going to stop. The service answers on both hostnames from the same
> deploy and the same cache — the old one is deprecated in the sense that new
> snippets use `gstats`, not in the sense that it has an end date. There is
> nothing to migrate and no reason to edit a README that already works.

If it is useful to you, [a star](https://github.com/rondrft/gstats)
helps other people find it.

---

## Designs

Six of them, set with `&card=`. Each is shown below in a different theme, but the
two are independent: **any design works with any theme**, and with any colour
override on top. Try combinations at
**[gstats.rondrft.workers.dev](https://gstats.rondrft.workers.dev)**,
which builds the snippet for you.

### `terminal` — three rings and a language column

The default, in the phosphor palette this project was originally named for.

![terminal design](docs/assets/terminal.svg)

```html
<a href="https://github.com/rondrft/gstats"><img alt="My GitHub stats" src="https://gstats.rondrft.workers.dev/api?username=USERNAME" /></a>
```

### `heatmap` — the trailing year, day by day

The only design that shows something the others cannot. Intensity is graded
against your own distribution, so a quiet year and a busy one both get contrast.

![heatmap design](docs/assets/heatmap.svg)

```html
<a href="https://github.com/rondrft/gstats"><img alt="My GitHub stats" src="https://gstats.rondrft.workers.dev/api?username=USERNAME&amp;card=heatmap&amp;theme=ice" /></a>
```

### `press` — a newspaper front page

Serif, on paper, with the current streak as the one spot of ink colour.

![press design](docs/assets/press.svg)

```html
<a href="https://github.com/rondrft/gstats"><img alt="My GitHub stats" src="https://gstats.rondrft.workers.dev/api?username=USERNAME&amp;card=press&amp;theme=light" /></a>
```

### `gauge` — an instrument panel

Needles, and no numbers inside the dials. The streak needle measures against your
own record, so full deflection means a personal best in progress.

![gauge design](docs/assets/gauge.svg)

```html
<a href="https://github.com/rondrft/gstats"><img alt="My GitHub stats" src="https://gstats.rondrft.workers.dev/api?username=USERNAME&amp;card=gauge&amp;theme=mono" /></a>
```

### `vinyl` — a record and its tracklist

Turns, once every eight seconds. `&animate=false` stops it.

![vinyl design](docs/assets/vinyl.svg)

```html
<a href="https://github.com/rondrft/gstats"><img alt="My GitHub stats" src="https://gstats.rondrft.workers.dev/api?username=USERNAME&amp;card=vinyl&amp;theme=amber" /></a>
```

### `pass` — a boarding pass

Shown with no named theme at all, only colour overrides — every design takes
them, so you are not limited to the five presets.

![pass design](docs/assets/pass.svg)

```html
<a href="https://github.com/rondrft/gstats"><img alt="My GitHub stats" src="https://gstats.rondrft.workers.dev/api?username=USERNAME&amp;card=pass&amp;bg=F4EDE1&amp;accent=C1432B&amp;text=2B2118&amp;muted=7A6A57&amp;border=D6C6AC" /></a>
```

### Themes

`phosphor` *(default)*, `amber`, `ice`, `mono` and `light`, set with `&theme=`.
Any individual colour can be overridden on top of any of them.

A published design never changes and is never removed: the URL in your README is
a promise, and a redesign would silently rewrite a page you are not watching. A
new look ships under a new id.

---

## Options

<details>
<summary><strong>Every parameter</strong></summary>

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `username` | string | — | **Required.** A GitHub login. |
| `card` | string | `terminal` | `terminal`, `heatmap`, `pass`, `press`, `gauge`, `vinyl`. |
| `theme` | string | `phosphor` | `phosphor`, `amber`, `ice`, `mono`, `light`. |
| `ring` | hex | theme | Colour of the contribution and record rings. |
| `accent` | hex | theme | Colour of the streak ring and its icon. |
| `bg` | hex | theme | Card background. Accepts `transparent`. |
| `text` | hex | theme | Colour of the numbers and the language rows. |
| `muted` | hex | theme | Colour of the labels. |
| `border` | hex | theme | Inner frame. `none` hides it. |
| `radius` | 0–24 | `6` | Corner radius of the card. |
| `hide` | csv | — | Modules to omit: `total`, `streak`, `best`, `langs`. |
| `langs_count` | 1–8 | `4` | **At most** this many languages. See below for the two reasons a card lists fewer. |
| `lang_mode` | string | `bytes` | How languages are ranked. See below. |
| `exclude_langs` | csv | — | Languages to leave out, case-insensitive. |
| `include_langs` | csv | — | Re-admit a language from the default exclusions. |
| `lang_style` | string | `blocks` | `blocks` or `bars`. |
| `scanlines` | bool | `true` | CRT banding over the background. |
| `animate` | bool | `true` | Draw-on animation. |
| `locale` | string | `en` | Label language: `en` or `es`. |
| `tz` | IANA zone | Anywhere on Earth | Which midnight ends a day for the streak, e.g. `Europe/Madrid`. |
| `show_credit` | bool | `false` | Adds a small project credit to the card. |
| `cache_seconds` | 1800–86400 | instance default | How long a client may reuse the card. |

Colours are accepted with or without a leading `#`, in 3, 4, 6 or 8 digits.
Anything that fails validation falls back to the theme rather than breaking the
card, and out-of-range numbers are clamped rather than rejected.

The card renders every failure rather than signalling it. A username that does
not exist, an exhausted GitHub quota or an upstream failure all come back as a
readable card with a `200` — a non-200 in a README shows up as a broken image
and tells the reader nothing.

One exception: a client that goes over the instance's rate limit gets a `429`
with `Retry-After`, because that answer is for whoever is making the requests
rather than for a reader. It is still a drawn card, so it says what happened to
anybody who opens it.

</details>

<details>
<summary><strong>How languages are counted</strong></summary>

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

`lang_mode=repos` ignores size entirely and counts the repositories each language
leads. It is cruder, and for a lot of profiles closer to the truth — a portfolio
of eight small Rust services and one enormous inherited Java monolith reads very
differently under the two.

```markdown
![](https://gstats.rondrft.workers.dev/api?username=USERNAME&lang_mode=repos)
![](https://gstats.rondrft.workers.dev/api?username=USERNAME&include_langs=CSS&exclude_langs=Go)
```

Bar length is the square root of the share of the leading language, so the leader
fills its row and a long tail stays legible — against a 49% leader, 5% and 2%
draw differently instead of both bottoming out at one cell. **The bar is an
ordering; the percentage beside it is the measurement**, and it is the true share
of the total.

### Why a card lists fewer languages than you asked for

`langs_count` is a maximum, and there are two separate reasons a card comes back
with fewer. They look identical on the card, which is why the response says
which one it was.

**The profile has fewer to give.** This is the common one. After the by-product
list and the 0.5% floor, plenty of accounts have three or four languages of
substance and no more — asking for six changes nothing.

**The design lists fewer.** Three of the six have a shape that stops earlier:
`vinyl` lists **3**, `press` and `gauge` list **4**, `terminal` and `pass` list
up to **8**, and `heatmap` draws no languages at all. Those ceilings are part of
what those cards look like, so they do not change; the parameter is honoured up
to the one belonging to the design you chose.

Every card response carries the answer:

```bash
curl -sI "https://gstats.rondrft.workers.dev/api?username=USERNAME&langs_count=6" \
  | grep -i x-languages
# x-languages-shown: 3        drawn on the card
# x-languages-available: 3    qualified after the filters — the profile's own number
# x-languages-ceiling: 8      the most this design draws
```

`shown < available` means the design or `langs_count` cut it; `available` below
what you asked for means the account did. GitHub's Camo proxy does not pass
these on, so read them against this service directly rather than against the
image in a rendered README.

</details>

---

## Known limitations

Worth reading before opening an issue — most of these are inherent rather than
fixable.

- **GitHub caches the image and it cannot be purged from outside.** READMEs are
  served through Camo. A card is at best `max-age` behind, which is 30 minutes.
  About half an hour is achievable for an embedded card; "instant" is not, for
  anybody. Opening the `/api` URL directly bypasses Camo and shows the current
  figures.
- **A new day can take a few hours to show up.** Streaks are counted against
  **Anywhere on Earth** (UTC−12), the last zone on the planet to change date, so
  a day counts for as long as it is still that day somewhere. That is the safe
  direction: your streak is never cut short before your own day is over, at the
  price of a new one taking up to twelve hours to be picked up. Pass
  `&tz=Europe/Madrid` — any IANA zone — to have it counted in yours exactly.
- **A zero on today does not break your streak.** The day is not over yet. The
  streak only ends once yesterday is also empty.
- **`card=heatmap`'s columns do not line up with GitHub's.** Both draw 53, and
  they cut the year differently: GitHub's are calendar weeks, Sunday to
  Saturday, so its last one is however much of this week has happened. This
  grid's last column ends on **today**, and each column is the seven days before
  it. Counting columns between the two therefore disagrees — neither is missing
  one. What this way buys is that every square is a day that has already
  happened, so there is never an empty cell for a day that has not arrived yet.
- **Public repositories only**, and forks are excluded from the language totals
  so that forking a large project does not rewrite your breakdown.
- **Languages are sampled**, not exhaustive: the 300 most recently pushed
  repositories are scanned. Beyond that the percentages do not move visibly.
- **The public instance is best effort.** One GitHub token shared by everyone
  using it, and nobody is on call for it.
- **Requests are limited per address.** Thirty a minute, and twenty *distinct*
  usernames an hour — a card in a README is one request every half hour, so
  ordinary use never approaches either. Reloading the same profile is free once
  it has been counted; walking a list of usernames is what the second limit is
  for. Over the line gets a card that says `too many requests` and a
  `Retry-After`. A [self-hosted instance](docs/self-hosting.md#7-protect-your-quota)
  sets its own numbers.

### Private repositories

**This service cannot see them, and should not be able to.** A GitHub token
reaches exactly what its owner reaches, so a third party's private repositories
are unreachable, without exception. Giving the shared token private access would
publish the language breakdown of the private code belonging to whoever
configured it — a leak wearing a feature's clothes.

What does work: [self-host](docs/self-hosting.md#private-repositories) with your
own token and restrict the instance to your own username.

Separately, and worth knowing: turning on **Settings → Profile → Include private
contributions on my profile** makes your contribution total count private work
without revealing anything about it. It costs nothing and a lot of people do not
know it exists.

---

## What this service records

Enough to know whether it is about to run out of Cloudflare's free tier, and
nothing else. Since it counts something, it should say what.

**Nothing about you is stored.** No IP address, no user agent, no referrer, no
cookie, no timestamp of any individual request, and no record anywhere tying a
profile to whoever asked for it. Nothing of that kind is written to the
service's storage, in any form, for any length of time. A card embedded in a
README is fetched by GitHub's image proxy on the reader's behalf in any case, so
for most readers there is nothing to see even if there were somewhere to put it.

The one exception, stated because "nothing" should mean it: the **rate limiter**
holds the caller's address in the running instance's memory, so that "twenty
distinct profiles an hour, per address" can be enforced at all. It is never
written to storage, it is not written to any log, it is gone when that instance
is recycled, and it is deliberately not in KV — [a ledger there would cost more
than the abuse it prevents](docs/pending.md).

**Two numbers about the instance**, both visible to anybody at
[`/health`](https://gstats.rondrft.workers.dev/health):

- **How many distinct GitHub logins have been fetched in the last 30 days.** This
  is the figure the service's own capacity is measured in — the free plan tops
  out somewhere around 240 of them — and it was a guess until it was counted. It
  is derived from the cache the service already keeps rather than recorded as
  people arrive, and the ledger behind it stores a short hash of each login
  rather than the login. That is not a secrecy claim: GitHub logins are public,
  and a hash of one is trivially reversible by anyone who bothers. It is that
  this record has no use for the identity, so it does not keep one.
- **How many cards were served in the last 7 days**, as one total per day. Not
  per profile, not per reader — one integer.

Separately, and worth stating because "nothing is stored" would otherwise be
doing too much work: **a card is cached under the login it is for, for seven
days.** That is the cache, not a metric — it is how the service avoids asking
GitHub the same question twice — but it does mean the instance's operator can
list which logins have been requested lately, and there is an endpoint behind
their token that does exactly that. It carries no timestamps, no counts and
nothing about who asked; it is the set of logins with a live cache entry. An
operator could always read this out of the storage directly, so the endpoint
adds convenience rather than access.

See [docs/limits.md](docs/limits.md) for the arithmetic these two figures feed,
and
[docs/decisions.md](docs/decisions.md#the-profile-count-is-read-out-of-the-cache-not-counted-on-the-way-in)
for why counting profiles on the way in was rejected — it would have cost about a
tenth of the very allowance the count exists to watch.

A self-hosted instance measures itself the same way and reports to nobody: there
is no telemetry, no phone-home, and no shared endpoint. The figures live in your
own KV namespace.

---

## Running your own

About five minutes, and it fits inside the Cloudflare free tier.

```bash
git clone https://github.com/rondrft/gstats
cd gstats && pnpm install
pnpm wrangler kv namespace create STATS_CACHE   # paste the id into wrangler.toml
pnpm wrangler secret put GITHUB_TOKEN
pnpm deploy
```

**→ [docs/self-hosting.md](docs/self-hosting.md)** for the full walkthrough:
tokens, KV, rate limiting, continuous deployment and monitoring.

Your own instance can also keep cards current, which the public one cannot do on
your behalf:

- `POST /purge?username=<login>` drops a cached profile so the next view
  refetches. There is a GitHub Action that calls it on every push.
- `WARM_USERS` refreshes up to ten profiles every fifteen minutes, so those cards
  never wait on a cache miss.

**→ [docs/purging.md](docs/purging.md)**, which also sets out how fresh a card
can honestly be.

---

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md)
for the layout of the codebase and how to run it locally. Participation is
governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

Before changing anything that looks arbitrary, read
[docs/decisions.md](docs/decisions.md): most of the odd-looking choices here are
working around something, and several were written the obvious way first and
corrected once a test proved the obvious way was wrong.

- [CHANGELOG.md](CHANGELOG.md) — what changed and when. Worth a look if a card
  you published starts showing a different figure.
- [docs/decisions.md](docs/decisions.md) — why things are the way they are.
- [docs/limits.md](docs/limits.md) — the quota arithmetic. The ceiling is KV
  writes, not the GitHub quota.
- [docs/pending.md](docs/pending.md) — what is missing, in priority order.

## Licence

[MIT](LICENSE). Icons from [Tabler Icons](https://github.com/tabler/tabler-icons),
also MIT, embedded as paths rather than loaded at runtime.
