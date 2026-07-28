# Self-hosting

The public instance shares one GitHub token across everyone who uses it. That is
fine until it is not: 5,000 requests per hour is a hard ceiling, and it is the
reason most services of this kind eventually fall over. Running your own gives
you a budget nobody else can spend.

Everything below fits in the Cloudflare Workers free tier.

## Prerequisites

- Node 22.13 or newer, and [pnpm](https://pnpm.io). The Worker itself has no Node
  dependency; this is the toolchain requirement.
- A Cloudflare account. The free plan is enough.
- A GitHub account, for the token.

## 1. Clone and install

```bash
git clone https://github.com/rondrft/gstats
cd gstats
pnpm install
```

## 2. Create a GitHub token

The service only ever reads public data, so the token needs **no scopes at all**.
An unscoped token still lifts you from 60 requests per hour to 5,000.

**Fine-grained token** (preferred):

1. Go to **Settings → Developer settings → Personal access tokens → Fine-grained tokens**.
2. **Generate new token**. Give it a name and an expiry.
3. Repository access: **Public repositories (read-only)**.
4. Leave every permission at *No access*.
5. Generate, and copy the value — GitHub shows it once.

**Classic token** works too: create one and tick **nothing**. Do not grant `repo`.

> Set a calendar reminder for the expiry date. An expired token turns every card
> into an "upstream error" card, and the only symptom is that the images change.

## 3. Log in to Cloudflare

```bash
pnpm wrangler login
```

## 4. Create the KV namespace

The cache lives in Workers KV. Create the production and preview namespaces:

```bash
pnpm wrangler kv namespace create STATS_CACHE
pnpm wrangler kv namespace create STATS_CACHE --preview
```

Each command prints an id. Put them in `wrangler.toml`, replacing the
placeholders:

```toml
[[kv_namespaces]]
binding = "STATS_CACHE"
id = "paste-the-production-id-here"
preview_id = "paste-the-preview-id-here"
```

These ids are not secrets and are safe to commit.

## 5. Store the token

```bash
pnpm wrangler secret put GITHUB_TOKEN
```

Paste the token at the prompt. It is encrypted by Cloudflare and never appears in
the repository, in `wrangler.toml`, or in any log.

For local development, copy `.dev.vars.example` to `.dev.vars` and put the token
there instead. That file is gitignored.

### Optional: a purge token

Set one if you want to be able to invalidate a card on demand, which is how you
get a figure to appear sooner than the six hours the cache holds it:

```bash
wrangler secret put PURGE_TOKEN     # any long random string
```

Without it, `POST /purge` answers `503` and the endpoint does nothing. See
[docs/purging.md](purging.md) for the workflow that calls it on every push.

### Optional: keep a few profiles warm

For up to ten profiles you can skip the manual endpoint entirely. Set
`WARM_USERS` and a cron trigger refreshes them every fifteen minutes, so nobody
visiting those cards ever waits on a cache miss:

```bash
pnpm wrangler deploy \
  --var SERVICE_VERSION:$(git rev-parse --short HEAD) \
  --var WARM_USERS:YOUR_LOGIN
```

Empty by default, and the handler does nothing at all when it is. Read the
[cost table](purging.md#what-it-costs) before adding more than a couple: the
GitHub calls are negligible but the KV writes are not, against a free plan that
allows a thousand a day.

## 6. Deploy

```bash
pnpm deploy:primary
```

`pnpm deploy:primary`, not `pnpm deploy`. The plain one deploys **two** Workers:
`gstats`, and a second target named `phosphor-stats` that exists only because the
public instance was called that first and its card URLs are in other people's
READMEs. On your account that is a duplicate you have no use for, paying its own
cold starts and sharing your KV write budget for nothing.

Either use `deploy:primary`, or delete the `[env.legacy]` block from
`wrangler.toml` and rename the Worker at the top of the file to whatever you want
your hostname to be. Deleting it is the tidier option for a fork; the reasoning
that keeps it in this repository is in
[decisions.md](decisions.md#the-old-hostname-is-a-second-deploy-of-the-same-worker-not-a-redirect).

Wrangler prints the URL, something like
`https://gstats.<your-subdomain>.workers.dev`. Check it:

```bash
curl -s https://gstats.<your-subdomain>.workers.dev/health
curl -sI "https://gstats.<your-subdomain>.workers.dev/api?username=YOUR_LOGIN" | grep -i x-cache
```

The first request reports `X-Cache: MISS`, the second `HIT`.

Then point your README at your own host:

```markdown
![My GitHub stats](https://gstats.<your-subdomain>.workers.dev/api?username=YOUR_LOGIN)
```

## Private repositories

The public instance cannot reach anybody's private repositories, and giving it a
token that could would publish the language breakdown of somebody's private code
to everyone who loads a card. On your own instance the calculus is different:
the token is yours, the private code is yours, and nothing leaves your Worker
except a card you asked for.

To do it:

1. Create a **classic** token with the `repo` scope. Fine-grained tokens work
   too — grant *Contents: read-only* on the repositories you want counted.
2. Store it as `GITHUB_TOKEN` exactly as above.
3. **Restrict the instance to your own account.** This step is not optional.

> [!WARNING]
> A token with `repo` scope turns the service into a lookup for *your* private
> language composition. Without a restriction, anyone who finds your Worker URL
> can request any username — and while GitHub will not return other people's
> private data, requests for **your own** username will happily return yours to
> whoever asked. Restrict it before you deploy, not after.
>
> The intended mechanism for this is the `WHITELIST` variable described in the
> reliability work. **It is not implemented yet.** Until it is, do not deploy a
> `repo`-scoped token on a publicly reachable Worker. Either wait, or put
> Cloudflare Access in front of the Worker so only you can reach it.

## 7. Protect your quota

Already done, by `wrangler.toml`. There is nothing to configure in the dashboard
and nothing to remember before sharing the URL — but two dials are worth knowing
about, and one piece of advice that used to be here was wrong.

`/api` is limited per client address, on two axes:

| Variable | Default | What it limits |
| --- | --- | --- |
| `API_RATE_LIMIT` | 30 | requests a minute |
| `PROFILE_RATE_LIMIT` | 20 | **distinct logins** an hour |

The second is the one that matters. A reader loads one or two profiles, and
asking for the same one again is free however often; a scraper walks logins it
has never asked for, and every one of those is a guaranteed cache miss worth
three to five upstream queries and a KV write. Counting breadth separates those
two populations far more sharply than counting requests does.

Both count cache hits as well as misses. What is being protected is not only the
GitHub quota — a hit still costs an invocation, and the scarce resource is
writes.

Going over gets a `429` with `Retry-After` and a card that says so. `/health`,
the landing page and `/purge` are exempt; `/purge` has its own per-token brake
and is meant to be called by your CI, which an address limit would throttle for
no benefit.

To change either, redeploy with the variable set:

```bash
wrangler deploy --var API_RATE_LIMIT:15
```

`API_RATE_LIMIT` cannot be raised above the token budget declared under
`[[ratelimits]]` in `wrangler.toml` — sixty by default. Raise that first if you
want a looser limit; the comment there explains why the two are separate.

> **Do not follow the older advice to add a WAF rate limiting rule.** It was
> wrong, and it fails silently rather than visibly. WAF rules are configured per
> zone, and `*.workers.dev` is not a zone in your account — there is no rule for
> you to add. The binding above runs inside the Worker and needs no zone, which
> is why it is used instead. If you put the Worker behind a domain you *do* own,
> a WAF rule becomes available as an extra layer in front of these, not a
> replacement for them.

To confirm your instance is enforcing anything at all, `/health` says so:

```bash
curl -s https://<host>/health | jq .rateLimiting     # "enforced", not "disabled"
```

`"disabled"` means no binding is declared and every request is being served
unthrottled. That is a legitimate way to run a private instance and a reckless
way to run a public one, which is why it is reported rather than left to be
inferred.

## Running locally

```bash
pnpm dev        # wrangler dev, with a local KV simulation
pnpm test       # the suite, inside workerd
pnpm typecheck
pnpm lint
```

`pnpm dev` serves the landing page and the API on `http://localhost:8787`.

## Continuous deployment

`.github/workflows/deploy.yml` deploys on every push to `main`. To use it, add
one repository secret:

- `CLOUDFLARE_API_TOKEN` — created in the Cloudflare dashboard under **My
  Profile → API Tokens**, from the *Edit Cloudflare Workers* template.

Until that secret exists the workflow skips itself rather than failing, so a
fresh clone does not collect a red mark on every push.

`GITHUB_TOKEN` stays a Wrangler secret; the deploy never touches it, and it is
never exposed to a workflow.

Both the workflow and `pnpm deploy` pass the commit they were built from as
`SERVICE_VERSION`. That value identifies the instance at `/health` and forms
part of the cache key, so a release cannot read entries written by the one
before it. Expect a burst of upstream traffic right after each deploy, in
proportion to how many distinct profiles are active — every one of them is a
cache miss until it is fetched again.

## Monitoring

`/health` reports the build, whether a token is configured, whether the address
limits are being enforced, the last observed GitHub quota window, and how much of
the day's KV write allowance has gone:

```json
{
  "status": "ok",
  "version": "a8cd332",
  "tokenConfigured": true,
  "rateLimiting": "enforced",
  "rateLimit": { "remaining": 4873, "limit": 5000, "reset": 1785000000, "observedAt": 1784996400 },
  "writes": { "used": 312, "limit": 1000, "percent": 31 }
}
```

**`writes` is the number to watch, not `rateLimit`.** The GitHub quota above it
is roughly forty-five times further from being the constraint — see
[limits.md](limits.md). `status` turns to `warning` at 80% of the write
allowance, which is the earliest useful warning of the cascade that document
describes: once writes start failing nothing is cached, so every request becomes
a miss, so the quota that had all that headroom drains in minutes.

Two things to know about the figure. It is a **floor** — writes held by an
isolate that is recycled before it flushes are lost, and it counts puts but not
deletes, which Cloudflare bills separately. And it measures against the free
plan's thousand a day unless you say otherwise, so on Workers Paid set
`KV_WRITE_BUDGET` to `1000000` or the percentage will describe a limit you do
not have.

`rateLimit` may be `null` on a quiet instance. The reading now lives in the
isolate rather than in KV, precisely so that keeping it current does not cost
the writes above; a cold isolate has not observed one yet. It is written through
to KV only when the budget falls below 1,000 remaining, which is the case worth
surviving an isolate.

`version` is the deployed commit. Locally `pnpm dev` reports `dev-<commit>`, and
`dev-local` means `wrangler dev` was invoked directly without the wrapper. It is
the quickest way to tell whether the instance is running what you think it is,
and it is also part of the cache key — see
[decisions.md](decisions.md#schema_version-exists-alongside-the-build-id-and-reads-are-validated).

If `remaining` regularly approaches zero, the instance is serving more distinct
profiles than one token can support. That number is driven by how long KV counts
an entry fresh — six hours, in `src/cache.ts` — and not by the card's `max-age`,
which is answered from KV and costs no quota at all. If instead it is Worker
invocations that are climbing, raise `CARD_MAX_AGE`:

```bash
wrangler deploy --var SERVICE_VERSION:$(git rev-parse --short HEAD) --var CARD_MAX_AGE:3600
```

If the GitHub quota itself is the problem, the next step is a GitHub App, where every
installation carries its own 5,000 per hour. The codebase is ready for it —
authentication is isolated behind the `TokenProvider` interface in
`src/github/client.ts`, and swapping it out means adding one implementation and
changing one line in `src/index.ts`.

## Troubleshooting

**Every card says `GITHUB_TOKEN is not set`.** The secret was not stored. Run
`pnpm wrangler secret put GITHUB_TOKEN` again and redeploy.

**Every card says `upstream error`.** Usually an expired or revoked token. Check
with `curl -H "authorization: bearer <token>" https://api.github.com/rate_limit`.

**Cards say `rate limited`.** GitHub's hourly window is exhausted. `/health`
shows when it resets. If it happens often, see *Monitoring* above.

**Cards say `too many requests`.** This instance is refusing, not GitHub, and
only for the address making the requests — everybody else is unaffected. The
response carries `Retry-After` and an `X-Rate-Limit` header saying which of the
two limits was hit: `requests` for the per-minute one, `profiles` for the
distinct-login budget. Raise the relevant variable in *Protect your quota* if
the traffic is legitimate.

**The logs say `kv write failed`.** The daily KV write allowance is gone. Cards
are still being served — every write here is best effort and a card is built
before anything tries to store it — but nothing is being cached, so the figures
are frozen at whatever was last stored and every request is now spending GitHub
quota. It clears at midnight UTC; to fix it sooner, cut `WARM_USERS` or move to
Workers Paid. See [limits.md](limits.md#the-cascade).

**`/health` says `"status": "warning"`.** More than 80% of the day's KV write
allowance is gone. Check `warming.configured` first — a warmed profile costs 96
writes a day, roughly a tenth of the free allowance each, and `warm:last-run`
costs another tenth on top regardless of how many are warmed. Otherwise the
instance is serving more distinct profiles than the free plan supports; see
[limits.md](limits.md). It resets at midnight UTC.

**The card in my README will not update.** GitHub's image proxy is still serving
its own copy. Wait it out — the card itself is already current, which you can
confirm by opening the `/api` URL directly.

**`wrangler deploy` complains about the KV id.** The placeholder in
`wrangler.toml` was not replaced with the id from step 4.
