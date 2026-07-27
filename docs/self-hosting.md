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
git clone https://github.com/rondrft/phosphor-stats
cd phosphor-stats
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
pnpm deploy
```

Wrangler prints the URL, something like
`https://phosphor-stats.<your-subdomain>.workers.dev`. Check it:

```bash
curl -s https://phosphor-stats.<your-subdomain>.workers.dev/health
curl -sI "https://phosphor-stats.<your-subdomain>.workers.dev/api?username=YOUR_LOGIN" | grep -i x-cache
```

The first request reports `X-Cache: MISS`, the second `HIT`.

Then point your README at your own host:

```markdown
![My GitHub stats](https://phosphor-stats.<your-subdomain>.workers.dev/api?username=YOUR_LOGIN)
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

A public URL that spends your GitHub budget is worth a rate limit. In the
Cloudflare dashboard, under **Security → WAF → Rate limiting rules**, add a rule
on the Worker's hostname — something like 60 requests per minute per IP is
generous for real README traffic and stops a scraper from draining an hour of
quota in a minute.

**Scope the rule to the `/api` path**, not to the whole hostname. `/purge`
carries its own per-token limit and is meant to be called by your CI; an IP rule
covering it would throttle your own workflow for no benefit.

Cache hits never touch GitHub, so the effective limit is much higher than it
looks.

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

`/health` reports the build, whether a token is configured, and the last observed
rate limit window:

```json
{
  "status": "ok",
  "version": "a8cd332",
  "tokenConfigured": true,
  "rateLimit": { "remaining": 4873, "limit": 5000, "reset": 1785000000, "observedAt": 1784996400 }
}
```

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

**Cards say `rate limited`.** The hourly window is exhausted. `/health` shows
when it resets. If it happens often, see *Monitoring* above.

**The card in my README will not update.** GitHub's image proxy is still serving
its own copy. Wait it out — the card itself is already current, which you can
confirm by opening the `/api` URL directly.

**`wrangler deploy` complains about the KV id.** The placeholder in
`wrangler.toml` was not replaced with the id from step 4.
