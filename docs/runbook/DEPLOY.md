# DEPLOY — Operating and Deploying a sekai-kb Instance

First-timer runbook: every command below is copy-pasteable. Each capability is
its own `##` section; future framework releases append new capability sections
(background workers, upgrade flow) without restructuring the existing ones.

Written for an instance created from the sekai-kb template ("Use this template"
on GitHub, then cloned). `<owner>/<repo>` below means your GitHub repo.

---

## Prerequisites

| Tool    | Version   | Check                  | Install                                                        |
| ------- | --------- | ---------------------- | --------------------------------------------------------------- |
| Node.js | ≥ 22.13   | `node --version`       | <https://nodejs.org/> or your version manager                   |
| npm     | ships with Node | `npm --version`  | —                                                               |
| uv      | any recent | `uv --version`        | `curl -LsSf https://astral.sh/uv/install.sh \| sh`               |
| Python  | ≥ 3.12    | managed by uv          | nothing to do — uv reads `.python-version` and fetches it        |
| gh      | any recent | `gh --version`        | <https://cli.github.com/> then `gh auth login`                   |
| git     | any recent | `git --version`       | —                                                               |

---

## Install

From a fresh clone:

```bash
npm ci --force
uv sync
```

- `npm ci --force`: the `--force` works around an npm cross-platform lockfile
  validation issue with optional native sub-dependencies (nodejs/npm#7758) —
  the same flag CI uses. All non-optional dependencies still install at exact
  locked versions. Plain `npm install` also works but may churn the lockfile.
- `uv sync` creates a local `.venv` with the pinned Python (≥ 3.12, from
  `.python-version`) and the `pytest` dev group. It powers the `article-health`
  editorial linter; you never invoke `pip` or manage a virtualenv yourself.
- Installing also wires the pre-commit hook (husky runs from npm's `prepare`
  script).

---

## Local development

```bash
npm run dev
```

Serves at `http://localhost:4321`. The dev command runs the full prebuild first
(content sync + generated data), so the first start takes a moment.

---

## Content workflow

Content lives in `knowledge/{Category}/*.md` — the single source of truth.
`src/content/` and `src/data/` are derived, gitignored projections; never edit
them directly.

Three files under `knowledge/` are not articles: `INBOX.md` and `SNIPPET-INBOX.md`
are workflow queues, and `knowledge/sounds/_manifest.md` lists the `/soundscape`
recordings. The manifest's leading underscore is what keeps the article pipeline
from validating it as an article, so keep the name exactly as it is.

```bash
# Project knowledge/ into the build (run after editing content)
npm run sync

# Validate frontmatter across all of knowledge/
npm run test

# Editorial lint on one article — mandatory ship gate (see docs/playbook/ARTICLE-PLAYBOOK.md)
npm run article-health -- knowledge/Beaches/lantern-cove-beach.md --profile=ci-deploy
```

The writing process itself — research, drafting, quality gate — is
[`docs/playbook/REWRITE-PIPELINE.md`](../playbook/REWRITE-PIPELINE.md).

---

## Python toolchain (article-health)

The editorial linter is Python, run through uv — no global Python setup, no
manual virtualenv.

```bash
# One-time (and after pulling dependency changes)
uv sync

# Lint one article — mandatory ship gate
npm run article-health -- knowledge/History/founding-of-marisol-cove.md --profile=ci-deploy

# Lint the whole corpus with the CI gate's profile
npm run article-health -- --all --profile=ci-deploy

# List every check the tool knows
npm run article-health -- --list-checks

# Run the tool's own test suite
npm run article-health:test
```

`npm run article-health` is a wrapper for
`uv run python scripts/tools/article-health.py`; both forms work. Profiles and
per-check thresholds live in `scripts/tools/article-health.config.toml` — tune
them per instance (see playbook §8).

---

## Quality gates

```bash
# Genericity + English-only gates (the same gates CI runs)
npm run genericity

# Committed worker configs carry framework placeholders only
npm run worker-config:check

# Frontmatter validation, CI-strict
npm run test:ci
```

`npm run genericity` runs two gates: the place-name denylist gate
(`scripts/ci/check-genericity.sh`), which enforces that framework code carries
zero place-specific strings, and the English-only gate
(`scripts/ci/check-english-only.mjs`), which rejects CJK codepoints. In the
pristine template (the `.sekai-template` marker is present at the repo root)
both scan the whole tree. In an adopted instance (`npm run init` removes the
marker) they scan the code trees, each gate stating its own root set: the
place-name denylist gate scans `src/`, `scripts/`, `tests/`, `workers/`,
`.agents/skills/`; the English-only gate scans `src/`, `scripts/`, `tests/`,
`workers/`, `.agents/skills/`; your `knowledge/` and `place.config.ts` are
outside both, so they legitimately carry your place's name. A gate skips any of
its roots this checkout does not have.
Your place name is added to `scripts/ci/genericity-denylist.local.txt` by the
init wizard, which keeps it out of framework code from day one.

`npm run worker-config:check` covers what a name denylist cannot: a committed
`ALLOWED_ORIGIN` or Worker name is deployment identity even when its text contains
no place name at all. It asserts every committed `workers/*/wrangler.toml` still
carries the framework placeholders (see §Cloudflare Workers). It runs in the same
`genericity` CI job, and it fails in your checkout too — that is the point.

---

## Build

```bash
npm run build
```

This chains: content sync → parallel prebuild (search index, knowledge-base
index, content dates, git info, related articles, changelog, map markers,
dashboard data) → `astro build` → post-build contract checks (smoke test,
internal links, map markers, graph, dashboard). Output lands in `dist/`.

Preview the production build locally:

```bash
npm run preview
```

---

## Pre-commit hook

Installed automatically by `npm ci`/`npm install` (husky). On every commit it
runs, against staged files only:

1. A credential-leak scan (service-account JSON, private keys, API tokens).
2. Frontmatter validation on staged `knowledge/` files.
3. `article-health --staged --profile=pre-commit` (HARD violations block the
   commit; WARN is advisory).

If the hook blocks a commit, fix the finding. `git commit --no-verify` bypasses
it — reserve that for false positives (e.g. a test fixture that looks like a
credential).

---

## CI

`.github/workflows/deploy.yml` runs on every PR and every push to `main`:

| Job          | What it does                                                                | Runs on            |
| ------------ | ---------------------------------------------------------------------------- | ------------------- |
| `genericity` | Place-string denylist + CJK/English-only scan + committed worker configs      | every PR + main     |
| `test`       | `npm run test:ci` + `article-health --all --profile=ci-deploy`               | every PR + main     |
| `build`      | `npm run build` including all post-build contract checks                     | every PR + main     |
| `init-check` | Init-wizard self-check (init → build on a disposable checkout)               | every PR + main     |
| `deploy`     | Publish `dist/` to GitHub Pages                                              | push to main only   |

The workflow follows least-privilege: jobs that execute PR-authored code run
with `contents: read`; only the deploy job holds the Pages write scopes. Watch a
run from the terminal:

```bash
gh run watch
```

---

## GitHub Pages

One-time setup so the deploy job can publish. Either in the UI — repo
**Settings → Pages → Build and deployment → Source: GitHub Actions** — or from
the terminal:

```bash
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

(If Pages was already enabled once, use `-X PUT` to update instead.)

Then push to `main` (or re-run the workflow) and the site is live:

```bash
gh run watch && gh api repos/<owner>/<repo>/pages --jq .html_url
```

Note on URLs: the build targets the domain root — `site` in `astro.config.ts`
comes from `place.domain` in `place.config.ts`. A `<owner>.github.io/<repo>`
project URL is fine for smoke-checking a deploy, but root-relative links only
fully resolve when the site is served from a domain root: a custom domain
(below) or a `<owner>.github.io` root repository.

---

## Custom domain (Cloudflare DNS)

Assumes your domain's DNS is on Cloudflare; any DNS provider works the same way
apart from the dashboard.

1. **Tell GitHub Pages the domain:**

   ```bash
   gh api -X PUT repos/<owner>/<repo>/pages -f cname=your-domain.example
   ```

   (UI equivalent: Settings → Pages → Custom domain.)

2. **Point DNS at Pages.** In Cloudflare, add for an apex domain
   (`your-domain.example`):

   ```
   Type: CNAME   Name: @   Target: <owner>.github.io   Proxy: DNS only
   ```

   Cloudflare flattens the apex CNAME automatically. For a subdomain
   (`www` or `kb`), same record with `Name: www`. Keep the record **DNS only**
   (grey cloud) at least until the certificate is issued; GitHub can't provision
   TLS behind Cloudflare's proxy.

3. **Wait for the certificate, then enforce HTTPS:** Settings → Pages →
   "Enforce HTTPS" (checkbox appears once the cert is provisioned; typically
   minutes, up to an hour). Or:

   ```bash
   gh api -X PUT repos/<owner>/<repo>/pages -F https_enforced=true
   ```

4. **Match the config:** set `place.domain` in `place.config.ts` to the same
   domain — it drives canonical URLs, the sitemap, and RSS. Commit and push so
   the next deploy builds against the right origin.

Verify end-to-end:

```bash
curl -sI https://your-domain.example | head -5
```

---

## Cloudflare Workers

Dynamic capability runs on Cloudflare Workers, separate from the static site on
GitHub Pages. Each worker lives in its own directory under `workers/` with its own
`wrangler.toml`, and is deployed by hand — CI never deploys a worker, so nothing
here runs on a push. `workers/feedback/` is the endpoint the feedback widget posts
to; `workers/chat/` retrieves cited knowledge-base context and streams an answer;
`workers/og/` renders per-article social-preview images on demand.

Everything below can stay inside the **free tier**: Workers, D1, and the shared
Workers AI daily allocation.

### The config you deploy is generated, not committed

A Worker script name and a D1 `database_name` are **account-scoped**: two instances
that deploy under the same names collide in one Cloudflare account, the second
overwriting the first's script and rebinding it to the second's database. The
Worker's `ALLOWED_ORIGIN` is your site's origin. All three are your place's
identity, and `workers/` is a code tree that may carry none of it (AGENTS.md iron
rule 2 — both machine gates scan it). So:

- **`workers/<worker>/wrangler.toml` is a committed template.** It ships
  placeholders and you never edit it. `npm run worker-config:check` fails the build
  if a real name, database name, or `[vars]` value is committed there — in your
  checkout as well as in the framework's.
- **`workers/<worker>/wrangler.generated.toml` is what you deploy.** `npm run
  worker-config` writes it from `place.config.ts`. It is gitignored, disposable, and
  regenerated whenever your config changes.
- Every `wrangler` command below therefore passes `--config` (global flag: "Path to
  your Wrangler configuration file"), which `deploy`, `d1 create`, and
  `d1 migrations apply` all accept.

**The derivation rule**, applied to both the Worker name and the D1 database name:

```
<place-slug>-<worker-directory-name>
```

`<place-slug>` is `place.name` from `place.config.ts`, lowercased, with every run of
characters outside `[a-z0-9]` collapsed to a single `-`, leading and trailing `-`
removed, truncated to 40 characters, and any trailing `-` the cut exposed removed
again — a name truncated mid-separator yields `<slug>-feedback`, never
`<slug>--feedback`. So a place named "Marisol Cove" deploys
`workers/feedback/` as `marisol-cove-feedback`. `ALLOWED_ORIGIN` is `place.domain`,
with `https://` added when the domain carries no scheme. Everything else in the
template — `main`, `compatibility_date`, the D1 `binding`, `migrations_dir`, and the
rate-limit vars — is carried through unchanged.

**`npm run init` does nothing for `workers/`.** The wizard never touches the tree:
its worker-related prompts ask for deployed endpoint URLs, with blank defaults,
because at init time no worker exists yet. Generation at deploy time
is the whole adoption path for `workers/`, and it needs no wizard step — your
`place.config.ts` is the only input.

### Prerequisites

- A Cloudflare account (free plan is enough).
- `wrangler` is deliberately **not** a project dependency — it pulls a
  platform-specific binary into the lockfile that CI would then have to resolve for
  a tool CI never runs. Invoke it with `npx` instead, which downloads it on demand.
- Log in once per machine:

```bash
npx wrangler login
```

### Deploying the feedback worker

Run every command from the **repository root** — `--config` carries the path, so
there is no directory to change into.

**1. Generate the config.** Read the derived name out of its output; the steps below
use `<worker-name>` for it.

```bash
npm run worker-config
```

It reports one line per worker (`name=…  ALLOWED_ORIGIN=…`) and notes that
`database_id` is still empty, which is expected until step 3.

**2. Create the D1 database**, under the same derived name:

```bash
npx wrangler d1 create <worker-name> \
  --config workers/feedback/wrangler.generated.toml
```

The database this creates is what `database_id` will point at; the generated
config's own `database_id` is still empty at this point, which is expected until
step 3. Do not pass `--update-config`: it would write the id into the generated
file, which the next regeneration discards. `place.config.ts` is where it lives.

**3. Record the database id and regenerate.** The command above printed a
`database_id`. Put it in `place.config.ts` — that file is yours (`merge=ours`), sits
outside every gate scan root, and survives a fresh clone, which a gitignored
generated file does not:

```ts
workers: {
  feedback: '',                                  // filled in at step 6
  feedbackDatabaseId: 'PASTE_THE_DATABASE_ID',
},
```

Then regenerate so the id reaches the config wrangler reads:

```bash
npm run worker-config
```

> **Why `place.config.ts` and not a gitignored sidecar.** The other candidate was a
> gitignored `workers/feedback/.deploy.json` holding the id beside the worker,
> recoverable with `npx wrangler d1 list` if it were ever lost. It was rejected:
> gitignored state does not survive a fresh clone, so every clone would need that
> recovery step before it could deploy, and it would split instance identity across
> two files. A D1 database id is an account-scoped identifier, not a credential —
> useless without account authentication — so there is nothing to protect by keeping
> it out of your repository, and `place.config.ts` is already the one place your
> instance's identity lives. `npx wrangler d1 list` remains how you recover the id if
> you lose it, whichever file it was in.

**4. Apply the schema.** This creates the `feedback` and `submission_window`
tables. Re-running it is safe; only unapplied migrations run.

```bash
npx wrangler d1 migrations apply <worker-name> --remote \
  --config workers/feedback/wrangler.generated.toml
```

**5. Set the IP-hash salt.** The worker rate-limits per address, and it stores only
`sha256(address + salt)` — never the address itself. Without the salt a hash of an
IPv4 address is reversible by brute force in seconds, so the worker refuses to run
(HTTP 500) rather than hash unsalted. Use a long random value; a secret is never a
var, so it goes in neither config file:

```bash
openssl rand -hex 32 | npx wrangler secret put IP_HASH_SALT \
  --config workers/feedback/wrangler.generated.toml
```

**6. Deploy, then point the site at it.**

```bash
npx wrangler deploy --config workers/feedback/wrangler.generated.toml
```

`wrangler` prints the deployed URL (`https://<worker-name>.<subdomain>.workers.dev`).
Set it in `place.config.ts` and turn the feature on. The widget needs both: with
either half missing it renders nothing, so a flag switched on before the worker
exists cannot produce a form that posts nowhere.

```ts
features: { feedback: true, /* ... */ },
workers: {
  feedback: 'https://<worker-name>.<subdomain>.workers.dev',
  feedbackDatabaseId: '…',
},
```

Rebuild and redeploy the site afterwards — the endpoint is read at build time, so
the browser never fetches config. `ALLOWED_ORIGIN` (generated from `place.domain`)
must be the origin the site is served from, or every submission comes back 403.

> If a step ever needs a value generation cannot supply, `wrangler deploy` also
> accepts `--name`. Reach for it only as a fallback; the generated config is the
> supported path, and the D1 binding resolves through `database_name` in the file
> regardless.

### Configuration

Everything below is derived into `wrangler.generated.toml` by `npm run
worker-config`, except `IP_HASH_SALT`, which is a secret you set once (step 5). The
committed `wrangler.toml` is where the framework's own defaults live; the
"Source" column says where each value comes from.

<!-- worker-vars: feedback -->

| Name | Required | Source | Meaning |
|---|---|---|---|
| `name` | yes | derived: `<place-slug>-<worker>` | The Worker script name, account-scoped, and the subdomain of its `workers.dev` URL. |
| `ALLOWED_ORIGIN` | yes | `place.domain` | The single origin allowed to post. Never `*`. Unset or mismatched → every request is 403. |
| `database_name` | yes | derived: `<place-slug>-<worker>` | The D1 database, account-scoped. Must match the database you created in step 2. |
| `database_id` | yes | `place.config.ts` → `workers.feedbackDatabaseId` | Printed by `wrangler d1 create`. Absent-safe: unset generates an empty value and a note, which is the state between steps 1 and 3. |
| `IP_HASH_SALT` | yes (secret) | `wrangler secret put` | Salt for the per-address hash. Missing → every POST is 500. Never a var. |
| `RATE_LIMIT_MAX` | no | template (`5`), override `workers.feedbackRateLimitMax` | Submissions allowed per address per window. |
| `RATE_LIMIT_WINDOW_SECONDS` | no | template (`3600`), override `workers.feedbackRateLimitWindowSeconds` | Length of the rolling window, in seconds. |

The last two rows carry an **override**: the committed
`workers/feedback/wrangler.toml` is framework-owned and ships the default, but you
can set a different value in `place.config.ts` under `workers` and `npm run
worker-config` writes it into the generated config. Editing the committed template
directly is not forbidden — it is your repository, and `npm run worker-config:check`
warns rather than failing your build for it — but the override key is the cheaper
home: it is instance-owned, so it never conflicts on a framework upgrade, while a
retuned template value conflicts on every release until you and the framework agree
again (`UPGRADE.md` §Framework-owned files). Leave a key unset and the template
default is carried through unchanged, so an instance that sets neither behaves
exactly as it did before these keys existed. A value the worker could not use is
rejected at generation time by name — a limit below `1`, a fractional count,
anything non-numeric — rather than deploying and silently falling back to the
default. If a later release drops one of these vars from the template, `npm run
worker-config` names the key, leaves the value out, and finishes, so one stale key
never blocks a deploy.

```ts
workers: {
  // ...
  feedbackRateLimitMax: 20,
},
```

The rate limit is keyed on `sha256(address + salt)`, which is **per public address,
not per person**: everyone behind one NAT shares one budget. A hotspot, a cafe, a
hotel, a school, and a QR code that puts the form in front of a group standing in
one place all land on the same key. A rate-limited submission tells the reader to try
later and tells you nothing at all: a ceiling too low for a placement produces
silence, not a report, so no absence of feedback is evidence that the limit is not
being hit. Raise `feedbackRateLimitMax` for placements busier than the default
assumes.

The `[[d1_databases]]` block binds the database as `DB`; `binding = "DB"` is the
name the worker's code uses and is framework-owned, not instance identity.

### Reading rows back

The triage skill reads D1 directly, but any query works from the CLI. `--remote`
targets the deployed database; without it you get the local dev copy. `<worker-name>`
is the derived name from step 1. These run from the repository root like every step
above, and pass the same `--config`: the path is repo-relative, and without it
`wrangler` resolves whichever config it finds nearest the directory you happen to be
in.

```bash
# The newest submissions
npx wrangler d1 execute <worker-name> --remote \
  --config workers/feedback/wrangler.generated.toml \
  --command "SELECT id, created_at, page, category, status FROM feedback ORDER BY created_at DESC LIMIT 20"

# One submission in full
npx wrangler d1 execute <worker-name> --remote \
  --config workers/feedback/wrangler.generated.toml \
  --command "SELECT * FROM feedback WHERE id = 'PASTE_AN_ID'"

# Mark one triaged
npx wrangler d1 execute <worker-name> --remote \
  --config workers/feedback/wrangler.generated.toml \
  --command "UPDATE feedback SET status = 'triaged' WHERE id = 'PASTE_AN_ID'"
```

`submission_window` holds only rate-limit counters keyed by salted hash — one row per
address per second in which it submitted, which is what makes the window roll rather
than reset on a boundary. The worker deletes rows once they age out of the window, so
the table stays small on its own. Deleting rows by hand is safe; it resets those
addresses' limits.

### Tests

The worker's unit suite runs under `node:test` with no Cloudflare dependency and no
network, driving the handler against an in-memory D1 stub. CI runs it on every pull
request; run it locally with:

```bash
npm run test:workers
```

### Deploying the OG image worker

`workers/og/` renders per-article social-preview cards on demand. No database,
no secrets, no state: it fetches `topics.json` from the deployed site on first
request, renders a PNG with Satori and resvg-wasm, and caches the result at the
edge for a year. Everything stays inside the free tier.

**1. Generate the config.** Same command as the feedback worker; it writes all
workers:

```bash
npm run worker-config
```

**2. Deploy.**

```bash
npx wrangler deploy --config workers/og/wrangler.generated.toml
```

**3. Register the route in the Cloudflare dashboard.** Workers on the free tier
use `workers.dev` subdomains by default. If you want the OG endpoint on your own
domain (e.g. `og.example.com/og/...`), add a route pattern in the Cloudflare
dashboard under Workers > Routes. The route is a custom-domain setup, not a
wrangler config entry.

**4. Point the site at it and turn the feature on.**

```ts
features: { og: true, /* ... */ },
workers: {
  og: 'https://<worker-name>.<subdomain>.workers.dev',
  /* ... */
},
```

Rebuild and redeploy the site. `SEO.astro` reads `features.og` and `workers.og`
at build time; with either missing the OG meta tag points to the static
`og-default.png` as before.

**5. Purge the edge cache on redeploy.** Each OG image is cached with
`max-age=31536000, immutable`. After an article title changes or you update the
card style, purge the cached URLs so the next request renders fresh:

```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/ZONE_ID/purge_cache" \
  -H "Authorization: Bearer CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"prefixes":["og.example.com/og/"]}'
```

Or purge everything via the Cloudflare dashboard under Caching > Purge Cache.

### OG worker configuration

<!-- worker-vars: og -->

| Name | Required | Source | Meaning |
|---|---|---|---|
| `name` | yes | derived: `<place-slug>-og` | The Worker script name, account-scoped. |
| `SITE_ORIGIN` | yes | `place.domain` | Origin to fetch `topics.json` from (e.g. `https://example.com`). |
| `SITE_NAME` | yes | `place.name` | Site name rendered on the card footer. |
| `CATEGORY_COLORS` | yes | `categories[].color` | JSON map of slug to hex color for the category badge. Empty entries omitted. |

No D1, no secrets, no rate limit. The worker is stateless: its only external
dependency is the site's own `topics.json`, which it fetches once on cold start
and caches in global scope.

### Corpus embeddings

`npm run embeddings:build` turns `knowledge/` into the retrieval index the chat
worker queries. It chunks every article at roughly 300-500 words on `##` heading
boundaries, embeds each chunk with `@cf/baai/bge-m3` through the Workers AI REST
API, and writes `workers/chat/vectors.json`.

**The artifact is gitignored, so a deploy must rebuild it first.** It carries every
article's title, URL, and body text, and `workers/` is a code tree that may hold no
place identity (AGENTS.md iron rule 2). `npm run worker-config:check` fails if a
`vectors.json` is ever committed. Nothing in the site build or in CI produces it:
the build stays green with no Cloudflare credentials in the environment, and this
command is a deliberate manual step.

**1. Mint an API token.** In the Cloudflare dashboard under My Profile > API Tokens,
use the **Workers AI** token template. If you create a custom token instead, running
inference over the REST API needs both of these permissions, not just the read one:

```
Account | Workers AI | Read
Account | Workers AI | Edit
```

Scope it to the single account you deploy from. `ai/run/@cf/baai/bge-m3` is an
inference call, so a Read-only token is rejected before any embedding is returned
([Workers AI REST API](https://developers.cloudflare.com/workers-ai/get-started/rest-api/),
checked 2026-08-06).

**2. Export the two variables and run the build.** The account id is an identifier,
not a credential — it appears in dashboard URLs, so typing it is fine. The token is a
credential: read it from a prompt rather than typing it on the command line, because
an inline `VAR=value command` prefix is written to your shell history verbatim.

```bash
export CF_ACCOUNT_ID=<your-account-id>
printf 'Cloudflare AI token: ' && read -rs CF_AI_TOKEN && echo && export CF_AI_TOKEN
npm run embeddings:build
```

(`read -rs` is silent and works in both bash and zsh; `npx wrangler whoami` prints
your account id if you do not have it to hand.)

Both variables are required. A missing or blank value exits nonzero naming the
variable rather than silently skipping the embedding step and writing a hollow index.

**Where the credentials live: nowhere in this repository.** The build reads both from
the environment at run time. Nothing writes them to a file, no log line prints the
token or the request URL, and the emitted `vectors.json` carries only chunk text and
vectors. Errors name the variable and the HTTP status, never the value. Keep it that
way: if you park the token in a file for convenience, `.gitignore` already covers
`.env` and `.dev.vars`, but a credential in the environment of the one shell that
needs it is safer than a credential on disk. To revoke, roll the token in the
Cloudflare dashboard — nothing in the repository has to change.

**3. Re-run it after any `knowledge/` change.** The index is a snapshot: an article
added, edited, or deleted since the last run is respectively missing, stale, or a
dangling citation until you rebuild. The run prints articles in, chunks out, and
bytes written, and it fails naming the file if any article produced zero chunks.

**What gets embedded, and what the run tells you it skipped.** The corpus is every
article the site publishes — a `knowledge/<Category>/*.md` whose directory is one of
your `place.config.ts` categories. An article in a directory that is not a configured
category has no page, so a chat answer citing it would link to a 404; the run prints
each one by name under `article(s) NOT embedded` rather than passing over it. If you
see a file listed there that should be searchable, the fix is to give it a route (add
its directory to `categories` in `place.config.ts`) or move it into a category that
already has one — not to change this command. Files starting with `_` are not articles
and are not listed.

**Free-tier budget.** Workers AI allows 10,000 neurons per day on the free plan
(`[as-of 2026-07]`); one embedding call is well under one neuron, so a corpus of a
few thousand chunks costs a small fraction of one day's allowance. The cost scales
with total chunks, not with articles, and it is paid once per rebuild — there is no
per-request cost at read time, because the chat worker loads the static artifact
rather than querying a vector service.

| Name | Required | Source | Meaning |
|---|---|---|---|
| `CF_ACCOUNT_ID` | yes | Cloudflare dashboard | The account that owns the Workers AI allowance. |
| `CF_AI_TOKEN` | yes | API token, `Workers AI: Read` + `Workers AI: Edit` (or the Workers AI template) | Bearer token for the `ai/run` REST endpoint. |

### Deploying the chat worker

Build the corpus embeddings first. The generated `workers/chat/vectors.json` is a
required module import, so `wrangler deploy` fails if the artifact is absent. Rebuild
it after every `knowledge/` change before redeploying the worker.

**1. Generate the worker config and create its D1 database.** The D1 database holds
only hashed-address rolling rate-limit counters. Cloudflare's native Rate Limiting
binding supports only 10- or 60-second periods, so it cannot implement this worker's
configurable 3,600-second exact rolling window.

```bash
npm run worker-config
npx wrangler d1 create <place-slug>-chat \
  --config workers/chat/wrangler.generated.toml
```

Put the printed id in the instance-owned config and regenerate:

```ts
workers: {
  chat: '',
  chatDatabaseId: 'PASTE_THE_DATABASE_ID',
},
```

```bash
npm run worker-config
npx wrangler d1 migrations apply <place-slug>-chat --remote \
  --config workers/chat/wrangler.generated.toml
```

**2. Set the IP-hash salt.** The worker refuses POST requests with HTTP 500 when
the salt is absent or blank. It stores `sha256(address + salt)`, never the address.

```bash
openssl rand -hex 32 | npx wrangler secret put IP_HASH_SALT \
  --config workers/chat/wrangler.generated.toml
```

**3. Deploy and record the endpoint.** The committed template declares the Workers
AI binding as `AI`; no API token is needed for inference inside the deployed Worker.

```bash
npx wrangler deploy --config workers/chat/wrangler.generated.toml
```

```ts
features: { chat: true, /* ... */ },
workers: {
  chat: 'https://<place-slug>-chat.<subdomain>.workers.dev',
  chatDatabaseId: '…',
},
```

Rebuild and redeploy the static site after setting the endpoint. `ALLOWED_ORIGIN`
is derived from `place.domain` and exact-match CORS rejects every other origin.

<!-- worker-vars: chat -->

| Name | Required | Source | Meaning |
|---|---|---|---|
| `AI` | yes | `[ai] binding = "AI"` | Workers AI binding used for query embedding and streamed answer generation. |
| `DB` | yes | `[[d1_databases]] binding = "DB"` | Exact rolling-window rate-limit state. |
| `ALLOWED_ORIGIN` | yes | `place.domain` | The only accepted browser origin. Unset or mismatched requests receive 403. |
| `SITE_NAME` | yes | `place.name` | Site identity injected into the system prompt. |
| `IP_HASH_SALT` | yes (secret) | `wrangler secret put` | Salt for the stored address hash. Missing or blank requests receive 500. |
| `RATE_LIMIT_MAX` | no | template (`20`), override `workers.chatRateLimitMax` | Accepted requests per hashed address in the rolling window. |
| `RATE_LIMIT_WINDOW_SECONDS` | no | template (`3600`), override `workers.chatRateLimitWindowSeconds` | Exact rolling-window duration in seconds. |
| `RELEVANCE_FLOOR` | no | template (`0.46`), override `workers.chatRelevanceFloor` | Cosine score a chunk must reach to be retrieved. Nothing clears it means nothing is cited and the answer refuses. See below. |

The three rows above carry an **override**: the committed `workers/chat/wrangler.toml`
is framework-owned and ships the default, but you can set a different value in
`place.config.ts` under `workers` and `npm run worker-config` writes it into the
generated config. Editing the committed template directly is not forbidden — it is your
repository, and `npm run worker-config:check` warns rather than failing your build for
it — but the override key is the cheaper home: it is instance-owned, so it never
conflicts on a framework upgrade, while a retuned template value conflicts on every
release until you and the framework agree again (`UPGRADE.md` §Framework-owned
files). Leave a key unset and the template default is carried through
unchanged, so an instance that sets none behaves exactly as it did before these keys
existed. A value the worker could not use is rejected at generation time by name — a
rate limit below `1`, a floor outside `0..1`, a fractional count, anything non-numeric —
rather than deploying and silently falling back to the default.

```ts
workers: {
  // ...
  chatRateLimitMax: 60,
  chatRelevanceFloor: 0.52,
},
```

If a later framework release drops one of these vars from the template, the key you set
has nothing left to override. `npm run worker-config` does not stop for that — it names
the key and the value, writes every other worker's config as usual, and tells you the
value was left out, so one stale key never blocks a deploy. Read that release's
CHANGELOG before going further: a var removed from the template usually means the worker
stopped reading it.

The rate limit is keyed on `sha256(address + salt)`, which is **per public address, not
per person**: everyone behind one NAT shares one budget. A hotspot, a cafe, a hotel, a
school, and a QR code that puts the chat in front of a group standing in one place all
land on the same key. Raise `chatRateLimitMax` for placements busier than the default
assumes.

### Tuning the relevance floor

Retrieval takes the top five chunks by cosine similarity, which on its own can never
say "the corpus does not cover this": a fixed count off a sorted list always returns
five, so a question with no support still cites the five least-bad matches. That is a
fabricated source list wearing real URLs. `RELEVANCE_FLOOR` is the cutoff that makes an
empty result reachable. Below it a chunk is not retrieved, so it never enters the
prompt and never becomes a citation; when nothing clears it the model is told outright
that no excerpt is relevant, and the page renders "no sources found".

**The shipped default in the table above is measured against the template's demo
corpus, and your corpus is not that corpus.** Re-measure it after your content settles:

1. Build the vectors (`npm run embeddings:build`) so you are scoring against the same
   artifact the worker loads.
2. Assemble two lists of questions: ten or so your articles genuinely answer, and five
   or so about places or topics your knowledge base never mentions.
3. Embed each question with `@cf/baai/bge-m3` and score it against every chunk in
   `workers/chat/vectors.json`, exactly as the worker does: L2-normalize the query and
   take its dot product with each stored vector divided by 127.
4. Compare the best score per question across the two lists. Set the floor in the gap
   between them.
5. Record that value in `place.config.ts` as `workers.chatRelevanceFloor`, then
   `npm run worker-config` and redeploy. That key is the supported home for a measured
   floor: it is instance-owned, it survives every `/sekai-upgrade`, and the generated
   config it feeds is what `wrangler deploy` reads. Writing the number into
   `workers/chat/wrangler.toml` instead also works and is allowed — the gate warns,
   naming both values and the cost, rather than failing your build — but it forks a
   framework-owned file, so it conflicts on each release until you upstream it. A value
   typed into the Cloudflare dashboard is the one option that does not work at all: the
   next deploy overwrites it from the generated config.

```ts
workers: {
  // ...
  chatRelevanceFloor: 0.52,
},
```

On the demo corpus, measured 2026-08-08, that gap runs from 0.435 (the best score any
never-mentioned place reached) to 0.484 (the worst score a real question reached), and
the shipped default splits it. Set the floor too high and real questions start refusing;
too low and off-topic questions keep citing. Setting it to `0` disables filtering
entirely.

**What the floor cannot do.** It separates questions about *other* places. It does not
separate questions about *your* place that no article happens to answer: those are dense
with your vocabulary and score at or above genuinely answerable questions (0.512 to
0.595 on the demo corpus, against a real-question floor of 0.484). No cutoff catches
those without also rejecting real questions, so for them the refusal appears in the
answer text and a person is what verifies it. The evaluation set below encodes that
split directly, as `expect: no-citations` versus `expect: refusal-in-answer`.

### Evaluating the deployed chat

`knowledge/chat/_eval.md` is an optional list of questions with the articles each answer
should rest on. `npm run chat:eval` posts every one to a deployed worker and exits
nonzero when a cited URL resolves to no published article, when a question declaring
`expect: no-citations` cites anything, or when a request errors. It writes
`reports/chat-eval.md` with every question, answer, and citation set.

```bash
npm run chat:eval
npm run chat:eval -- --endpoint https://your-chat-worker.workers.dev
```

The endpoint comes from `workers.chat`, the presented origin from `place.domain`, and
the published-article index from your local `public/kb/topics.json` when it exists,
otherwise from `/kb/topics.json` on your site. `--endpoint`, `--origin`, `--topics`, and
`--out` override each of those.

Answer quality is deliberately not machine-judged: scoring prose would need a second
model in the loop or a brittle string match against a free-tier model's phrasing. Read
the report and confirm each answer is grounded in what it cites and that the refusal
questions refused. An absent manifest exits 0 with "no evaluation set", so an instance
that never writes one is not broken.

### QR codes for physical places

A visitor standing at a trailhead has no app, no account, and no reason to search. A
printed code is the whole onboarding: it opens `/chat?ctx=<slug>`, which greets them for
the spot they are standing in and steers the first question toward the articles about it.

Declare the places in `knowledge/chat/_contexts.md` — optional, gray-matter frontmatter,
an ordered `contexts` list, body free for your own notes. The leading `_` is what keeps
the file invisible to the three scanners that walk `knowledge/` looking for articles;
never rename it without the prefix.

A context requires `slug`, `label`, `greeting`. A context also accepts optional `hint`,
`article`.

```yaml
---
contexts:
  - slug: north-dock
    label: North Dock
    greeting: >-
      You are at the north dock. Ask about the boats, the birds, or how this
      stretch of water got its name.
    hint: the north dock and the water around it
    article: /places/north-dock
---
```

- **`slug`** is the `ctx` query value and goes into a printed URL, so it is restricted to
  lowercase letters, digits, and single hyphens.
- **`greeting`** is the opening message. Write it for somebody holding a phone in the
  wind, not for a reader at a desk.
- **`hint`** biases *retrieval* toward this location. It is appended to the text that gets
  embedded for the reader's first question and is never shown to the model as an
  instruction, so a hint changes which articles are found and cannot change how the
  answer is written. It rides the first question only: by the third, the reader has moved
  on. A `hint` is capped at 200 characters, the longest one the chat worker accepts; a
  longer one is ignored with a build-time warning and the context keeps working, because
  sending it would fail every question asked from that context and take the printed code
  out of service.
- **`article`** is a site-root-absolute route your build produces, rendered as a link
  under the greeting. A route that resolves to nothing drops that whole context with a
  build-time warning, because a greeting that sends a reader at a 404 is worse than one
  code that does nothing.

Contexts are dropped one at a time. A duplicate `slug`, a missing required field, an
unusable `slug`, and an unresolvable `article` each take out that one entry with a named
warning in the build log and leave every other code working. An `unknown` or absent `ctx`
in a URL is not an error either: the page opens exactly as it does for a reader who typed
it, which is what makes a code outliving its sign harmless.

Print the codes:

```bash
npm run qr:sheet
```

That writes `qr-sheet.html` at the repository root — gitignored, because it is a print
artifact regenerated on demand, not repository content. Open it in a browser and print.
Each card carries the code, the place's name, and the URL in plain text for anyone who
would rather type it; the sheet is laid out to fit both A4 and US Letter without choosing
a paper size, and everything including the codes is inline, so it prints correctly from a
`file://` URL with no network. With no manifest it exits 0 saying no contexts are
declared — declaring none is not a failure. A manifest whose contexts were *all* dropped
by validation is the opposite state and exits nonzero naming how many, because an empty
sheet from a manifest you wrote is a manifest to go fix, not a place with nothing on a
wall yet.

The flags, all optional: `--domain`, `--out`, `--root`.

| Flag | Default | Use it when |
|---|---|---|
| `--domain <host>` | `place.domain` | Printing codes for a domain you have not put in the config yet — a staging host, or a rehearsal before the site goes live. |
| `--out <path>` | `qr-sheet.html` | Keeping several sheets side by side, or writing outside the repository. Only the default path is gitignored. |
| `--root <path>` | this repository | Printing another instance's sheet without leaving this one. It is also how the CLI's own test suite drives it against a temporary tree. |

No build is required. The `article` links are checked against the routes your build
produces, and that set is derived from `knowledge/` and `place.config.ts` — the same set
`/chat` itself validates against — so the sheet can be printed before the site has ever
been built.

**Model and free-tier contract.** `CHAT_MODEL` in `workers/chat/src/index.mjs` is
the single generation-model constant. On 2026-08-07 it was verified against the
[Workers AI model catalog](https://developers.cloudflare.com/workers-ai/models/)
and the [model's streaming API documentation](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/)
as `@cf/zai-org/glm-4.7-flash`, a Cloudflare-hosted, streaming-capable model. The
Workers AI free allocation is
10,000 neurons per day, shared by corpus builds, per-request query embeddings, and
answer generation. Monitor that account-level total; if answer quality requires a
hosted paid model, follow the dated quality/cost escalation analysis in
[the upstream platform notes §2.10](https://github.com/wilsonkichoi/sekai-kb/blob/main/dev%5Fdocs/research/platform-notes.md#210-cost-and-platform-comparison)
and re-verify the model and pricing at selection time. The SPEC intentionally does
not pin a generation model.

---

## Visual regression

Optional but recommended once your instance's look settles:

```bash
# Capture the reference screenshots (run once, and after intentional redesigns)
npm run visual:baseline

# Compare current pages against the baseline
npm run visual:check
```

---

## Troubleshooting

- **`npm ci` rejects the lockfile** — use `npm ci --force` (see Install). If it
  persists after a dependency change, regenerate:
  `rm -rf node_modules package-lock.json && npm install`, then re-verify with
  `npm ci --force`.
- **`article-health` says command not found / Python errors** — run `uv sync`
  first; every Python entry point goes through `uv run`.
- **Build fails on a content file** — run `npm run test` for frontmatter
  errors, then `npm run article-health -- <file> --profile=pre-commit` for the
  editorial gate's view.
- **Deploy job skipped** — the deploy job only runs on push to `main`; PR runs
  build but never publish.
