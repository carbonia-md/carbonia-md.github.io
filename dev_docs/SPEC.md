# SPEC: Sekai KB

**Framework maintainer document.** This is the engineering SSOT for the framework's
architecture, contracts, negative requirements, and risk controls. Product intent lives
in `dev_docs/PRD.md`; delivery detail lives in `dev_docs/ROADMAP.md`; accepted decisions live in
`dev_docs/adr/`. Conflicts go to the maintainer (see `.agent-toolkit/dev.md`). Engineering
diagrams (SSOT): `dev_docs/diagrams/architecture.drawio`, `data-flow.drawio`,
`repo-topology.drawio` — updated in the same PR as any architecture change they depict.

> **Stripped at adoption.** `npm run init` removes this file along with `dev_docs/PRD.md`,
> `dev_docs/ROADMAP.md`, and `dev_docs/adr/`. Adopters keep `docs/playbook/` and
> `docs/runbook/` (ADR 008).
>
> **Sections that did not move.** This document was split out of instance #1's SPEC. The
> extraction map (which fork file seeded which framework file) and the inherited-fork
> disposition table (what was deleted, split, or deferred at the rebuild) are that
> instance's rebuild history and stay in its repository. Where text below refers to the
> "inherited fork" or the "v1 archive", the authoritative record is there.

## Stack

- **Astro 6.x + Tailwind 4.x**, zero client-side frameworks; vanilla JS on interactive
  pages. Node >= 22.13 (`package.json` `engines` is the operative floor).
- **MiniSearch** client-side search, index prebuilt; plain word tokenization (English-only,
  no CJK code path).
- **D3 from CDN** for the knowledge graph only; **Chart.js from CDN** only if the dashboard
  needs it.
- **Leaflet + OSM tiles** for the map, CDN-loaded and page-scoped.
- **Python >= 3.12 via uv** for editorial tooling: `article-health.py` and
  its pytest suite run through `uv run`; `pyproject.toml` + `uv.lock` ship with the
  framework, and `npm run prebuild:dashboard` shells into the tool (absent-safe: `|| true`).
  The runbook documents uv setup for adopters.
- **Cloudflare Workers (free tier)** for all dynamic capability: feedback (Worker + D1),
  on-demand OG (Satori + resvg-wasm), RAG chat. RAG model space: **bge-m3, 1024-dim** for
  both corpus (offline GPU or Workers AI) and query (Workers AI `@cf/baai/bge-m3` —
  mandatory, since an offline GPU is unreachable at request time). At single-instance
  scale, retrieval is in-worker cosine over static JSON vectors; Vectorize is the
  documented path at roughly 4k+ vectors.
- **Workers are TypeScript, never Python.** Python Workers run Pyodide inside the V8
  isolate, costing memory overhead and cold-start latency the CPU budget below has no room
  for, and adding tens of seconds to deployment.
- **No native hybrid search on this platform.** Workers AI's `@cf/baai/bge-m3` runner
  returns only the 1024-dimensional **dense** vector, and Vectorize indexes neither sparse
  dictionaries nor multi-vector matrices — so bge-m3's sparse and multi-vector
  representations are unreachable here at any scale. Keyword and vector fusion, if it is
  ever built, is Reciprocal Rank Fusion merged in-worker over the existing MiniSearch
  index. Evidence and the measurements behind this:
  `dev_docs/research/platform-notes.md §2.3`, `§2.5`.
- **Chat generation starts on free-tier Workers AI** with citation-required prompting. The
  model is selected at packet time against the current catalog and is deliberately **not
  pinned here**: the hosted-model quality/cost escalation path and its per-token
  figures are recorded in
  `dev_docs/research/platform-notes.md §2.10`, dated, and must be re-verified before use.
  Pinning a model identifier from archived research would ship a stale contract.

## Repo topology

`sekai-kb` is the framework SSOT and a GitHub template repository; each adopted instance
is a separate repository re-based onto it. Instances merge **tagged releases only, never
framework main**; determinism is guaranteed by (a) immutable semver tags + CHANGELOG
upgrade notes, (b) zero place content in the template, (c) `merge=ours` on instance-owned
files (`place.config.ts`, `knowledge/**`, `public/media/**`, `CNAME`, `CLAUDE.md`,
`AGENTS.md`, `README.md`, `CHANGELOG.md`, `VERSION`, `FRAMEWORK-VERSION`,
`scripts/ci/genericity-denylist.local.txt`, `.agent-toolkit/**`, `dev_docs/**`),
(d) the **ownership rule**: an instance's `src/` and `scripts/` are framework-owned, which
is a **default and an upgrade contract, never an access boundary** (ADR 010). Customization
flows through config/content/media because that route survives merges without conflict and is
machine-validated; an adopter may nonetheless edit any file in their own clone, and what the
framework owes them is the cost stated where it applies rather than a refusal. Upstreaming to
sekai-kb and pulling the change back as a release stays the **recommended** route because it
buys conflict-free upgrades, not because the local edit is forbidden.
`.gitattributes` in each repository is the operative list, and
`scripts/ci/check-framework-docs.mjs` gates the enumeration above against it.

`VERSION` records an instance's own release. `FRAMEWORK-VERSION` records the
adopted Sekai release. The template carries only `FRAMEWORK-VERSION`; init creates
adopter `VERSION`. Each repository's npm manifest mirrors its own release SSOT without
the leading `v`. The `/sekai-upgrade` skill wraps fetch → capture adopter package state →
merge tag → reconcile mixed-ownership manifests → build-verify → conflict report.
Framework and instances use the same directory shape except for adopter-only `VERSION`
and the maintainer docs, which adoption removes:

```text
sekai-kb/
├── place.config.ts
├── knowledge/                 # instance-owned Markdown SSOT
├── public/media/              # instance-owned media
├── src/
│   ├── components/
│   ├── layouts/
│   ├── templates/
│   ├── pages/
│   ├── styles/
│   ├── content/               # derived, gitignored
│   └── data/                  # derived build outputs
├── scripts/
│   ├── core/
│   ├── tools/
│   ├── init/
│   ├── upgrade/
│   ├── release/
│   └── ci/
├── workers/                   # optional Cloudflare Workers
├── semiont/                   # optional organ layer
├── .agents/skills/            # framework-owned skills
├── docs/playbook/             # adopter-facing editorial canon
├── docs/runbook/              # adopter-facing operations
├── dev_docs/PRD.md                # framework maintainer doc; removed by init
├── dev_docs/SPEC.md               # framework maintainer doc; removed by init
├── dev_docs/ROADMAP.md            # framework maintainer doc; removed by init
├── dev_docs/adr/                  # framework maintainer docs; removed by init
├── CHANGELOG.md               # framework release log; init replaces it with instance history
├── VERSION                    # adopter only: instance release; merge=ours
├── FRAMEWORK-VERSION          # adopted tag; captured/restored across the merge, then bumped
├── AGENTS.md                  # instance-owned agent-instruction SSOT
└── CLAUDE.md                  # one-line @AGENTS.md shim
```

> **Dev-plugin state persistence (2026-07-19, ADR 006 addendum):** `merge=ours`
> protects content only when the path exists on both merge sides; it does not preserve an
> intentionally absent `.agent-toolkit/` tree. `/sekai-upgrade` must classify dev-plugin state
> before merging: **stripped** means both `.agent-toolkit/` and the active
> `@.agent-toolkit/dev.md` reference are absent; **installed** means the adopter's
> `.agent-toolkit/dev.md` and active reference are present. A stripped instance stays
> stripped across shared-history upgrades and unrelated-history first tag merges; an
> installed instance keeps its own config and rules. Mixed states are invalid and stop the
> upgrade with a diagnostic. Framework dev-plugin state is never reacquired implicitly;
> `dev:setup` is the only opt-in path.

> **Maintainer-doc ownership (2026-07-28, ADR 008):** `dev_docs/PRD.md`, `dev_docs/SPEC.md`,
> `dev_docs/ROADMAP.md`, and `dev_docs/adr/` are framework-development state in the same class as
> `.agent-toolkit/`. The init wizard removes them; `docs/playbook/` and `docs/runbook/`
> stay, because they are what an adopter operates the site with. No file that ships to an
> adopter may carry a link into a removed path —
> `scripts/ci/check-framework-docs.mjs` is the gate. An instance that keeps its **own**
> document at one of these paths is a legitimate state, not a violation: the reference
> resolves there, and that document is the instance's, never a copy of the framework's
> prose that could go stale. In instance mode the gate therefore treats a maintainer-doc
> path **present** in the checkout as instance-owned — excluded from the dangling-reference
> scan and from the registered-statement anchors — using the same presence signal the
> upgrade's `reconcile` uses to classify a path `owned`. In template mode nothing is
> owned, so both checks stay exhaustive.

> **Maintainer-doc state persistence (2026-07-28, ADR 008 addendum):** the maintainer docs
> are subject to the same `merge=ours` limit as `.agent-toolkit/` — the attribute protects
> content on a path that exists on both merge sides and cannot preserve an intentionally
> absent one. `/sekai-upgrade` therefore classifies maintainer-doc state before merging and
> reconciles it immediately after, **per path** rather than as a set: a path present
> pre-merge is **owned** and is never deleted; a path absent pre-merge is **stripped** and
> whatever the merge introduced there is removed, across both shared-history upgrades and
> unrelated-history first tag merges. Unlike dev-plugin state there is no activation signal
> and no mixed state: an instance may legitimately own some of these paths and not others,
> so a partial set is normal and never stops the upgrade. An owned path that is unmerged or
> changed against the pre-merge revision **does** stop it — that is `merge=ours` missing from
> `.gitattributes` or `merge.ours.driver` unset in the clone, and the framework's copy must
> never win over a document the instance wrote. Framework paths the merge adds *under* an
> owned directory are reported, not deleted. The path set is derived at runtime from the
> wizard's `MAINTAINER_DOCS`, so the upgrade and the strip cannot disagree;
> `scripts/upgrade/check-upgrade-state.sh` is the gate for both helpers.

> **Skill ownership (task 5.6):** the framework skills under
> `.agents/skills/` (`/sekai-write`, `/sekai-validate`, `/sekai-factcheck`, router, plus
> `/sekai-adopt`, `/sekai-seed-articles`, `/sekai-upgrade`, `/sekai-release`) are
> framework-owned, same class as `src/`. Adopters ADD new skills freely — new files never
> conflict on upgrade. Overriding a framework skill means upstreaming the change to
> sekai-kb first, or accepting a conflict-managed local fork that `/sekai-upgrade` flags
> on every release. ADR 006 extends the original five-file instance-owned baseline;
> `CLAUDE.md` remains instance-owned as the byte-exact one-line `@AGENTS.md` shim.

> **Release train for post-cut feature phases (9-11, ADR 005):** those phases execute in
> `sekai-kb`; each ships as a tagged release, and instances adopt via
> `/sekai-upgrade` per `docs/runbook/UPGRADE.md` (task 9.3). The upgrade pull into
> instance #1 is part of each phase's exit gate.

## `place.config.ts`

Schema: `place {name, brandSuffix?, tagline, domain, locale, languages}`,
`categories[] {slug, title, icon, description, color?, colorLight?}` (5-14), `map {center, zoom, maxBounds}`,
`features {graph, map, dashboard, soundscape, feedback, chat, social, analytics, og}`,
`links {repo, email, social {twitter?, threads?, instagram?}}`,
`workers? {feedback?, feedbackDatabaseId?, feedbackRateLimitMax?,
feedbackRateLimitWindowSeconds?, chat?, chatDatabaseId?, chatRateLimitMax?,
chatRateLimitWindowSeconds?, chatRelevanceFloor?, og?}`,
`seo {defaultOgImage, twitterHandle?}`,
`home {hero, stats, doors, coverStory, randomDiscovery, features, exhibitions, recentUpdates, contribute}`.
Init-time: written only by the `npm run init`
wizard (or `--answers <json>` from `/sekai-adopt` — single writer, no drift).
Runtime-toggleable: `features`, languages, semiont organs.
Both the top-level section list and the `features` flag list are derived from
`place.config.ts` and gated by `scripts/ci/check-framework-docs.mjs`. The
`PlaceConfig` declaration itself is stated **once**, at the top of that file: the
wizard re-emits the committed declaration rather than carrying a copy, and
`scripts/ci/check-place-config-interface.mjs` (`npm run place-config:check`) is
the gate — it fails when `scripts/init/writer.mjs` re-introduces a declaration of
its own or emits a different one, when a `scripts/init/prompt-table.mjs` row
prompts for a key the declaration does not declare, or when a config object sets
a property its own declaration omits. `scripts/init/check-init.sh` runs that last
assertion against a real wizard run (`--generated`). Nothing in this repository
typechecks — `npm run build` strips types through esbuild — so this gate, not the
compiler, is what keeps the emitted config and the emitted interface in agreement.

> **`links`:** the shell's Footer/SEO/Header need a repository URL, contact
> email, and social handles, which the original schema did not define. The schema was
> extended rather than dropping the links. `links.social.*` render only when
> `features.social` is true; the init wizard includes `links` prompts.

> **`workers?`:** this instance's Cloudflare Worker deployment identity, one
> optional key per worker for each of two roles: the deployed endpoint URL
> (`workers.feedback` for `workers/feedback/`) and the D1 database id
> (`workers.feedbackDatabaseId`, `<worker>DatabaseId` in general). A worker is
> deployed by hand after adoption, so the wizard prompts for the URL with a blank
> default and an instance fills both in later. Both are place identity — they name
> this instance's deployment, and a Worker `name` or a D1 `database_name` is
> account-scoped, so two instances sharing one collide inside a single Cloudflare
> account. Under iron rule 2 they may live only here, never in `src/` and never in the
> committed `workers/*/wrangler.toml`, which `scripts/ci/check-worker-config.mjs` holds
> to framework placeholders **and keeps fatal in both modes** — this is the harm-beyond-
> the-editor half of ADR 010, and the place-name denylist gate cannot catch it, since
> `name = "coastal-feedback"` carries no denylisted term. The `[vars]` tuning constants
> in the same files are the other half and are **not** identity: see the third role
> below. The effective
> deploy config is derived from this block into a gitignored
> `wrangler.generated.toml` by `npm run worker-config`. Absent-safe by construction:
> a consumer requires both its `features` flag and a non-empty endpoint, so a missing
> `workers` block leaves the capability off, and an unset database id generates an
> empty value with a note rather than failing.
>
> This block carries a third role, added in LB-89: a **deploy-time tuning override**
> (`workers.chatRateLimitMax`, `chatRateLimitWindowSeconds`, `chatRelevanceFloor`, and
> — added in LB-91 — `workers.feedbackRateLimitMax`, `feedbackRateLimitWindowSeconds`).
> Unlike the first two roles these are not place identity — the framework ships a real
> default for each in that worker's `wrangler.toml`, and the committed template remains
> the default carrier and stays gated at those constants. They live here because the
> framework *asks* an instance to retune them (§New builds (6) sends an adopter to
> `docs/runbook/DEPLOY.md` to re-measure the floor against their own corpus) and
> `workers/` is framework-owned, so there was no structured place to record the answer.
> **ADR 010 amends the justification, not the feature.** A hand-edit to the committed
> `wrangler.toml` is now permitted in an instance and warns rather than failing, so this
> block is no longer the *only* way to record a retuned value — it remains the
> **preferred** one, because a structured key survives a tag merge without conflict and
> is validated by name, where a hand-edit conflicts on the next upgrade.
> The registry is `WORKER_VAR_OVERRIDES` in `scripts/deploy/wrangler-config.mjs`,
> shared by the generator and the gate; a second worker's vars are another entry in it,
> not a second mechanism. That is now what ships rather than a forward-looking claim:
> LB-91 added `feedback` as the second entry, and it cost one registry row per var —
> the generator and the gate both reach it by iterating
> `WORKER_VAR_OVERRIDES[<worker>]`, and neither grew a per-worker branch.
> `scripts/ci/check-worker-config-selftest.sh` states its generator classes per
> worker, with one recorded pre-override fixture each, so a third entry is proven by
> the same classes rather than by the first worker's alone. Absent-safe: an unset key pushes no override, so the generated
> config is byte-identical to one produced before the keys existed. Values are validated
> at generation time and rejected by name, because the worker parses these vars leniently
> and would otherwise fall back to its own defaults on a typo, deploying clean and
> behaving as if nothing had been configured.

> **`categories[].color?` / `colorLight?`:** optional hex color strings
> for category display (hero tints, tag badges, sidebar accents). Absent-safe: when
> omitted, `categoryConfig.ts` falls back to `DEFAULT_COLOR`. This moves category
> colors from a framework-owned slug-keyed palette to instance data, eliminating the
> per-upgrade conflict on `categoryConfig.ts` that every non-demo-slug adopter hits.

> **Phase 9-11 extensions (ADR 005):** `features.mcp` (task 9.1)
> and `analytics` IDs (GA4 measurement ID, Cloudflare Web Analytics token — task 10.1)
> extend the schema under the same intentional-divergence pattern as `links`; init-wizard
> prompts are tracked on the citing tasks.
> **Absent-safe rule (spec invariant):** every new `place.config` key must default to
> feature-off when missing, so existing instances upgrade across framework releases
> without config edits.

> **`home`:** the entire home-page copy surface — hero, stats, doors, cover
> story, exhibition halls, feature cards, section headings — lives in the config as a
> `home` block. This keeps `src/` string-free (genericity win) but
> exceeds any init interview: the wizard writes generic defaults for `home.*`, and
> `/sekai-adopt` may draft place-specific copy behind the same human-approval gate as
> `/sekai-seed-articles`. The demo place ships authored demo copy. Same
> intentional-divergence pattern as `links`.

## Content model

`knowledge/` is SSOT (plain Markdown + YAML frontmatter, `[[wiki-links]]`);
`scripts/core/sync.sh` projects it into gitignored `src/content/`, never edited directly.
Wiki-links resolve at build time into hyperlinks + graph edges. The map frontmatter key is
`geo: Name,lat,lng,Area` (there is no `coordinates:` key).
Multi-language, as a design sketch only: 3-line wrapper pages per language importing
`src/templates/*` bodies; adding a language would be a wrapper directory + a `languages`
entry + `knowledge/{lang}/` content. No translation tooling ships. The framework is
English-only through the current roadmap and language support is a post-project revisit
(PRD non-goals).
Adopter-facing boundary: tooling is English-calibrated; Latin-script
content largely works (plain tokenization; article-health prose thresholds may need
per-instance retuning); CJK is unsupported until that revisit. The adopter docs state
this — documented honestly, never patched with code.

## Build pipeline

`sync.sh` → parallel prebuild (`run-p`: kb-index, search, content-dates, git-info,
related, changelog, map-markers, dashboard) → latest → `astro build` → post-build
contract checks (`run-s`: smoke, internal-links, map-markers, graph, dashboard, sounds). Target
under 60s at 50 articles. The dashboard job shells into article-health (uv) absent-safe.
Both job lists are derived from `package.json` and gated by
`scripts/ci/check-framework-docs.mjs`.

**Static-endpoint naming: `/kb/`, not `/api/`** — `/kb/topics.json`,
`/kb/articles/{slug}.md`, `/kb/search-index.json`, plus `/llms.txt` at root. This is the
vendor-agnostic lazy-loading knowledge protocol: any browsing-capable AI reads `llms.txt`
→ `topics.json` → fetches only the articles it needs. `build-kb-index.mjs` emits the
`/kb/` outputs.

## Pages

Routes under `src/pages/`: `index`, `[category]/index`, `[category]/[slug]`, `404`,
`about`, `changelog`, `chat`, `contribute`, `dashboard`, `explore`, `feed.xml`, `graph`,
`latest`, `map`, `rss.xml`, `soundscape`, `system`.
Non-route build outputs: `llms.txt` and `/kb/*`, emitted by `build-kb-index.mjs`
rather than by an Astro page. `/map` is Leaflet; `/soundscape` is native HTML5
audio with no player library. Phase 6 also adds the feedback widget (a component,
not a route). `/chat` is vanilla JS over `fetch` and the streams API, with no client
framework and no off-origin script; it always builds, and `src/lib/chat.ts` decides
whether it renders the live panel or a static disabled state. That predicate needs
BOTH `features.chat` and a non-empty `workers.chat`, and the Header and Footer entry
points read the same function, so the nav never links to a disabled page.

The route list is derived from `src/pages/` and gated by
`scripts/ci/check-framework-docs.mjs`, so adding a page without amending this
sentence fails CI.

## New builds

1. **Leaflet map.** GeoJSON markers come from article `geo:` frontmatter and use category
   colors. Popups link to articles. A simplified municipal-boundary GeoJSON may overlay
   the map; Leaflet consumes GeoJSON directly, and the page degrades gracefully when an
   instance ships no boundary file.
2. **Feedback capability.** `FeedbackWidget.astro` posts to `workers/feedback/`, a
   Cloudflare Worker backed by D1. A triage skill reads D1 and files GitHub issues. This
   replaces the inherited fork's Supabase harvest orchestrator; none of that code survives.
3. **Social publishing pipeline.** `/sekai-snippet` selects an article, generates a short-form
   draft, queues it in `knowledge/SNIPPET-INBOX.md`, and requires human approval before a
   platform adapter publishes it. It reuses the concept, not the fork's code. The adapter
   interface is `scripts/tools/snippet/adapter.d.ts`; `npm run snippet:publish` is the runner,
   and the only shipped sink is a manual one that prints the post for the operator to paste and
   records the URL they return, so `posted` is reachable before any instance has a platform
   account. A platform adapter is added only once a real instance has that account.
4. **Soundscape.** A native HTML5 audio page reads a `knowledge/sounds/` manifest. No
   player library is introduced, and the template carries no `<script>`. The manifest is
   `knowledge/sounds/_manifest.md`: gray-matter frontmatter, body free for human notes.
   A recording requires `title`, `location`, `credit`, `file`. A recording also accepts
   optional `description`, `icon`, `contributor`, `contributorUrl`, `date`. Recordings are
   grouped by an ordered `categories` list, one anchored page section each. A category
   requires `id`, `icon`, `title`. A category also accepts optional `article`, and carries
   its own `sounds` list plus an optional `wishlist`, whose entries carry `icon`, `text`
   and name the sounds the place still wants. A manifest that declares a top-level
   `sounds` list instead — the shape the first release of this page shipped — still
   renders, as one implicit category with no heading, so the schema is additive and an
   existing manifest needs no edit. The leading `_` is mandatory — it is
   what makes the file invisible to the three scanners that walk `knowledge/` looking for
   articles. `src/lib/sounds.ts` reads it with `readFileSync` + `try/catch`, so an absent
   manifest, an empty list, and an entry whose `file` is missing under `public/` all leave
   the build green: the page renders its empty state, or drops the offending entry with a
   build-time warning and renders the rest. A category's `article` is validated against the
   routes the build produces, and one that resolves to none is dropped with a build-time
   warning naming the category, so the page never links into a 404.
   `scripts/ci/check-soundscape-schema-docs.mjs` derives all five field lists in this
   paragraph from that reader and fails CI when the prose disagrees with it.
   `features.soundscape` gates only the Header
   and Footer entry points; the page itself always builds, as `/map`, `/graph`, and
   `/dashboard` do. The template ships three synthesized demo clips under
   `public/media/sounds/` that adoption removes.
5. **On-demand OG images.** `workers/og/` renders slug-keyed cards with Satori and
   `resvg-wasm`, cached at the Cloudflare edge. Static `og-default.png` remains fallback.
6. **RAG chat and QR flow.** `build-embeddings.mjs` chunks articles at 300-500 tokens on
   `##` boundaries and embeds them with bge-m3 at 1024 dimensions. `workers/chat/` embeds
   queries with Workers AI `@cf/baai/bge-m3`, performs in-worker cosine retrieval over
   static JSON vectors, and calls free-tier Workers AI with citation-required prompting. QR codes deep
   link to `/chat?ctx=<location>`. Those locations are declared in the optional
   `knowledge/chat/_contexts.md`: gray-matter frontmatter, an ordered `contexts` list, body
   free for human notes. A context requires `slug`, `label`, `greeting`. A context also
   accepts optional `hint`, `article`. `src/lib/chat-contexts.ts` reads it with
   `readFileSync` + `try/catch`, so an absent manifest leaves `/chat` exactly as it is
   without one, and a duplicate `slug`, a missing required field, an unusable `slug`, or an
   `article` that resolves to no built route each drop that one context with a build-time
   warning naming it while every other code keeps working.
   `scripts/ci/check-chat-context-schema-docs.mjs` derives both field lists in this
   paragraph from that reader and fails CI when the prose disagrees with it. A context's
   `hint` is appended to the **embedded query text** and never to the generation prompt, so
   a context can steer which articles are retrieved and cannot instruct the model — a
   scanned URL is attacker-editable, and the prompt is the one place it may not reach.
   A `hint` is capped at 200 characters, the bound the chat worker enforces on a request:
   the worker refuses an over-long hint with a 400 for the whole request, so a manifest
   that shipped one would make every question asked from that context fail, permanently,
   for anyone who scanned that sign. The reader drops it with a build-time warning and
   keeps the context, and the same gate holds the reader's constant, the worker's, and
   this sentence to one value.
   `npm run qr:sheet` renders the declared contexts as a gitignored `qr-sheet.html`, one
   printable card each, laid out to fit A4 and US Letter. It is a script and not a route:
   a `/qr` page would add a gated route and a maintained index page for something only the
   operator printing signs ever needs. It buys no privacy — `/chat` necessarily ships the
   whole context list to the client, since a static build has no server to resolve `?ctx=`
   — so the argument is cost, not secrecy.
   Retrieval applies a cosine **relevance floor** before top-k, so a question the corpus
   cannot support retrieves nothing, cites nothing, and is answered with a refusal. Top-k
   alone cannot express that: it returns a fixed count off a sorted list, so an
   unanswerable question still cites the least-bad matches. The floor is the deploy-time
   var `RELEVANCE_FLOOR`, not a constant, because the separating value is a property of
   the corpus; `docs/runbook/DEPLOY.md` carries the default and the procedure for
   re-measuring it. It bounds one refusal class only. A question about a subject the
   place plausibly has but no article covers scores at or above genuinely answerable
   questions, so no floor separates it and the answer is where its refusal shows up.
   `knowledge/chat/_eval.md` is the optional evaluation set and `npm run chat:eval` runs
   it against a deployed worker, failing on a citation that resolves to no published
   article, on a question declaring `expect: no-citations` that cites anything, and on
   any request error. Answer quality is deliberately not machine-judged; the run writes a
   Markdown report for the human review that is. An absent manifest exits 0.
7. **Framework scaffolding.** The primary path is GitHub "Use this template" followed by
   `/sekai-adopt`. The skill interviews for place identity, domain, map, language,
   categories, and grounding material; it calls `npm run init -- --answers <json>`, then
   offers `/sekai-seed-articles`. The wizard remains the single writer of
   `place.config.ts` and also seeds category directories, `CNAME`, `AGENTS.md`, adopter
   `VERSION`, and `FRAMEWORK-VERSION`, writes adopter package identity whose npm version
   mirrors `VERSION`, and removes framework-development state (`.agent-toolkit/`, the
   maintainer docs, the `.sekai-template` marker). Framework delivery includes
   `/sekai-upgrade`, `/sekai-release`, the playbook and runbooks, the template README,
   and the generic `/sekai-write`, `/sekai-validate`, `/sekai-factcheck`, and router
   skills.
8. **Semiont plugin layer.** ADR 003 governs the optional organ architecture. The stable
   boot hook lives in adopter-owned `AGENTS.md`; framework-owned organ logic lives under
   `semiont/`. Core is MEMORY + REFLEXES with a boot read below 150 lines. Other organs
   are opt-in and may not read one another's files.

## Extension capabilities — Phases 9-11 (ROADMAP blocks govern detail; ADR 005)

### MCP delivery (`workers/mcp/`, Phase 9)

Stateless Streamable-HTTP MCP server on Cloudflare Workers (createMcpHandler pattern, no
Durable Objects at single-instance scale — free-tier verified 2026-07, ADR 005;
McpAgent/DO documented as the scale-up path for adopters needing sessions). Tools:
`list_topics` (/kb/topics.json), `get_article` (/kb/articles/{slug}.md), `search`
(keyword over /kb/search-index.json), `semantic_search` (query embed via Workers AI
`@cf/baai/bge-m3` + in-worker cosine over the 7.2a vectors — same model space as chat,
§Stack). Retrieval code shared with `workers/chat/` lives in `workers/lib/`. Behind
`features.mcp`. The `/ai` page + `/kb/agent.md` boot file (task 9.2) document every AI
consumption path.

### Analytics (`features.analytics`, Phase 10)

Full stack: GA4 + Google Search Console + Cloudflare Web Analytics (ADR 005). Beacon/gtag
injected by HeadInlineScripts only when the flag is on; IDs live in `place.config.ts`,
never in `src/`. Fetchers emit `src/data/analytics/*.json` behind
`npm run fetch:analytics`; the dashboard renders panels from them and the build stays
green when they are absent. Credentials via local env / Actions secrets, documented in
the runbook.

### Autonomous routines (Phase 11)

Hybrid substrate (ADR 005): deterministic pipelines (embeddings/index refresh, analytics
fetch) run as GitHub Actions cron/push-triggers; AI routines (maintainer, feedback-triage,
trend-discovery, social-publish, rewrite) run as Claude Code native scheduled tasks on the
operator's machine. `semiont/organs/routine/ROUTINE.md` is the SSOT — each routine =
`{id, substrate, schedule, skill, model, depends, ship-mode}`; the `/schedule` skill
registers/unregisters against the declared substrate. Lifecycle contract (five stages with
PR discipline replacing direct push): sync main → run skill → ship via PR per
ship-mode (`auto-merge-data` for data-only artifacts, `human-merge` for content) → finale
writes the MEMORY organ. Kill switch: disabling the routine organ in
`semiont/config.json` stops all routines.

## Risk controls

1. **Design-parity failure.** Design ships as copied files, with side-by-side screenshot
   acceptance and visual baselines. If a page misses the bar, copy the reference page
   wholesale and re-genericize it; never re-prompt from description.
2. **Genericity erosion.** CI runs place-name and CJK gates, `place.config.ts` is the
   only code-facing identity ingress, and a real second-place adoption proof validates
   the abstraction empirically.
3. **Framework deferral.** Feature phases depend on the framework cut. Reordering is a
   scope change requiring the maintainer's explicit approval.
4. **Two-repo drift.** The template contains no place content, instance-owned paths use
   `merge=ours`, instances merge immutable tags only, and framework-owned changes land in
   `sekai-kb` before instances adopt them. ADR 004 and ADR 006 govern the full contract.
   The control is **visibility, not prohibition** (ADR 010): an instance may diverge from a
   framework-owned file, and the framework's job is to say so twice — once continuously, as
   a CI warning naming the file and the consequence, and once at `/sekai-upgrade`, with the
   incoming framework value beside the instance's. Divergence the framework cannot see is
   the risk; divergence it names is a decision the instance made.
5. **Lost upstream improvements.** This is an accepted cost. The codebase the framework
   was extracted from remains readable; useful ideas are reimplemented generically, never
   merged automatically.
6. **Framework overreach.** A framework feature exists only when a real instance uses it
   or it is one of the named adopter needs. Additional framework surface waits for a real
   adopter requirement.
7. **Maintainer-doc leakage.** Framework product, architecture, and delivery documents
   describe how the framework is built, not how an instance is operated. They are stripped
   at adoption and gated against dangling references (ADR 008); an adopter who wants
   product docs writes their own.

## Deployment

GitHub Pages via Actions + Cloudflare DNS/CDN. Workers deploy via `wrangler` from
`workers/`, documented in the runbook. No paid services.

## Negative requirements

- **Genericity + English-only (CI-gated):** zero place-specific strings in any code tree;
  `scripts/ci/check-genericity.sh` fails the build on denylist hits, and
  `scripts/ci/check-english-only.mjs` fails on any CJK codepoint. Each gate carries its
  **own** instance-mode scan roots: the place-name denylist gate scans `src/`,
  `scripts/`, `tests/`, `workers/`, `.agents/skills/`; the English-only gate scans `src/`,
  `scripts/`, `tests/`, `workers/`, `.agents/skills/`; the two lists agree today but are
  never merged into one claim, so either gate can gain a root without the other. In
  template mode (the `.sekai-template`
  marker) both scan the whole repository. Test fixtures are code, Worker source is code,
  and so is
  agent-executed skill prose. `scripts/ci/check-scan-root-docs.mjs` keeps every statement
  of those root sets, including this one, synchronized with the gates.
- **No build-time OG generation ever**; static default until the Phase 7 worker. The
  evidence is build-time and pipeline complexity, never dollars: upstream it cost a 12 GB
  Node heap and a ~120-minute build to render images for articles that are ~80-90% never
  shared (`dev_docs/research/platform-notes.md §1`). An argument that reaches for a cost
  saving finds none and concludes wrongly.
- **Corpus vectors and the search index are parsed once into worker global scope.** The
  free Workers plan caps V8 CPU per request, and parsing a corpus-sized JSON index consumes
  most of that budget on its own, so a per-request `JSON.parse` of the corpus is a defect,
  not a style preference. Measurements: `dev_docs/research/platform-notes.md §2.6`.
- **Site builds with `semiont/` deleted**; no organ reads another organ's files (ADR 003).
- **CI must run on pull requests**: gate + build jobs trigger on `pull_request`
  (the deploy job only on push to `main`), so every task PR gets CI.
- **Feature phases depend on the framework cut**: no instance features before the
  framework ships (ADR 002, held in instance #1's history; `Risk controls`).
- **Routines never push main directly** (Phase 11, ADR 005): every routine ships via a
  PR behind CI — `auto-merge-data` on green for data-only artifacts, `human-merge` for
  content. The dev-plugin iron rule (no work done outside a verified merge) applies to
  automation, not just humans.
- **A framework gate may not fail an adopter's build on ownership grounds** (ADR 010): in
  instance mode a check running in an adopter's repository exits nonzero only for something
  that harms a party other than the person editing — account-scoped collisions (a Worker
  `name`, a D1 `database_name` or `database_id`), committed credentials, and security
  boundaries. Every other divergence from a framework-owned file warns, names both values,
  and names the upgrade consequence. Template mode (the `.sekai-template` marker) is
  unaffected and stays fully fatal, because there the gate is protecting the framework's own
  shipped contract rather than policing someone else's repository. This binds gates that do
  not exist yet: a new check that blocks an adopter must first show the harm.
- **New `place.config` keys must be absent-safe**: a missing key means the feature is
  off; framework upgrades never require config surgery on existing instances.
- **Framework maintainer docs never ship to an adopter**: `npm run init` removes
  `dev_docs/PRD.md`, `dev_docs/SPEC.md`, `dev_docs/ROADMAP.md`, and `dev_docs/adr/`, and no file that
  survives adoption may link into them (ADR 008;
  `scripts/ci/check-framework-docs.mjs`).

## Change log

- **2026-08-10, ADR 010 adopter edit rights:** "framework-owned" is now a default and an
  upgrade contract rather than an access boundary, following the `dev_docs/PRD.md` §Non-goals
  amendment of the same date. Four statements moved: §Repo topology rule (d) (customization
  through config/content/media is the recommended route, not the only permitted one);
  §`place.config.ts` `workers?` (the identity half is named as account-scoped and stays fatal
  in both modes; the tuning half is explicitly not identity, and the LB-89 override block's
  justification is amended from "the only supported place" to "the preferred place");
  §Risk controls 4 (the control is visibility, not prohibition); §Negative requirements (a
  new bullet binding gates that do not exist yet).

  **What it invalidates.** `AGENTS.md` iron rule 3 as written, in the template and in every
  instance that carries its own copy — `merge=ours` means the reworded text reaches future
  adopters only, so the release carrying this needs a `CHANGELOG.md` **Upgrade note**.
  `scripts/ci/check-worker-config.mjs` has no mode branch and must gain one.
  `docs/runbook/UPGRADE.md`'s blind `for f in $(git diff --diff-filter=U); do git checkout
  --theirs ...` sweep is now actively wrong: it silently destroys the edits this decision
  licenses, which is why ADR 010 (f) removes it in the same change rather than deferring it.

  **What it does not change.** Template mode stays fully fatal. The identity half of the
  worker gate stays fatal in both modes. `place.config.ts` remains the preferred home for a
  retuned value. The `WORKER_VAR_OVERRIDES` registry is reused as the identity/tuning
  classification rather than a second one being introduced, so no new drift surface appears.

- **2026-07-28, ADR 008 docs ownership split:** this document was created by moving the
  framework sections of instance #1's SPEC into the framework repository, alongside a
  framework `dev_docs/PRD.md`, `dev_docs/ROADMAP.md`, and ADRs 003-007. The extraction map and
  inherited-fork disposition sections did not move. `npm run init` strips all four
  maintainer paths, `scripts/init/check-init.sh` asserts the strip on a really stripped
  tree, and `scripts/ci/check-framework-docs.mjs` gates dangling references plus the
  `merge=ours` and build-pipeline enumerations above.
- **2026-07-26, version ownership correction:** Sekai carries only
  `FRAMEWORK-VERSION`; adopters carry `VERSION` plus their adopted
  `FRAMEWORK-VERSION`. Each private npm manifest mirrors the repository's own release
  SSOT without the leading `v`. Adopter releases are explicit through `/sekai-release`;
  routine article PRs do not bump. `/sekai-upgrade` reconciles the manifests' mixed
  ownership. ADR 007 records the init, release, upgrade, and CI contracts.
- **2026-07-26, ownership correction:** `CHANGELOG.md` is instance-owned
  and records instance work only. The init wizard replaces the template's framework
  release log with an instance changelog. `/sekai-upgrade` reads framework release notes
  from the target tag and preserves the local changelog through `merge=ours`.
  `FRAMEWORK-VERSION` carries the attribute too, but the attribute alone does not hold
  it: a merge driver runs only on a three-way content merge, so an instance whose copy
  still equals the merge base has git resolve to theirs without consulting the driver.
  `/sekai-upgrade` therefore captures the pre-merge value in `package-state.mjs` and
  restores it immediately after the merge (amending the merge commit when git
  auto-committed), so the file still reads the old version until the explicit bump after
  successful verification — which asserts the result rather than assuming its write took
  effect. **That mechanic is a property of every `merge=ours` path, not of this one
  file** (corrected 2026-08-09, LB-88): an instance that kept a framework document
  verbatim has `ours == base` there too, so the attribute cannot fire, and keeping a
  framework document verbatim is the common adopter state. Both helpers therefore
  restore rather than assert — `package-state.mjs` for the version files,
  `maintainer-docs-state.mjs` for the `dev_docs/**` tree, which restores the pre-merge
  content of any file the merge moved under a path `git check-attr merge` reports as
  `ours` and amends the merge commit the same way. It still stops for an owned path the
  instance never marked `merge=ours`, because claiming a path is the instance's
  decision, and that diagnostic reports the attribute value and driver state it
  observed rather than assuming both are missing.
  `scripts/upgrade/check-upgrade-state.sh` is the gate for that contract: case 12 pins
  the version files and case 14 the maintainer-doc tree, with case 8 holding the
  `ours != base` half where the driver does fire.
- **2026-07-19, LB-44 delta:** added the dev-plugin state-persistence
  contract for framework upgrades. This corrects the false assumption that
  `.gitattributes merge=ours` preserves a deleted `.agent-toolkit/` path.
