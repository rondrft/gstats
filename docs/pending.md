# Pending

In priority order. The reason matters more than the item — several of these look
like polish and are not.

Recently closed, so nobody goes looking for them: per-address rate limiting, the
write-budget figure at `/health`, stale-while-error, the language bars that did
not scale with their percentage, the ring track that made a third look like four
fifths on light themes, and the quota reading that was written on every cache
miss — and then sampled, and now not written at all unless it is bad news.

---

## 1. An exact hourly login budget, shared across isolates

The per-address limits exist and the instance URL is safe to share. This is the
one loose end in them.

Requests per minute are enforced by Cloudflare's Rate Limiting binding, which is
exact and shared by every isolate in a location. The **distinct logins per hour**
budget — the one that actually separates a reader from a scraper — is not, and
cannot be: the binding's window is fixed by the platform at ten or sixty seconds,
so an hour cannot be expressed with it at all. The ledger is a module variable,
which makes it lossy in one direction: an address whose requests land on a second
isolate gets a second allowance.

In practice that is a large reduction rather than a leak — a location serves a
Worker's traffic from very few isolates, and the requests-per-minute limit is an
exact cross-isolate ceiling underneath it — but it is a brake and not a gate, and
it is the sort of thing worth knowing before relying on it.

The two stores that would be exact are both unavailable on the default
deployment. **The Cache API** is the natural fit and is a documented no-op on
`workers.dev`. **KV** would cost one write per reader address per hour, against
an allowance of a thousand a day — the defence would be more expensive than the
abuse it prevents, and would itself trigger the cascade in
[limits.md](limits.md#the-cascade).

That leaves a **SQLite-backed Durable Object**, which is on the free plan, is
strongly consistent, needs no custom domain, and would make the budget exact. The
cost is a stateful class, a migration, and a round trip on every `/api` request
including cache hits. Worth doing if an instance is ever actually enumerated;
not worth doing speculatively.

## 2. A custom domain would simplify several of these

Not a task so much as the thing several tasks are working around. A
`workers.dev` subdomain is not a zone, and a surprising amount of Cloudflare is
zone-scoped: WAF and its rate limiting rules, and the Cache API, which is
silently a no-op there. Both would have been the obvious answer to something in
this file.

Nothing is blocked on it and the free-plan story is deliberately the supported
one. But anybody putting this behind a domain they own should know that the WAF
becomes available as a layer in front of the in-Worker limits, and that
`caches.default` starts working, which makes the item above cheap.

## 3. Streak timezone: default to Anywhere on Earth

Streaks are computed in UTC and documented as such, which is defensible — see
[decisions.md](decisions.md#streaks-are-computed-in-utc-and-todays-zero-does-not-break-one).
But for anybody west of UTC, a commit late on their Monday evening lands on
Tuesday UTC, and a streak can appear to break on a day they worked.

**Anywhere on Earth** (UTC−12) is the standard answer: a day counts as long as it
is still that day *somewhere*. It never breaks a streak early, only late, which
is the right direction for a figure meant to encourage. Add a `tz` parameter for
people who want their own zone, with AoE as the default.

This changes what a stored figure means, so it requires a `SCHEMA_VERSION` bump.

## 4. Reduce KV writes further

The binding constraint is writes ([limits.md](limits.md)). The quota reading has
been dealt with twice over — sampled rather than written per miss, and then moved
into the isolate entirely, which took the fixed instance overhead from 288 writes
a day to nothing and the free ceiling from ~178 to ~240. One remains.

**The `warm:last-run` record is written every run**, 96 times a day, whether or
not anything changed — about 10% of the free budget on its own, and now the
largest single line item on an instance that warms anything. Writing only on a
changed outcome would recover most of it, but note the tension: the timestamp
*is* the liveness signal, and a record that stops updating on a healthy instance
is indistinguishable from a cron that has stopped. Probably: write on any change
and otherwise at most hourly.

There is now a way to tell whether this is worth doing on a given instance
rather than guessing, which is the `writes` figure at `/health`. The counter that
produces it is itself the other line item, at one write in 26; lowering
`PERSIST_EVERY` in `src/budget.ts` buys accuracy with the resource being
measured, which is the trade to be suspicious of.

## 5. Move the language parameters out of the cache key

`lang_mode`, `langs_count`, `exclude_langs` and `include_langs` are all in the
cache key, so switching any of them costs a full refetch — even though the
*fetched* data is identical and only the post-processing differs.

Storing the raw per-repository data and ranking at render time would make all of
those free, the way theme changes already are. The cost is a much larger cache
entry: raw repositories are far bigger than the four-entry ranked list, and that
weight lands on every profile whether or not anybody uses a non-default setting.

Worth measuring before doing. It may be the wrong trade.

## 6. `WHITELIST` for self-hosting with a private token

[docs/self-hosting.md](self-hosting.md#private-repositories) documents how to run
an instance with a `repo`-scoped token so your own private repositories count —
and then tells you not to, because the mechanism that would make it safe does not
exist.

Without a restriction, anyone who finds the Worker URL can request *your* login
and receive your private language composition. The guide currently says to put
Cloudflare Access in front of the Worker instead, which works but is a different
shape of solution.

`WHITELIST` should be a comma-separated list of logins the instance will answer
for at all; anything else gets the "user not found" card. Small to build. Listed
here rather than higher because it only matters for one deployment mode, and that
mode is currently documented as "do not".

## 7. The `pass` design is cramped, and has an artefact

Both verified in the source rather than only by eye.

**The perforation notch overlaps the band.** The top notch is a circle at
`cy = BAND_HEIGHT` with `r = 4`, filled with the card background — so half of it,
four pixels, is painted over the solid accent band. It reads as a dark dot
sitting on the band rather than as a hole punched in the edge. It should be
clipped to the body, or moved down to start below the band.

**The stub is tight on the right.** It is 76 pixels wide with 13 to the tear on
its left and 20 to the card edge on its right, and it carries the largest number
on the card plus the barcode. It wants a few more pixels of breathing room, which
means widening the right margin for this design rather than taking the shared
default.

Neither is a correctness problem, which is why this is last.
