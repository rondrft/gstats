# Decisions

The *what* is readable in the code. The *why* is what gets lost, and most of
these look arbitrary — or wrong — until you know what they are avoiding. Several
were written the obvious way first and corrected only after a test or a
screenshot proved the obvious way did not work; those are marked.

---

## Rendering

### The ring's track shares the progress arc's rotation

`src/render/ring.ts`

A ring is two concentric circles: a dim track and a bright progress arc. Both
leave a wedge unpainted at twelve o'clock, and the module's icon sits in it.

The original specification said the track should carry `stroke-dasharray="135 35"`
with **no** rotation, while the progress arc is rotated `-90°`. That does not
work, and it is worth knowing why rather than rediscovering it. An SVG `<circle>`
path starts at three o'clock. With no rotation, a 35-unit gap after 135 painted
units lands its centre about 323° round from the start — the upper *right* — not
at the top. The progress arc, rotated `-90°` with a half-gap `stroke-dashoffset`,
puts its gap at twelve o'clock. The two gaps would sit 53° apart and the icon
would cover painted track.

Both circles now take the same rotation and the same half-gap offset. Everything
is derived from `RADIUS` and `GAP`, so changing either moves the arcs, the
animation and the icon together.

### Only the streak ring shows a real percentage

`src/render/cards/terminal.ts`, `src/render/cards/gauge.ts`

The lifetime total has no natural maximum. Picking one — "1000 contributions is
full" — would be decoration impersonating a measurement, and the number in the
middle already carries the information, so that ring is always full and is
structure rather than data. The record ring is its own ceiling, likewise.

The streak ring is the one with an honest denominator: the current run against
this account's longest. It reaches full exactly when the reader is having their
best run ever, which is the thing worth showing.

The `gauge` design has the same problem and answers it differently, because a
needle at maximum reads as an assertion in a way a full ring does not: its first
dial measures the *current calendar year* against the reader's best calendar
year, and reports the lifetime total as text underneath.

### The layout is derived from the content's bounding box

`src/render/layout.ts`

Fixing the ring centres at 118/238/358 with a vertical centre of 75 looks
centred and is not. **Found by eye, then measured.** Two independent errors:

- A column is wider than its ring. `"longest streak"` is 92 units of text around
  a 59-unit circle, and the date under it can be wider still, so the group's real
  edges come from the outermost labels. The columns are not even the same width
  as each other, which means the group's centre is not its middle ring.
- The content is not symmetric about the ring axis. It runs from the top of the
  icon — above the arc — down to the descender of the date line sixty units
  below. Centring the axis left the whole block about twelve pixels low.

So the layout measures what will be drawn and centres *that*. Width is derived
from the content plus one symmetric margin, which makes the two side margins
equal by construction rather than by arithmetic somebody has to keep in step.
A consequence: the default card is 585 wide, not a round 600. That is deliberate,
not a rounding slip.

`layoutRow` is the same idea generalised, and every design uses it. A coordinate
written anywhere else is a piece that will not move with the rest.

### The theme contract beats fidelity to a mockup

`src/render/cards/pass.ts`, `src/render/chrome.ts`

The `pass` design was specified with cream paper. The registry contract requires
every design to honour `theme`. Those pull against each other and the contract
wins: a design that ignores the reader's colours is broken, not opinionated.

"Paper" is therefore the theme's own background raised a few percent towards its
text colour — it reads as stock in a dark theme and as paper in a light one, and
`theme=light` gives the literal article. `press` does the same with its one ink
accent: it is the theme's accent, so the restraint survives whichever palette is
in use. Every design draws its background through `chrome.ts` rather than naming
colours, which is what makes this free instead of six chances to forget.

### The vinyl label does not turn

`src/render/cards/vinyl.ts`

The grooves and the tonearm rotate; the centre label, which carries the lifetime
total, stays put. A number that revolves once every eight seconds is decoration,
and the entire argument for putting it on the label is that it is the figure
worth reading.

A disc of concentric circles is rotationally symmetric and would look motionless,
so the spinning group carries one radial seam. The grooves are drawn at very low
contrast on purpose: at full strength the disc stops reading as a record and
starts reading as a target.

### The heatmap reveals with a stepped clip, not 53 delays

`src/render/cards/heatmap.ts`

The effect wanted is columns appearing left to right, 8 ms apart. The obvious
implementation is a `<g>` per week with its own `animation-delay`, which needs 53
CSS rules and 53 group wrappers.

Instead one clip rectangle slides in from the left with
`steps(53, end)`. Identical effect, a few hundred bytes instead of a few
kilobytes, and — the part that matters — its resting state is *fully revealed*,
so a renderer that ignores the stylesheet shows the finished grid rather than
nothing.

The same size pressure shapes the cells. A year is 371 squares; emitting each one
individually put the document over its 12 KB budget by itself. Empty days are one
tiled `<pattern>`, and only active days are drawn, grouped by level so the fill
colour is written five times rather than 371.

### Heatmap intensity is by quartile, not by threshold

Fixed cut-offs make somebody who averages two contributions a day look inactive
all year, and somebody who averages forty look uniformly saturated. Ranking each
active day against that account's own distribution gives both a grid with
contrast. The cost is that levels are not comparable between people — which they
never really were.

Quartiles are taken over days that had *any* activity. A year is mostly zeros,
and including them would push every boundary to zero and flatten the grid to two
levels.

### Gauge needles pivot on coordinates, not `fill-box`

`src/render/cards/gauge.ts`

`transform-origin: center` with `transform-box: fill-box` is the idiomatic way to
rotate an SVG element about itself. A `<line>` has a zero-area fill box, so that
pair pivots around an undefined point and the needle flies off. The origin is
given in viewBox units instead. **Written the idiomatic way first.**

### Numbers are sized by rendered length, not digit count

`src/render/ring.ts`

`20,714` is six cells, not five: locale-aware formatting inserts separators that
occupy a full monospace cell. Sizing on the digit count overflows the ring for
any locale that groups thousands.

### The language block preserves its whitespace

`src/render/langs.ts`

The `blocks` style aligns its columns by padding a single monospaced `<text>`,
which means runs of spaces have to survive into the output. Without
`xml:space="preserve"` the XML whitespace rules collapse them and every column
drifts.

---

## Caching

### KV holds data, never rendered SVG

`src/cache.ts`

The entry is serialised `StatsData`; the card is built from it on every request.
Two things follow, and both are the point:

- Style parameters are absent from the cache key, so a reader asking for a
  different theme reuses the entry an earlier reader paid for instead of
  triggering another round of API calls. On a shared quota that is the difference
  between viable and not.
- A release that changes the renderer takes effect on the next request, because
  nothing rendered was ever stored.

What it cannot reach is the copy Camo is holding. That is governed by
`Cache-Control`, not by KV, and is the *only* reason a card can look stale after
a deploy — worth knowing before hunting for a cache bug that is not there.

### `SCHEMA_VERSION` exists alongside the build id, and reads are validated

`src/cache.ts`

An earlier version replaced the hand-maintained schema version with the deploy's
commit, on the reasoning that a deploy always changes it so nobody has to
remember. **That was wrong, and it shipped.** A deploy identity answers "is this
the same binary?"; the cache needs "does this entry still mean what the code
expects?". They coincide in production and come apart everywhere else:

- `wrangler dev` reads `SERVICE_VERSION` from `wrangler.toml`, so the build
  component is a constant. Every local session shares one namespace for ever, and
  a change to how a field is computed is invisible to the key.
- Re-running a deploy for the same commit reuses that commit's namespace, as does
  deploying, rolling back and rolling forward again.

Dumping the local store found an entry written before `calendar` existed, which
the heatmap would have dereferenced straight into a `TypeError`.

So there are two mechanisms, doing different jobs. `SCHEMA_VERSION` is semantic
and environment-independent, and is what somebody bumps when the meaning of a
stored field changes. `hasCurrentShape` validates on read and treats a mismatch
as a miss — the key is a heuristic that depends on somebody remembering, and this
is the guarantee. A missed bump now costs one extra upstream call instead of a
card that throws.

### `max-age` and KV freshness are separate levers

`src/cache.ts`, `src/index.ts`

They used to be the same number, which made a reader wait for the *sum* of both:
up to four hours between a commit and the figure appearing. They cost different
things.

`max-age` decides how often Camo comes back and asks. Those returns are answered
from KV without touching GitHub, so it spends Worker invocations and nothing
else. It is short (1800) and configurable per instance.

KV freshness decides how often *we* ask GitHub, which spends a budget every
profile on the instance shares. It is long (six hours).

Not lowering `max-age` further is deliberate: below 30 minutes the invocation
count grows linearly while the propagation gain does not — a reader still waits
for whatever fraction of the interval they happened to arrive in.

### Purging is by key prefix

`src/purge.ts`, `src/cache.ts`

A login does not have *an* entry. It has one per combination of the parameters
that shape what is fetched — `langs_count`, `lang_mode`, the exclusions, `hide`.
Deleting one would leave a stale card at whichever URL the reader actually used,
which is the failure that is hardest to notice because it looks like it worked.

Entries under other builds are unreachable from the current one and are left to
their own expiry.

### `/purge` deletes and does not fetch

Fetching there would convert a burst of pushes into a burst of API calls, which
is the exact cost the rest of the design is arranged to avoid. Fifty pushes in
ten minutes are fifty cheap deletes and one fetch, paid by whoever loads the card
next.

### The purge rate limit is a brake, not a gate

Ten a minute per token, counted in KV. KV is eventually consistent, so a burst
arriving at several locations at once can overshoot before the count catches up.
That is acceptable and deliberate: the *gate* is the token. A caller who holds it
is not the threat model — a caller who holds it and has a stuck retry loop is,
and a loose counter stops that just as well. A Durable Object would be exact and
is far more machinery than the job needs.

### Warming refreshes rather than purges, and never deletes on failure

`src/warm.ts`

Purging on a timer would guarantee the opposite of the point: every interval, the
first reader of each warmed card would be the one waiting on GitHub. So the cron
fetches and writes back.

When a refresh fails, the run logs it and moves to the next profile, and the
entry it failed to replace is left exactly where it was. A figure from some hours
ago is worth more to a reader than a miss they have to wait for — the same
reasoning that makes this a refresh rather than a purge.

Only the default parameter combination is warmed. Covering all of them would
multiply the cost by the number of ways a URL could have been written.

---

## Data

### The per-repository cap is solved iteratively, and does not apply below seven repos

`src/languages.ts`

Both halves were wrong on the first attempt and **the tests caught both.**

*Why iteratively.* The obvious implementation caps each repository at 15% of the
uncapped total and renormalises. That does not cap: a repository holding 95% of
an account is cut to 15% of the original total, but everything else was tiny, so
after renormalising it is back above 70%. The ceiling has to be a fixed point of
the total it is a fraction of, which is what the loop finds. It converges
downwards in a handful of passes.

*Why not below seven.* With fewer than `1/0.15` repositories no allocation can
put every one of them under the cap, and forcing it flattens the account to equal
shares — turning a 9:1 split between two projects into 1:1. A cap is meant to
bound influence, not erase differences, so it engages only when it is satisfiable
by all of them at once.

### Languages are excluded by default rather than included

Ten by-product languages — `HTML`, `CSS`, `Dockerfile`, `Shell` and so on — are
dropped unless asked for. They are generated, configuration, or markup that
arrived with a framework: present in the byte count, absent from the work.

Excluding by default produces the right list for most people and makes the
minority edit their URL. Defaulting the other way makes everybody else edit
theirs. `include_langs` brings any of them back.

None of this measures skill or effort and could not. It is a heuristic tuned to
be wrong less often than raw byte counts are, and it says so in the code.

### Forks are excluded from language totals

Counting them credits the fork's author with the upstream project's entire
history, which is the single most common way these cards end up lying.

### Contribution years are batched as GraphQL aliases

`src/github/contributions.ts`

`contributionsCollection` accepts at most one year per call, so a lifetime total
needs one window per calendar year since the account was created. Those go in a
single query as aliased fields rather than one request each: a ten-year-old
account costs two requests instead of eleven, and the hourly quota is the
scarcest thing here. Verified against the live API before relying on it.

Windows are aligned to calendar years rather than rolling 365-day spans, so they
are provably disjoint — which is what makes summing their totals correct rather
than approximate. Only the two most recent windows request the daily calendar;
that covers 366 to 730 days depending on the date, always more than the streak
needs, and the rest come back as one integer each.

### The stored calendar is positional, not dated

`src/github/types.ts`

A year of `{date, count}` objects is roughly fifteen times the JSON of a start
date plus an array of counts — and it sits in the cache entry of every profile
whether or not the reader asked for a design that draws it.

### Streaks are computed in UTC, and today's zero does not break one

`src/streak.ts`

A Worker runs in whichever colo is closest to the reader, so anything derived
from local time would report a different streak per continent. The module reads
no clock at all: the reference day is an argument.

A zero on today does not end a streak. The day is still in progress, and
collapsing somebody's streak at 00:01 UTC because they have not pushed yet is
simply wrong. A zero on the day before is a genuine break.

---

## Service shape

### Failures are drawn, never signalled

`src/index.ts`, `src/render/error-card.ts`

`/api` always answers 200 with an SVG. A README consumes it as `<img>`, where a
non-200 is the browser's broken-image glyph and a JSON body is nothing at all. A
card that says "user not found" in the same typeface as the real thing is
diagnosable at a glance.

Error cards get a one-minute lifetime rather than the card's `max-age`: a rate
limit or an upstream blip resolves itself long before that would.

`/purge` and `/health` answer JSON, because scripts call those and a script
cannot read an SVG.

### A malformed parameter is never fatal

`src/params.ts`

Anything that fails validation falls back to its default. The reader cannot see
an error body, so the card has to render regardless. `username` is the one
exception — it has no sensible default — and it is validated against GitHub's own
login rules before it can reach a URL, a GraphQL variable or the document.

An unknown `card=` resolves to the default in silence, for the same reason: a
typo in a README should degrade to a working card.

### Credentials sit behind `TokenProvider`

`src/github/client.ts`

A personal access token gives the whole deployment one 5,000/hour budget. A
GitHub App gives every installation its own, which is the only way this scales
past a few thousand distinct profiles. Isolating credential lookup behind one
interface keeps that migration to a single new implementation.

### The cache key hash is FNV-1a, not WebCrypto

It only has to distinguish a handful of parameter combinations per user, and
collisions between different shapes for the *same* user are the only ones that
could matter. WebCrypto would make the key path async for no gain.

### The landing page is one self-contained document

`src/landing.ts`

No build step, no framework, no external script. It is served by the same Worker
that renders the cards; adding a bundler to serve one page would double the
project's moving parts to save nothing.

The embedded script is written without template literals, because the whole
document is itself a template literal and a stray backtick is a syntax error that
ships silently — the HTML still renders and every control simply stops working.
**That happened once**; `test/landing.test.ts` now parses the script.

The gallery is a design selector over a grid of themes, not a flat grid of every
pairing: six designs times six themes is thirty-six cards nobody scrolls through.
