# Changelog

All notable changes to this project are documented here, in the format of
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

**There are no version numbers, and that is deliberate.** This is one
continuously deployed Worker, not a package anybody installs: the build id *is*
the commit it was deployed from, which is what `/health` reports and what
namespaces the cache. So entries are dated and carry the commits that made them,
and the way to find out what a running instance contains is

```bash
curl -s https://<host>/health | jq -r .version
```

and then read down from that commit.

The reason this file exists is the **URL contract**. A card URL pasted into a
README is a public promise: `card=terminal` never changes, a published design is
never removed, and a redesign ships under a new id. Anything that would alter a
card somebody already published is the sort of thing that has to be written down
where they can find it, and "Changed" below is the section to read.

## [Unreleased]

Committed but not yet deployed.

### Added

- **The snippet the landing page hands over is HTML, with the card wrapped in a
  link to the project.** The plain markdown image is a click away beside it, and
  both are built from the same URL, so anything you set in the controls is in
  either. **The link is optional and nothing depends on it** — no referrer check,
  no parameter, no difference in what is served. Checked against GitHub's own
  markdown renderer: the sanitizer keeps the anchor, and the image it produces is
  identical to the markdown one down to the proxy URL, so a card looks and caches
  the same either way. `4611229`
- The six sample cards in the README are file snapshots now: `pnpm test` fails
  when they are behind the renderer and `pnpm samples` writes them back. They had
  drifted three commits, which is where a bug report about two already-fixed
  defects came from. `a885fb1`
- **The service answers on `gstats.rondrft.workers.dev`**, which is the hostname
  new snippets use. `phosphor-stats.rondrft.workers.dev` keeps working
  indefinitely: it is a second deploy of the identical Worker from the same
  commit, sharing one cache, rather than a redirect. **No published card URL
  needs changing, and none will break.** A redirect was considered and rejected
  because it would make every existing card depend on Camo following a 301 —
  somebody else's proxy, undocumented for that purpose. See `[env.legacy]` in
  `wrangler.toml`.
- `tz` takes an IANA zone (`&tz=Europe/Madrid`) to count the streak against that
  zone's midnight. Validated against the runtime's own zone list; anything it
  does not recognise falls back to the default rather than erroring. `29d9316`,
  `1e20bba`

### Changed

- **Streaks now count against Anywhere on Earth (UTC−12) rather than UTC.** A day
  counts for as long as it is still that day somewhere, so a streak is never cut
  short before the reader's own day is over — which is what UTC was doing to
  everybody west of Greenwich. The cost is the opposite error: a new day can take
  up to twelve further hours to appear. **This can change the current streak a
  card shows by one, in the direction of showing more.** `1e20bba`
- **The project is called `gstats`.** The repository, both Workers and the
  branding follow the name; `show_credit=true` draws `gstats` on the card instead
  of `phosphor-stats`, and so does the band on `card=pass`, which the rename
  missed the first time — see "Fixed" below. **The `phosphor` theme is
  unchanged** — that one is a public parameter value sitting in other people's
  READMEs, and renaming it would break them.
- The icons at `/favicon.svg` and `/logo.svg` give `gstats` as their accessible
  name, which is the only text in either file. Nothing about them looks different.
  They are served with a year and `immutable`, so a browser that already holds one
  keeps the old name until it expires — acceptable for a label no sighted reader
  sees, and cheaper than moving two public URLs. `2b1d85a`
- The four language parameters — `lang_mode`, `langs_count`, `exclude_langs`,
  `include_langs` — no longer cost a separate fetch from GitHub. They rank data
  that has already been fetched, so they now behave the way `theme` always has.
  No change to what any of them produces. `29d9316`

### Fixed

- `card=heatmap` came to 13.5 KB for an account that commits daily, over the
  12 KB budget the tests were meant to enforce. Same grid, drawn in fewer bytes.
  `e7c4ca0`
- `card=pass` painted the top perforation notch onto its own accent band, where
  it read as a dot rather than as a hole, and its stub was cramped against the
  card edge. `e7c4ca0`
- **`card=pass` had three left margins.** Its inner frame, the type on its
  coloured band and its columns each sat a different distance from the card edge,
  which reads as a card whose margins are wrong even though each pair was
  symmetric. Every edge on it now comes from the layout's content box, so the
  brand stands over the first column and the frame hangs midway between the
  content and the card. **The type on this design moves by a few units**, which is
  visible if you compare a card drawn before and after. `2b1d85a`
- **`card=pass` printed its language summary even under `hide=langs`**, and on a
  card narrowed by another hidden module it overlapped the date range. `2b1d85a`
- **The band on `card=pass` still said `PHOSPHOR STATS`.** The rename reached the
  credit line, the landing page and the documentation and missed the one place
  that had it as a literal, so every card drawn with that design carried the old
  name for three commits. There is one constant for it now, and a test that fails
  if any design draws the old one. `2b1d85a`
- `card=press` drew its masthead rules and its dateline from the margin constant
  rather than from the layout's content box, which put them two tenths of a unit
  out of line with the columns beneath them. Invisible, and the same latent
  mistake that was visible on `pass`. Its frame keeps the inset it has always had.
  `dd31f25`
- The sample card in the README (`docs/assets/pass.svg`) was three commits stale:
  it showed the notch dot and the cramped stub that `e7c4ca0` fixed, and the old
  name. Re-rendered from the same profile the other five were captured from.

## 2026-07-27

### Added

- **Five designs, selected with `&card=`**: `heatmap`, `press`, `gauge`, `vinyl`
  and `pass`, behind a registry that fixes `terminal` as the default for every
  URL written before `?card=` existed. `bf56127`
- Language ranking that measures practice rather than bulk: a 15% per-repository
  cap, a recency weight, and ten by-product languages excluded by default with
  `include_langs` to bring them back. `bf56127`
- `POST /purge?username=<login>` drops a login's cached entries so the next view
  refetches, behind `PURGE_TOKEN` and its own per-token brake. `01b4345`
- `WARM_USERS` refreshes a configured handful of profiles every fifteen minutes,
  so those cards never wait on a cache miss. `6d5d542`
- Per-address rate limiting on `/api`: requests a minute, and *distinct logins*
  an hour, which is the limit that separates a reader from a scraper. Over the
  line gets a `429` with `Retry-After` — the one non-200 the API produces — and
  the body is still a drawn card. `a14572d`
- `/health` reports the day's KV write count and turns `status` to `warning` at
  80%, which is the earliest signal of the failure that cascades. `a14572d`
- A favicon, logo and social preview, served from the Worker itself. `b443db0`
- `docs/decisions.md`, `docs/limits.md` and `docs/pending.md`. `e4eaefc`

### Changed

- Cache entries are namespaced by the deployed build, so a release cannot serve
  an entry written by the one before it, and separately versioned by *meaning* so
  that a local session cannot either. `77578d7`, `b0283c9`
- `max-age` and KV freshness became separate levers. They used to be the same
  number, which made a reader wait for the sum of both — up to four hours between
  a commit and the figure appearing. `01b4345`
- Language bars are scaled against the leading language rather than against 100%,
  so a normal breakdown reads as 6/4/2/1 instead of four bars that all look the
  same. `402eeea`

### Fixed

- The ring track was mixed towards black, which on light themes made a 33% streak
  read as about 80% filled. It is now mixed from the background. Reported from
  production. `402eeea`
- An expired cache entry is served with a `200` and `X-Stale: true` when GitHub is
  unreachable, instead of an error card. This is what stops an exhausted write
  budget from becoming an outage. `402eeea`
- KV write failures are logged rather than only swallowed. Cards quietly going
  stale was indistinguishable from a healthy instance nobody was visiting.
  `2579d44`

## 2026-07-26

### Added

- Initial service: contribution totals, current and longest streaks, and a
  language breakdown, rendered as an SVG card by a Cloudflare Worker.
  `b8b2e37`, `c737927`, `00e3d96`, `ffc3070`
- KV caching with a stale fallback under quota pressure. `5c9dba4`
- Query parameters — themes, colour overrides, `hide`, `locale`, `lang_style`
  and the rest — with every value whitelisted, and a malformed one falling back
  to its default rather than breaking the card. `7505a16`
- `/health`, and a self-contained landing page that builds the snippet for you.
  `b8b2e37`
- README, self-hosting guide and contribution docs. `023b181`
- CI running typecheck, lint and tests — inside workerd — on every push.
  `638bd8b`, `68d6beb`, `c5892ed`

### Fixed

- The card centres the measured bounding box of its content rather than the ring
  axis. A ring column is wider than its ring, and the content is not symmetric
  about it, so the old way sat about twelve pixels low. `a8cd332`
