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

If you have put a Cloudflare rate limiting rule in front of your Worker as the
[self-hosting guide suggests](self-hosting.md#7-protect-your-quota), scope it to
the `/api` path rather than to the whole hostname. A rule covering `/purge` would
throttle your own CI on top of the limit that is already there.
