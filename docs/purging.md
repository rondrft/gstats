# Keeping a card current

A card is behind by up to two things at once: how long the response tells Camo
to hold it, and how long the service considers its own copy of your figures
fresh. Both are deliberate, and the second is the expensive one — every time it
lapses, somebody's card costs a round of GitHub API calls against a budget the
whole instance shares.

So the caches stay long and there is a way to say "this one changed":

```
POST /purge?username=<login>
Authorization: Bearer <PURGE_TOKEN>
```

It deletes that login's cached entries and returns JSON. It does **not** fetch
anything. The next person to load the card pays for the fetch, which is what
makes fifty pushes in ten minutes cost fifty cheap deletes and one API call.

```json
{ "purged": 3, "username": "octocat" }
```

`purged` is a count of entries, not of people: one login has an entry per
combination of the parameters that change what gets fetched, and all of them go.

| Status | Meaning |
| --- | --- |
| `200` | Deleted. `purged` may be `0` if nothing was cached. |
| `400` | `username` is missing or is not a GitHub login. |
| `401` | Missing, malformed or wrong `Authorization` header. |
| `429` | More than ten purges in a minute for this token. |
| `503` | The instance has no `PURGE_TOKEN`, so purging is switched off. |

> [!IMPORTANT]
> **This only works if you hold the instance's token.** The public instance does
> not share its `PURGE_TOKEN` with anyone — one shared purge key would let
> anybody drain the instance's GitHub quota by purging popular profiles in a
> loop. If you want this, [run your own instance](self-hosting.md); it takes
> about five minutes.

## Purging on every push

Your GitHub profile README lives in a repository named after your account. Add a
workflow there that calls `/purge` whenever you push:

```yaml
# .github/workflows/refresh-stats.yml
name: Refresh stats card

on:
  push:
  # Anything that changes your figures without touching this repository —
  # a commit somewhere else, a merged pull request — is not a push here, so a
  # slow tick keeps the card honest without spending much.
  schedule:
    - cron: '0 */6 * * *'
  workflow_dispatch:

concurrency:
  group: refresh-stats
  cancel-in-progress: true

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - name: Purge the cached card
        env:
          PURGE_TOKEN: ${{ secrets.PHOSPHOR_PURGE_TOKEN }}
          INSTANCE: https://phosphor-stats.your-subdomain.workers.dev
        run: |
          curl --fail-with-body --silent --show-error \
            --request POST \
            --header "Authorization: Bearer $PURGE_TOKEN" \
            "$INSTANCE/purge?username=${{ github.repository_owner }}"
```

Then add the secret: **Settings → Secrets and variables → Actions → New
repository secret**, named `PHOSPHOR_PURGE_TOKEN`, holding the same value you
gave `wrangler secret put PURGE_TOKEN`.

`--fail-with-body` matters: without it `curl` exits 0 on a `401` and the workflow
goes green while nothing is being purged.

A push does not make the card update — it makes the *next view* of the card
update. If you want to see it yourself straight away, open the `/api` URL
directly; the copy in your README is Camo's and will catch up within `max-age`.

## Warming a few profiles automatically

If the profiles you care about are yours and there are only a handful, you can
skip the workflow entirely. Set `WARM_USERS` and the Worker refreshes them on a
timer:

```bash
wrangler deploy \
  --var SERVICE_VERSION:$(git rev-parse --short HEAD) \
  --var WARM_USERS:octocat,defunkt
```

Every fifteen minutes it fetches each of those profiles and writes the result
back to KV. Two consequences follow: nobody visiting those cards ever waits on a
cache miss, and the stored figures are never more than fifteen minutes old.

It **refreshes**, it does not purge. Purging on a timer would guarantee the
opposite of the point — every quarter of an hour, the first person to load each
warmed card would be the one waiting for GitHub.

Details worth knowing:

- **Off unless you set it.** With `WARM_USERS` empty the scheduled handler
  returns immediately: no requests, no writes, no record.
- **Ten profiles at most.** This is a convenience for whoever runs the instance,
  not a subscription service.
- **One at a time, with a pause.** Ten profiles firing together would be exactly
  the spike against the shared quota that everything else here avoids.
- **A failure is skipped, never destructive.** If GitHub is down for one
  profile, that profile's existing entry is left alone and the run moves on. A
  figure from some hours ago beats a miss.
- **Only the default parameters are warmed.** A profile has one cache entry per
  combination of the inputs that change what is fetched, so a card using
  `langs_count=8` or `lang_mode=repos` is not covered and its first reader still
  pays for a miss. That is the ordinary behaviour, not a fault.

`/health` reports what is configured and how the last run went, which is the only
way to notice a cron that has quietly stopped:

```json
{
  "warming": {
    "configured": ["octocat", "defunkt"],
    "ignored": [],
    "lastRun": {
      "ranAt": 1785110400000,
      "durationMs": 2140,
      "refreshed": ["octocat", "defunkt"],
      "failed": [],
      "skipped": []
    }
  }
}
```

`ignored` holds anything in `WARM_USERS` that is not a GitHub login. A stray
comma is otherwise invisible — the only symptom is one profile silently never
warming, which nobody traces back to the variable.

### What it costs

Per warmed profile, per day:

| | Amount | Against |
| --- | --- | --- |
| Runs | 96 | — |
| GitHub calls | ~300 | 5,000 **per hour** |
| KV writes | 96 | 1,000 **per day** on the free plan |

The GitHub side is nothing: 300 calls a day against a budget that refills to
5,000 every hour. The KV side is the one to watch, because that quota is daily
and much smaller. Ten profiles is 960 writes, plus one per run for the status
record — right at the free plan's ceiling, and that is before any cache miss
from an ordinary visitor writes anything.

So: one or two profiles is free in practice. Ten is a decision to make
deliberately, and on the free plan it is effectively the whole day's write
budget. Cloudflare's paid Workers plan raises the limit well past this.

## How fresh can a card actually be

Worth being precise about, because the answer is not "instant" and no amount of
configuration makes it so.

| Stage | Delay it adds | Who controls it |
| --- | --- | --- |
| Your commit → our stored figures | up to 15 min with warming, up to 6 h without, 0 with a purge | this service |
| Our figures → the image in a README | up to `max-age`, 30 min by default | **Camo** |

The floor is set by the second row, and it is not ours. GitHub serves README
images through its own proxy, which holds a copy for as long as `Cache-Control`
permits and gives no way to invalidate it from outside. Warming and purging both
act on the first row only.

Lowering `max-age` shortens the second row, but the cost grows linearly in
Worker invocations while the benefit does not — the reader still waits for
whatever fraction of the interval they happened to arrive in. Below 30 minutes
it stops being worth it.

**So: about half an hour is achievable for a card embedded in a README. "Almost
instant" is not, for anybody, and a project promising it is measuring something
other than what a visitor sees.** Opening the `/api` URL directly bypasses Camo
and shows the current figures immediately, which is the right way to check that
a purge or a warm actually worked.

## Why not just shorten the cache

Because the two caches cost different things.

`Cache-Control: max-age` decides how often Camo comes back and asks. Those
returns are answered from KV without touching GitHub, so shortening it costs
Worker invocations — which on the free plan come out of 100,000 a day for the
whole account — and nothing else. It is set to 30 minutes, and
`CARD_MAX_AGE` can raise it on a busy instance without a code change.

How long KV counts an entry as fresh decides how often *the service* asks
GitHub. That comes out of 5,000 requests an hour shared by every profile the
instance serves, which is the thing that actually runs out. It is set to six
hours.

Below 30 minutes on the first number the propagation gain is marginal and the
invocation count grows linearly, which is a bad trade in both directions. If you
want a figure sooner than that, purge — it is the targeted version of the same
thing and it costs one delete.

## Rate limit

Ten purges per minute per token. That is a brake on a stuck retry loop, not a
security boundary — the token is the security boundary.

The counter lives in KV, which is eventually consistent, so a burst arriving at
several locations at once can overshoot slightly before the count catches up.
That is fine for what it is guarding against.

The per-address limits described in the
[self-hosting guide](self-hosting.md#7-protect-your-quota) deliberately do not
cover this endpoint. `/purge` is called by its owner's CI from whatever address
GitHub Actions happens to allocate, and throttling that on top of the per-token
limit already here would cost the owner their own tooling to protect nothing —
the token is the gate.
