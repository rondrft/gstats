# Where this stops scaling

Short version: **the ceiling is Cloudflare KV writes, not the GitHub quota.**
That is the opposite of what the design reads like — the GitHub budget is the
thing every comment worries about, and it is nowhere near being the constraint.
Worth knowing before optimising the wrong number.

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

What remains is the write counter that produces the `writes` figure at
`/health`. It accumulates in the isolate and flushes every 25 writes, and the
flush counts itself — so it costs **one write in 26**, about 3.8%, and it scales
with the traffic rather than sitting on the budget as a fixed floor.

## The two ceilings

**Cloudflare KV, free plan: 1,000 writes per day, per account.** Shared with
every other Worker on the same account, so the real allowance is lower.

```
1,000 × 25/26 counter overhead  =  ~961 writes for cards
~961 ÷ 4 writes/profile/day     ≈  240 active profiles
```

The progression is worth keeping in view, because each step moved the number for
a different reason: **~125** when the quota reading was written on every miss,
**~178** when it was sampled every five minutes, **~240** now that it is only
written when it matters. A hypothetical instance with no write counter at all
would reach 250 — the counter costs about ten profiles of headroom and buys the
ability to see the ceiling coming, which is a trade this document exists to
argue for.

**GitHub GraphQL: 5,000 points per hour = 120,000 per day**, per token.

```
120,000 points/day ÷ ~15 points/profile/day  ≈  8,000 active profiles
```

The GitHub ceiling is roughly **forty-five times** further away than the KV one. Every
mechanism in this codebase that protects the GitHub quota — the six-hour
freshness, the language pagination cap, the aliased year batching, the stale
fallback — is protecting the resource that was never going to run out first.

They are still worth having: they are what keeps the GitHub ceiling that far
away, and a token is also a per-instance limit rather than a per-account one. But
if a number needs watching, it is the writes.

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

The GitHub side of warming is nothing: 96 runs × ~4 queries ≈ 400 points a day
against 120,000.

## The cascade

The failure mode is not gradual, and it is worth recognising early.

1. The daily KV write allowance is exhausted.
2. Writes start failing. `KvStatsCache.write` swallows the error by design — a
   lost write should cost one extra upstream call, not a broken image.
3. But now *nothing is being cached*. Every request is a miss.
4. Every miss is three to five GitHub queries. The hourly quota, which had
   forty-five times the headroom, drains in minutes.
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

## Seeing it coming

Softening the cascade is not the same as noticing it. Until recently there was
no way to know an instance was at 900 writes rather than 200, which meant the
first symptom of the whole sequence above was somebody's card going stale.

`/health` now reports the day's write count:

```json
"status": "warning",
"writes": { "used": 831, "limit": 1000, "percent": 83 }
```

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

## The paid plan

Cloudflare's Workers Paid plan ($5/month) raises KV writes to **1 million a day**.

```
1,000,000 ÷ 4  ≈  250,000 active profiles
```

Which puts the ceiling back on GitHub at ~8,000 profiles, where it belongs — the
constraint is then the thing the architecture is actually designed around, and
the next step past it is the `TokenProvider` migration to a GitHub App, where
every installation brings its own 5,000 an hour.

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
