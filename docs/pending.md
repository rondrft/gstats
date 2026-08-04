# Pending

In priority order. The reason matters more than the item — several of these look
like polish and are not.

Recently closed, so nobody goes looking for them: per-address rate limiting, the
write-budget figure at `/health`, the active-profile count beside it — which is
what the ceiling in [limits.md](limits.md) is expressed in and was a guess until
it was measured — stale-while-error, the language bars that did
not scale with their percentage, the ring track that made a third look like four
fifths on light themes, the quota reading that was written on every cache miss —
and then sampled, and now not written at all unless it is bad news — the streak's
day boundary moving from UTC to Anywhere on Earth, the language parameters
leaving the cache key, the `pass` design's three disagreeing margins, and the
sample cards in the README, which are now file snapshots the suite holds to the
renderer rather than files somebody has to remember to redraw.

---

## 0. The GitHub App migration

**Blocked on one verification, and deliberately not built until it comes back.**
Listed first because it is the item most likely to be picked up by somebody who
has just read [limits.md](limits.md) and drawn the obvious conclusion from it.

The service runs on a single personal access token: 5,000 points an hour for
every reader of the instance. A GitHub App would give each account that installs
it a budget of its own, so the ceiling would grow with adoption rather than
against it, and installation tokens renew themselves so the expiring-token
failure mode disappears. `TokenProvider` in `src/github/client.ts` exists for
this — although its `getToken()` takes no argument, and choosing a credential per
login means the subject has to reach it.

### Why it is not the next thing to build

The App raises the **GitHub** ceiling. That ceiling is ~1,100 active profiles;
the one that binds is KV writes, at ~150 on a day with a release. Building the
App first would be solving the second constraint while the first is a fifth of
the distance away — and the five-dollar Workers Paid plan moves the binding one
by three orders of magnitude in an afternoon.

So the order is: **paid plan first, App second**, and the App becomes the right
build at roughly a thousand active profiles rather than at the eight thousand
this document used to imply. Two of the three pains that motivated it also have
answers that cost nothing: a token dedicated to the service rather than shared
with its owner's account, and a *classic* token set to no expiry, since
fine-grained ones cap at a year.

### The verification that decides it

**Unverified premise: that an installation access token can read
`contributionsCollection` for an arbitrary third party.** It is the field two of
the three queries depend on, and it is user-scoped rather than repository-scoped,
which is the axis a GitHub App is weakest on. If it cannot, the migration is not
partially useful — it is dead, because contributions are the card.

This cannot be checked without an App existing, and it takes five minutes once
one does: create it with no permissions, install it, mint an installation token,
and ask for `user(login: "torvalds") { contributionsCollection { … } }`. Record
the outcome here either way. A negative result is worth more written down than
rediscovered in six months.

### What it should ask for, when it is built

**Repository permissions: Metadata, read-only. Nothing else. No account
permissions at all.** Metadata is mandatory for every GitHub App and cannot be
declined, so this is the floor rather than a choice — which is the point: an App
that asks for repository contents in order to draw a picture is an App nobody
installs, and everything the service reads is public.

Account permissions are specifically excluded. They require the user to
*authorize* the App and not merely install it, which is a second consent dialog
for data the service does not use.

It must not change what a card shows. `privacy: PUBLIC` in the languages query
is what guarantees that, and it is held by a test for exactly this reason — see
[decisions.md](decisions.md#the-repositories-query-is-pinned-to-public-and-that-is-a-decision).
The sentence "installing it changes nothing about your card, it only contributes
quota" has to stay true, and it is true by construction rather than by promise.

### Installations are resolved lazily, not by webhook

When the App exists, the mapping from login to installation is looked up on
demand and cached, rather than maintained by `installation` and
`installation_repositories` webhooks.

The reasoning is the usual one here. A webhook endpoint is a new public POST
route, HMAC-SHA256 signature verification, and a third secret to set twice —
real surface, for a stream of events that arrives a handful of times a year on an
instance this size. Lazy resolution costs one KV read on the miss path and one
extra API call the first time a login is seen, both cacheable, and it is
self-correcting: an uninstall shows up as a failed token mint, which falls back
to the shared token, which is the behaviour required anyway.

**The criterion for changing that**, so it is a decision and not an omission.
Switch to webhooks when any one of these is true:

- **The negative cache stops being free.** Lazy resolution has to remember which
  logins have *no* installation, or every card for a non-installer pays a lookup.
  That memory is a KV write per login, and writes are the binding resource. Below
  a few hundred profiles it is noise; if `profiles.active30d` and the write
  budget ever make it visible at `/health`, the webhook is the cheaper store.
- **Installations churn faster than the negative cache expires.** A user who
  installs the App and still gets served by the shared token for hours has been
  given a broken promise. If the cache TTL has to come down far enough that
  re-lookups become frequent, push beats poll.
- **The installation count reaches the low hundreds.** At that point the mapping
  is worth holding as a set rather than rediscovering an entry at a time, and one
  write per install event is unambiguously cheaper than one per unknown login.

Until one of those holds, a webhook is machinery in exchange for nothing.

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
rather than guessing, which is the `writes` figure at `/health`, and to tell
whether the instance is anywhere near needing it at all, which is
`profiles.active30d` beside it.

The diagnostics are themselves the remaining line items, and they are small on
purpose: the write counter at one write in 26, the request counter at one per
200 card requests, and the profile rollup at four a day. Lowering
`PERSIST_EVERY` in `src/budget.ts` or `PERSIST_EVERY_REQUESTS` in
`src/usage.ts` buys accuracy with the resource being measured, which is the
trade to be suspicious of. The request counter is the largest of the three and
the one with the weakest claim on a tight budget; the profile count is nearly
free because it is derived from the cache rather than counted per request.

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

## 5. `bg=transparent` leaves the heatmap almost invisible

Found while fixing the heatmap's intensity ramp, and left alone because it is a
different question with a decision in it rather than a line to change.

`mix` returns its first argument unchanged when either side is not a hex colour,
which is right for `none` and `transparent` — there is nothing to interpolate
between. But the heatmap builds its five fills by mixing *from the background*,
so `?card=heatmap&bg=transparent` yields `transparent` for levels 0 to 3 and
leaves only the top one, which is mixed from the ring colour instead. Verified:
`empty=transparent active=[transparent, transparent, transparent, #9fb76c]`.

The other designs are unaffected — they use `mix` for panels and paper, where
falling back to the background is the sensible degradation.

`trackColor` already faced the same wall and answered it by dimming the colour
when there is no background to recede into. The heatmap needs the opposite
direction, and the decision to make is what "away from nothing" means when the
card is sitting on whatever the page behind it is: probably a fixed ramp from
the ring colour's own low end, accepting that it cannot be tuned against a
background nobody here can see. Whatever it is, `test/render.test.ts` already
has the shape of the assertion — the contrast rules there just need a
`transparent` case they can express.

## 6. Nothing checks a design against Camo on the way in

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

## 7. The social preview image still carries the old name

`assets/brand/social-preview.png` is a 1280×640 raster, drawn by hand, that says
`phosphor-stats` and quotes the old hostname. It is what `og:image` points at, so
it is what a shared link shows, and it is the last place the rename has not
reached.

It is the one piece of output no test can hold to account. The sample cards were
the other one and are now file snapshots (`test/samples.test.ts`), but this is not
generated from anything in the repository: replacing it needs the image redrawn
*and* uploaded by hand in the repository settings, because GitHub keeps its own
copy of a repository's social preview. Until both halves happen, `/health` and
every card can be current while a shared link is a year out of date.
