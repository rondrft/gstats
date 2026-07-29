# Pending

In priority order. The reason matters more than the item — several of these look
like polish and are not.

Recently closed, so nobody goes looking for them: per-address rate limiting, the
write-budget figure at `/health`, stale-while-error, the language bars that did
not scale with their percentage, the ring track that made a third look like four
fifths on light themes, the quota reading that was written on every cache miss —
and then sampled, and now not written at all unless it is bad news — the streak's
day boundary moving from UTC to Anywhere on Earth, the language parameters
leaving the cache key, and the `pass` design's three disagreeing margins.

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

## 3. Reduce KV writes further

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

## 4. `WHITELIST` for self-hosting with a private token

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

## 5. Nothing checks a design against Camo on the way in

The five designs after `terminal` shipped verified by opening them in a browser,
which is not the medium they are served in. Putting them through Camo found two
things a browser could not have: a heatmap that reached 13.5 KB for a daily
committer against a 12 KB budget, and the `pass` notch painting a dot on its own
accent band. Both are fixed. The gap that let them ship is not.

What would close it is a check that renders every registered design at its
largest and compares the bytes against what the origin serves — the size half of
that now exists in `test/cards.test.ts`, and it is the half that generalises.
The rest is genuinely hard to automate: Camo passes our bytes through unchanged
(verified), so what is left is *visual*, and no assertion catches a dot in the
wrong place.

Worth knowing for whoever adds the seventh design: the useful check is a real
README, and the useful moment is before it is published rather than after
somebody opens an issue.

## 6. Nothing re-renders the sample cards in `docs/assets/`

The six SVGs the README shows are rendered output committed as files, and nothing
regenerates them. `docs/assets/pass.svg` was three commits stale: it showed the
perforation notch as a dot on the accent band and a stub cramped against the card
edge, both fixed in `e7c4ca0`, and it went on printing the old service name after
the rename. **Every reader of the front page was looking at defects the code no
longer had** — including the reader who reported the margins, which is how the
already-closed items came back.

A script that re-renders all six from one fixture would close it, and the reason
this is low and not high: the figures on them come from a real profile, so a
regeneration either freezes those figures in the fixture — which is what a sample
card wants, and what happened here — or makes the six disagree with each other
about how many contributions the same person has.

`assets/brand/social-preview.png` is the same class of thing and is not fixed: it
is a 1280×640 raster, drawn by hand, that still says `phosphor-stats` and quotes
the old hostname. It is what `og:image` points at, so it is what a shared link
shows. Replacing it needs the image redrawn *and* uploaded by hand in the
repository settings, because GitHub keeps its own copy of the social preview —
neither half is something a test can do.
