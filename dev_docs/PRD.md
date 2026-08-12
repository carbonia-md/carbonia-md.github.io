# PRD: Sekai KB

**Framework maintainer document.** This is the product-intent SSOT for **sekai-kb**, the
knowledge-base framework. Architecture and implementation contracts live in
`dev_docs/SPEC.md` and `dev_docs/adr/`; phase order and task blocks live in `dev_docs/ROADMAP.md`.
Conflicts resolve per the precedence rule in `.agent-toolkit/dev.md`.

> **Stripped at adoption.** `npm run init` removes this file along with `dev_docs/SPEC.md`,
> `dev_docs/ROADMAP.md`, and `dev_docs/adr/`. It describes the framework's own product intent,
> not an adopted instance's. Adopters keep `docs/playbook/` and `docs/runbook/`, and
> write their own product docs if they want them (ADR 008).

## Goal

**Sekai KB** is a framework for standing up a design-quality, AI-native knowledge base
about a place: curated articles across a configured category set, a knowledge graph, a
map, and static knowledge endpoints that any AI can consume without cloning the
repository. Brand: Sekai, the Japanese word for "world" — the framework is the
world-level system, and each adopted instance is one place in it (ADR 002, held in
instance #1's history).

An adopter goes from a fresh clone of the GitHub template to a configured, seeded,
deployed site in under an hour, and keeps that site maintainable at a real editorial bar
with any agent CLI. The framework is generic by construction: nothing sekai-kb ships
carries place identity in a code tree, and that guarantee is machine-enforced over the
whole template rather than asserted. It binds what the framework **delivers**, never what
an adopter subsequently does in their own repository (see Non-goals).

## Why

The framework was cut from a working instance, not designed in the abstract, and the
sequencing was itself a decision (ADR 002):

- **Framework-first with zero instances repeats the coupling mistake in mirror image.**
  A framework with no live consumer accumulates features no one needs and abstractions
  nothing tests. sekai-kb was extracted from a running site at Phase 5, after four phases
  of building that site, so every abstraction had a real consumer before it was generic.
- **Instance-first with "extraction later" is the deferral trap.** The extraction was a
  numbered phase, sequenced ahead of the features the maintainer personally wanted most,
  with genericity CI-enforced from day one rather than cleaned up at cut time.
- **The cost being avoided is structural, not incidental.** The predecessor codebase was
  a fork of a knowledge base built for a different place. Its last upstream merge took
  three phases of place-removal work and left dozens of files still hardcoding place
  strings. That maintenance cost was unbounded; a bounded extraction plus a tagged-release
  upgrade discipline (ADR 004) replaces it.

## Who adopts it

| Adopter | What they get |
|---|---|
| A person or group publishing knowledge about one place | GitHub template + `/sekai-adopt` AI interview → configured, seeded, deployed site in under an hour (SPEC `New builds`); the editorial playbook and quality tooling that keep it good afterward; full edit rights over their own clone, with the upgrade cost of an edit stated rather than blocked |
| Readers of an adopted instance | Curated, fact-checked local knowledge at the inherited editorial bar; graph, map, and client-side search |
| AI consumers of an adopted instance | `/llms.txt` → `/kb/topics.json` → `/kb/articles/{slug}.md`: a lazy-loading knowledge protocol, one HTTP request per article, no clone required (SPEC `Build pipeline`); tool-using MCP clients reach the same corpus over one remote MCP connection (`workers/mcp/`, Phase 9, ADR 005) |
| Instance contributors | Plain-Markdown SSOT under `knowledge/`, quality tooling (article-health, link and frontmatter checks), and a tracker-driven contribution workflow |
| Instance operators | An optional autonomous operations layer (Phase 11 routines) that maintains the instance without burnout, shipping only through verified PR merges |
| Framework maintainers | One template repository, an immutable-tag release train, and a genericity gate that fails CI rather than a convention that erodes |

## North star

Phase-gated proof points rather than a single metric. Each is a ROADMAP exit gate:

- **Adoption:** a fresh clone through the `/sekai-adopt` interview to five AI-seeded
  articles deployed on GitHub Pages in under one hour, executed for real against a place
  the framework was never built for. Proven at the framework cut and re-proven whenever
  the adoption path changes.
- **Upgrade:** an instance adopts each framework release by merging an immutable tag,
  cleanly, with instance-owned files untouched and `FRAMEWORK-VERSION` bumped only after
  the merged site verifies (ADR 004; part of every phase's exit gate).
- **Genericity:** the machine gates pass in template mode over the whole tree, so the
  template provably ships zero place-specific strings and zero CJK codepoints.
- **Operations (extension, ADR 005):** two autonomous routines live for at least one week,
  shipping only via verified PR merges with zero direct pushes to main.

## Non-goals

Non-goals bound the product; they never shrink a task. If a task packet's DoD appears
to conflict with a non-goal, surface the conflict to the maintainer (per
`.agent-toolkit/dev.md`), never silently trim the packet.

- **No paid hosting or infra services** (SPEC `Deployment`): GitHub Pages + Cloudflare
  free tier + Workers free tier only. AI compute for development and Phase-11 routines
  rides an existing Claude subscription or API budget — the same cost class as the
  development process itself, not an infra service (ADR 005).
- **No direct-push automation**: routines never bypass the PR + CI gate; the inherited
  fork's push-to-main routine model is explicitly not adopted (ADR 005).
- **No fork continuation and no upstream merging** — improvements to the codebase the
  framework was extracted from are deliberate idea cherry-picks, never merges.
- **No build-time OG generation, ever** — a static default image until the Phase 7
  on-demand worker (SPEC `Build pipeline`).
- **Not carrying the inherited fork's scale machinery**: the four-tier translation
  cascade, batch translation system, place-politics data-viz pages, and social-harvest
  apparatus are deleted or rebuilt from concept. That disposition is instance #1's
  rebuild history and stays in its repository.
- **No framework features for hypothetical adopters**: a framework feature exists only if
  a real instance uses it or it is one of the named adopter needs; everything else waits
  for a second real adopter to ask (SPEC `Risk controls`). "A future adopter might want
  it" is never a reason to build or retain a feature.
- **English-only through the current roadmap**: the framework ships English-only — no
  CJK or multi-language code paths, language profiles, or CJK test fixtures anywhere in
  committed code or tests (`src/`, `scripts/`, `tests/`, `workers/`, `.agents/skills/` —
  the whole project, never a single-directory reading). Test fixtures are code, and so
  are agent-executed skills. Multi-language support is a post-project revisit, built
  fresh at that time. For adopters the boundary is documented, not coded around: tooling
  is English-calibrated, Latin-script content largely works, CJK is unsupported until
  that revisit — stated plainly in the adopter docs.
- **Semiont is optional**: the site must build with the `semiont/` directory deleted;
  every organ beyond the minimal core is opt-in (ADR 003).
- **The framework does not own an instance's content, identity, or history.** Place
  identity flows only through `place.config.ts`, `knowledge/`, and `public/media/`; an
  instance's changelog, version, and agent instructions are instance-owned and survive
  every upgrade (ADR 006, ADR 007).
- **The framework does not police an adopter's own repository.** The complement of the
  bullet above — `src/`, `scripts/`, `workers/`, `.agents/skills/` — is framework-owned as
  a **default and an upgrade contract**, never as an access boundary. An adopter may edit
  any file in their own clone. What the framework owes them is the cost, stated where it
  applies: a hand-edit to a framework-owned file conflicts at the next tag merge, and
  `/sekai-upgrade` is what reconciles it. **CI in an adopted instance blocks only what
  harms someone other than the person editing** — account-scoped collisions (a Worker
  `name`, a D1 `database_name`), committed credentials, security boundaries. Deploy-time
  tuning an instance legitimately differs on, such as a retrieval relevance floor or a
  rate-limit ceiling, warns and names the upgrade cost; it never fails the adopter's
  build. Upstreaming a change to sekai-kb stays the **recommended** route because it buys
  conflict-free upgrades, not because the local edit is forbidden.

## Change log

- **2026-08-10, LB-92 adopter edit rights:** "framework-owned" is now stated as a default
  plus an upgrade contract rather than an access boundary, with a single dividing line for
  machine enforcement — **block only what harms someone other than the person editing**.
  Three sections moved: §Goal now scopes the genericity guarantee to what the framework
  delivers (the North star already scoped its proof to template mode, so the two now
  agree); §Who adopts it records the edit right as something an adopter gets; §Non-goals
  gains the policing bullet above.

  **Why.** `scripts/ci/check-worker-config.mjs` holds every committed
  `workers/*/wrangler.toml` to framework constants, has no template-mode branch, and runs
  in the `genericity` job of the `deploy.yml` an adopter inherits — so an adopter who
  retunes `RELEVANCE_FLOOR` in their own repository gets a red build in their own
  repository, and the workflow comment says that is intended. That gate conflates
  account-scoped deployment identity, which is a real collision concern, with deploy-time
  tuning constants, which are numbers an instance may legitimately measure differently. It
  also charges the cost at the wrong time: the actual cost of a hand-edit is a merge
  conflict at the next `/sekai-upgrade`, which is later, cheaper, and now LLM-assisted.

  **Scope check performed before this entry.** The other gates in the inherited workflow
  are not in this class and are unchanged: `check-genericity.sh` reads a static denylist of
  pre-cut place names and never derives the adopter's own place name, so it is effectively
  a no-op in an instance (its one instance-owned hook,
  `scripts/ci/genericity-denylist.local.txt`, is additive by design);
  `check-framework-docs.mjs` already has an instance-mode branch; the ROADMAP exit-gate
  guard is template-mode only. `check-english-only.mjs` does block an adopter, but for the
  separately stated English-only non-goal with its post-roadmap revisit, not for ownership.

  **What it invalidates.** `dev_docs/SPEC.md` §Repo topology ownership rule (d), the
  §`place.config.ts` `workers?` note (which fuses identity and tuning into one
  prohibition), §Risk controls 4, and §Negative requirements. `AGENTS.md` iron rule 3 as
  written. The `dev_docs/ROADMAP.md` blocks are unaffected.

  **Handed to `/dev:architect`** (parked here as product-level, decided there): how the
  gate splits identity from tuning; where the warning is delivered (CI annotation, upgrade
  time, or both); what "reconcile intelligently" means concretely in `/sekai-upgrade` and
  whether that half is its own task; ADR 010 recording the decision. Two delivery
  constraints travel with it — `AGENTS.md` is instance-owned (`merge=ours`), so a reworded
  iron rule reaches future adopters only and existing instances need a `CHANGELOG.md`
  Upgrade note; and `WORKER_VAR_OVERRIDES` in `scripts/deploy/wrangler-config.mjs`, merged
  with LB-89, already encodes the identity-versus-tuning classification, so it does not
  need inventing.

  **Downstream tasks.** LB-92 returns to `/dev:backlog` for a packet once `/dev:architect`
  lands the SPEC delta and ADR 010. LB-91 is parked behind LB-92 in `Backlog`: it argues
  for a structured `place.config.ts` override on the grounds that a hand-edit is
  forbidden, and this entry changes that premise.
