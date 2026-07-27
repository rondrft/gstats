# Pending

In priority order. The reason matters more than the item — several of these look
like polish and are not.

---

## 1. IP rate limiting — blocking for sharing the instance

**Not implemented, and not implementable in this codebase.** It is a Cloudflare
WAF rule, configured in the dashboard, and nobody has configured one.

Until it exists, a public instance URL is an open invitation to spend somebody
else's GitHub quota: a loop over invented usernames is all misses, and every miss
is three to five upstream queries. [docs/self-hosting.md](self-hosting.md#7-protect-your-quota)
describes the rule to add — roughly 60 requests a minute per IP.

**Scope it to `/api`.** A rule covering `/purge` would throttle your own CI on
top of the per-token limit that endpoint already has.

This is listed first because it is the one thing that has to be true before the
instance URL is shared with anybody.

## 2. Stale-while-error — what stops the cascade

When GitHub returns 403 and there is no fresh entry, `/api` renders a "rate
limited" card. It should instead serve the *expired* entry, if one exists, and
only fall through to the error card when there is genuinely nothing.

The groundwork is already there and unused: `KV_EXPIRE_SECONDS` is seven days
against six hours of freshness, precisely so an expired entry is still sitting
there. `getStats` only reaches for it when the *quota reading* says the budget is
low, not when a request actually fails.

The failure this prevents is described in [limits.md](limits.md#the-cascade):
KV writes exhausted → nothing cached → every request a miss → GitHub drained →
nothing to fall back on → every card breaks at once. This is the step that turns
a quota problem into an outage.

## 3. Bug: language bars do not scale with the percentage

**Visible in production.** In the default `lang_style=blocks`, 41%, 30% and 28%
all draw as two blocks.

The cause is resolution, not arithmetic. `blockCount` quantises to six cells, so
one cell is about 17 percentage points:

| Share | Blocks drawn |
| --- | --- |
| 41% | 2 |
| 30% | 2 |
| 28% | 2 |
| 17% | 1 |
| 10% | 1 |

Anything between 25% and 41% is indistinguishable, which is exactly the range
most language breakdowns live in. The percentage beside it carries the real
information, so the bar is currently decoration.

`lang_style=bars` is unaffected — it scales a `<rect>` and renders those three as
16, 12 and 11 pixels — as is the `gauge` panel. Only the default is wrong.

Fixes worth considering: use eighth-block characters (`▏▎▍▌▋▊▉█`) for eight times
the resolution at the same width, or normalise against the leading language
rather than against 100%. The first keeps the bars comparable between cards; the
second makes the differences more visible within one card. They are not the same
decision and the first is probably right.

## 4. Streak timezone: default to Anywhere on Earth

Streaks are computed in UTC and documented as such, which is defensible — see
[decisions.md](decisions.md#streaks-are-computed-in-utc-and-todays-zero-does-not-break-one).
But for anybody west of UTC, a commit late on their Monday evening lands on
Tuesday UTC, and a streak can appear to break on a day they worked.

**Anywhere on Earth** (UTC−12) is the standard answer: a day counts as long as it
is still that day *somewhere*. It never breaks a streak early, only late, which
is the right direction for a figure meant to encourage. Add a `tz` parameter for
people who want their own zone, with AoE as the default.

This changes what a stored figure means, so it requires a `SCHEMA_VERSION` bump.

## 5. Reduce KV writes

The binding constraint is writes ([limits.md](limits.md)), and two of them are
cheap to remove.

**The quota reading is written on every miss.** `fetchAndStore` writes
`v2:rate-limit` alongside the stats entry, so it is *half* the total write cost —
four of the eight writes an active profile spends per day. It only needs to be
accurate enough to notice the budget running down; writing at most once every few
minutes would halve the daily total and change nothing that depends on it.

**The `warm:last-run` record is written every run**, 96 times a day, whether or
not anything changed. Writing only on a changed outcome saves nearly 10% of the
free budget — but note the tension: the timestamp *is* the liveness signal, and a
record that stops updating on a healthy instance is indistinguishable from a cron
that has stopped. Probably: write on any change, and otherwise at most hourly.

## 6. Move the language parameters out of the cache key

`lang_mode`, `langs_count`, `exclude_langs` and `include_langs` are all in the
cache key, so switching any of them costs a full refetch — even though the
*fetched* data is identical and only the post-processing differs.

Storing the raw per-repository data and ranking at render time would make all of
those free, the way theme changes already are. The cost is a much larger cache
entry: raw repositories are far bigger than the four-entry ranked list, and that
weight lands on every profile whether or not anybody uses a non-default setting.

Worth measuring before doing. It may be the wrong trade.

## 7. `WHITELIST` for self-hosting with a private token

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

## 8. The `pass` design is cramped, and has an artefact

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
