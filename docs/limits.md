# Where this stops scaling

Short version: **the ceiling is Cloudflare KV writes, not the GitHub quota.**
That is the opposite of what the design reads like — the GitHub budget is the
thing every comment worries about, and it is not the constraint. Worth knowing
before optimising the wrong number.

It is not, however, as far from being the constraint as this file used to say.
The margin is about **seven times, not forty-five**; the correction is
[below](#which-makes-the-gap-between-the-two-ceilings-about-seven-times-not-forty-five)
and it comes from GitHub's allowance being hourly rather than daily.

All figures below are derived from the code, not estimated: KV freshness is
`KV_FRESH_SECONDS` in `src/cache.ts`, and the write count per miss is whatever
`fetchAndStore` in `src/stats.ts` does.

## What one active profile costs per day

"Active" means somebody is loading the card often enough that every cache entry
is refetched as soon as it goes stale — the worst case.

KV freshness is six hours, so an active profile is **4 misses a day**, and each
miss writes its stats entry.

| | Per active profile per day |
| --- | --- |
| Cache misses | 4 |
| **KV writes** | **4** |
| GitHub queries | 12–20 (3–5 per miss) |

A miss costs one bootstrap query, one batched history query, and one to three
pages of repositories — so three queries typically, five at most.

The **instance overhead** used to dominate that figure and no longer does.

The quota reading at `v2:rate-limit` was written on every miss, which doubled
the table above to 8 and made it half of everything the service wrote. Sampling
it every five minutes capped it at 288 writes a day — better, but still a *fixed*
floor of 29% of the free allowance, paid whether the instance served two profiles
or two hundred, to keep one diagnostic field on `/health` current.

It now lives in a module variable in the isolate and costs nothing. KV sees it
only when `remaining` crosses below 1,000, and then at most once every five
minutes while it stays there — so the case that is merely diagnostic is free and
the case that is an emergency is still visible from every isolate. The cost is
that `/health` served by a cold isolate reports whatever KV last heard, or
`null`. For a diagnostic that is the right trade; see
[decisions.md](decisions.md#the-quota-reading-lives-in-the-isolate-not-in-kv).

What remains is what `/health` costs to keep current. Three line items, and they
are deliberately of three different shapes:

| | Cost | Shape |
| --- | --- | --- |
| The write counter (`writes`) | one write in 26 | proportional to writes |
| The request counter (`requests.last7d`) | one write per 200 card requests | proportional to traffic |
| The profile rollup (`profiles.active30d`) | 4 writes a day | fixed |

The write counter accumulates in the isolate and flushes every 25 writes, and
the flush counts itself — **one write in 26**, about 3.8%.

The request counter works the same way with a larger interval, which at roughly
a dozen requests per cache write puts it near one write in twenty of what the
cards themselves cost.

The profile rollup is the only fixed cost here, and it is four writes rather
than 288 because it does not count anything on the way in: a stats entry
survives seven days, so *the cache is already a list of the logins this instance
has fetched*, and the rollup only has to fold that listing into a thirty-day
ledger. Six hours between folds, one write each. See
[decisions.md](decisions.md#the-profile-count-is-read-out-of-the-cache-not-counted-on-the-way-in).

## The two ceilings

**Cloudflare KV, free plan: 1,000 writes per day, per account.** Shared with
every other Worker on the same account, so the real allowance is lower.

```
1,000 × 25/26 write counter     =  ~961 writes for everything else
~961 − 4 profile rollup         =  ~957
~957 ÷ 4.06 writes/profile/day  ≈  236 active profiles
```

The `4.06` is the four cache misses a profile costs plus its share of the
request counter, at an assumed dozen requests per profile per day. That
assumption is one of the two estimates in this document — the other is how
tightly the post-deploy stampede lands, below — and it does not have to stay
one: `/health` reports the requests actually served, so a given instance can
substitute its own figure —

```
writes/day  ≈  (4 × profiles  +  requests/day ÷ 200  +  4) × 26/25
```

The progression is worth keeping in view, because each step moved the number for
a different reason: **~125** when the quota reading was written on every miss,
**~178** when it was sampled every five minutes, **~240** once it was only
written when it mattered, **~236** now that the instance also counts what it is
serving. A hypothetical instance with no diagnostics at all would reach 250. The
whole apparatus costs about fourteen profiles of headroom and buys knowing where
on the scale you are, which is a trade this document exists to argue for — the
alternative is finding out from a card going stale.

**GitHub GraphQL: 5,000 points per hour**, per token.

Per *hour*, and that is the whole of the correction below. This document used to
turn it into 120,000 a day and divide:

```
120,000 points/day ÷ ~15 points/profile/day  ≈  8,000 active profiles
```

**That figure was optimistic by roughly a factor of six, and it is worth being
precise about why, because the mistake is not arithmetic.** Converting an hourly
allowance into a daily one assumes consumption is flat across the day. Nothing
here is flat, and one thing is violently not.

### The deploy stampede is what actually binds

`SERVICE_VERSION` is part of the cache key, so **every deploy retires every
entry**. The first request for each active profile after a release is a miss,
and a miss is three to five queries. That is not spread across a day; it lands
in however long the instance's readers take to come back, and a card is served
with `max-age=1800`, so a card on a page anybody is looking at comes back inside
half an hour.

```
steady state    0.6 × N points/hour        (15 points/profile/day ÷ 24)
after a deploy  + up to 4 × N points, inside one hour
                4.6 × N  ≤  5,000   →   N ≈ 1,100 active profiles
```

If the returns spread over six hours instead of one — the loosest reading of
"active", which only guarantees a reader every six hours — the same arithmetic
gives about 3,900. A ceiling is quoted against the worse case, so:

**The GitHub ceiling is about 1,100 active profiles, not 8,000**, and what puts
it there is a deploy rather than the traffic.

### Which makes the gap between the two ceilings about seven times, not forty-five

The old **forty-five** was internally consistent when it was written — 8,000
against a KV ceiling of ~178 — and both halves have moved since. Comparing like
with like, both figures on a day with a release:

| | Active profiles |
| --- | --- |
| KV writes, the day of a deploy | **~150** |
| GitHub points, the hour of that deploy | **~1,100** |

Writes still bind first, and every conclusion in this document still holds. But
the margin is **seven times, not forty-five**, and that is a materially different
picture from the one this file used to paint: it means the GitHub quota is a
constraint on the horizon rather than one over it, and that on the paid plan —
where the write ceiling jumps three orders of magnitude — GitHub becomes the
binding constraint at about 1,100 profiles rather than at 8,000.

Every mechanism in here that protects the GitHub quota — the six-hour freshness,
the language pagination cap, the aliased year batching, the stale fallback — is
still protecting the resource that runs out second. They are what keep it
second. But "forty-five times of headroom" was never a licence to stop counting,
and it is not one now.

### The stampede is a choice, and this is what it costs

Worth stating because the number above is the only place its cost is visible.
The build id is in the cache key deliberately, so that a release cannot read
entries written by the one before it — but `SCHEMA_VERSION` and `hasCurrentShape`
already exist to answer "does this entry still mean what the code expects?", and
they are the durable half of that protection. Taking the build id out of the key
would remove the stampede entirely and move this ceiling back towards the 8,000
the old arithmetic claimed.

It is not free, which is why it has not been done. `hasCurrentShape` checks the
*shape* of an entry, and the failure it cannot see is a stored field whose shape
is unchanged and whose meaning is not — the streak moving from UTC to Anywhere on
Earth was exactly that. The build id catches a forgotten `SCHEMA_VERSION` bump;
the shape check cannot. See
[decisions.md](decisions.md#schema_version-exists-alongside-the-build-id-and-reads-are-validated).

So it stays, and the price is written here rather than discovered during a
release.

## What warming costs

`WARM_USERS` refreshes each named profile every fifteen minutes: **96 runs a
day**, each one a full fetch and store.

| | Per day |
| --- | --- |
| Per warmed profile | **96 KV writes** |
| The `warm:last-run` record | 96 writes, **for the whole instance** |
| The quota reading | nothing, unless the budget is running out |

So **one warmed profile is about 10% of the free plan's entire daily write
budget**, and the status record is another 10% on top regardless of how many
profiles are warmed. Ten warmed profiles is 960 writes — the whole free
allowance, before a single ordinary visitor causes a miss.

Warming a profile every fifteen minutes costs twenty-four times what letting it
go stale for six hours does. That is the trade being made, and it is worth
making for one or two profiles and not for ten.

The cap of ten in `MAX_WARM_USERS` is generous relative to what the free plan can
actually absorb. One or two is free in practice. Anything more is a decision to
make with this table open.

The GitHub side of warming is nothing, and stays nothing when read against the
hour rather than the day: four runs an hour × ~4 queries ≈ **16 points an hour
against 5,000**. It is also the one thing here that is genuinely flat, which is
more than can be said for the traffic it is smoothing.

## The cascade

The failure mode is not gradual, and it is worth recognising early.

1. The daily KV write allowance is exhausted.
2. Writes start failing. `KvStatsCache.write` swallows the error by design — a
   lost write should cost one extra upstream call, not a broken image.
3. But now *nothing is being cached*. Every request is a miss.
4. Every miss is three to five GitHub queries. The hourly quota — which is an
   *hourly* one, and had about seven times the headroom rather than the
   forty-five this document used to claim — drains in minutes.
5. Once GitHub returns 403, there is nothing fresh to fall back to, because step
   3 stopped writing.

Step 5 is what used to turn a quota problem into an outage: every card on the
instance would break at once. **Stale-while-error breaks the chain.** An entry
that is expired but still present — they survive seven days against six hours of
freshness, precisely for this — is served with a `200`, `X-Stale: true` and a
ten-minute lifetime. The error card is now only for a profile that has never
been fetched at all.

So the failure has been softened rather than removed. An instance past its write
budget serves increasingly old cards instead of breaking, which is the right
direction, and `/health` shows the quota falling while it happens. It is still a
condition to fix rather than to live in.

**Nothing in that sequence returns an error to a reader.** Every `put` in the
service is wrapped, the card is built from the fetched data before anything
tries to store it, and a refused write cannot reach the response. That is
enforced rather than assumed: `test/kv-failure.test.ts` runs the whole service
against a namespace whose writes always fail, and checks that the cards still
carry figures — a status check would pass on an error card, which is exactly the
outcome being ruled out.

Each of those swallowed failures is reported to the logs, once a minute per
isolate, naming the operation and the reason:

```
kv write failed [stats-cache]: KV PUT failed: 429 Too Many Requests (and 41 more since the last report)
```

`wrangler tail` is where that shows up. `/health` warns that the allowance is
nearly gone; this says it is gone.

## Seeing it coming

Softening the cascade is not the same as noticing it. Until recently there was
no way to know an instance was at 900 writes rather than 200, which meant the
first symptom of the whole sequence above was somebody's card going stale.

`/health` now reports the day's write count, and next to it the two figures that
say what the writes were *for*:

```json
"status": "warning",
"writes":   { "used": 831, "limit": 1000, "percent": 83 },
"profiles": { "active30d": 187, "seen30d": 203, "updatedAt": 1785312000000 },
"requests": { "last7d": 24019 }
```

`writes` is the ceiling; `profiles.active30d` is the number the ceiling is
*expressed in*, and until it existed the answer to "how far along are we?" was a
guess.

**`active30d` and `seen30d` are not the same question, and the gap between them
is a diagnostic in its own right.** `seen30d` is every login fetched at all in
the window. `active30d` counts only those folded on more than one day — which is
what "active" has meant in this document from the beginning: a profile somebody
is loading often enough that its entry is refetched as soon as it goes stale,
four misses a day, which is where every figure above comes from. A login looked
up once costs one write in its life and is not a tenant.

A wide gap means something is generating profile lookups nobody asked for. That
is not hypothetical: the landing page's generator used to repaint its preview on
every keystroke, so one visitor typing a login fetched a card for every prefix of
it — and most prefixes of a real login are real logins, so they cached, cost
GitHub queries and cost writes. It read as 35 profiles on an instance serving
fewer than ten people. See
[decisions.md](decisions.md#the-generator-debounces-its-preview-because-a-keystroke-was-a-card-request).

`requests` is what separates two hundred profiles nobody looks at from twenty in
busy READMEs, and is also the reading against the other free-plan ceiling,
100,000 Worker invocations a day.

Two things to know before quoting either. `profiles.updatedAt` is when the
rollup last ran; if it stops moving, the cron has stopped and the count is
frozen rather than falling — the same signal `warming.lastRun` carries.
`requests.last7d` is a floor, for exactly the reasons the write count is: an
isolate recycled before it flushes takes its pending count with it, so a quiet
instance under-reports, which is where it matters least.

To see *which* logins rather than how many — the ledger is hashed and cannot
tell you — there is `GET /profiles` behind `PURGE_TOKEN`, which reads the cache
listing directly. Its window is the cache's seven days, not thirty.

Neither figure involves anything about a visitor. See the privacy note in the
[README](../README.md#what-this-service-records).

`status` turns from `ok` to `warning` at 80%. The count is UTC-daily, because
that is when Cloudflare's allowance resets, and it is a **floor rather than an
audit**: writes held by an isolate that is recycled before it flushes are lost,
and two locations flushing at once can each read the same total. Deletes are not
counted, because Cloudflare bills them against a separate allowance.

Set `KV_WRITE_BUDGET` to `1000000` on a Workers Paid instance, or the percentage
will describe a limit that instance does not have.

## Protecting the instance from the outside

Everything above assumes the traffic is readers. A public URL also attracts
enumeration, and a loop over invented logins is the worst possible shape of
traffic for this service: every login is a guaranteed miss, and every miss is
three to five upstream queries **and a KV write**.

This is why the limits in `src/ratelimit.ts` count distinct logins per address
and not just requests. Thirty requests a minute is a generous ceiling for a
reader — a card is one request every half hour — but thirty *misses* a minute is
43,000 writes a day against an allowance of 1,000. The login budget is what
makes the difference: a reader asks for one or two profiles, and asking for the
same one again is free.

They are enforced by Cloudflare's Rate Limiting binding, inside the Worker.
**Not by a WAF rate limiting rule**, which earlier versions of these documents
recommended and which cannot be created for the default deployment: WAF rules
are configured per zone, and a `workers.dev` subdomain is not a zone anybody but
Cloudflare can add rules to. The same trap catches the Cache API, whose
operations are documented no-ops on `workers.dev` — which is why the login
ledger is kept in the isolate rather than there.

## When to move to the paid plan

Cloudflare's Workers Paid plan ($5/month) raises KV writes to **1 million a day**.

```
1,000,000 ÷ 4  ≈  250,000 active profiles
```

Which puts the ceiling back on GitHub — **at about 1,100 profiles, not the 8,000
this section used to promise**, because what binds there is the deploy stampede
and not the average rate. The constraint is then the thing the architecture is
actually designed around, and the next step past it is the `TokenProvider`
migration to a GitHub App, where every installation brings its own 5,000 an hour.

That correction matters for sequencing more than it looks. On the free plan the
order is not close: writes bind at ~150 and GitHub at ~1,100, so the App would
be solving the second problem first. Past the paid plan the order reverses
immediately and the App is the only remaining move — but "immediately" now means
around a thousand profiles rather than around eight thousand, which is a great
deal closer than this document used to imply. See
[pending.md](pending.md#0-the-github-app-migration).

### The threshold is 150 active profiles, not 236

**Read `profiles.active30d` at `/health` and switch when it reaches about 150.**
The rest of this section is where that number comes from, because "switch near
the ceiling" is the wrong instinct and the gap is bigger than it looks.

The ceiling of ~236 is a *steady state* figure and no day is one. The thing that
breaks the steady state is a deploy: the build id is part of the cache key, so
**every deploy retires every entry**, and the first request for each active
profile after a release is a miss. A deploy costs one extra write per active
profile, on top of the four the day was already going to spend.

So the day's writes are about `(4 × N + N per deploy + N/17 + 4) × 26/25`, and
what matters is where that first crosses the 80% line `/health` warns at:

| Active profiles | A quiet day | One deploy | Two deploys |
| --- | --- | --- | --- |
| 100 | 43% | 53% | 63% |
| 150 | 64% | **79%** | 95% |
| 190 | **81%** | 100% | over |
| 236 | 100% | over | over |

Steady state trips the warning at about **190**. A day with one deploy trips it
at about **150**, and this project deploys on every push to `main`. Two in a day
is an ordinary afternoon.

Below **100** there is nothing to think about. Between 100 and 150, watch
`writes.percent` on days you release — that is the band where the figure starts
moving. **At 150, move**: five dollars against an instance that begins serving
stale cards on its busiest days, and the paid plan puts the next ceiling three
orders of magnitude away.

Above 200 the instance is already spending its margin. Nothing breaks loudly —
[the cascade](#the-cascade) is softened, so what happens is that cards quietly
get older — which is precisely why the decision wants a number to watch rather
than a symptom to wait for.

Two things to do when you switch, neither of which is automatic:

- Set `KV_WRITE_BUDGET` to `1000000`, or `/health` will keep measuring against a
  limit the instance no longer has and warn about 8% of the real one.
- Set it on **both** deploy targets. It is a `[vars]` entry, and vars are not
  inherited by `[env.legacy]`.

## What does not cost anything

**How much somebody commits is irrelevant.** A profile with 50 contributions and
one with 50,000 cost exactly the same: the queries are fixed, and the calendar
comes back as a fixed-size array either way. What costs is the number of
*distinct profiles* being served.

Two second-order effects, both small: an older account adds one aliased field per
year to a single query, and an account with more than 100 public repositories
adds a pagination round trip, up to the three-page cap.

**Cache hits cost nothing but a Worker invocation.** Worker requests on the free
plan are 100,000 a day, which at 30-minute `max-age` is a great many readers.
That is the other reason `max-age` is a separate lever from KV freshness: it
spends the plentiful resource, not the scarce one.

A hit does now rank the stored repositories as well as draw the card, which is
the price of `lang_mode` and friends no longer costing a fetch each. It is CPU on
an invocation already being paid for — at the 300-repository cap, an entry of
about 11 KB to parse and a few thousand numbers to add up — against the 10 ms a
free-plan request is allowed. The resource it saves is the one that runs out.

**How the card is configured no longer multiplies the entries.** A profile used
to need one entry per combination of `langs_count`, `lang_mode`, `exclude_langs`
and `include_langs` anybody had written into a URL, each with its own four writes
a day. The table above assumed the default and was optimistic by however many
variants were in circulation. It is now correct as written: `hide` and `tz` are
the only parameters that still split a profile in two.
