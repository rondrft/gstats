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

### The ring track is mixed from the background, not dimmed from the colour

`src/render/color.ts`

The track is the unfilled part of the ring, so it always covers the full arc. If
it reads as strongly as the progress arc, the ring looks nearly complete whatever
the value is.

It was derived by multiplying the arc colour towards black. On a dark theme that
lands near the background and works. On a light one it does the opposite:
`#BC4C00` became `#291100`, an 18:1 contrast against white, and a 33% streak ring
read as about 80% filled — the track was the boldest thing in it. **Reported from
production, and the first place looked was the `stroke-dasharray`, which was
correct all along.**

It is now a step *from the background towards the colour*: 1.4:1 on light, and
the dark themes unchanged. A test asserts the track stays under 3:1 against the
background on every theme, since the next theme somebody adds will not have this
in mind.

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

### The pass draws its own frame, so every edge on it is derived from the content box

`src/render/cards/pass.ts`

The other five designs call `chrome.frame`, which is inset from the card's four
edges. The `pass` frame cannot: it has to start where the coloured band ends, so
this is the one design that draws its own — and once it was drawing its own, it
started choosing its own coordinates. It ended up with three: a frame at 8, band
type at 14 and the content at 20.

**Every pair of those was symmetric about the card's own axis, and it still
looked wrong.** The report was "the margins are asymmetric", which was the
natural way to describe what it does to the eye: down the left edge you met a
hairline, then the brand, then the first column, no two of them the same distance
from the edge. Symmetry is not the property that was missing — agreement is.

So the card now has one horizontal number. `layoutRow` turns it into a content
box, the band's brand and login sit on that box's two edges, and the frame hangs
exactly halfway between the box and the card on every side it has. The footer
comes off the frame's own bottom edge rather than the card's, which is what stops
"move the frame" from silently changing how much air the smallest type on the
card has.

Two details that are easy to get wrong the other way. The inset is taken from the
**measured** content box and not from the margin that was requested: the card's
width is rounded to a whole number, so the two differ by up to a quarter of a
unit, and it is the measured gap the eye compares. And the box is rounded once,
where it is built, because four coordinates that have to agree with each other
cannot each round their own half of a card width.

`test/layout.test.ts` asserts both properties over nine parameter combinations,
by reading the coordinates back out of the rendered document. It fails on the
geometry described above.

### The service's name is a constant; the theme's is not

`src/service.ts`

The rename to `gstats` reached the landing page, the credit line and every
document, and missed the `pass` band, which went on printing `PHOSPHOR STATS`
onto every card drawn with that design for three commits — including the sample
card in the README, which nothing re-renders. The name was a literal in each
place that drew it, so there was nowhere to change it once.

`SERVICE_NAME` is now that place, and a test in the per-design battery asserts
that no design draws the old name. What deliberately does **not** come from it:
the `phosphor` theme, the legacy hostname, and the repository's history. Those
are all things somebody else has written down, and the URL contract puts them
out of reach — which is the distinction the constant exists to make explicit
rather than to blur.

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

### Language bars are scaled against the leader, not against 100%

`src/render/langs.ts`

Six cells across the whole 0-100% range makes one cell worth seventeen
percentage points. A normal breakdown — 41/25/17/10 — drew as 2, 2, 1, 1: four
bars that look the same and say nothing the percentages beside them do not
already say. **Shipped that way and was visible in production.**

Scaling against the leading language spends the resolution where the differences
are, and the same breakdown reads 6, 4, 2, 1. The trade is real: a bar now
compares within one card rather than between two. That is the comparison a reader
actually makes, and the absolute figure is printed next to it either way.

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

### The cache holds repositories, and the language ranking happens at render time

`src/languages.ts`, `src/render/cards/index.ts`, `src/cache.ts`

The same argument as "KV holds data, never rendered SVG", carried one step
further. `lang_mode`, `langs_count`, `exclude_langs` and `include_langs` were all
in the cache key, so every combination somebody wrote into a URL bought its own
round of GitHub calls — for repositories the instance already held. None of those
four changes the request sent upstream. They change how its answer is read.

So the entry holds the repositories and the ranking runs when the card is drawn,
which takes all four out of the key the way `theme` always has been.

**The cost is entry size, and it had to be measured rather than assumed** —
`pending.md` carried this for months with "it may be the wrong trade" attached,
which was the right instinct. Storing the fetched `RepoLanguages[]` as it comes
is about **53 KB** at the 300-repository pagination cap, nearly all of it the
same few language names and Linguist colours written out across three thousand
edges. Interning them into a table and referring to them by index takes a real
account at the cap to **11 KB**, and a typical one to under 2 KB. The same trade
`CompactCalendar` makes, for the same reason.

That is affordable, and the reason is worth stating precisely, because the
intuition points at the wrong resource: **KV bills writes per operation, not per
byte.** A larger entry costs nothing against the budget in
[limits.md](limits.md), which is the thing that actually runs out. The value
limit is 25 MB and the free plan's storage is 1 GB against roughly 3 MB at 240
active profiles. What the change *saves* is writes, by collapsing every ranking
variant of a profile onto one entry.

One thing it does not buy, contrary to what it looks like it should: it does not
prevent a stampede after a release. The cache key carries the deploy's commit, so
**every deploy already retires every entry** whether or not anything about
languages changed. What it removes is the need to bump `SCHEMA_VERSION` when the
ranking changes — which matters under `wrangler dev`, where the build id is a
constant, and is exactly the case that version exists for.

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

### The quota reading lives in the isolate, not in KV

`src/cache.ts`

This has been wrong twice, in the same direction both times.

It began written on every cache miss, alongside the stats entry — *half* of every
KV write the service performed, spent on a diagnostic. Sampling it every five
minutes fixed the proportion but left a **fixed floor of 288 writes a day**, 29%
of the free allowance, paid whether the instance served two profiles or two
hundred. A fixed cost to keep a diagnostic current is worse than it looks,
because the ceiling has to be paid out of it before anything useful is served.

It is now a module variable. `/health` reads the isolate's own observation, and
KV sees the reading only when `remaining` crosses below 1,000 — and then at most
once every five minutes while it stays there, because that is exactly when the
instance is busiest.

**It is lossy on purpose.** An isolate is recycled and takes its reading with it,
so `/health` served by a cold one reports whatever KV last heard, or `null`. That
is an acceptable answer for a diagnostic. The case that is *not* diagnostic — the
budget actually running out, which is what the stale-card fallback keys off — is
written through, so it survives the isolate that noticed and is visible from
every other one.

The same reasoning is why the low-quota threshold is the trigger rather than a
timer. Timers cost the same whether anything is happening or not; a threshold
costs nothing until something is.

### A failed write is swallowed, and said out loud

`src/budget.ts`, and every `catch` around a `put`

Every KV write in this service is best effort. Losing one costs one extra
upstream call on the next request; failing the request costs a reader a broken
image in a README they do not control. The trade is not close, and it is the
same one `docs/limits.md` describes as the expected shape of running out on the
free plan: **the figures freeze, they do not disappear.** A card is built from
the data before anything tries to store it, so a refused `put` cannot reach the
response.

What was missing was the other half. Swallowed is not the same as unnoticed, and
the symptom of an instance that had exhausted its allowance — cards quietly
going stale — is indistinguishable from a healthy instance nobody is visiting.
Every one of those catches now reports, with the operation that failed and the
reason.

Throttled to one report a minute per isolate, carrying the count it stands for.
An exhausted allowance does not fail one write, it fails every write for the
rest of the day, so a line per failure would be a line per cache miss and would
bury everything else the instance logs.

Together with the `writes` figure at `/health` that makes both halves visible:
that one says the allowance is nearly gone, this one says it is gone.

The tests for this are worth more than usual and were nearly worthless. `/api`
answers `200` for an error card too, so asserting the status proves nothing —
`test/kv-failure.test.ts` asserts that the body carries figures, which is the
thing that actually distinguishes "frozen" from "broken".

### The write budget is counted in memory and sampled into KV

`src/budget.ts`

Running out of KV writes is the failure that cascades — nothing is cached, so
every request is a miss, so the GitHub quota that had forty-five times the
headroom drains in minutes — and until this existed there was no way to see it
coming. The first symptom of the whole sequence was somebody's card going stale.

The constraint writes itself: **a counter that wrote to KV on every write it
counted would double the quantity it exists to protect.** So the isolate
accumulates and flushes every 25, and the flush counts itself, which puts the
overhead at one write in 26 — and makes it proportional to traffic rather than a
fixed floor, which is the mistake the quota reading made twice.

Two things are given up deliberately. It **undercounts**: writes held by an
isolate that dies before it flushes are lost, and two locations flushing at once
can each read the same total and overwrite each other. It is a floor, not an
audit, which for "am I about to run out?" is the useful direction to be wrong in.

There was a third source of undercount that was not deliberate at all, and it is
worth recording because "it is a floor anyway" is exactly the reasoning that let
it sit there. The tally is keyed by UTC day, and a write arriving on a new day
**replaced** the tally rather than flushing it — so every isolate silently
dropped whatever it was holding at midnight, up to twenty-four writes each,
every night. A floor is only useful if it is not wrong by much, and the
allowance resets at the same boundary, so the loss landed on the figure at its
least informative moment and made the 80% warning arrive late in the one case it
exists for. Midnight is now a flush. The flush counts itself against the day it
closes rather than the day it happens on, which is one write in the wrong column
against the twenty-four it recovers.
And **deletes are not counted**, because Cloudflare bills them against their own
daily allowance and folding them in would misreport the one figure this is about.

`status: "warning"` at 80% rather than a number to interpret. Anyone reading
`/health` while something is wrong is not in a state to divide.

### The profile count is read out of the cache, not counted on the way in

`src/usage.ts`, `src/cache.ts`

[limits.md](limits.md) expresses the ceiling in **active profiles** — about 240
of them on the free plan — and for a long time the instance had no idea how many
it had. The figure that decides whether to pay Cloudflare five dollars a month
was a guess.

The obvious implementation is a set of logins in KV, updated on the way in. It
is also the third appearance of the mistake this file already records twice, and
the worst of the three. Every isolate discovers every login *separately*: a
login is new to an isolate whether or not another isolate has already written it
down, so the cost is not "one write per profile" but **one write per profile per
isolate**, on a service that deliberately runs its cheapest path — a cache hit —
without touching KV at all. A counter that spent a tenth of the allowance to
report on the allowance would be answering the question by making it worse.

So nothing is counted on the way in. The observation that makes that possible is
that **the service already stores the answer**: a stats entry survives seven
days against six hours of freshness — a property that exists for the stale
fallback, not for this — so listing the cache is a list of every login fetched
in the last week, free, exact, and already paid for. A rollup on the cron folds
that listing into a thirty-day ledger. One write every six hours, four a day, and
nothing at all on the request path.

Three details that are easy to get wrong the other way:

- **The listing crosses builds.** `cachePrefix` is namespaced by the deploy, and
  reading through it would have counted only what had been requested since the
  last release — which for an instance that deploys on every push is a number
  with no meaning. `CACHE_KEY_ROOT` is the schema alone, so entries written by
  the previous build still count towards the profiles the instance is carrying.
- **A login is read off the end of the key, not the start.** The shape is
  `<schema>:<build>:<login>:<fingerprint>`, and the build id is whatever
  `SERVICE_VERSION` was set to. Splitting from the left assumes nobody ever
  deploys with a colon in it; the fingerprint is always last.
- **The ledger stamps a day per login, not a flag.** Without that there is no
  window, and "profiles ever seen" grows for ever and stops describing anything.

One property worth having deliberately rather than by luck: **the figure covers
both hostnames.** The two Workers share a KV namespace, so a profile fetched
through the old name is in the listing the new one folds, and the rollup runs on
the primary alone because `[env.legacy]` sets `crons = []`. Counting on the
request path would have needed both Workers to agree about it; deriving it from
the shared cache means there is nothing to agree about.

What this cannot see is a login that was never successfully fetched — a typo, an
enumeration attempt, a profile requested while GitHub was down. That is the
right exclusion rather than a limitation: those cost the instance nothing to
keep, and counting them would let anybody inflate the number the paid-plan
decision is made on.

### The generator debounces its preview, because a keystroke was a card request

`src/landing.ts`

The generator repaints the preview by assigning to an `<img>` src, and it did
that on `input` — which fires on every keystroke. So somebody typing a login
into the box fetched a card for **every prefix of it**.

The reason that is not a rounding error is the part worth remembering: **most
prefixes of a real GitHub login are themselves real GitHub logins.** Short
logins are all taken. So the prefixes did not bounce off as 404s; they resolved,
and each one cost three to five GraphQL queries and a KV write — against the
one resource [limits.md](limits.md) says the service runs out of first. One
visitor typing `bautista-diaz` left `b`, `ba`, `baut`, `bauti`, `bautist`,
`bautista`, `bautista-d` and `bautista-diaz` in the cache. Three visitors did it
in a week. **Found by reading the KV key listing**, which is also the only place
it was visible: every one of those looks exactly like a profile somebody
embedded.

The prefixes that are *not* real accounts were the cheap case — an upstream
404, no entry written — and still spent a shared quota on nothing.

The fix is a 500 ms debounce on the preview and nothing else. The snippet is
text and stays instant, because it costs nothing and is what people are actually
watching. The same timer fixed a second case nobody had noticed: the colour
pickers fire `input` continuously while being dragged, and colours are not in
the cache key, so every step of a drag was a request for a card the service had
already drawn. `repaintPreview` also refuses to reload a URL that is already on
screen.

`test/landing.test.ts` runs the script against a stub DOM and types a login one
character at a time. A textual assertion that the source contains `setTimeout`
would not have caught this coming back.

### A profile that was looked up once is not an active profile

`src/usage.ts`

The ledger records `[first, last]` per login rather than just the last day, and
`active30d` counts only logins folded on **more than one day**. `seen30d`, next
to it, counts everything.

This is not a filter bolted on after the fact — it is the figure finally
matching its own definition. [limits.md](limits.md) has always defined an active
profile as one somebody is loading often enough that its entry is refetched as
soon as it goes stale: four misses a day, which is where the entire ceiling
comes from. A login fetched once and never again costs one write in its life.
Counting the two the same way overstated the number the paid-plan decision is
made on, and the first version of this counter did exactly that.

The bug above is what made the gap visible: `active30d` read 35 on an instance
serving fewer than ten people. Both figures are reported, because the gap
between them is itself the diagnostic — a wide one means something is generating
profile lookups nobody asked for, which is precisely how the keystroke problem
was found.

The cost is that a genuinely new profile takes up to a day to start counting.
That is the right direction for a capacity figure: it is slow to admit a new
tenant and quick to forget a stranger.

### Failed lookups are not cached, and that is the cheaper answer

`src/stats.ts`

A login that does not exist writes nothing to KV — the error propagates and the
card is drawn from it. Caching those would look like an obvious saving and is
the wrong trade for this service specifically.

A negative entry costs **one KV write** to save **one GraphQL query**. Writes
are the resource with 1,000 a day and the cascade behind it; GraphQL queries are
the resource with 120,000 a day and forty-five times the headroom. Paying the
scarce one to protect the abundant one is the same inversion `limits.md` exists
to argue against, and at enumeration scale — where a negative cache sounds most
attractive — it would be actively worse: every invented login would become a
write, which is exactly the traffic shape the login rate limit exists to stop.

The error card carries a one-minute `max-age`, so a client that asks again
immediately is answered without reaching the service at all. That is the layer
where a failure should be cached, and it costs nothing.

### `GET /profiles` reads the cache, not the ledger

`src/index.ts`, `src/usage.ts`

`/health` answers *how many*, which is the capacity question and needs no
identities — so the ledger behind it stores hashes and is structurally unable to
answer *which*. That is deliberate, and it left a real gap: looking at actual
profiles is how edge cases get found, and the keystroke bug above was found
exactly that way, by hand, in a key listing.

So there is an endpoint for it, and three choices in it are worth stating:

- **It derives the list from the cache key listing, live**, rather than from the
  ledger. The keys carry the login in clear for the seven days an entry lives,
  so this stores nothing new and the ledger stays hashed. Adding plaintext
  logins to the ledger to serve this would have traded a permanent record for a
  convenience.
- **Its window is therefore the cache's seven days, not the ledger's thirty**,
  and the response says so in a field rather than leaving the two to be
  confused. They are different questions and they have different answers.
- **It is behind `PURGE_TOKEN` and answers `404` without it.** One secret rather
  than two because whoever holds it is running the instance, and anybody running
  the instance can already read every key in the namespace with `wrangler kv key
  list` — a second token would imply a boundary that does not exist. The `404`
  is the point of the pairing: a `401` would confirm to an anonymous caller that
  a list of users is kept here, which is the one thing the rest of this design is
  arranged not to advertise.

### The repositories query is pinned to public, and that is a decision

`src/github/languages.ts`, `test/languages.test.ts`

The languages query carries `privacy: PUBLIC` alongside `ownerAffiliations:
OWNER` and `isFork: false`. It reads like a limitation of whatever token happens
to be in use. It is not — it is a constraint on what the card is allowed to mean,
and it is now held by a test so that nobody "fixes" it in six months.

The case that makes it load-bearing does not exist yet. A GitHub App
installation token reaches whatever repositories the installer granted it,
including private ones. On the day authentication changes, this one line is the
difference between "installing the App is a quota improvement nobody can see"
and "installing the App silently publishes your private language breakdown to
every reader of your README". The README calls giving the shared token private
access *a leak wearing a feature's clothes*; the self-inflicted version is the
same leak and harder to notice, because the person enabling it believes they are
helping with a quota.

Two other things follow from it, and both are worth more than the line costs.
The card keeps the same meaning for everybody, whoever fetched it and however —
which is what the URL contract is about. And the pitch for the App can be honest
in one sentence: it changes nothing about your card.

### Requests are counted, and nothing about who made them is

`src/usage.ts`, `src/index.ts`

Two hundred profiles nobody looks at and twenty embedded in busy READMEs are the
same number of profiles and nothing like the same load, so `active30d` alone
would be misleading in the direction that costs money. The request figure is the
correction, and it is also the reading against the *other* free-plan ceiling —
100,000 Worker invocations a day — which nothing else here reports.

It is counted the way the write budget is, and inherits the same honest
undercount. It costs one write per two hundred requests, which is the largest of
the three diagnostic line items and the only one somebody trimming a tight
budget would have a case for removing.

**Nothing about the caller is recorded, anywhere, at any resolution.** No
address, no user agent, no referrer, no per-request timestamp — the request
figure is a single integer per UTC day, and the profile ledger holds a short
hash of a login rather than the login. The logins are public and are in the
cache keys already, so the hash buys no secrecy and is not claimed to: a 32-bit
hash of a GitHub login is enumerable by anyone who cares. What it buys is that
the one record here that outlives a cache entry cannot be read as a list of
anybody, and cannot quietly become one later. A public service that counts
things should be able to say exactly what it counts, and the README says it.

### A failed fetch serves the expired entry

`src/stats.ts`, `src/index.ts`

Entries survive seven days against six hours of freshness for exactly this: when
GitHub is unreachable — rate limited, 5xx, timeout, network — an expired entry is
served with a `200`, `X-Stale: true` and a ten-minute lifetime. The error card is
only for a profile that has never been fetched at all.

A card a few hours behind is worth more to a reader than a card that says
"upstream error", and this is the step that stops an exhausted write budget from
becoming an outage; see [limits.md](limits.md#the-cascade).

The short lifetime carries no `stale-while-revalidate` on purpose. That directive
would let Camo keep showing the stale card past even the ten minutes, which is
the opposite of what is wanted while the service is trying to recover.

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
that shape what is stored — `hide`, and `tz`. Deleting one would leave a stale
card at whichever URL the reader actually used, which is the failure that is
hardest to notice because it looks like it worked.

There used to be four more, and the prefix is what made removing them a
non-event: purging never named the variants, so it did not have to learn that
there are fewer of them.

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

### The streak's day boundary is Anywhere on Earth, not UTC

`src/streak.ts`, `src/stats.ts`

A Worker runs in whichever colo is closest to the reader, so anything derived
from the machine's own local time would report a different streak per continent.
The module reads no clock at all: the reference day is an argument. That much was
always right. Which day to pass it was not.

It used to be the UTC day, which is the worst available answer for roughly half
the planet. For anybody west of Greenwich, a commit late on their Monday evening
is already Tuesday in UTC — so through the last hours of their day the card is
counting a day they have not finished, and reports a streak one short. It was
documented as a limitation for months on the grounds that a boundary has to be
drawn somewhere. True, and it was drawn in the one place that is wrong for a
continent's worth of readers rather than for nobody.

The default is now **Anywhere on Earth** — the date in UTC−12, the last zone on
the planet to leave any given day. A day counts as long as it is still that day
somewhere, so no reader's streak is ever cut before their own day is over. The
cost is the opposite error: a new day takes up to twelve further hours to be
picked up. That is much the more benign of the two. One shows a figure briefly
stale; the other shows a figure that is wrong, and wrong in the discouraging
direction, to somebody who did the work.

`tz` takes an IANA zone for anybody who wants theirs exactly. It is validated
against `Intl.supportedValuesOf('timeZone')` — the runtime's own list rather than
a table here that would rot as IANA moves — matched case-insensitively, and
anything unrecognised is silently the default. It is in the cache key, because
the streak is computed before the entry is stored; almost every reader takes the
default and shares one entry.

**The arithmetic special-cases none of this.** It anchors on the most recent day
that had activity and measures the gap from there to the reference day. One rule
then covers every zone, including the ones where the gap is *negative*: a reader
in UTC+14 can commit on a date Anywhere on Earth has not reached yet. Starting
from "today" and walking backwards, which is the obvious implementation, cannot
see that day at all.

A zero on the reference day does not end a streak — one day of silence is
allowed, because the day is still in progress. Two is a genuine break.

### The fetch window and the reference day are different days

`src/stats.ts`

Conflating them costs real contributions, in the direction the change above
exists to avoid. Anywhere on Earth is up to twelve hours behind UTC, so asking
GitHub for contributions "up to AoE today" would discard everything done since
midnight UTC — and the streak would come out *worse* than the UTC version it
replaced.

So the upstream window always runs to the end of the UTC day, and the reference
day is only what the answer is then interpreted against. The calendar covers both
because it is fetched to the wider of the two.

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

There is one exception, below.

### The rate limit refusal is the one non-200, and it is still drawn

`src/index.ts`, `src/ratelimit.ts`

A caller over their own limit gets `429` with `Retry-After`. That breaks the rule
above, and it is the right break: every other failure is something the reader
cannot act on and the service cannot signal, whereas this one is *addressed to
whoever is generating the traffic*. A client that ignores `Retry-After` because
the service answered 200 is a client that keeps hammering, and a status of 200
would be a lie told to the only party able to stop.

The body is a drawn card anyway. The rule that produced the rest of the error
cards has not gone away — somebody's README is still an `<img>` — so the refusal
says `too many requests, wait 1m` in the same typeface, in the caller's locale
and theme. An empty body or a JSON one would leave a reader with nothing at all;
this at least leaves them something to read if they open it. `no-store`, because
a refusal that lapses in a minute must not be pinned to the URL by an
intermediary that will still be holding it an hour later.

The copy is deliberately not the `rate limited` used for GitHub's own quota. The
two mean opposite things to whoever reads the card: one is a shared budget nobody
can do anything about, the other is the caller's own traffic and is theirs to
fix.

### The limits are in the Worker, not in the WAF

`src/ratelimit.ts`, `wrangler.toml`

This project's own documentation recommended a WAF rate limiting rule for
months. **It was not implementable.** WAF rules are configured per zone, and the
default deployment target — a `workers.dev` subdomain — is not a zone anybody but
Cloudflare can add rules to. The instructions described a dashboard page that,
for this instance, has nothing to add a rule to.

Cloudflare's Rate Limiting binding runs inside the Worker and needs no zone,
which is the whole reason it is used here. Two of its properties shaped the code
around it:

- **The window is fixed at ten or sixty seconds.** An hourly budget cannot be
  expressed with it at all, which is why the distinct-login ledger is a module
  variable and why `pending.md` still carries an item about making it exact.
- **The allowance is declared in `wrangler.toml` and cannot be read back at
  runtime.** So the declared allowance is treated as a *token budget* and the
  configurable limit decides what one request costs against it — which is what
  makes `API_RATE_LIMIT` a variable rather than a redeploy of the binding.

The same zone trap catches the Cache API, which is a documented no-op on
`workers.dev` and would otherwise have been the obvious home for the ledger.
Anything that sounds like "just use the edge for this" is worth checking against
that constraint first.

### The second limit counts distinct logins, not requests

`src/ratelimit.ts`

Thirty requests a minute is generous for a reader — a card is one request every
half hour — and useless as a description of abuse. Thirty *misses* a minute is
43,000 KV writes a day against an allowance of 1,000.

What separates the two populations is breadth. A reader loads one or two profiles
and reloads them; a scraper walks logins it has never asked for, and every one of
those is a guaranteed miss worth three to five upstream queries and a write. So
the budget is twenty distinct logins an hour per address, and a login already
counted is free however many times it is asked for again.

Both limits count cache hits. A hit still costs an invocation, and a limit that
applied only to misses would be avoided by asking for one popular profile in a
loop.

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

### Icons are bundled as modules, not as static assets and not as base64

`src/brand.ts`, `wrangler.toml`

A Worker has no static file server, so an icon is either a route or a separate
product. Three ways to have one, and the deciding numbers:

**Workers static assets** (`[assets]`) keeps binaries out of the bundle
entirely, which sounds like the answer until you count what it costs: a routing
layer that matches *before* the Worker script, in front of a service whose `/`
is generated by that script. Real config, real precedence rules, a new surface
in the test harness — to avoid spending 8 KB of a 3 MB allowance.

**Base64 in a source file** needs no config, and inflates every binary by a
third while putting an unreadable blob in source that nothing can verify against
the file it came from.

**Wrangler's module rules** — `Text` for `.svg`, `Data` for `.png` — bundle the
files as they are. The files stay real files under `assets/brand/`, so the
README, GitHub and the Worker all point at one copy and it cannot drift. No
base64, no build step, no routing layer. Measured cost of the first two icons:
117.02 KB to 119.46 KB.

Only what the landing page references is imported. `logo-512.png` and
`social-preview.png` are in the repo and deliberately not bundled — the second
is 69 KB of already-compressed PNG, over half the bundle, to be fetched a
handful of times ever by scrapers. `og:image` points at GitHub's copy of it
instead, which is also the copy uploaded by hand as the repository's social
preview.

The icons are the only responses this service serves that will never change for
a given URL, so they are the only ones that get a year and `immutable`. A card
is a live figure and is cached in half hours. If an icon ever does change, it
changes under a new name.

They are exempt from the rate limit for the same reason `/health` and the
landing page are: a browser fetches the icon alongside the page rather than as a
separate act of traffic, and throttling it would only break the tab icon of
somebody who shares an address with a scraper.

### The old hostname is a second deploy of the same Worker, not a redirect

`wrangler.toml`, `[env.legacy]`

**This is the entry to read before deleting anything that looks like a leftover.**
The service answers on two hostnames: `gstats.rondrft.workers.dev`, and
`phosphor-stats.rondrft.workers.dev`, which is what it was called first. The
second one is a full deploy of the identical Worker, from the same commit, bound
to the same KV namespace.

It exists because of the URL contract. A card URL is pasted into a README once
and then nobody looks at that page again — that is the whole premise the rest of
this document is arranged around — so the old hostname has to keep working
indefinitely, not for a deprecation window.

**A 301 was the obvious answer and is the wrong one.** GitHub serves README
images through Camo, and a redirect makes every one of those cards depend on
Camo following it. That is a behaviour of somebody else's proxy: undocumented for
this purpose, free to change, and not something to stake a permanent promise on.
Serving the same bytes from both names depends on nothing outside this
repository. It costs one extra deploy step and some duplicated configuration,
which is the cheaper side of that trade by a wide margin.

Three consequences follow from the two Workers sharing one KV namespace, and all
three were checked rather than assumed:

- **The cache is shared, which is the point.** Both deploys must pass the *same*
  `SERVICE_VERSION`, because it is part of the cache key. Deploy them from one
  commit or they silently stop sharing entries and each pays its own misses out
  of a single write budget. `pnpm deploy` and the CI workflow both do this.
- **The write budget is shared, and correctly so.** `budget:writes:<day>` is
  deliberately not namespaced by build, and the 1,000-a-day allowance it measures
  is per *account* — so both Workers counting into one key is the honest total
  rather than a collision. The flush is a read-then-write with no atomicity, so a
  second Worker makes it undercount a little more. It was already a floor rather
  than an audit, and a floor is the useful direction to be wrong in.
- **The rate limits are per Worker, so they are effectively doubled.** The
  Rate Limiting binding's counters are scoped to the script, not to the
  `namespace_id`, and the distinct-login ledger is a module variable — so an
  address willing to use both hostnames gets both allowances. Both limits are
  brakes rather than gates, the ceiling that matters is still KV writes, and the
  deprecated hostname's share of traffic only falls. Worth knowing before
  quoting the numbers in `limits.md` as exact.

**Secrets are per Worker, not per account.** `GITHUB_TOKEN` and `PURGE_TOKEN`
have to be set twice, once with `--env legacy`. Forgetting is not subtle: the old
hostname serves the `GITHUB_TOKEN is not set` card to everybody still using it.

Warming runs on the primary only. The cron is inherited by environments, so
`[env.legacy.triggers]` sets `crons = []` explicitly — the two share a cache, and
a second warmer would refresh the same entries at roughly a fifth of the free
plan's daily writes.

### Every deploy opens a window where the two Workers disagree

`src/index.ts`, `/health`

A deploy updates the two Workers one after the other, and each takes its own
time to reach every colo. For a minute or two afterwards they can be running
different commits — **and `SERVICE_VERSION` is part of the cache key**, so while
that lasts the shared cache is not shared. Each Worker reads and writes its own
namespace and pays its own misses, out of one KV write budget. Observed in
production the first time this architecture was deployed: `gstats` reported
`bcec7b3` while `phosphor-stats` still reported `d4ea76a`. It resolved itself in
under two minutes.

It is self-correcting and mostly harmless. It is worth writing down because the
symptom — a burst of writes and upstream calls with no traffic to explain it — is
one somebody will otherwise diagnose as a caching bug, three months from now,
without ever suspecting that the two halves of the service briefly stopped
agreeing on which cache to use.

`/health` reports `target` alongside `version` for exactly this. Without it the
two hostnames answered identically and the question could not even be asked:

```bash
want=$(git rev-parse --short HEAD)
for h in gstats phosphor-stats; do
  curl -s "https://$h.rondrft.workers.dev/health" \
    | jq -r --arg want "$want" '"\(.target)\t\(.version)\t\(if .version == $want then "ok" else "STALE" end)"'
done
```

**Comparing the two against each other is not enough, and that is worth being
precise about because the obvious check gets it wrong.** This

```bash
diff <(curl -s https://gstats…/health | jq -r .version) \
     <(curl -s https://phosphor-stats…/health | jq -r .version)
```

passes whenever they agree — including when they agree on the *previous* commit
because neither has propagated yet. It was written that way here first, and it
reported "converged" against a build two commits old. The version has to be
compared against the commit that was deployed, which is what `$want` is for.

Run it a minute *after* deploying, never in the same command — the same trap as
propagation generally, and this project has been caught by that one more than
once.

### The sample cards are file snapshots, checked against the renderer and not against production

`test/samples.test.ts`, `docs/assets/`

The six cards in the README are rendered output committed as files. Nothing
regenerated them, so `pass.svg` sat three commits behind the code — showing a
notch painted on the accent band and a cramped stub, both already fixed — and an
external report arrived about two defects that were closed. **The most-read
output this service has was the only output nothing checked.**

They are now file snapshots: `pnpm test` compares each one against what the
renderer draws and fails on any difference, `pnpm samples` writes them back, and
a seventh design fails the suite until it has a sample.

**Fetching them from the deployed instance was the obvious mechanism and is the
wrong one for the assertion.** Everything on a live card moves: the figures daily,
the date `press` prints, and the heatmap's element count with every day that
becomes active. A byte comparison against production would fail every morning for
reasons outside this repository, and a check that cries wolf is one people re-run
without reading. It would also be **green on the failure it exists to catch** — a
stale committed asset and a stale deploy agree with each other, which is the same
reason `/health` has to be compared against the commit that was deployed rather
than against the other Worker.

So the profile is a snapshot of the live instance taken by hand and frozen in the
fixture. The figures stay plausible and the six stay consistent with each other,
while the assertion is the only one a test can honestly make: does the committed
file match what this code draws? Two figures on it are chosen rather than
captured — the calendar and the year totals the `gauge` needles measure — because
no card prints them and they cannot be recovered from rendered output.

### The default snippet wraps the card in a link, and the plain one is one click away

`src/landing.ts`, `README.md`

The generator hands over HTML with the card inside an `<a>` to this project, and
offers the plain markdown image beside it. Three things were checked rather than
assumed, through GitHub's own markdown API:

- `<a href>` and `<img alt src>` both survive the README sanitizer, with the href
  intact.
- The rendered `<img>` is **identical** either way — same Camo URL, same `alt`,
  same `max-width` — so the card looks the same and is cached the same.
- A plain markdown image is *already* wrapped in a link by GitHub, to the Camo
  copy of the image. So the choice is not "link or no link", it is where the click
  goes.

The link is documented as optional in the README, and nothing in the service looks
for it: no referrer check, no parameter, no difference in what is served. That
matters more than it sounds — a snippet people paste into their own README has to
be honest about what it is doing, and the markdown form is kept precisely so that
"I do not want that link" has a first-class answer instead of a hand edit.

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
