# Changelog

All notable changes to the **sekai-kb** framework are recorded here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Release discipline (read before cutting a release)

sekai-kb is the framework SSOT; instances track it by merging **immutable release
tags, never framework `main`** (ADR 004, SPEC
§Repo topology). The rules that keep two-repo upgrades deterministic:

1. **Every framework change lands with a CHANGELOG entry.** No entry, no release.
   The entry names what changed in the framework-owned trees (`src/`, `scripts/`,
   `.agents/skills/`, `docs/playbook/`, `docs/runbook/`, config).
2. **Breaking config changes carry an upgrade note.** Any change an instance must
   act on at merge time (a renamed `place.config.ts` key, a new required field, a
   moved file) goes under an explicit **Upgrade note** in that version's entry.
   New `place.config` keys MUST default to feature-off when absent (SPEC
   §Negative requirements, "New `place.config` keys must be absent-safe"), so an
   instance that ignores the note still builds — the note tells it what it is
   opting out of.
3. **Instances merge tags only.** The release flow is: land the change on `main`
   with its CHANGELOG entry → bump `FRAMEWORK-VERSION` and its npm manifest
   mirrors → tag
   `sekai-kb-vX.Y.Z` → push the tag. Instances run `/sekai-upgrade` (or the manual git
   flow in `docs/runbook/UPGRADE.md`), which merges the tag, never `main`.
4. **Instance-owned files are never overwritten.** Files an instance owns
   (`place.config.ts`, `knowledge/**`, `public/media/**`, `CNAME`, `CLAUDE.md`,
   `AGENTS.md`, `README.md`, `CHANGELOG.md`, adopter-only `VERSION`, `FRAMEWORK-VERSION`,
   `scripts/ci/genericity-denylist.local.txt`, `.agent-toolkit/**`, and the
   maintainer-doc tree `dev_docs/**`) carry
   `.gitattributes merge=ours` on the instance, so a tag merge keeps the
   instance's copy. Framework changes to those paths are therefore inert on
   instances by design — do not rely on them propagating. The attribute protects
   *content on a path that exists on both sides and differs from the merge base*;
   it does not preserve an absent path (the upgrade's classify/reconcile pass owns
   that), and it does not fire on a file the instance has not edited since the
   merge base. That last gap is a property of every `merge=ours` path, so the
   upgrade restores rather than trusts the attribute: `package-state.mjs` for
   `FRAMEWORK-VERSION` and the npm manifests, `maintainer-docs-state.mjs` for the
   `dev_docs/**` tree.

## [Unreleased]

## [1.1.4] — 2026-08-11

Feedback worker rate-limit vars gain a place.config.ts override path, the PlaceConfig declaration is stated once with a drift gate, and the chat worker supplies its refusal sentence directly.

### Added

- **The feedback worker's two rate-limit vars are now settable from
  `place.config.ts`.** `workers/feedback/wrangler.toml` ships `RATE_LIMIT_MAX = "5"`
  and `RATE_LIMIT_WINDOW_SECONDS = "3600"`, and until now the only way to change
  either was to edit that framework-owned file and re-resolve the conflict on every
  upgrade. The limit is keyed on `sha256(address + salt)` — per public address, not
  per person — so everyone behind one NAT shares a single budget of five submissions
  per hour: a cafe, a school, a hotel, or a group standing at one QR placement. A
  rate-limited submission is also silent from the operator's side, so no absence of
  reports is evidence that the ceiling is not being hit.

  Two optional keys under `workers` now carry them: `feedbackRateLimitMax` and
  `feedbackRateLimitWindowSeconds`. They are the same mechanism the three `chat*`
  tuning keys use, not a second one: `feedback` is one more entry in the
  `WORKER_VAR_OVERRIDES` registry in `scripts/deploy/wrangler-config.mjs`, which the
  generator and `npm run worker-config:check` both reach by iteration, so adding it
  needed no per-worker code path in either. `npm run worker-config` writes each key
  that is set into the generated config, rejecting at generation time by name a value
  the worker could not use (a limit below `1`, a fractional count, anything
  non-numeric). The committed template keeps its constants, stays the default
  carrier, and stays gated at them. The runbook's `feedback` var table names the
  override key beside each default, and the gate fails when that table and the
  registry disagree. `scripts/ci/check-worker-config-selftest.sh` now states its
  generator classes per worker, with one recorded pre-override fixture each, so the
  registry's second entry is proven by its own cases rather than by the first
  worker's.

> **Upgrade note:** `workers.feedbackRateLimitMax` and
> `workers.feedbackRateLimitWindowSeconds` are optional, absent-safe config-schema
> additions. An instance that sets neither behaves exactly as before: no key set means
> no override, and the generated `workers/feedback/wrangler.generated.toml` is
> byte-identical to the one the previous release produced from the same
> `place.config.ts` (a self-test case holds that byte-for-byte, against a config
> recorded before these keys existed). No edit is required at merge time. Set them
> only when you have a reason — a placement busier than five submissions per hour per
> address assumes — then regenerate with `npm run worker-config` and redeploy the
> worker.

### Fixed

- **The `PlaceConfig` declaration is stated once, and the init wizard emits that one.**
  `scripts/init/writer.mjs` carried its own copy of the interface inside a template
  literal, and nothing in this repository compared it to `place.config.ts`. It had lost
  five keys: `place.brandSuffix?`, `categories[].color?`, `categories[].colorLight?`,
  `features.og`, and `workers.og?`. Two of them are prompted — `scripts/init/prompt-table.mjs`
  asks `features.og` ("Enable per-article OG images") and `workers.og` — so the wizard
  wrote both into the emitted config object under an interface that declared neither.
  **Every `place.config.ts` the wizard had produced was a TypeScript excess-property
  error against its own interface**, and the other three failed the moment an adopter
  hand-added a brand suffix or a category color, both documented features. The copy is
  gone: `writeInstance` now reads the committed `place.config.ts` before overwriting it
  and re-emits the declaration it finds, through the new shared parser
  `scripts/init/place-config-interface.mjs`. Adding a config key is now two edits (the
  declaration and, if it is prompted, the table row) instead of three, and the emitted
  file is byte-identical to before apart from the five restored keys.
- **The drift is machine-gated.** New `scripts/ci/check-place-config-interface.mjs`
  (`npm run place-config:check`, wired into the `test` job of
  `.github/workflows/deploy.yml`) fails when `place.config.ts` carries no parseable
  declaration, when `writer.mjs` re-introduces one of its own, when what the wizard
  renders is not byte-identical to the committed declaration, when a prompt-table row
  names a key the declaration does not declare, or when a config object sets a property
  its own declaration omits. `npm run place-config:selftest` plants six defect classes —
  one per branch — and requires the gate to fail each, so the gate cannot pass vacuously.
  `scripts/init/check-init.sh` runs the same object-vs-declaration assertion against a
  real `--answers` wizard run, which is the half a static comparison cannot reach. No
  typechecker was added: `npm run build` strips types through esbuild, and `astro check`
  over this tree is a larger, separate change that would surface unrelated pre-existing
  errors.
- `scripts/ci/check-framework-docs.mjs` claimed in its header that the wizard's copy of
  the interface needed no gate because a drifted one would fail `npm run init:check` as a
  type error. It would not — nothing here typechecks — and under that reasoning the five
  keys were lost unnoticed. The comment now states what actually holds the two in
  agreement. `scripts/init/README.md` §Extending said the companion edit for a new prompt
  was the interface block in `writer.mjs`; it is now the declaration in `place.config.ts`.
  `dev_docs/SPEC.md` §`place.config.ts` names the new gate and gains the `brandSuffix?`
  key its schema line had never listed.
- **The chat worker's refusal is a sentence a reader can read, not an instruction the
  model repeats back.** When no chunk clears the relevance floor, `systemPrompt()` in
  `workers/chat/src/index.mjs` sent the model a line describing the refusal in the
  imperative: `Say that the knowledge base does not cover it and suggest browsing the
  knowledge base.` The deployed model dropped the leading verb and emitted the rest as
  its answer — "The knowledge base does not cover it and suggest browsing the knowledge
  base" — whose second clause has no subject. That is the reply every off-corpus
  question gets, and the QR flow (`/chat?ctx=<slug>`) puts it in front of somebody
  standing at a physical placement, so it was a plausible first impression of the whole
  site. The refusal is now a single exported constant, `REFUSAL_SENTENCE(siteName)`,
  supplied to the model as the sentence to produce rather than described to it, with a
  subject in every clause and the site name interpolated. Both prompt branches carry it
  on its own line after the instruction that names it, so a model that copies the line
  it was pointed at produces exactly the intended answer: the parroting failure degrades
  into the right output instead of a fragment. The with-context branch's twin line
  (`If the excerpts do not contain the answer, say so and suggest browsing the knowledge
  base.`) was written the same way and is rewritten the same way, before it is observed
  failing rather than after. The comment explaining why the no-context branch exists at
  all is unchanged.
- `workers/chat/test/chat.test.mjs` gains the guard for both branches: neither prompt may
  contain the parroted imperative or the subjectless `and suggest browsing` fragment, and
  each must contain the exact `REFUSAL_SENTENCE` text. The suite runs in CI through
  `npm run test:workers`. The prompt's four pre-existing no-context assertions and the
  with-context browse assertion pass unmodified — the rewrite was held to them rather
  than the other way round.

No **Upgrade note**: neither change adds, renames, or requires a `place.config.ts` key,
a deploy-time var, or an edit to a file an instance owns. The chat change is prompt text
inside the framework-owned worker, so an instance picks it up by redeploying that worker
after the merge. The wizard change makes the emitted declaration match the one the
framework already read — no config an instance holds becomes invalid. One thing worth
knowing rather than acting on: an instance adopted before this release has a
`place.config.ts` whose interface came from the old copy and is short those five keys.
It is instance-owned, so the merge leaves it alone, and nothing typechecks it either way;
add a key by hand if you want to use `place.brandSuffix`, a category `color`, or an
`og` worker.

## [1.1.3] — 2026-08-10

Framework-owned files warn instead of failing an instance's build, /sekai-upgrade reports diverged files with both values, chat worker tuning vars gain place.config.ts overrides, and a tag merge no longer stops on an unedited doc.

### Added

- **`/sekai-upgrade` now names the framework-owned files you have diverged on, with the
  framework's incoming value beside yours, before the merge.** The previous release made
  editing a framework-owned file a warning rather than a build failure, and rewrote
  `docs/runbook/UPGRADE.md` so no instruction discards your side without naming it. That
  left the naming itself as manual work: at merge time you got a bare conflict list and
  had to reconstruct, by reading two revisions of each file, what you had changed and
  why. A new helper, `scripts/upgrade/framework-divergence.mjs`, does it for you:

  ```bash
  node "$DIVERGENCE_HELPER" report --target "$TARGET"
  ```

  It walks `src/`, `scripts/`, `workers/`, and `.agents/skills/`, and for every path
  whose content differs from your merge base with the target it prints your value and
  the framework's incoming one — key by key for a `wrangler.toml` (the key with its
  table, `[vars] RELEVANCE_FLOOR`, your value, the framework's), as the differing region
  for anything else — plus how that path meets the merge: kept as yours, changed on both
  sides, a modify/delete, or already settled. *Settled* is the case where your side and
  the framework's incoming side are now the same content, which is where upstreaming an
  edit leaves you on the release that ships it back: the path is still listed as one you
  changed, and the report says there is no conflict and nothing to decide rather than
  printing a value pair with the same value twice.
  Reading the merge base rather than `--diff-filter=U` is what
  makes it a report and not an echo of the conflict list: the conflict list holds only
  what git could not settle by itself, so a file you changed that the framework did not
  is merged silently and never appears there at all. It is bootstrapped from the target
  tag like every other upgrade helper, runs before the merge, and **writes nothing** —
  no state file, no staged path, no side taken. There is no reconcile step for it, and
  every decision it reports stays yours. An instance carrying no local edits gets a
  three-line clean report; a first, unrelated-history merge has no common ancestor to
  measure against, so it says so and claims nothing rather than listing your whole tree.
  `docs/runbook/UPGRADE.md` step 4d and the `/sekai-upgrade` skill's step 3c are the same
  command, and `scripts/upgrade/check-upgrade-state.sh` holds them to it.

- **The chat worker's three deploy-time tuning vars are now settable from
  `place.config.ts`.** `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SECONDS`, and
  `RELEVANCE_FLOOR` had no instance-owned override path: `workers/chat/wrangler.toml`
  is framework-owned (`AGENTS.md` iron rule 3), so editing it forks a framework file
  that re-conflicts on every `/sekai-upgrade`, and a value typed into the Cloudflare
  dashboard is overwritten by the next `wrangler deploy` from the generated config.
  That left `RELEVANCE_FLOOR` in a contradiction: `docs/runbook/DEPLOY.md` §Tuning the
  relevance floor ships a procedure for re-measuring it against your own corpus, and
  the framework provided nowhere to record the answer. The rate limit is the
  reader-facing half — it is keyed on a hash of the caller's public address, so
  everyone behind one NAT (a hotspot, a cafe, a school, a group standing at one QR
  code) shares a single budget of 20 requests per hour.

  Three optional keys under `workers` now carry them: `chatRateLimitMax`,
  `chatRateLimitWindowSeconds`, and `chatRelevanceFloor`. `npm run worker-config`
  writes each one that is set into the generated config; the committed template keeps
  its framework constants, stays the default carrier, and stays gated at them. A value
  the worker could not use is rejected at generation time by name — a rate limit below
  `1`, a floor outside `0..1`, a fractional count, anything non-numeric — because the
  worker parses these vars leniently and would otherwise deploy clean while silently
  falling back to its own defaults. The runbook's `chat` var table now names the
  override key beside each default, and `npm run worker-config:check` fails when that
  table and the override registry disagree. If a future release removes one of these
  vars from the template, generation does not stop: it names the key and the value it
  could not apply, writes every config without it, and points you at that release's
  CHANGELOG.

> **Upgrade note:** `workers.chatRateLimitMax`, `workers.chatRateLimitWindowSeconds`,
> and `workers.chatRelevanceFloor` are optional, absent-safe config-schema additions.
> An instance that sets none of them behaves exactly as before: no key set means no
> override, and the generated worker config is byte-identical to the one the previous
> release produced from the same `place.config.ts` (a self-test case now holds that
> byte-for-byte). No edit is required at merge time. Set them only when you have a
> reason: a re-measured relevance floor for your own corpus, or a rate ceiling for
> placements busier than the template's default assumes. Regenerate with
> `npm run worker-config` and redeploy after changing one.

### Changed

- **"Framework-owned" now warns about upgrade risk instead of failing your build.**
  `scripts/ci/check-worker-config.mjs` held every committed `workers/*/wrangler.toml`
  to the framework's constants with no template-mode branch, and it runs in the
  `genericity` job of the `deploy.yml` an instance inherits. Retuning a value that is
  yours to tune — a relevance floor measured against your own corpus, a rate ceiling
  for a busier placement — therefore turned **your** repository's CI red, in a file in
  your own tree, for a divergence that costs nobody but you. The gate is now
  mode-gated (ADR 010, `dev_docs/` in the framework repository). In **template mode**
  (the `.sekai-template` marker, i.e. the framework's own tree) nothing changes: every
  check is still fatal, so a changed default is still a deliberate edit to the gate's
  `EXPECTED` table as well as to the template. In **instance mode** the gate fails
  only on what reaches past the person editing — a Worker `name`, a D1
  `database_name` or `database_id`, `ALLOWED_ORIGIN` (the workers' CORS boundary), a
  dropped `[[d1_databases]]` block, an unparseable config, an unregistered worker
  directory, and a tracked `wrangler.generated.toml` or `vectors.json`. Every other
  divergence — a retuned `[vars]` constant, a `[vars]` key you added, a drifted
  runbook default — warns, names the file, the key, your value, the framework's, and
  the cost (a merge conflict at the next `/sekai-upgrade`), and points at the
  `place.config.ts` override key when one exists. Under GitHub Actions the same
  warning is emitted as a `::warning` annotation, so it reaches the run summary and
  the pull request instead of only the log. The identity/tuning split is read from
  the existing `WORKER_VAR_OVERRIDES` registry rather than a second classification.
- **`docs/runbook/UPGRADE.md` no longer tells you to throw your own work away.** The
  first-merge instructions resolved every framework-owned conflict with one blind
  sweep (`for f in $(git diff --name-only --diff-filter=U); do git checkout --theirs
  ...`), which silently deleted exactly the edits the gate above now permits. It is
  replaced by a per-file decision: the conflicted paths are listed, and each is
  resolved after reading your side against the framework's incoming one
  (`git diff ":2:<file>" ":3:<file>"`) and that release's CHANGELOG entry. Step 7 of
  the routine flow is reworded the same way, and a new §Framework-owned files section
  states the doctrine: framework-owned is where a file comes from, not a permission
  boundary; upstreaming is recommended because it ends the conflict, not because a
  fork is disallowed. `docs/runbook/DEPLOY.md` and the `/sekai-upgrade` skill's
  conflict walk match, and `AGENTS.md` iron rule 3 — in the template and in the copy
  the init wizard writes for a new adopter — is reworded to state it as a default and
  an upgrade contract rather than an access boundary.

> **Upgrade note:** nothing to do at merge time, and no `place.config.ts` key changes.
> Two things are worth knowing. First, your CI may now print warnings where it
> previously printed nothing: an instance that already diverged from a committed
> `wrangler.toml` was failing before and is now green with a `::warning` naming the
> file and the cost. Second, **`AGENTS.md` iron rule 3 was NOT updated in your
> repository and never will be by an upgrade.** `AGENTS.md` carries
> `.gitattributes merge=ours`, so your copy is kept as-is on every tag merge by
> design — this release's new wording reaches new adopters only. If you want it, copy
> iron rule 3 from the tag yourself:
> `git show sekai-kb-vX.Y.Z:AGENTS.md` and take the "Framework vs instance" rule, or
> `git diff --no-index -- AGENTS.md <(git show sekai-kb-vX.Y.Z:AGENTS.md)` to see it
> beside yours. Leaving your copy alone is fine: it is prose your agents read, and the
> behavior it describes is enforced by the gate, which is framework-owned and does
> arrive with this release.

### Fixed

- **A tag merge no longer stops the upgrade over a maintainer document you kept
  verbatim.** `scripts/upgrade/maintainer-docs-state.mjs reconcile` used to assert that
  `merge=ours` had held every owned `dev_docs/**` path byte-for-byte, and to stop when it
  had not, prescribing two repairs: mark the path `merge=ours` and run
  `git config merge.ours.driver true`. On the instance that hit this both were already
  in place, so the prescribed remedy was a no-op and re-running reproduced the stop. The
  cause is the mechanic this changelog already records one file over: a merge driver runs
  only on a three-way **content** merge, so an instance whose copy still equals the merge
  base has git resolve to theirs without ever consulting the driver. Keeping a framework
  document unedited is the ordinary adopter state, not an edge case. `reconcile` now
  **restores** the pre-merge content of every file the merge modified or deleted under a
  path `git check-attr merge` reports as `ours`, staging it and amending the merge commit
  when git had already auto-committed — the same capture-and-restore treatment
  `package-state.mjs` gives `FRAMEWORK-VERSION`. A clone whose `merge.ours.driver` is
  unset takes the same restore and is told the driver is missing, instead of halting.
- **The remaining hard stop is narrower, and its diagnostic reports what it observed.**
  `reconcile` still stops for an owned path the instance never claimed — one
  `check-attr` reports as anything but `ours` — because reverting the framework's edit
  there would be the upgrade deciding ownership on the instance's behalf. That diagnostic
  now prints, per failing path, the attribute value git actually resolved and whether
  `merge.ours.driver` is configured in this clone, and prescribes only the repairs those
  observations support. It never tells a reader to mark a path that is already marked, or
  to configure a driver that is already configured.
- **A maintainer document whose filename is not pure ASCII no longer stops the upgrade.**
  `reconcile` reads the paths it restores out of `git diff --name-status` and
  `git ls-files -u`, and git C-quotes any path holding a byte above 0x7f
  (`core.quotePath` defaults to true). The quoted literal is neither a pathspec git
  accepts nor a path `git check-attr` resolves, so a file such as `dev_docs/café.md` was
  read as unclaimed and hit the hard stop above with the one remedy that cannot fix it.
  Both producers now use `-z`, which writes every path verbatim.
- Files the merge **added** under an owned path are still reported and never deleted, and
  an instance that wrote its own content at a maintainer-doc path (`ours != base`, where
  the driver does fire) is unaffected. `scripts/upgrade/check-upgrade-state.sh` gains
  case 14 for the `ours == base` restore, including the amend path, and splits case 10
  into the unclaimed-path stop and the unconfigured-driver restore; both new shapes are in
  the `--selftest` non-vacuity run. Every seeded maintainer-doc directory now carries a
  record with a non-ASCII filename, so case 14 pins the cleanly-merged path producer and
  case 10 the conflicted one. `docs/runbook/UPGRADE.md`, the `/sekai-upgrade` skill,
  and the SPEC change log are corrected to state the mechanic as a property of every
  `merge=ours` path and to name both helpers.

No **Upgrade note**: this changes no adopter-visible configuration, no
`place.config.ts` key, and no file an instance owns. It changes what the upgrade does
when it meets a state it previously refused to proceed from.

## [1.1.2] — 2026-08-08

Adds on-demand OG worker, cited RAG chat worker with corpus embeddings, /chat page with evaluation set, QR flow with location-context deep links and printable codes, and bumps the Node floor to 22.13.

### Added

- **QR flow: location contexts and printable codes.** `/chat?ctx=<slug>` opens with a
  greeting written for somebody standing at that spot and steers their first question
  toward the articles about it. A visitor at a trailhead has no app and no account, so a
  printed code is the whole onboarding — which is the reason this framework hosts its own
  chat instead of pointing at a vendor assistant.
- **`knowledge/chat/_contexts.md`, a new optional manifest.** Gray-matter frontmatter, an
  ordered `contexts` list, body free for human notes; the leading `_` keeps it invisible to
  the three scanners that walk `knowledge/`. A context requires `slug`, `label`, `greeting`
  and optionally carries `hint`, `article`. Greetings are prose about places, which is
  content, so they live here rather than in `place.config.ts`. `src/lib/chat-contexts.ts`
  reads it absent-safely: no manifest leaves `/chat` exactly as it was, and a duplicate
  `slug`, a missing required field, an unusable `slug`, or an `article` that resolves to no
  built route each drop that one context with a build-time warning naming it while every
  other code keeps working. An unknown or absent `ctx` is not an error either — a code that
  outlives its sign falls back to the ordinary page.
- **A context's `hint` reaches retrieval and never generation.** It is appended to the
  embedded query text and is absent from the prompt, so a context can change which articles
  are found and cannot instruct the model. A scanned URL is editable by anyone holding a
  phone; the prompt is the one place it may not reach. `workers/chat/` accepts `hint` as an
  optional bounded string, and a worker test asserts both halves. A `hint` is capped at 200
  characters, the bound the worker enforces on a request: the worker refuses a longer one
  with a 400 for the whole request, so the reader drops an over-long hint at build time with
  a warning and keeps the context. Shipping one would otherwise make every question asked
  from that context fail for as long as the code stayed on the wall.
- **`npm run qr:sheet`.** Renders the declared contexts as `qr-sheet.html` at the repository
  root — gitignored, a print artifact rather than repository content. One card per context:
  the code as inline SVG, the place's name, and the URL as text for anyone who would rather
  type it. Everything is inline, so it prints from a `file://` URL with no network, and the
  layout fits A4 and US Letter without choosing a paper size. No build is needed: the
  `article` links are checked against the same route set `/chat` validates against, derived
  from `knowledge/` and `place.config.ts`. With no manifest it exits 0 saying no contexts are
  declared; a manifest whose contexts were all dropped by validation exits nonzero naming how
  many, because an empty sheet from a manifest somebody wrote is a manifest to go fix. It is
  a script and not a `/qr` route: a page would add a gated route and an index
  to maintain for something only the operator printing the signs ever opens.
- **`@paulmillr/qr` (dev dependency).** Pure JS, zero runtime dependencies, no native
  bindings. It also ships a decoder, which `npm run test:qr` uses to round-trip every card's
  own inline SVG back to the URL it should encode — a wrong code is otherwise invisible until
  somebody prints it, mounts it, and scans it.
- **`scripts/ci/check-chat-context-schema-docs.mjs`** (folded into `npm run schema-docs`)
  derives the context field lists from the reader and fails CI when `dev_docs/SPEC.md`, the
  manifest body, or `docs/runbook/DEPLOY.md` disagrees with it. It also holds the hint bound
  and the `qr:sheet` flag list to one value each: the worker's own `MAX_HINT_CHARS` and the
  runbook's flag table are registered as statements about the reader and the CLI, so a second
  implementation cannot drift from the first any more quietly than prose can. Its engine is
  now shared with the soundscape gate in `scripts/lib/schema-docs.mjs`.
- **Runbook:** `docs/runbook/DEPLOY.md` gains a QR-codes section covering how to declare a
  context, what each field does, how contexts are dropped one at a time, and how to print.

- **On-demand OG image worker (`workers/og/`).** Per-article social-preview cards
  rendered with Satori and resvg-wasm, cached at the Cloudflare edge. The worker
  fetches article metadata from the site's own `topics.json` and renders title,
  category, and site name with each category's accent color. A bundled Latin-subset
  Inter font keeps the deployed bundle inside the free-tier limit without R2.
- **`place.config.ts` gains `features.og` and `workers.og`.** `SEO.astro` emits the
  worker URL as the `og:image` when both are set; every other combination falls back
  to the static `og-default.png`.
- **`gen-worker-config.mjs` derives per-worker `[vars]`** for `SITE_ORIGIN`,
  `SITE_NAME`, and `CATEGORY_COLORS`, extending the feedback worker's `ALLOWED_ORIGIN`
  pattern to a second worker.
- **Runbook:** `docs/runbook/DEPLOY.md` gains an OG worker subsection with the deploy
  command, vars table, route registration, and cache-purge instructions.
- **Corpus embeddings (`npm run embeddings:build`).** `scripts/core/build-embeddings.mjs`
  chunks every `knowledge/` article at roughly 300-500 words on `##` heading boundaries,
  embeds each chunk with `@cf/baai/bge-m3` through the Workers AI REST API, and writes
  `workers/chat/vectors.json`: int8-quantized unit vectors (a consumer's dot product is
  cosine) plus per-chunk `{id, slug, title, url, category, heading, chunkIndex, text}`
  metadata, under a versioned `rag-v1` manifest. This is the retrieval substrate the chat
  worker, the MCP `semantic_search` tool, and the refresh pipeline all read.
- **The embedding index is derived and gitignored.** It carries every article's title,
  URL, and body text, so it is rebuilt at deploy time rather than committed to `workers/`.
  Both machine gates skip it by name, and `npm run worker-config:check` now fails if a
  `vectors.json` — or any generated worker artifact — is tracked by git.
- **The corpus is every published article, and every article it does not embed is named
  in the run output.** Articles are discovered from the filesystem, the same way the
  frontmatter and article-health gates discover them, so a `knowledge/` directory that is
  not one of your `place.config.ts` categories is still seen. Its articles are not
  embedded — they have no page, so a chat answer citing one would link to a 404 — but the
  run prints each by name with the reason rather than passing over it silently. Give such
  a directory a route (add it to `categories`) and its articles join the corpus with no
  further change.
- **A failed embedding batch no longer hides the rest of the corpus.** The run attempts
  every batch, counts the failures, names the affected articles, and then fails without
  writing a partial `vectors.json`, so one run reports the whole picture instead of
  surfacing one bad batch at a time.
- **`npm run test:embeddings`** covers the chunker's splitting rules, the int8
  quantization round-trip, the Workers AI request contract against a stubbed `fetch`, the
  fail-soft batch loop, the zero-chunk coverage failure, and the assertion that every
  article-shaped file under `knowledge/` is either embedded or reported. It runs in CI and
  needs neither network nor credentials.
- **Runbook:** `docs/runbook/DEPLOY.md` gains a Corpus embeddings subsection with the two
  environment variables, the API-token permissions (`Workers AI: Read` **and**
  `Workers AI: Edit`, or the Workers AI token template — `ai/run` is an inference call, so
  a read-only token is rejected), what the run embeds and what it reports as skipped, when
  to re-run, the free-tier neuron budget, and where the credentials live (the environment,
  never the repository).
- **`.env` and `.dev.vars` are gitignored.** Nothing in the framework reads either file —
  credentials reach Cloudflare through `wrangler secret put` and reach the embedding build
  through the environment. They are ignored because `.dev.vars` is wrangler's conventional
  local-secret path and `.env` is everyone else's, so a token parked in one for convenience
  is never stageable.
- **Cited RAG chat worker (`workers/chat/`).** The worker embeds each query with
  `@cf/baai/bge-m3`, decodes the generated int8 corpus artifact once per isolate,
  retrieves the five highest cosine matches, and streams a free-tier Workers AI
  answer followed by a structural citation event covering every prompted chunk.
- **The chat endpoint fails closed.** Exact-origin CORS, bounded request validation,
  model and dimension compatibility checks, and a D1-backed exact rolling limit of
  20 requests per hashed address per 3,600 seconds protect the endpoint without
  storing or logging raw IP addresses.
- **Chat deployment configuration and tests.** `place.config.ts` gains absent-safe
  `workers.chat` and `workers.chatDatabaseId` keys; the generated wrangler config
  supplies instance identity while the committed template declares `AI` and `DB`
  bindings. The `node:test` contract suite runs through `npm run test:workers` in CI.
- **Runbook:** `docs/runbook/DEPLOY.md` now covers the required embedding-first
  sequence, chat D1 migration, secret, deployment, model verification, shared
  Workers AI free allocation, and hosted-model escalation path.

- **`/chat`, the reader-facing chat page.** Vanilla JS over `fetch` and the streams API:
  no client framework, no off-origin script. Answer text renders frame by frame as it
  arrives, and the articles behind an answer render as linked cards built from the
  worker's structural citation payload — never from URLs parsed out of answer prose, so a
  model that invents a plausible-looking link mid-sentence cannot get it rendered.
  Several retrieved chunks of one article collapse into one card. Conversation lives in
  `sessionStorage`, is capped to the last four messages — two prior exchanges — on the
  way to the worker, and clears when the tab closes. Only messages the worker accepts are
  stored or sent: a turn that produced no answer text is not remembered, so a stream that
  carries reasoning but never an answer cannot leave the tab sending an entry the worker
  refuses; that turn also says so inline, since a blank body under a row of source cards
  otherwise reads as an answer the model declined to give. A 429, a 503, or a stream that
  dies mid-answer renders inline and keeps whatever text already arrived.
- **The chat surface has one gate, in `src/lib/chat.ts`.** It needs BOTH `features.chat`
  and a non-empty `workers.chat`. The page always builds; with either half missing it
  renders a static "chat is not enabled here" state carrying no endpoint and no script,
  and the Header and Footer entry points read the same predicate, so the nav never links
  to a disabled page.
- **A relevance floor makes refusal reachable (`RELEVANCE_FLOOR`, default `0.46`).**
  Retrieval now applies a cosine cutoff before top-k. Top-k alone always returns five
  chunks, so a question the corpus cannot answer still cited the five least-bad matches —
  a fabricated source list wearing real URLs. Below the floor a chunk is not retrieved,
  never enters the prompt, and never becomes a citation; when nothing clears it the model
  is told no excerpt is relevant and the page renders "no sources found". It is a
  deploy-time var rather than a constant because the separating value is a property of
  the corpus, and the runbook carries the procedure for re-measuring it.
- **`knowledge/chat/_eval.md` and `npm run chat:eval`.** An optional evaluation set —
  gray-matter frontmatter, leading `_` so the `knowledge/` scanners skip it — pairing each
  question with the articles its answer should rest on. The runner posts every question to
  a deployed worker and exits nonzero when a cited URL resolves to no published article,
  when a question declaring `expect: no-citations` cites anything, or when a request
  errors, then writes `reports/chat-eval.md` with every question, answer, and citation
  set. An absent manifest exits 0, so an instance that never writes one is not broken.
  Answer quality is deliberately not machine-judged; the report exists for the human
  review that judges it.
- **Two refusal kinds, because one of them cannot be machine-checked.** A question about
  a place the corpus never mentions falls below the floor and must cite nothing
  (`expect: no-citations`, enforced by the runner). A question about a subject this place
  plausibly has but no article covers scores at or above genuinely answerable questions,
  so no floor separates it; its refusal appears in the answer and is human-judged
  (`expect: refusal-in-answer`). The runbook documents the measurement behind that split.
- **`npm run test:chat`** covers the four gate combinations, the evaluation set's reader
  and every runner failure class including the absent-manifest zero exit, and the page
  client driven in Chromium against a real streaming server: progressive rendering,
  citation cards, the empty-payload state, the four-turn cap, session storage, and the
  429/503/mid-stream failures. It runs in CI.
- **The documented Node floor is machine-derived.** `npm run version:check` now derives
  the floor from `package.json` `engines.node` and fails when any registered statement of
  it disagrees — the README, the runbook prerequisites table, the wizard-emitted instance
  README, and the adopt skill. A reworded or deleted statement fails too, rather than
  passing silently, since an unfindable statement is how a stale one hides. Raising the
  floor is a one-line `engines` edit plus whatever prose the gate then names.

### Changed

- **The supported Node floor is now 22.13.** The chat worker's D1 statements are
  executed against a real SQLite database built from the shipped migration, using the
  core `node:sqlite` module, which stopped requiring `--experimental-sqlite` in Node
  22.13.0. The previous floor, 22.12, differs by one patch release inside the same LTS
  line.

> **Upgrade note:** Node ≥ 22.13 is required (previously ≥ 22.12). Instances on 22.12
> exactly must take a patch upgrade within the same LTS line; every later 22.x, 24.x,
> and 26.x runtime already satisfies it. Nothing in `place.config.ts` changes.

> **Upgrade note:** `features.og` and `workers.og` are config-schema additions.
> Both are absent-safe: missing keys leave OG on the static `og-default.png`
> fallback, so no config edit is required on upgrade. To enable per-article OG
> cards, deploy `workers/og/` per the runbook, then set both keys.

> **Upgrade note:** the chat worker's retrieval behavior changes. `RELEVANCE_FLOOR`
> (default `0.46`) is a new `[vars]` entry, absent-safe in both directions: the worker
> carries the same default in code, so an unset var needs no config edit. But a
> redeployed chat worker will now refuse questions it previously answered with five
> weakly-matched citations, which is the intent. `place.config.ts` is unchanged. If your
> corpus differs materially from the template's, re-measure the floor before redeploying
> — `docs/runbook/DEPLOY.md` §Tuning the relevance floor has the procedure — and
> regenerate the worker config so the var is present to tune.

> **Upgrade note:** `workers.chat` and `workers.chatDatabaseId` are absent-safe
> config-schema additions. Existing instances build with chat disabled and require
> no edit. To enable chat, rebuild the embedding artifact, create and migrate the
> chat D1 database, deploy `workers/chat/`, and set both values as documented in
> `docs/runbook/DEPLOY.md`.

## [1.1.1] — 2026-08-04

This patch corrects the v1.1.0 upgrade note, which described a maintainer-doc relocation merge that does not occur, and rebuilds the fixture that let the false claim ship.

### Fixed

- **Corrected the v1.1.0 upgrade note, which described a merge that does not happen.**
  v1.1.0 told instances that relocating their own maintainer documents to `dev_docs/`
  before merging the tag would make the old paths "a clean two-sided delete" and the new
  tree "an add/add that the `ours` driver resolves". Both halves are wrong.

  Against a merge base carrying the *framework's* document at the old path, the framework's
  move is a high-similarity **rename** while the instance's move is a **delete plus an
  unrelated add** — the two documents share almost no text, which is ADR 008's whole
  premise. Rename on one side and delete on the other is a **rename/delete conflict**, and
  git applies **no merge driver** to those, so `merge=ours` is never consulted. The real
  upgrade produces one conflict per owned maintainer-doc path plus `.gitattributes`.

  This mattered beyond accuracy: an instance told to expect a clean merge, then facing a
  dozen conflicts, may resolve with `--theirs` and silently replace its own PRD, SPEC, and
  ROADMAP with the framework's — the exact loss ADR 008(f) exists to prevent.

  ADR 009(g) is rewritten to describe the real shape and to state the resolution: **take
  `ours` for every conflicted path under `dev_docs/`**, and `git rm` the paths conflicted
  only because the framework carried a record the instance never had.

- **`check-upgrade-state.sh` case 9 now asserts that the relocation conflicts.** The
  fixture wrote one-line documents whose similarity profile made git pair *both* sides as
  renames, yielding a tidy add/add that the driver resolved. The case passed while
  modelling a merge that cannot occur, which is how the false claim above reached a
  release. Fixture documents now carry long, side-specific bodies so the rename-detection
  asymmetry is real, and the case fails if the relocation ever merges cleanly — because
  that would make the upgrade documentation wrong again.

### Upgrade note

Supersedes the v1.1.0 note. The relocation steps are unchanged — `git mv` to `dev_docs/`,
declare `dev_docs/** merge=ours`, commit, *then* merge the tag — but **expect conflicts**,
and expect two distinct classes of framework file to deal with.

**1. Conflicted paths** — one per maintainer doc you own, plus `.gitattributes` and the
package manifests. Take yours:

```
git checkout --ours -- <each conflicted path you own under dev_docs/>
```

For a conflicted path you never owned (a framework record that lived at the old path),
`git rm` it. **Never `--theirs` on a path you own** — that is how an instance loses its own
PRD, SPEC, and ROADMAP to the framework's.

**2. Silent additions** — a framework file whose path is *new* (this release's ADR 009 and
the four `dev_docs/research/` files) does not conflict at all. It arrives as a one-sided
add and will not appear in the conflict list. `/sekai-upgrade`'s reconcile pass reports
every one; delete the ones you do not want as part of the adoption commit.

Verified end to end against a real instance holding its own documents at all four legacy
paths: 9 conflicts under `dev_docs/` plus 3 outside it, and 5 silent additions.

## [1.1.0] — 2026-08-04

This release relocates the framework maintainer documents to dev_docs/, adds the ported platform research and the constraints promoted from it, and makes every phase exit gate state its instance-adoption step.

This release moves the framework's own maintainer documents out of `docs/` into a
dedicated `dev_docs/` tree, ports the phase-7-through-11 platform research in beside them,
promotes the hard platform constraints into the SPEC, and makes each phase's exit gate
state its adoption step explicitly.

### Changed

- **Framework maintainer docs moved to `dev_docs/` (ADR 009).** `docs/PRD.md`,
  `docs/SPEC.md`, `docs/ROADMAP.md`, `docs/adr/`, and `docs/diagrams/` are now
  `dev_docs/PRD.md`, `dev_docs/SPEC.md`, `dev_docs/ROADMAP.md`, `dev_docs/adr/`, and
  `dev_docs/diagrams/`. `docs/` now holds only `playbook/` and `runbook/` — the two
  adopter-facing trees — so `docs/` is adopter-facing by definition and `dev_docs/` is
  maintainer-only by definition.

  The strip declaration in `scripts/init/writer.mjs` collapses from four enumerated paths
  to the single directory `dev_docs`, which is the point: a maintainer document added
  later lands on the correct side of adoption without editing any list. The previous shape
  had already failed once silently — `docs/diagrams/` was never on the list, so every
  adopted instance received `.drawio` sources for the framework's own architecture.

- **`docs/diagrams/` is no longer shipped to adopters.** The three `.drawio` files document
  the framework's repo topology, build pipeline, and instance/framework split. They are
  maintainer state and are now stripped at adoption with the rest of `dev_docs/`. Existing
  instances keep whatever they already have; nothing is deleted from an instance by this
  release.

- **`merge=ours` collapses to `dev_docs/** merge=ours`.** One attribute line replaces the
  four maintainer-doc lines plus the separate `docs/baselines/**` line. It protects an
  instance's own planning documents, decision records, and captured baselines — including
  ones added after the line was written.

### Added

- **`dev_docs/research/`** — the platform research behind phases 7 through 11, ported
  de-placed at full fidelity from the pre-cut instance's archives: `platform-notes.md`
  (Workers, RAG, OG, delivery, and the autonomous-layer audit), `upstream-reference.md`
  (the prebuild pipeline, graph force parameters, routine cadence and lifecycle,
  article-health dimensions), `origin-decisions.md` (the reasoning behind the framework's
  shape), and `OMISSIONS.md`, which records every dropped passage against the non-goal that
  excludes it.

- **Hard platform constraints promoted into `dev_docs/SPEC.md`.** §Stack now records that
  Workers AI's `bge-m3` runner returns only the dense vector and Vectorize indexes neither
  sparse nor multi-vector representations — so native hybrid search is unavailable on this
  platform at any scale — that Workers are TypeScript and never Python, and that the chat
  generation model is chosen at packet time rather than pinned from archived research.
  §Negative requirements now requires corpus vectors and the search index to be parsed once
  into worker global scope, because parsing per request consumes most of the free plan's
  CPU budget.

- **`npm run roadmap-gates`** (`scripts/ci/check-roadmap-exit-gates.mjs`) — asserts that
  every ROADMAP milestone row's exit gate states the release tag, the instance adoption,
  and the maintainer confirm, and that every packet it cites is defined by a real task
  block. Template mode only; an adopted instance skips it. Ships with
  `npm run roadmap-gates:selftest`, which requires the guard to reject seven planted defect
  classes.

- **Every phase 6-11 now has a terminal adoption packet.** 6.4 and 9.3 already existed;
  7.4, 8.3, 10.3, and 11.9 are new. Adoption into instance #1 was always part of the exit
  gate in prose, but four of six rows never said so and four phases tracked no adoption
  work at all.

### Fixed

- **The wizard's own emitted text is now scanned for dangling paths.**
  `check-framework-docs.mjs` exempts `scripts/init/writer.mjs` from its dangling-reference
  scan, because a strip mechanism must name what it strips — which meant the `AGENTS.md`
  and `README.md` bodies the wizard *emits* were never checked. `scripts/init/check-init.sh`
  now asserts that the really-stripped tree contains no occurrence of any stripped path,
  with a planted inverse proving the assertion can fail.

- **`check-upgrade-state.sh` case 9 now models a relocated declaration.** Its previous form
  constructed mixed ownership by owning one declared path and not another, which a
  single-directory declaration cannot express. It now models the upgrade this release
  performs: the pre-merge wizard declares the old paths, the merged tree declares the new
  one, and the union is the mixed set. `first_doc_file` derives a concrete file from a
  directory entry rather than requiring a `*.md` entry.

### Upgrade note

**An instance that keeps its own documents at the old maintainer-doc paths must relocate
them before merging this tag, in the same branch.**

```
git mv docs/PRD.md docs/SPEC.md docs/ROADMAP.md docs/adr docs/diagrams docs/baselines dev_docs/
```

Then replace the `docs/PRD.md`, `docs/SPEC.md`, `docs/ROADMAP.md`, `docs/adr/**`, and
`docs/baselines/**` lines in `.gitattributes` with a single `dev_docs/** merge=ours`, commit
that, and only then run `/sekai-upgrade`.

**The order matters.** Relocating first makes the old paths a clean two-sided delete and the
new tree an add/add that the `ours` driver resolves in your favour; the reconcile pass then
recognises your relocated tree as owned because it existed at the pre-merge revision.
Merging first and relocating afterwards produces modify/delete conflicts that `merge=ours`
does not resolve, because git applies no merge driver to them.

An instance adopted by the wizard has none of these paths and needs no action: its
maintainer-doc state is absent before and after.

Note that the merge adds the framework's own `dev_docs/` files alongside yours wherever the
filenames differ (the framework's ADRs, its research port). `/sekai-upgrade` reports every
such addition; delete the ones you do not want as part of the adoption PR.

## [1.0.20] — 2026-08-03

This patch strips recording capture metadata during soundscape ingest and rejects metadata-bearing or mislabeled sound files at validation.

### Fixed

- **Soundscape ingest no longer publishes the recording's capture metadata.**
  Consumer phones write capture coordinates (to roughly ten metres), capture
  timestamp, device make and model, and OS version into the audio container.
  `ffmpeg` copies input metadata to its output by default and Astro copies
  `public/` into `dist/` byte-for-byte, so every clip added with
  `npm run sounds:add` was publishing all of it, and an adopter recording near
  home was publishing their home coordinates. `npm run sounds:add` now writes
  every published file through ffmpeg with metadata, chapter, and ID3 writing
  disabled. mp3 input is re-muxed (`-c:a copy`, so the audio frames are unchanged
  and nothing is re-encoded) rather than copied byte-for-byte, which makes ffmpeg
  an **unconditional prerequisite** of the script rather than one only non-mp3
  input needed. There is no opt-out flag: the manifest's `location` field is the
  place description readers see, and shipping exact coordinates underneath it
  contradicts that field's purpose.
- **`npm run sounds:check` rejects a published file that carries a metadata tag.**
  Hand-placing a file into `public/media/sounds/` and hand-writing its manifest
  entry is a supported path that bypasses the script, so fixing only the writer
  would have left the class open. The gate now scans every file under
  `public/media/sounds/` at any depth, whatever it is named — Astro publishes a
  file because of where it sits, not what its extension says — and fails on an
  ID3v2 tag, an ID3v1 trailer, an APE footer, or one of six recognized non-mp3
  container signatures (RIFF/WAVE, ISO base media, Ogg, FLAC, AIFF,
  Matroska/WebM), which is how a recording renamed rather than converted is
  caught. Recognition is a positive signature match, not a test for MPEG audio, so
  a container outside that list is not detected as one; the alternative would
  break an adopter's build over a valid but unusual mp3. Each finding names the
  file and the tag form, and adds the offending frame identifiers when the tag
  exposes a readable frame area — an ID3v1 trailer, an APE footer, and an ID3v2
  tag behind an extended header carry no frame list to name, and are findings all
  the same. The rule is absolute rather than a denylist of sensitive fields,
  because the page reads every displayed field from the manifest and never from
  the audio file. The scan reads the container in JavaScript
  (`scripts/lib/mp3-tags.mjs`, shared with the writer so the two cannot drift) and
  needs no ffmpeg, so it runs unchanged in every adopter's `postbuild` chain and
  in this repository's CI build job, neither of which has one. (CI's test job does
  install ffmpeg, but only so the writer's suite can exercise the real
  conversion.) Self-test coverage at `npm run sounds:selftest` grew from five
  planted defect classes to ten: one per tag container, one for a renamed
  container, and one proving the walk does not filter on a file's name.
- The three synthesized demo clips under `public/media/sounds/` were re-muxed to
  drop the encoder tag ffmpeg had written into them. Their audio is unchanged.

**Upgrade note.** The fix is not retroactive: recordings ingested before this
release keep whatever their capture device wrote, and `npm run sounds:check` will
now fail on them. For each affected file, either re-run `npm run sounds:add` on
the original recording, or strip the committed file in place with

```
ffmpeg -i <file>.mp3 -map_metadata -1 -map_chapters -1 -id3v2_version 0 -c:a copy <stripped>.mp3
```

and commit the result. Run `npm run sounds:check` to list the affected files.
Instances with no soundscape recordings need no action. ffmpeg is now required
for `npm run sounds:add` with any input format, including mp3; it is not required
to build or to run the gate.

## [1.0.19] — 2026-08-03

Soundscape ingest tooling: npm run sounds:add converts and places audio, npm run sounds:check validates manifest entries, and docs/playbook/SOUNDSCAPE-PLAYBOOK.md documents the workflow.

### Added

- **Soundscape ingest script** (`npm run sounds:add`): converts and places audio into `public/media/sounds/`, appends a schema-valid YAML entry to the manifest. Strictly additive; preserves surrounding bytes. Requires ffmpeg on PATH for non-mp3 input.
- **Soundscape validation gate** (`npm run sounds:check`): imports field arrays from `src/lib/sounds.ts`, exits nonzero on missing required fields, unresolved files, path escapes, or duplicate category ids. Wired into postbuild and CI. Self-test at `npm run sounds:selftest`.
- **Soundscape playbook** (`docs/playbook/SOUNDSCAPE-PLAYBOOK.md`): documents the record, convert, add, verify, commit workflow and the hand-editing path.

No upgrade note required (no config-schema change, no instance action required).

## [1.0.18] — 2026-08-02

Generate deploy-time Worker configs from place.config.ts, add CI guards for placeholder-only committed templates, and document the Worker and D1 rename path.

### Fixed

- **Worker deploy configs are generated from `place.config.ts`, not committed.**
  `workers/feedback/wrangler.toml` carried three values that are deployment
  identity — the Worker script `name`, the D1 `database_name`, and
  `ALLOWED_ORIGIN` — inside a tree both machine gates scan for exactly that.
  Worker and D1 names are **account-scoped**, so every instance was deploying
  under the framework's `sekai-feedback`: a second instance in the same Cloudflare
  account overwrites the first's script and rebinds it to the second's database,
  and the public `workers.dev` URL carried the framework's name rather than the
  place's. The runbook told adopters to commit their real origin into that file,
  which the denylist gate then failed as soon as the origin contained their place
  name.

  The committed `wrangler.toml` is now a template carrying placeholders only, and
  `npm run worker-config` (`scripts/deploy/gen-worker-config.mjs`) writes the
  effective `workers/<worker>/wrangler.generated.toml` from `place.config.ts`.
  Names derive as `<place-slug>-<worker-directory-name>`, where `<place-slug>` is
  `place.name` lowercased with every run of non-`[a-z0-9]` characters collapsed to
  `-` and truncated to 40 characters; `ALLOWED_ORIGIN` comes from `place.domain`;
  `database_id` comes from the new optional `place.config.ts` key
  `workers.feedbackDatabaseId`. `main`, `compatibility_date`, the D1 `binding`,
  `migrations_dir`, and the rate-limit vars carry through from the template
  unchanged. The generated file is gitignored, and both machine gates skip it by
  name because it is derived and place-specific by design.

  A new gate, `npm run worker-config:check`
  (`scripts/ci/check-worker-config.mjs`), asserts every committed
  `workers/*/wrangler.toml` still carries the framework placeholders and that no
  generated config is tracked by git. It catches what the place-name denylist
  cannot: a committed origin or worker name whose text contains no denylisted term
  at all. It runs in the `genericity` CI job alongside its non-vacuity self-test
  (`npm run worker-config:selftest`), and it fails in an adopter's checkout too,
  which is the point.

  `docs/runbook/DEPLOY.md` §Cloudflare Workers is rewritten around `--config`
  (a global Wrangler flag accepted by `deploy`, `d1 create`, and
  `d1 migrations apply`), states the derivation rule and that `npm run init` does
  nothing for `workers/`, and no longer claims an instance owns
  `workers/feedback/wrangler.toml` — no path under `workers/` carries
  `merge=ours`, and after this change the file is genuinely framework-owned and
  unedited. The `/sekai-triage-feedback` skill now resolves its database through
  the generated config.

  **Upgrade note.** New `place.config.ts` key `workers.feedbackDatabaseId`
  (optional, absent-safe: unset generates an empty `database_id` and a note).
  An instance that already deployed the feedback worker under the framework's
  `sekai-feedback` names is renaming, so re-deploy under the derived names:

  1. `npm run worker-config` and read the derived `<worker-name>` from its output.
  2. `npx wrangler d1 create <worker-name>`, then put the id it prints in
     `place.config.ts` as `workers.feedbackDatabaseId` and regenerate.
  3. `npx wrangler d1 migrations apply <worker-name> --remote --config workers/feedback/wrangler.generated.toml`.
  4. `npx wrangler secret put IP_HASH_SALT --config workers/feedback/wrangler.generated.toml`
     (secrets are per-Worker; the new script has none).
  5. `npx wrangler deploy --config workers/feedback/wrangler.generated.toml`, then
     set `workers.feedback` in `place.config.ts` to the new URL and rebuild the
     site.
  6. Delete the old Worker and database once the new endpoint answers:
     `npx wrangler delete --name sekai-feedback` and
     `npx wrangler d1 delete sekai-feedback`. Existing rows do not migrate; export
     anything you still need from the old database first
     (`npx wrangler d1 execute sekai-feedback --remote --command "SELECT * FROM feedback" --json`).

  An instance that has **not** deployed the worker needs no action beyond the
  merge: the template's placeholders are the state it already has.

## [1.0.17] — 2026-08-02

Adds the /soundscape page, the /sekai-snippet and /sekai-triage-feedback skills, and a feedback widget over a new workers/feedback Worker; extends the denylist gate to workers/; and repairs the dark theme plus two tooling defects.

### Fixed

- **Route-wide dark theme repair.** Fixed white surfaces and dark-on-dark text
  on `/`, `/latest`, `/dashboard`, `/about`, `/contribute`, and `/changelog` in
  dark mode. All affected surfaces now resolve through `tokens.css` design tokens
  (`--color-surface-raised`, `--color-bg-alt`, `--color-ink-heading`,
  `--color-border-visible`) rather than hardcoded hex values. Shared components
  (`ArticleCard`, `FeatureCards`, `CategoryGrid`, `ReaderDoors`, `CoverStory`,
  `RecentUpdates`, `ContributeSection`) use token-bound colors so the fix stays
  shared across pages.

  A new browser-backed regression guard (`npm run test:theme`) asserts computed
  background and text colors on every named surface in dark mode. It runs in the
  CI build job after `npm run build` and fails on light-only backgrounds or
  dark-on-dark text. No adopter action required: token additions are additive and
  the new test runs only in the framework CI workflow.

### Added

- **`/soundscape` layout: manifest categories, a card grid, per-category
  wishlists, and a contribute block.** The page was a single-column stack of
  cards; it now reads as a collection. The hero carries a stats line (recordings,
  wanted, categories), each category is an anchored `<section id>` with an icon
  and a heading, its recordings render in a responsive `auto-fill` grid with a
  ~280px minimum, and each category can declare the sounds it still wants and a
  link to one article. A contribute block with numbered steps and a call to
  action for `/contribute` closes the page. No `<script>` was added: the page
  still ships zero client JavaScript of its own, and `<audio controls
  preload="none">` is still the whole player.

  The manifest schema is **additive**. `knowledge/sounds/_manifest.md` now accepts
  an ordered `categories` list — each category requiring `id`, `icon`, `title`,
  accepting optional `article`, and carrying its own `sounds` list plus an
  optional `wishlist` whose entries carry `icon`, `text`. A recording still
  requires `title`, `location`, `credit`, `file`, and now accepts optional
  `description`, `icon`, `contributor`, `contributorUrl`, `date` alongside them.
  `src/lib/sounds.ts` normalizes both shapes into one structure and applies the
  same skip-one-keep-the-rest discipline to a malformed category and a malformed
  wishlist entry that it already applied to a malformed recording.

  A category's `article` is validated at build time against the routes the build
  actually produces (static pages, category hubs, and article routes). One that
  resolves to nothing is dropped with a warning naming the category, so the page
  cannot ship a link into a 404 — and the post-build internal-link check cannot
  fail the whole build over one manifest typo.

  `scripts/ci/check-soundscape-schema-docs.mjs` (`npm run schema-docs`, run in CI)
  derives all five field lists from `src/lib/sounds.ts` and fails when
  `docs/SPEC.md` or the manifest's own body disagrees with the reader, so the
  documented schema cannot drift from the code that implements it.

  Every colour the page renders now resolves through the theme tokens in
  `src/styles/tokens.css`. This fixes a live defect: in dark mode the previous
  page painted white cards on a near-black body (`card=rgb(255,255,255)` on
  `body=rgb(5,5,5)`) with a barely legible hero. It now measures
  `card=rgb(20,20,24)`, `card title=rgb(241,245,249)`, `hero=rgb(241,245,249)`.

  **Upgrade note:** the schema is additive and no instance action is required. An
  existing manifest that declares a top-level `sounds` list keeps rendering
  untouched — it normalizes to one implicit category that renders no heading, so
  the page looks as it did apart from the theme fix and the contribute block. To
  adopt categories, edit `knowledge/sounds/_manifest.md` alone: replace the
  top-level `sounds:` list with a `categories:` list whose entries carry `id`,
  `icon`, `title` and their own `sounds:` list, and add a `wishlist:` (entries of
  `icon`, `text`) or an `article:` route per category where you want them. A
  top-level `sounds` list is ignored, with a build-time warning, if `categories`
  is also declared — move those entries into a category rather than keeping both.

- **`/soundscape`: a native HTML5 audio page over a `knowledge/sounds/`
  manifest.** `src/pages/soundscape.astro` +
  `src/templates/soundscape.template.astro` render one
  `<audio controls preload="none">` per manifest entry. No player library and no
  client framework ship with it: the browser's own transport is the player, and
  nothing crosses the wire until a reader presses play.

  The manifest is `knowledge/sounds/_manifest.md` — gray-matter frontmatter
  carrying a `sounds` list of `{title, location, credit, file}` plus an optional
  `date`, with the body free for human notes. The leading `_` is mandatory: it is
  what makes the file invisible to the three scanners that walk `knowledge/`
  looking for articles (`scripts/core/test-frontmatter.mjs`,
  `scripts/tools/article-health.py`, `scripts/core/build-content-dates.mjs`).
  `src/lib/sounds.ts` reads it with `readFileSync` + `try/catch` and normalizes
  any `date` to an ISO-8601 string at the boundary.

  Every degradation keeps the build green. No `knowledge/sounds/` at all and an
  empty list both render the documented empty state; an entry whose `file` is
  missing under `public/` is dropped with a build-time warning naming it while
  every other entry still renders. `npm run test:soundscape` gates all of that in
  CI. `features.soundscape` gates only the Header and Footer entry points — the
  page itself always builds, exactly as `/map`, `/graph`, and `/dashboard` do.

  The template ships three short synthesized demo clips under
  `public/media/sounds/`, each credited as synthesized rather than as a field
  recording of anywhere, so the player and the page's visual bar are provable in
  the repository that ships them. `npm run init` removes them, and
  `npm run init:check` asserts the removal against a tree the wizard really
  stripped.

  **Upgrade note:** this release adds files under two instance-owned paths,
  `knowledge/sounds/_manifest.md` and `public/media/sounds/*.mp3`. `merge=ours`
  protects an instance's *content on a path that exists on both sides*; it does
  not stop a clean add, so merging this tag lands the framework's demo manifest
  and demo clips in your tree. They are the demo place's content, not yours —
  delete both after the merge:

  ```sh
  rm -rf knowledge/sounds public/media/sounds
  ```

  Nothing else is required: `features.soundscape` stays absent-safe and defaults
  to `false`, and with no manifest the page renders its empty state. To turn the
  page on, set `features.soundscape: true` in `place.config.ts`, write your own
  `knowledge/sounds/_manifest.md`, and put your audio under `public/media/sounds/`.

  `docs/SPEC.md` §Pages now enumerates the route list under a derivation gated by
  `scripts/ci/check-framework-docs.mjs`: adding a page under `src/pages/` without
  amending that sentence now fails CI, which is the drift this entry would
  otherwise have introduced.

- **`/sekai-snippet`: short-form drafts, a human-gated queue, and a manual-sink
  runner.** The framework-owned skill reads exactly one `knowledge/` article,
  writes a platform-neutral draft carrying no claim that article does not make,
  and appends it to `knowledge/SNIPPET-INBOX.md` as `status: pending`. Approval is
  a human edit of that file to `approved` and nothing else — the runner reads
  `approved` entries only, so a draft nobody has read is unreachable from the
  publish path. `npm run snippet:publish` then publishes through an adapter and
  writes back `posted` plus the returned URL; `pending`, `posted`, and `rejected`
  entries are left untouched.

  The platform-adapter interface is one file,
  `scripts/tools/snippet/adapter.d.ts`: `{ id, maxChars, publish(draft) }`, with
  no registry, no loader, and no credential handling. **No platform adapter
  ships**, by rule — the first one arrives when a real instance has an account on
  that platform. The only shipped sink is a manual one that prints the approved
  text for the operator to paste and records the URL they paste back, which is
  what makes `posted` reachable in the meantime. An entry over the adapter's
  `maxChars` is refused with a message naming the entry and the overage, never
  truncated, and stays `approved` for a shortened rerun. Because the manual sink
  waits on a human, the runner re-reads the queue when it finishes and re-applies
  only the `status` and `url` lines it published, so an entry appended or edited
  mid-run is never overwritten; a change to an entry it published is reported with
  the live URL and written back by hand rather than merged. The format contract is
  gated by `npm run test:snippet` in CI; `scripts/tools/snippet/README.md`
  documents the interface.

  No **Upgrade note**: the skill, the runner, and the npm scripts are additive,
  and no `place.config.ts` key changed. A freshly adopted instance has no queue
  file at all — `npm run init` reseeds `knowledge/` with category folders and
  `INBOX.md` only — so the skill creates `SNIPPET-INBOX.md` on first use by
  copying `scripts/tools/snippet/queue-template.md`, which survives adoption
  because it lives under `scripts/`.

- **`/sekai-triage-feedback` turns new D1 feedback into deduplicated GitHub
  issues.** The framework-owned skill reads `status='new'` rows through Wrangler,
  assigns exactly one of five documented classes, groups normalized duplicates,
  and either creates a `feedback`-labeled issue or comments on the matching open
  issue from `place.config.ts` `links.repo`. It records the resulting issue URL
  through `workers/feedback/migrations/0002_triage.sql`; spam is recorded without
  filing an issue. Dry-run and live execution share the same complete plan, and
  no GitHub or D1 write runs until the human explicitly approves that plan.

  **Upgrade note:** instances that already deployed the feedback Worker must apply
  the new D1 migration before running the skill:

  ```bash
  cd workers/feedback
  npx wrangler d1 migrations apply <database-name> --remote
  ```

- **Feedback widget on article pages (`src/components/FeedbackWidget.astro`).** An
  article-bottom button opens the form in an accessible modal, keeping the full form
  hidden until a reader asks for it. The message field displays and enforces the
  Worker's 10-to-4,000-character requirement before submission.
  Vanilla JS, no client framework: it posts `{page, category, message, contact}`
  plus a hidden honeypot to the `workers/feedback/` endpoint and renders one of
  four end states — success, a validation error naming the field the endpoint
  rejected, rate-limited, and a catch-all for an unreachable endpoint, a rejected
  origin, or a server fault. The trap field is off-screen, `aria-hidden`, and out
  of the tab order; a `<noscript>` block falls back to `links.email`. Every string
  lives in `src/i18n/ui.ts`. The widget renders only when `features.feedback` is
  true **and** `workers.feedback` is a non-empty string, so a flag switched on
  before the worker is deployed produces no markup rather than a form that posts
  nowhere. Operator steps: [DEPLOY.md §Cloudflare
  Workers](docs/runbook/DEPLOY.md).
- **`place.config.ts` gains `workers?: {feedback?: string}`,** the deployed
  endpoint URL. It is place identity (it names this instance's deployment), so
  under iron rule 2 it may live only in config; the init wizard prompts for it with
  a blank default, since the worker is deployed after adoption. The `place.config`
  top-level section list and the `features` flag list are now derived from
  `place.config.ts` and gated by `scripts/ci/check-framework-docs.mjs`, so the next
  key that is added without updating the SPEC enumeration fails CI.

  **Upgrade note:** one new optional config key. Nothing to do — a config without
  a `workers` block keeps the feedback widget off, exactly as before. To turn it
  on, deploy the worker and follow step 5 of DEPLOY.md §Cloudflare Workers.
- **`workers/` — the framework's first Cloudflare Worker tree, starting with
  `workers/feedback/`.** A POST endpoint backed by D1 that stores reader feedback:
  CORS locked to a single deploy-time `ALLOWED_ORIGIN` (never `*`; an unset var or a
  mismatch is 403), a honeypot field that returns a real-looking success and writes
  nothing, a per-address rate limit of `RATE_LIMIT_MAX` per genuinely rolling
  `RATE_LIMIT_WINDOW_SECONDS` (submissions are counted per second and the seconds
  age out individually, so no counter reset lets a second allowance through at a
  window boundary, and a refused attempt gives its slot back so a client that waits
  out `Retry-After` is let in rather than locked out for good), and full payload
  validation enforced against the request
  stream so an oversized chunked upload is a 400 rather than a buffered Worker
  crash. Addresses are only ever stored as `sha256(address + IP_HASH_SALT)`;
  a missing salt fails the request closed rather than hashing unsalted. The schema
  ships as a D1 migration (`feedback` + `submission_window`), `wrangler.toml` carries
  placeholders only, and the `node:test` unit suite runs in CI as `npm run
  test:workers`. Operator steps are in
  [DEPLOY.md §Cloudflare Workers](docs/runbook/DEPLOY.md). CI never deploys a worker;
  `npx wrangler` is the documented path, so no platform-specific binary enters the
  lockfile.

### Changed

- **The place-name denylist gate now scans `workers/` in instance mode.** Its
  instance-mode roots become `src/`, `scripts/`, `tests/`, `workers/`,
  `.agents/skills/` — the same five the English-only gate already scanned. Before
  this, a denylisted place string under `workers/` was unguarded on an adopted
  instance. The two gates still derive and state their root sets independently, so
  either can gain a root without the other. `scripts/ci/check-skills-gated.sh` now
  plants its place-string and CJK fixtures under `workers/feedback/` as well as
  `.agents/skills/sekai-kb/`, proving in instance mode that each root is actually
  reached by the scan rather than merely listed in `SCAN_ROOTS`.

### Fixed

- **`article-health` no longer treats a root-level `knowledge/*.md` workflow queue
  as an article.** `is_article_path` documented its contract as
  `knowledge/{Category}/*.md` but accepted any `.md` anywhere under `knowledge/`,
  so a staged `knowledge/INBOX.md` — and now `knowledge/SNIPPET-INBOX.md` — was
  linted as an article, reported a hard violation for having no frontmatter, and
  the pre-commit hook refused the edit. Eligibility is now structural (the file
  must sit in a category directory), covering any future root-level workflow doc,
  and `--staged` routes through the same predicate instead of duplicating it.
  `--all` was already correct, which is why this only ever surfaced at commit time.

- **The visual-baseline page list no longer hardcodes place-specific URLs.**
  `scripts/visual/capture-baseline.mjs` sampled `/trails/top-of-the-world/` for its
  `article` page and `/history/` for its category hub — both pre-cut slugs, so
  `npm run visual:check` could not be green in the template (the article does not
  exist in the demo corpus) and would break in any instance whose articles and
  categories differ. Both are now derived: the `article` sample is the
  lexicographically first `href` in `src/data/latest.json` and the hub is the first
  configured category, so the list is correct for every place by construction. The
  sample is deliberately NOT the newest article — `latest.json` is date-ordered, so
  "newest" would change the moment an article ships and a baseline captured before
  it would diff against a different page. Both derived URLs are printed on every
  run and recorded in the baseline manifest. The `hub-history` page key is now `hub`.

  **Upgrade note.** Local visual baselines do not carry over: the captured files are
  named per page key, so an existing `reports/visual/baseline/hub-history-*.png` no
  longer pairs with the `hub-*.png` this writes, and the `article` sample may now be
  a different article than the one your baseline captured. Recapture once after
  upgrading with `npm run visual:baseline`; nothing else changes, and the PNGs are
  gitignored so no commit is involved. An instance passing `--pages=hub-history`
  updates that token to `hub`.

## [1.0.16] — 2026-07-29

This release runs every upgrade helper from the target release tag, so a release that changes a helper applies its own fix on the upgrade that ships it.

### Fixed

- **The upgrade bootstraps every helper from the target tag, never from the instance's
  working tree.** Steps 3, 3b, and 4 of `/sekai-upgrade` and both flows in
  `docs/runbook/UPGRADE.md` used `test -f scripts/upgrade/<helper>.mjs || git show
  "$TARGET":...`, so an in-tree copy always won. That is correct when a helper is merely
  *absent* and wrong whenever a release *changes* one: the tree's copy shipped with the
  release the instance is leaving, so the fix never applied on the upgrade that shipped
  it. v1.0.15 is the concrete case — it added the `FRAMEWORK-VERSION` capture to
  `package-state.mjs`, and an instance on v1.0.11 following the documented procedure
  verbatim ran its own pre-capture copy, captured nothing, restored nothing, and left the
  marker claiming a release no build had verified. The extraction is now unconditional
  for all three helpers; a `$TARGET` that predates a helper fails loudly on `git show`
  instead of silently running an older one. `docs/runbook/UPGRADE.md` gains a **Helper
  version skew** section stating the rule, and `scripts/upgrade/check-upgrade-state.sh`
  gains case 13: 13a derives the bootstrap form from both adopter-facing documents so
  the retired shape cannot return in prose, and 13b drives the skew end to end against a
  framework whose earlier tag ships a helper without `FRAMEWORK-VERSION` handling,
  pinning that the retired tree-first form loses the marker where the documented form
  keeps it.

  **Upgrade note.** No instance action is required and no configuration changed. If you
  have the previous bootstrap lines pasted into your own notes or scripts, replace the
  `test -f` form with the unconditional `git show "$TARGET":scripts/upgrade/<helper>.mjs`
  extraction shown in `docs/runbook/UPGRADE.md`.

## [1.0.15] — 2026-07-29

This release hardens first-upgrade maintainer-doc classification, preserves FRAMEWORK-VERSION through merges, repairs adopter-facing upgrade references, and records cross-repository lifecycle routing.

The maintainer-doc upgrade path works on a first upgrade, `FRAMEWORK-VERSION` survives the merge, and the adopter-facing upgrade documents resolve.

### Fixed

- **`classify` can derive its path set on the first upgrade that introduces it.**
  `scripts/upgrade/maintainer-docs-state.mjs classify` gains `--from-tag <tag>`, which
  takes the `MAINTAINER_DOCS` derivation from the release being merged while still
  reading path **presence** from the pre-merge working tree. Extracting the helper out
  of the tag was never enough on its own: the helper reads `scripts/init/writer.mjs`,
  and on exactly the upgrade that introduces the strip list the instance's copy still
  predates the export, so `classify` exited 3 and the classification the whole pass
  depends on could not be produced at all. `/sekai-upgrade` step 3b and
  `docs/runbook/UPGRADE.md` now pass the flag on every `classify`. `reconcile`
  **rejects** it (exit 2): reconciliation must derive from the merged tree, because that
  is how a merge which did not bring the framework's wizard through is exposed rather
  than papered over by reading the tag instead. Options are declared per command in one
  table the parser and the documentation guard both read.
- **`FRAMEWORK-VERSION` keeps its value through the merge.** It is marked `merge=ours`,
  and that was never sufficient: a merge driver runs only on a three-way content merge,
  so an instance that has not edited the file since the merge base has `ours == base`
  and git fast-forwards the incoming value straight in — the file claimed the new
  release before anything had verified it, contradicting the documented flow.
  `scripts/upgrade/package-state.mjs` now captures the pre-merge value alongside the
  adopter's npm-manifest fields and restores it immediately after the merge, amending
  the merge commit when git auto-committed. An instance that had no `FRAMEWORK-VERSION`
  keeps having none. The explicit post-verification bump is unchanged in placement but
  now **asserts** the resulting value rather than assuming its write took effect.
  That helper's entry-point check also gained the `realpathSync` resolution its sibling
  already had, without which running it from the copy the upgrade extracts into `.git`
  was a silent no-op on any path reached through a symlink.
- **Adopter-facing upgrade references resolve.** `docs/runbook/UPGRADE.md` cited a
  `§G risk 4` section lettering and a `SPEC §place.config.ts absent-safe rule` document
  location that no longer exist; both now name the framework SPEC section that owns
  them (§Risk controls "Two-repo drift", §Negative requirements "New `place.config`
  keys must be absent-safe") and point at the upstream repository an adopter can
  actually reach. The `/sekai-upgrade` skill carried the same stale citation and is
  fixed with it.

### Added

- **The maintainer-doc paths ship as `merge=ours`.** `docs/PRD.md`, `docs/SPEC.md`,
  `docs/ROADMAP.md`, and `docs/adr/**` are now declared instance-owned in the
  framework's `.gitattributes`, and `docs/runbook/UPGRADE.md`'s instance-owned table
  records them with their rationale. They are inert for a wizard-adopted instance,
  which has nothing at those paths; they matter for an instance that keeps its **own**
  product, architecture, delivery, or decision records there, which ADR 008 explicitly
  allows. Shipping the attribute means such an instance is protected from its first
  merge onward instead of having to remember to add it.
- **The adopter-facing instance-owned lists are machine-derived.**
  `scripts/ci/check-framework-docs.mjs` now registers `docs/runbook/UPGRADE.md`'s table
  and the `/sekai-upgrade` skill's step 4 list against `.gitattributes`, alongside the
  SPEC and ADR 006 restatements it already checked. Both survive adoption, so they are
  checked for containment rather than equality in an adopted clone, where an adopter's
  `.gitattributes` legitimately grows paths the framework's documents do not list. A
  registered enumeration is also masked out of the dangling-reference scan, so a
  surviving document can record that `docs/PRD.md` is a path an instance may own
  without that being read as a link into a stripped file. Five new planted defect
  classes and two new legitimate states are in `--selftest`.
- **Regression coverage for both fixes, in CI.**
  `scripts/upgrade/check-upgrade-state.sh` gains case 11 (a first-upgrade fixture whose
  wizard predates `MAINTAINER_DOCS`, where `classify` without the flag must exit 3 and
  `--from-tag` must still produce the classification) and case 12 (`FRAMEWORK-VERSION`
  held at its pre-merge value through the merge and moved only by the explicit bump,
  with sub-case 12b covering the auto-commit/amend shape and 12c the pre-wizard
  instance that had no `FRAMEWORK-VERSION` and must not gain one). Each pins the
  underlying defect with a fixture guard before asserting the fix, and `--selftest`
  non-vacuity extends to all of them. Two option-contract checks close the loop: one
  asserts `reconcile` rejects `--from-tag`, and one checks the options the two upgrade
  documents tell a user to pass, per invoked command, against the helper's own option
  table — scoped to that literal and carrying a non-vacuity probe, since the helper's
  source is full of single-quoted git arguments a whole-file grep would wrongly report
  as accepted CLI options.

**Upgrade note.** Nothing to do. Both fixes are in the upgrade path itself and take
effect on the upgrade that adopts this release: the first-upgrade hard stop and the
premature `FRAMEWORK-VERSION` move are gone. If you keep your own documents at the
maintainer-doc paths, the four new `merge=ours` lines arrive with this release, so you
no longer need to maintain them by hand — an existing hand-added copy is harmless.
Follow `docs/runbook/UPGRADE.md` as written: `classify` now takes
`--from-tag "$TARGET"`, and `FRAMEWORK-VERSION` deliberately still reads your old
version until the final bump step.

## [1.0.14] — 2026-07-29

The framework maintainer-doc gate accepts an instance that keeps its own documents at those paths.

### Fixed

- **The maintainer-doc gate no longer rejects an instance that owns documents at those
  paths.** `scripts/ci/check-framework-docs.mjs` treated every mention of
  `docs/PRD.md`, `docs/SPEC.md`, `docs/ROADMAP.md`, or `docs/adr/` as a dangling
  reference and checked its registered statements against whatever file sat at those
  paths — correct for a wizard-adopted clone, which really has none of them, but wrong
  for an instance that keeps its own planning documents there. That instance was told to
  remove the `merge=ours` lines that protect those very documents. In instance mode the
  gate now treats a maintainer-doc path **present** in the checkout as instance-owned and
  excludes it from both checks, using the same presence signal `reconcile` uses to
  classify a path `owned`. Template mode is unchanged and still exhaustive, and a
  wizard-adopted instance whose paths are genuinely absent still fails on a dangling
  reference — both are now planted cases in `--selftest`, which additionally asserts two
  legitimate instance-owned states pass.

**Upgrade note.** Nothing to do. If you kept your own documents at those paths and saw
`npm run framework-docs` fail after adopting v1.0.12 or v1.0.13, this release fixes it;
no change to your `.gitattributes` is needed, and the four `merge=ours` lines remain
required.

## [1.0.13] — 2026-07-29

/sekai-upgrade classifies and reconciles framework maintainer-doc state per path, and the upgrade-state harness covers both helpers.

### Added

- **`/sekai-upgrade` classifies and reconciles maintainer-doc state.**
  `scripts/upgrade/maintainer-docs-state.mjs` is the sibling of the dev-plugin state
  helper: `classify` records, before the merge, which of the framework's maintainer-doc
  paths this instance carries, and `reconcile` applies that answer immediately after.
  Classification is **per path** — these paths have no activation signal and are mutually
  independent, so an instance may own one and not the others, and a partial set is a
  normal state rather than a stop. A path you do not have stays absent across shared and
  unrelated history; a path you own is asserted byte-for-byte unchanged, never deleted,
  and framework files the merge adds underneath it are reported for you to decide.
  The path set is derived at runtime from the init wizard's own strip list — the same
  single source `npm run framework-docs` derives from, whose parser now lives with the
  upgrade helper so there is one derivation rather than two.
- **Upgrade-state regressions cover both helpers.**
  `scripts/upgrade/check-upgrade-state.sh` gains five maintainer-doc cases (stripped on
  shared history, stripped on an unrelated-history first merge, fully owned, partially
  owned, and owned-but-unprotected in two shapes), each an independent disposable git
  repository, with fixtures derived from the wizard rather than restated.
  `--selftest` non-vacuity extends to the new reconcile-dependent cases: with reconcile
  skipped, each must fail.

### Changed

- **Adopter documentation states the maintainer-doc contract.** The `/sekai-upgrade`
  skill gains the classify and reconcile steps, and `docs/runbook/UPGRADE.md` gains the
  copy-pasteable equivalent plus a per-path state table, in both the first-merge and
  routine flows.

**Upgrade note.** Nothing to do. The manual clean-up that v1.0.12 asked wizard-adopted
instances to perform after every merge is now automatic: the upgrade removes the
framework's maintainer documents itself and never commits them into your instance.

- **If your instance keeps its own documents at any of those paths**, the requirement is
  unchanged and still yours to meet *before* merging: mark them `merge=ours` in
  `.gitattributes`, and confirm `git config merge.ours.driver true` in that clone (it is
  per-clone and not version-controlled). The upgrade now detects the omission and stops
  with both repairs named, rather than letting the framework's copy overwrite your
  document — but it does not perform the repair for you.

## [1.0.12] — 2026-07-28

Moves framework maintainer documents beside the code they govern and strips them from adopter clones.

Moves the framework's own product, architecture, and delivery documents into this
repository and keeps them out of adopter clones.

### Added

- **Framework maintainer docs.** `docs/PRD.md` (what the framework is for, who adopts
  it, north star, non-goals), `docs/SPEC.md` (stack, repo topology, `place.config.ts`,
  content model, build pipeline, pages, new builds, phase 9-11 extension capabilities,
  risk controls, negative requirements), `docs/ROADMAP.md` (the phase 6-11 task blocks
  `/dev:plan` converts packets from), and ADRs 003-007, which govern framework code and
  moved here keeping their numbers and filenames. **ADR 008** records the split: the
  ownership boundary, the wizard strip, the `merge=ours` requirement for an instance that
  already has documents at those paths, and why the tracker stays a single project.
  Phases 0-5, the extraction map, the inherited-fork disposition, and ADRs 001-002 are
  the first instance's rebuild history and stay in its repository.
- **`npm run framework-docs`** — the maintainer-doc gate, wired into the CI genericity
  job with a self-test that plants seven defect classes and requires each to fail. It
  derives the stripped-path list from the wizard, the instance-owned `merge=ours` list
  from `.gitattributes`, and the prebuild/post-build job lists from `package.json`, then
  fails on any prose that disagrees with its source or on any file an adopter keeps that
  links into a stripped path.

### Changed

- **`npm run init` strips the framework maintainer docs.** `docs/PRD.md`,
  `docs/SPEC.md`, `docs/ROADMAP.md`, and `docs/adr/` are removed at adoption, the same
  class as `.agent-toolkit/`: they describe how the framework is built, never how an
  instance is operated. `docs/playbook/` and `docs/runbook/` are untouched.
  `scripts/init/check-init.sh` asserts both halves on a tree the wizard really stripped,
  then re-runs the same predicate against planted inverse fixtures so an all-absent
  assertion cannot pass vacuously.
- Adopter-facing prose that cited a framework decision record by section now points at
  the upstream repository instead (`docs/runbook/UPGRADE.md`, the `/sekai-upgrade` skill,
  `scripts/init/README.md`), so nothing an adopter keeps refers to a document adoption
  removed.

**Upgrade note.** This release adds four paths under `docs/` that some instances already
use for their own documents.

- **If your instance has its own `docs/PRD.md`, `docs/SPEC.md`, `docs/ROADMAP.md`, or
  `docs/adr/`:** add them to your `.gitattributes` as `merge=ours` **before** merging
  this tag, or the merge will conflict with — or overwrite — your documents.

  ```
  docs/PRD.md merge=ours
  docs/SPEC.md merge=ours
  docs/ROADMAP.md merge=ours
  docs/adr/** merge=ours
  ```

  The `ours` driver is per-clone and not version-controlled, so confirm
  `git config merge.ours.driver true` in that clone as well.
- **If your instance was adopted through `npm run init` and has none of those paths:**
  the merge adds the framework's copies as new files. They are framework-development
  state, not yours — delete them after the merge and commit the deletion.
  `/sekai-upgrade` does not classify maintainer-doc state in **this** release the way it
  classifies dev-plugin state, so this step is manual here. **Superseded:** the next
  release automates it (see that entry's Upgrade note); this instruction applies only
  when v1.0.12 is the tag you are merging.

## [1.0.11] — 2026-07-28

Ships a guard-or-explain doctrine rule for prose that drifted from code.

### Added

- **Doctrine: guard-or-explain for prose that drifted from code.**
  `.agent-toolkit/rules/guard-or-explain-prose-drift.md` requires a task whose
  objective is correcting a stale statement about the code to ship a machine
  guard deriving the value from its source, or to name why one is infeasible or
  already exists. Dev-plugin state only: the init wizard strips
  `.agent-toolkit/`, so adopters inherit nothing from this change.

## [1.0.10] — 2026-07-26

Adds an end-to-end guarded framework release workflow covering version and changelog preparation, verification, PR merge, lightweight tag publication, and branch cleanup.

### Added

- **`/sekai-framework-release`** now cuts framework releases end to end: guarded
  version and changelog preparation, full verification, release PR and green-CI
  merge, lightweight `sekai-kb-vX.Y.Z` tag publication, and branch cleanup. Its
  deterministic helper preserves `pyproject.toml` as independent internal tooling
  metadata and changes only the four framework release files.

## [1.0.9] — 2026-07-26

Corrects cross-agent skill discovery and establishes separate adopter and framework release
ownership.

### Changed

- **Framework skills moved to the shared agent namespace.** All skills now live
  under `.agents/skills/`, and their folder names, YAML names, invocation names,
  and cross-skill references use the `sekai-` prefix. Codex discovers the
  standard path natively; `AGENTS.md` tells Claude Code to discover metadata
  there and load a full `SKILL.md` only when it triggers. The genericity and
  English-only gates now scan the new tree.

  **Upgrade note:** remove the old `.claude/skills/` tree when adopting this
  release. Use `/sekai-adopt`, `/sekai-seed-articles`, `/sekai-write`,
  `/sekai-validate`, `/sekai-factcheck`, `/sekai-kb`, `/sekai-upgrade`, and
  `/sekai-release` after the upgrade.

- **Framework and adopter npm manifests now mirror their respective release
  SSOTs.** The Sekai template no longer carries `VERSION`; its
  `package.json.version` and lockfile root versions mirror `FRAMEWORK-VERSION`.
  Init creates adopter `VERSION` and sets the adopter manifest versions from it.
  CI rejects drift. The new `npm run release:bump -- patch|minor|major` command and
  `/sekai-release` skill let an adopter maintainer prepare a release explicitly, without
  versioning routine article PRs. The bump command preserves every non-version
  byte in both npm manifests.

  **Upgrade note:** the first upgrade from v1.0.8 keeps the adopter's `VERSION`
  when the framework deletes its mistaken template copy. `/sekai-upgrade` now captures
  adopter package identity before merging, takes incoming framework scripts and
  dependencies, and restores adopter name, description, privacy, and version
  fields afterward. This package reconciliation is required on every upgrade
  because the manifests have mixed ownership.

## [1.0.8] — 2026-07-26

Separates adopter release identity from adopted framework identity and removes
framework release numbers from the private npm manifest.

### Changed

- **Framework and adopter versions now have separate file SSOTs.**
  `FRAMEWORK-VERSION` identifies the Sekai release and replaces
  `package.json.version` in the framework release procedure. `VERSION` identifies an
  adopter's own release and carries `merge=ours`. The private npm manifest has no
  release version. Init writes adopter-specific package name and description,
  initializes `VERSION` to `v0.0.0`, and preserves the checked-out
  `FRAMEWORK-VERSION`. CI validates the two version domains and the private package
  contract.

  **Upgrade note:** existing adopters add `VERSION merge=ours`, create `VERSION` with
  their own release number, remove `package.json.version`, set `private: true`, and
  remove the corresponding root version fields from `package-lock.json`. Keep the old
  `FRAMEWORK-VERSION` during the tag merge; `/upgrade` bumps it after verification.

## [1.0.7] — 2026-07-26

Separates framework and adopter changelogs, protects the instance's adopted
framework marker during merges, and pins the framework's dev-plugin validation
contract to its declared release.

### Changed

- **Adopted instances now own their changelog.** The template keeps this file as the
  framework release log, but `npm run init` replaces it with a deterministic
  instance-only changelog and `.gitattributes` protects it with `merge=ours`.
  `/upgrade` continues to read framework notes directly from the target tag, so it does
  not need or overwrite the instance log. Init and upgrade regression checks enforce
  the split. `FRAMEWORK-VERSION` is now merge-protected too; `/upgrade` remains its
  explicit writer after verification.

  **Upgrade note:** before adopting the release containing this change, an existing
  instance that wants an instance-only changelog must add `CHANGELOG.md merge=ours` to
  its `.gitattributes` and replace copied framework history with its own record. Commit
  both changes before running `/upgrade`.

- **The required dev-plugin release is explicit and CI-guarded.**
  `.agent-toolkit/dev.md` frontmatter now declares the action repository and
  release. `npm run dev-plugin:check` verifies every `check-rules` workflow
  reference against that declaration, and CI now uses `dev-v0.0.72`.

## [1.0.6] — 2026-07-25

Moves category colors into instance configuration, makes genericity scan-root
documentation machine-checked, and replaces the vendored dev-plugin rule checker
with the upstream pinned composite action.

### Changed

- **Category colors are now instance-owned.** The slug-keyed `COLOR_PALETTE` in
  `src/utils/categoryConfig.ts` is removed. Colors flow through optional
  `color?` and `colorLight?` fields on each entry in `place.config.ts`
  `categories[]`. Absent fields fall back to a neutral `DEFAULT_COLOR`
  (`#475569` / `#47556920`), so existing adopters build without config surgery.
  The demo place carries its colors inline as an example.

### Removed

- **`.agent-toolkit/scripts/check-rule-registry.mjs` is retired.** The dev plugin
  now ships the rule-discovery checker itself
  (`resolve_project_rules.py --check`, agent-toolkit #37) and packages it as a
  composite action (#39) referenced at an immutable release tag (#38), so the
  framework no longer maintains a second copy of a checker it does not own. The
  `test` job's `Rule registry` step is now a single
  `uses: wilsonkichoi/agent-toolkit/.github/actions/check-rules@dev-v0.0.70`, and
  the `if [ -f .agent-toolkit/dev.md ]` shell guard around it is gone: the action
  performs that detection itself and skips with exit 0 on a repository without the
  config, which is exactly what a `npm run init`-stripped adopter has.
  `.agent-toolkit/scripts/` is removed with its only file.

  Two steps replace the retired `--selftest`, so adopter-side non-vacuity is not
  lost. In `test`, a throwaway fixture carrying one unclassified rule file is run
  through the same pinned action and the workflow asserts it fails with the
  `rules_dir contains unclassified Markdown` diagnostic. In `init-check`, where
  the wizard has just stripped the workspace in place, the action is run against
  that real stripped tree and the workflow asserts `result: skipped` and exit 0.

  The `test` fixture steps carry `if: hashFiles('.agent-toolkit/dev.md') != ''`.
  The gate itself is never guarded; only its non-vacuity proof is, because an
  instance with no dev-plugin state has no rules for that proof to be about and
  should not install a toolchain or depend on an upstream diagnostic string to
  learn it. Adopters running `dev:setup` get the full proof back automatically the
  moment their config exists.

  **Upgrade note:** this is `deploy.yml` only, so it reaches instances through a
  normal tag merge with no adopter action. An instance that carries its own
  `.agent-toolkit/` tree (adopter-owned, `merge=ours`) keeps its copy of the
  retired script through the merge and should delete it in the same commit that
  adopts this release; an instance stripped by `npm run init` has nothing to do —
  its `Rule registry` step skips and the fixture steps do not run at all.

### Fixed

- **Scan-root scope statements now match the gates.** `npm run genericity` runs
  two gates whose instance-mode roots differ — the place-name denylist gate
  (`scripts/ci/check-genericity.sh`) scans `src/`, `scripts/`, `tests/`,
  `.claude/skills/`, and the English-only gate
  (`scripts/ci/check-english-only.mjs`) scans `src/`, `scripts/`, `tests/`,
  `workers/`, `.claude/skills/` — and both scan the whole repository in template
  mode. Eight statements restated those sets wrongly, most by merging them into
  one claim or by omitting `.claude/skills/`: the denylist file header, the
  English-only script's instance-mode comment, the English-only CI step name (it
  omitted `workers/`), `docs/runbook/DEPLOY.md` §Quality gates, `README.md`
  §Genericity, `AGENTS.md` iron rule 2 (which contradicted its own "Skill
  ownership" section), the wizard-emitted instance `AGENTS.md` in
  `scripts/init/writer.mjs`, and the `.sekai-template` marker. Each now states
  the roots per gate; the `check-genericity.sh` "Scan scope" header, already
  correct, was reworded to say which gate its list belongs to.

### Added

- **`scripts/ci/check-scan-root-docs.mjs`** — the guard that keeps the above
  true. It *derives* both root sets from the two gate scripts (the
  `SCAN_ROOTS+=` lines and the `SCAN_ROOTS` array literal) and asserts that all
  21 registered statements enumerate exactly the roots of the gate each one
  describes; changing a script's roots changes what the guard demands, with no
  second edit to the guard. A registered statement that has been reworded or
  moved (its anchor no longer matches) fails rather than silently passing.
  Statements in adopter-owned files (`AGENTS.md`, `README.md`,
  `.agent-toolkit/**`) and in the removed `.sekai-template` marker are required
  in template mode and reported as skipped on an adopted instance, so an
  adopter's own wording never fails their gate. Wired into `npm run genericity`,
  so `test_command` and every local run cover it.
- **`scripts/ci/check-scan-root-docs-selftest.sh`** (`npm run
  genericity:docs-selftest`) — the guard's non-vacuity proof, in the
  `check-skills-gated.sh` idiom: it plants doc drift, script `SCAN_ROOTS` drift,
  and a reworded anchor, requires the guard to fail each time, and restores every
  file it mutates. Both the guard and this self-test run as named steps in
  `deploy.yml`'s `genericity` job.

## [1.0.5] — 2026-07-24

Makes framework upgrades preserve an instance's dev-plugin state in both
directions: an adopter who never wanted the dev workflow stops silently
reacquiring it, and an adopter who installed their own keeps it untouched.

### Fixed

- **`/upgrade` preserves a stripped `.agent-toolkit/` tree.** `merge=ours`
  protects the *content* of a path present on both merge sides; it does not
  preserve a path the instance deliberately deleted. A wizard-adopted instance
  therefore hit a `DU .agent-toolkit/dev.md` modify/delete conflict on a
  shared-history upgrade, and had the framework's whole dev-plugin tree added back
  as theirs-only content on an unrelated-history first tag merge. Dev-plugin
  presence is now persistent instance state that the upgrade classifies before
  merging and reconciles after (ADR 006 addendum, SPEC §Repo topology).

### Added

- **`scripts/upgrade/dev-plugin-state.mjs`** — the framework helper `/upgrade` and
  `docs/runbook/UPGRADE.md` both drive. `classify` prints `stripped` (no
  `.agent-toolkit/` and no active `@.agent-toolkit/dev.md` reference in
  `AGENTS.md`/`CLAUDE.md`) or `installed` (the adopter's `.agent-toolkit/dev.md`
  and the active reference both present), and exits 3 with a diagnostic on an
  inconsistent state — half-installed dev-plugin state stops the upgrade rather
  than being guessed at. `reconcile --state stripped` removes every
  `.agent-toolkit/` path the merge brought in (modify/delete conflicts and
  theirs-only additions alike), drops any reference line the merge introduced, and
  amends the merge commit when the merge already completed, so the framework tree
  is never committed into the instance and the user never resolves a dev-plugin
  conflict by hand. `reconcile --state installed` mutates nothing: it asserts the
  adopter's `.agent-toolkit/**` is byte-for-byte unchanged against the pre-merge
  revision and reports framework paths the merge added, for the user to keep or
  remove.
- **`scripts/upgrade/check-upgrade-state.sh`** — disposable-repository regressions
  for all five states (stripped on shared history, stripped on unrelated history,
  installed, and both inconsistent states), plus a `--selftest` mode that proves
  the suite fails when the reconcile step is skipped. Both run in the required CI
  `test` job (`npm run upgrade:check`, `npm run upgrade:selftest`).

### Changed

- **CI `test` job gates the dev-plugin rule registry when dev-plugin state is
  present.** `.github/workflows/deploy.yml` gains a step that runs
  `.agent-toolkit/scripts/check-rule-registry.mjs` and its self-test, guarded by
  `if [ -f .agent-toolkit/dev.md ]`. The checker asserts every promoted rule under
  the configured `rules_dir` declares a valid `tier` (doctrine / gotcha+trigger /
  none) for the dev-plugin project-bootstrap **discovery** contract (dev 0.0.64+),
  and that the `## Rules` section carries no bare `@path` registry line. The init
  wizard strips the entire `.agent-toolkit/` tree from adopter instances, so on a
  stripped adopter the guard makes the step a clean no-op — the workflow never
  depends on a removed path. The rule files and registry format under
  `.agent-toolkit/**` are instance-owned (`.gitattributes merge=ours`) and inert on
  instances; only this guarded `deploy.yml` step propagates on upgrade, and it
  requires no adopter action.

### Upgrade note

Run this upgrade with `/upgrade` (or the updated `docs/runbook/UPGRADE.md` flow):
both now classify dev-plugin state **before** the merge and reconcile it after.
Releases before 1.0.5 did not ship the helper, so on this one upgrade run it from
the tag, as both flows show:

```sh
HELPER=scripts/upgrade/dev-plugin-state.mjs
test -f "$HELPER" || { HELPER="$(git rev-parse --git-dir)/sekai-dev-plugin-state.mjs"; \
  git show sekai-kb-v1.0.5:scripts/upgrade/dev-plugin-state.mjs > "$HELPER"; }
STATE="$(node "$HELPER" classify)"
```

If `classify` exits 3, your instance is in an inconsistent state (a
`.agent-toolkit/` tree with no active `@.agent-toolkit/dev.md` reference, or the
reverse). Repair it deliberately before merging — the diagnostic names both
directions. No `place.config.ts` change and no other adopter action is required.

## [1.0.4] — 2026-07-19

Corrects the v1.0.3 AGENTS.md-as-SSOT rollout so framework development and fresh
adopter instances follow the accepted ADR-006 contract without gaps.

### Fixed

- **Operative framework references now agree on the agent-instruction SSOT.**
  `.agent-toolkit/dev.md` names `AGENTS.md` as the content-bearing instruction
  source and `CLAUDE.md` as its one-line shim. The repository-topology diagram
  carries the same labels and includes `AGENTS.md` plus `.agent-toolkit/**` in
  the applicable instance-owned set.
- **The init self-check enforces the `CLAUDE.md` shim byte-for-byte.** The expected
  output is exactly `@AGENTS.md\n`; regression fixtures reject a trailing blank
  line, a missing final newline, added prose, or any changed byte. The existing
  CI init-check job runs this assertion, including its disposable `--build` tier.
- **Fresh adopter instructions retain the full applicable support contract.**
  Wizard-rendered `AGENTS.md` files now include the language-support boundary and
  the absent-safe semiont probe rule. The init self-check asserts both sections
  and continues to reject template-only and dev-plugin-only content.

### Upgrade note

`AGENTS.md`, `CLAUDE.md`, and `.agent-toolkit/**` are instance-owned, so merging
this tag does not overwrite them. Reconcile the improved `AGENTS.md` starter per
`docs/runbook/UPGRADE.md`: carry over the language-support boundary and semiont
probe if they are absent, keep instance-specific instructions intact, and confirm
that `CLAUDE.md` is byte-for-byte `@AGENTS.md\n`.

## [1.0.3] — 2026-07-19

`AGENTS.md` becomes the single source of truth for agent instructions; `CLAUDE.md`
is reduced to a one-line `@AGENTS.md` shim. Claude Code inlines the shim recursively
(`CLAUDE.md` → `AGENTS.md` → `@.agent-toolkit/dev.md` → doctrine rules) and Codex
reads `AGENTS.md` natively, so both CLIs boot from one document with no instructions
duplicated across or diverging between the two files.

### Changed

- **`AGENTS.md` is the agent-instruction SSOT.** The framework `CLAUDE.md` content
  (place identity, where-things-live, how-the-site-builds, iron rules, skill
  ownership, language boundary, semiont probe, template mode) moved into `AGENTS.md`
  above the dev-plugin sentinel block. The `AGENTS.md` "Read CLAUDE.md — it is the
  boot document" pointer is gone; `CLAUDE.md` is now exactly `@AGENTS.md`. The
  dev-plugin sentinel block and its `@.agent-toolkit/dev.md` reference line stay in
  `AGENTS.md`, unchanged.
- **The init wizard writes the new shape.** `scripts/init/writer.mjs` renders
  `AGENTS.md` place-specifically (the former `renderClaudeMd` content plus the
  content working set) and writes `CLAUDE.md` as the one-line `@AGENTS.md` shim; a
  fresh instance's `AGENTS.md` carries no dev-plugin sentinel block, so no separate
  strip is needed. `scripts/init/check-init.sh` now asserts the `AGENTS.md` header
  and the `CLAUDE.md` shim.
- **Starter reconciliation follows the new shape.** `/upgrade` +
  `docs/runbook/UPGRADE.md` treat `AGENTS.md` (and `README.md`) as the
  content-bearing starters to reconcile on upgrade; `CLAUDE.md` is exempt as a fixed
  `@AGENTS.md` shim.

### Upgrade note

**An instance must mirror this consolidation by hand** — `AGENTS.md`, `CLAUDE.md`,
and `.agent-toolkit/**` are `merge=ours`, so the tag's restructured starters do not
land on your instance automatically. On the merge branch, after merging this tag:

1. Move your `CLAUDE.md`'s content into your `AGENTS.md` (above the dev-plugin
   sentinel block if you keep one), delete any "Read CLAUDE.md — boot document"
   pointer, and reduce `CLAUDE.md` to a single `@AGENTS.md` line.
2. Keep your `AGENTS.md` dev-plugin sentinel block and its `@.agent-toolkit/dev.md`
   reference line intact — that line must NOT sit inside an HTML comment, or Claude
   Code will not inline your dev config through the chain.
3. Confirm `CLAUDE.md` is exactly `@AGENTS.md` and every `@` import target still
   resolves.

No `place.config` keys changed; the site builds unchanged. This note is about your
repo's agent-instruction plumbing, not the rendered site.

## [1.0.2] — 2026-07-19

Dev-plugin encapsulation (agent-toolkit 0.0.55) and adopter-owned `AGENTS.md`. The
framework's own development state (dev config + engineering rules) moves into
`.agent-toolkit/`, stops shipping to adopters, and `AGENTS.md` becomes instance-owned
from clone time (LB-41).

### Added

- **sekai-kb adopts the dev plugin** — `.agent-toolkit/dev.md` now carries the
  framework repo's own dev-workflow config (tracker, test command, CI workflow,
  merge policy, `context_file: AGENTS.md`, `rules_dir: .agent-toolkit/rules/`) plus a
  tiered `## Rules` index of the 12 engineering rules. `AGENTS.md` gains a
  dev-plugin reference line; `CLAUDE.md` reaches it via an `@AGENTS.md` shim.

### Changed

- **Engineering rules relocated** from `.claude/rules/` to `.agent-toolkit/rules/`
  and reclassified as **dev-plugin state, not framework content**. They are lessons
  from developing the framework's `src/`/`scripts/`; adopters never touch those
  trees, so shipping them was a mistake. Every `.claude/rules/` reference in code
  comments, `CLAUDE.md`, `README.md`, and the wizard was re-pointed or removed.
- **`.gitattributes` `merge=ours` baseline is now 10 paths** — added `AGENTS.md`
  and `.agent-toolkit/**`. `AGENTS.md` is instance-owned from clone time (its
  starter began as framework boilerplate the instance then personalizes);
  `.agent-toolkit/**` is instance-owned because every repo — the framework and each
  instance — carries its own dev config that a tag merge must never overwrite.
- **The init wizard strips dev-plugin state from adopter clones.**
  `scripts/init/writer.mjs` removes the `.agent-toolkit/` tree and the `AGENTS.md`
  dev-plugin reference line on adoption; `scripts/init/check-init.sh` asserts both
  are absent post-init. A fresh instance ships zero dev-plugin state.
- **`/upgrade` + `docs/runbook/UPGRADE.md` gained a starter-file reconciliation
  step.** `merge=ours` silently discards the framework's changes to instance-owned
  starter files (`AGENTS.md` above all); the upgrade flow now diffs each starter
  against the incoming tag and offers framework improvements conversationally
  instead of dropping them.

### Fixed

- Template `.gitattributes` now ships the full `merge=ours` baseline the docs
  promise: added `CNAME`, `docs/baselines/**`, and
  `scripts/ci/genericity-denylist.local.txt` (all wizard-written), so a
  template-cloned adopter's `CNAME` + local denylist are protected without hand
  edits (LB-33 review S1).
- `docs/runbook/UPGRADE.md` demo-article cleanup uses `ORIG_HEAD` (the pre-merge
  tree `git merge` records at merge start) instead of `HEAD@{1}`, which resolved
  to an arbitrary reflog entry while the establishment merge was still uncommitted
  and could `git rm` an instance's own article (LB-33 review S2).
- `/upgrade` skill + `UPGRADE.md` CHANGELOG-excerpt command uses an `awk` range
  that stops before the next `## [` heading instead of a `sed` range that printed
  it as trailing noise (LB-33 review N1).

### Upgrade note

**An instance must migrate its own dev-plugin layout BEFORE merging this tag**, or
the template-side deletion of `.claude/rules/` collides with the rule files the
instance still has there. Do this on the merge branch, in order:

1. Add the two new `merge=ours` lines to your instance `.gitattributes`
   (`AGENTS.md`, `.agent-toolkit/**`) — this must precede the merge, or the tag's
   `.agent-toolkit/dev.md` (the framework's config) would land on your instance.
2. Relocate any rules you keep from `.claude/rules/` into your `rules_dir`
   (`.agent-toolkit/rules/`) and remove `.claude/rules/`. The template-side rule
   deletions then merge clean (both sides removed the path).
3. Run `dev:setup` (agent-toolkit ≥ 0.0.55) so your `.agent-toolkit/dev.md` carries
   `context_file` + `rules_dir` and a `## Rules` index; add the `AGENTS.md`
   reference line and the `CLAUDE.md` `@AGENTS.md` shim.

No `place.config` keys changed; the site builds unchanged. This note is about your
repo's dev-workflow plumbing, not the rendered site.

## [1.0.1] — 2026-07-18

### Changed

- **`docs/runbook/UPGRADE.md`** — the merge-base establishment step now covers
  demo-content cleanup: `merge=ours` protects files an instance already has but
  does not stop theirs-only `knowledge/` articles from being *added*, so an
  existing instance re-basing onto the framework must strip the template's demo
  articles. Documents the `comm`-based list-and-remove and clarifies the
  `merge=ours` add-vs-overwrite distinction.

### Upgrade note

Docs only — no config or code contract changes. Nothing to do.

[1.0.1]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.1

## [1.0.0] — 2026-07-18

First tagged framework release: the complete Phase-5 sekai-kb template, cut from
its origin instance and genericized to ship zero place content. An adopter runs
`/adopt` on a fresh clone and reaches a deployed site; the first instance re-bases
onto this tag.

### Added

- **Adoption path** — `/adopt` AI-interview skill (the primary bootstrap), the
  `npm run init` wizard (single writer of `place.config.ts`, `CNAME`, the
  `CLAUDE.md`/`README.md` headers, `FRAMEWORK-VERSION`, and the instance-owned
  genericity denylist), and `/seed-articles` for first content.
- **Content-lifecycle skills** — `/write`, `/validate`, `/factcheck`, and a
  router skill under `.claude/skills/`, all config- and playbook-driven with no
  place identity baked in.
- **`SystemDiagram.astro`** — config-driven animated architecture diagram
  (`/system` page); renders from `place.config.ts` with a brand-circle fallback
  when no `boundary.geojson` is present, and dims feature loops that are off.
- **Docs** — `docs/playbook/` (ARTICLE / REWRITE-PIPELINE / FACTCHECK-PIPELINE),
  `docs/runbook/DEPLOY.md`, framework `CLAUDE.md` + `AGENTS.md`.
- **Release discipline** — this `CHANGELOG.md`, the `/upgrade` skill, and
  `docs/runbook/UPGRADE.md` (tagged-release upgrade flow + merge-base mechanics).
  The `merge=ours` mechanism requires `git config merge.ours.driver true` per
  clone (the `ours` driver is not built into git); `/upgrade`, the runbook, and
  the `.gitattributes` header all set/document it.

### Changed

- **Genericity + English-only gates** now scan `.claude/skills/` in addition to
  `src/`, `scripts/`, `tests/`, and run whole-tree in template mode (gated on the
  `.sekai-template` marker) vs. code-trees-only in instance mode.
- **`article-health`** editorial linter hardened across Phase 5 (At-a-Glance
  blockquote, chronicle-lead, footnote/cross-reference rules) and its
  `EDITORIAL_REF` strings re-pointed to `docs/playbook/`.
- **`package.json`** `version` set to `1.0.0`; the init wizard now records
  `FRAMEWORK-VERSION` as `v${version}` so wizard-written and `/upgrade`-written
  values share the `vX.Y.Z` form.

### Upgrade note

First release — nothing to upgrade from. The first instance establishes its merge
base against this tag per `docs/runbook/UPGRADE.md` §Establishing the merge base.

[Unreleased]: https://github.com/wilsonkichoi/sekai-kb/compare/sekai-kb-v1.1.4...HEAD
[1.1.4]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.1.4
[1.1.3]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.1.3
[1.1.2]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.1.2
[1.1.1]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.1.1
[1.1.0]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.1.0
[1.0.20]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.20
[1.0.19]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.19
[1.0.18]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.18
[1.0.17]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.17
[1.0.16]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.16
[1.0.15]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.15
[1.0.14]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.14
[1.0.13]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.13
[1.0.12]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.12
[1.0.11]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.11
[1.0.10]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.10
[1.0.9]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.9
[1.0.8]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.8
[1.0.7]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.7
[1.0.6]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.6
[1.0.5]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.5
[1.0.4]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.4
[1.0.3]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.3
[1.0.2]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.2
[1.0.1]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.1
[1.0.0]: https://github.com/wilsonkichoi/sekai-kb/releases/tag/sekai-kb-v1.0.0
