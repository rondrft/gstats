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

KV freshness is six hours, so an active profile is **4 misses a day**. Each miss
writes **twice**:

| Write | Key |
| --- | --- |
| The stats entry | `v2:<build>:<login>:<hash>` |
| The rate limit reading | `v2:rate-limit`, one shared key |

The second one is easy to miss when counting. It is a single shared key, but a
write is a write: every miss by every profile spends one.

| | Per active profile per day |
| --- | --- |
| Cache misses | 4 |
| **KV writes** | **8** |
| GitHub queries | 12–20 (3–5 per miss) |

A miss costs one bootstrap query, one batched history query, and one to three
pages of repositories — so three queries typically, five at most.

## The two ceilings

**Cloudflare KV, free plan: 1,000 writes per day, per account.** Shared with
every other Worker on the same account, so the real allowance is lower.

```
1,000 writes/day ÷ 8 writes/profile/day  ≈  125 active profiles
```

**GitHub GraphQL: 5,000 points per hour = 120,000 per day**, per token.

```
120,000 points/day ÷ ~15 points/profile/day  ≈  8,000 active profiles
```

The GitHub ceiling is roughly **sixty times** further away than the KV one. Every
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
| Per warmed profile | 96 × 2 = **192 KV writes** |
| The `warm:last-run` record | 96 writes, **for the whole instance** |

So **one warmed profile is 19% of the free plan's entire daily write budget**,
and the status record is another 10% on top regardless of how many profiles are
warmed. Ten warmed profiles is 1,920 writes — nearly twice the free allowance,
before a single ordinary visitor causes a miss.

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
4. Every miss is three to five GitHub queries. The hourly quota, which had sixty
   times the headroom, drains in minutes.
5. Once GitHub returns 403, there are no fresh entries to fall back to, because
   step 3 stopped writing them.
6. **Every card on the instance breaks at once.**

The step that turns a quota problem into an outage is 5. A stale-while-error
path — serving an expired entry rather than an error card when the quota is gone
— breaks the chain, and is listed first in [pending.md](pending.md) for that
reason. The groundwork is there: entries survive seven days against six hours of
freshness, precisely so there is something to serve.

## The paid plan

Cloudflare's Workers Paid plan ($5/month) raises KV writes to **1 million a day**.

```
1,000,000 ÷ 8  ≈  125,000 active profiles
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
