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

There is also a **fixed instance overhead**: the quota reading at
`v2:rate-limit`. It used to be written on every miss, which doubled the figure
above to 8 and made it half of everything the service wrote. It is now sampled
at most once every five minutes, which caps it at **288 writes a day for the
whole instance** however many profiles are being served — and it still writes
immediately the first time the budget falls below 1,000, so an instance running
out is visible at `/health` at once.

## The two ceilings

**Cloudflare KV, free plan: 1,000 writes per day, per account.** Shared with
every other Worker on the same account, so the real allowance is lower.

```
(1,000 − 288 overhead) ÷ 4 writes/profile/day  ≈  178 active profiles
```

Before the quota reading was sampled this was ~125. Halving the per-profile cost
did not quite double the ceiling, because the sampling floor is a fixed cost the
ceiling now has to be paid out of. Raising the sampling interval from five
minutes to fifteen would take the overhead to 96 and the ceiling to about 226,
at the price of a coarser `/health`.

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
| The quota reading | already counted in the 288 above |

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
