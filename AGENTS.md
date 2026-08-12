# Marisol Cove (sekai-kb demo instance)

Knowledge base for the fictional coastal town of **Marisol Cove** — the demo place
that ships with the **sekai-kb** framework template. Built with Astro; content is
plain Markdown under `knowledge/`. Replace this demo with your own place by running
`npm run init` (or the `/sekai-adopt` skill).

This file — **`AGENTS.md`** — is the single source of truth for agent instructions
in this repository, for **every** agent CLI: codex-cli reads it natively, and Claude
Code reaches it through a one-line `@AGENTS.md` shim in `CLAUDE.md`. Everything an
agent needs is here: where things live, how the site builds, the iron rules (SSOT,
genericity + English-only, framework vs instance), the language support boundary,
the semiont probe, and the content working set.

> This file is **instance-owned from clone time** (`merge=ours` in
> `.gitattributes`): framework upgrades never overwrite it. Edit it freely to
> describe your instance and how your agents should work in it.

## Where things live

- **Place identity (the one file to edit):** `place.config.ts` — name, tagline,
  domain, categories, map, feature toggles, links, and home-page copy.
- **Content (single source of truth):** `knowledge/{Category}/*.md` — plain Markdown.
  Everything the site renders is derived from this at build time. Article ideas
  queue in `knowledge/INBOX.md`.
- **Soundscape manifest:** `knowledge/sounds/_manifest.md` — the `/soundscape`
  entries. Not an article: the leading `_` is what makes the three scanners that
  walk `knowledge/` skip it, so never rename it without one.
- **Media:** `public/media/` and other `public/` assets. Soundscape audio lives
  under `public/media/sounds/`; the template's three clips are synthesized demo
  content and the init wizard removes them.
- **Cloudflare Workers:** `workers/*/` — one directory per worker, each with its own
  `wrangler.toml` (placeholders only), `migrations/`, and `node:test` suite. Deployed
  by hand, never by CI; see [DEPLOY.md §Cloudflare Workers](docs/runbook/DEPLOY.md).
- **Editorial canon:** `docs/playbook/` — [ARTICLE-PLAYBOOK.md](docs/playbook/ARTICLE-PLAYBOOK.md)
  (voice, structure, quality bar), [REWRITE-PIPELINE.md](docs/playbook/REWRITE-PIPELINE.md)
  (the write/rewrite process), [FACTCHECK-PIPELINE.md](docs/playbook/FACTCHECK-PIPELINE.md)
  (fact-check methodology).
- **Operations:** `docs/runbook/` — [DEPLOY.md](docs/runbook/DEPLOY.md) covers
  install and deployment, [UPGRADE.md](docs/runbook/UPGRADE.md) covers framework
  adoption, and [RELEASE.md](docs/runbook/RELEASE.md) covers explicit adopter
  releases.
- **Change history:** this template's `CHANGELOG.md` records framework releases.
  `npm run init` replaces it with an instance-owned changelog for adopter work.
- **Versions:** this template has only `FRAMEWORK-VERSION`, the Sekai release SSOT.
  Init creates adopter `VERSION`. In each repository, `package.json.version`
  mirrors its own release SSOT without the leading `v`.
- **Engineering rules:** `.agent-toolkit/rules/` — framework-owned lessons that keep
  the build green (Astro/Vite gotchas, prebuild ordering, shell portability,
  lockfile). Dev-plugin state, indexed in `.agent-toolkit/dev.md`; stripped from
  adopter clones by the init wizard, and kept stripped by every later framework
  upgrade (`docs/runbook/UPGRADE.md` §Dev-plugin state).

## How the site builds

`knowledge/` → `sync.sh` → parallel prebuild (kb-index, search, content-dates,
git-info, related, changelog, map-markers, dashboard-lite) → `astro build` →
post-build contract checks. `src/content/` and `src/data/` are derived, gitignored
projections of `knowledge/` — never edit them directly.

## Writing an article

Read [docs/playbook/ARTICLE-PLAYBOOK.md](docs/playbook/ARTICLE-PLAYBOOK.md) first,
then follow [REWRITE-PIPELINE.md](docs/playbook/REWRITE-PIPELINE.md) stage by stage.
The short loop: draft in `knowledge/{Category}/{slug}.md` → self-check against the
playbook's quality gate →
`npm run article-health -- <file> --profile=ci-deploy` (the mandatory ship gate;
for a media-complete depth article also run the `--profile=rewrite-stage-4`
self-check per [ARTICLE-PLAYBOOK.md §7.4](docs/playbook/ARTICLE-PLAYBOOK.md)) →
`npm run sync` → `npm run build` → commit (the pre-commit hook re-validates staged
content).

## Iron rules

1. **SSOT:** `knowledge/` is the only content source of truth; `src/content/` is
   derived (gitignored, written by sync) and never edited directly.
2. **Genericity + English-only:** zero place-specific strings and zero CJK/multi-language
   code paths in any code tree; test fixtures are code, and so are the framework
   skills. Place identity flows only from `place.config.ts` + `knowledge/` +
   `public/media/`. Machine-gated by `npm run genericity`, whose two gates each carry
   their **own** instance-mode roots: `scripts/ci/check-genericity.sh` (place-name
   denylist) scans `src/`, `scripts/`, `tests/`, `workers/`, `.agents/skills/`;
   `scripts/ci/check-english-only.mjs` (CJK codepoints) scans `src/`, `scripts/`,
   `tests/`, `workers/`, `.agents/skills/`; the two lists agree today but are never
   merged into one claim, so either gate can gain a root without the other. In
   template mode (the `.sekai-template`
   marker) both scan the whole repository. `scripts/ci/check-scan-root-docs.mjs`
   keeps every such statement in this repository true.
3. **Framework vs instance:** `src/`, `scripts/`, `workers/`, and `.agents/skills/`
   are framework-owned — the framework ships them and every release replaces them
   wholesale. That is a **default and an upgrade contract, not an access boundary**:
   this is your repository and you may edit any file in it. The recommended routes
   are still the cheap ones — customize through `place.config.ts`, `knowledge/`, and
   `public/media/`, and upstream anything larger to sekai-kb so it comes back as a
   tagged release and stops conflicting. What a direct edit costs is a merge conflict
   on that file at the next `/sekai-upgrade`, and the framework's job is to say so
   rather than to prevent it: a gate running in an instance fails the build only for
   something that harms a party other than the person editing — account-scoped
   collisions (a Worker `name`, a D1 `database_name`), committed credentials,
   security boundaries. Every other divergence warns, names both values, and names
   that cost (ADR 010; `docs/runbook/UPGRADE.md` §Framework-owned files). The
   genericity gate remains the structural guarantee for rule 2, which is a different
   rule and stays fatal. `CHANGELOG.md` becomes instance-owned at adoption; framework
   release notes remain available from immutable tags.

## Skill discovery and ownership

Codex discovers project skills natively from `.agents/skills/*/SKILL.md`. Claude
Code must discover them from the same path by reading each file's YAML `name` and
`description`, then load the full file when the user names a skill or the request
matches its description. Claude needs the explicit instruction because
`CLAUDE.md` delegates all project instructions to this file and the skills do not
live under Claude's default `.claude/skills/` path.

The skills under `.agents/skills/` — `/sekai-write`, `/sekai-validate`,
`/sekai-factcheck`, the `/sekai-kb` router, plus `/sekai-adopt`,
`/sekai-seed-articles`, `/sekai-snippet`, `/sekai-triage-feedback`,
`/sekai-upgrade`, `/sekai-release`, and the template-only
`/sekai-framework-release` — are
**framework-owned**, the same class as `src/` and `scripts/`. The `sekai-`
namespace prevents collisions with adopter and tool-provided skills. They are
managed through framework upgrades; customize them the way you customize `src/`:
through `place.config.ts`, `knowledge/`, and the playbook, not by editing the
skill bodies.

`/sekai-framework-release` is the sole template-maintainer skill. It hard-stops
after adoption when `.sekai-template` is absent; all other skills are adopter-facing.

- **Adding a skill is free.** A new skill is a new directory under
  `.agents/skills/`, so it never conflicts on `/sekai-upgrade`. The `/sekai-kb`
  router lists it automatically (it enumerates the directory, not a hardcoded set).
- **Overriding a framework skill** means either upstreaming the change to
  sekai-kb first (so every instance gets it), or accepting a conflict-managed
  local fork that `/sekai-upgrade` flags on each release.

Both machine gates (`npm run genericity`) scan `.agents/skills/` — agent-executed
prose is code for the genericity + English-only doctrine.

## Language support boundary

UI strings and editorial tooling are English-calibrated; Latin-script content
largely works (plain word tokenization; article-health prose thresholds may need
retuning per instance); CJK content is unsupported until the post-project
multi-language revisit. `place.locale` and `place.languages[]` are declared but
dormant schema seams — don't build on them.

## Semiont probe

`semiont/config.json` at the repo root configures the autonomous-organ layer
(memory, routines — arrives in a later framework release). Skills and scripts that
look for it must **no-op gracefully when it is absent**. It is absent in this
release; nothing should require it.

## Template mode

This repo carries a `.sekai-template` marker at its root, which switches the
genericity + English-only gates to scan the **whole tree** (so the template ships
zero real-place strings). `npm run init` removes the marker when you adopt the
template, reverting the gates to scanning the code trees only — your `knowledge/`
and `place.config.ts` then legitimately carry your place's identity.

## Content working set

Beyond the overview above, the working set for any agent session:

- **Writing or editing content:** follow
  [`docs/playbook/ARTICLE-PLAYBOOK.md`](./docs/playbook/ARTICLE-PLAYBOOK.md) and
  the stage sequence in
  [`docs/playbook/REWRITE-PIPELINE.md`](./docs/playbook/REWRITE-PIPELINE.md).
  Edit only `knowledge/` — never the derived `src/content/`.
- **Verifying claims:** [`docs/playbook/FACTCHECK-PIPELINE.md`](./docs/playbook/FACTCHECK-PIPELINE.md).
  Never fabricate a fact, a source, or a quote.
- **Build, toolchain, deploy commands:** [`docs/runbook/DEPLOY.md`](./docs/runbook/DEPLOY.md).
  Python tooling always runs through `uv` (`uv sync`, `uv run`); never `pip`.
- **Before committing:** `npm run test`, the relevant
  `npm run article-health -- <file> --profile=...` gate, and `npm run build`
  must pass. The pre-commit hook enforces a subset; don't rely on it as the
  first check.

<!-- dev-plugin:start — the init wizard (scripts/init) strips this block, and the
     .agent-toolkit/ tree it points at, from adopter clones. Framework state only. -->
## Framework development

This repository is developed with the **agent-toolkit dev plugin** (its own
task/PR/CI/review/verify lifecycle). Adopters do not need any of this — the init
wizard strips the `.agent-toolkit/` tree and the reference line below when you
adopt the template, so a fresh instance ships zero dev-plugin state.

**Framework maintainer docs** (ADR 008) live beside the code they govern, in
`dev_docs/`, and the whole directory is stripped at adoption in the same pass
(ADR 009 — one directory, so a document added later is on the correct side by
default):

- [`dev_docs/PRD.md`](dev_docs/PRD.md) — product SSOT: what the framework is for, who
  adopts it, north star, non-goals.
- [`dev_docs/SPEC.md`](dev_docs/SPEC.md) + [`dev_docs/adr/`](dev_docs/adr/) —
  engineering SSOT: architecture, contracts, risk controls, negative requirements,
  accepted decisions.
- [`dev_docs/ROADMAP.md`](dev_docs/ROADMAP.md) — delivery SSOT: the phase 6-11 task
  blocks `/dev:plan` converts packets from.
- [`dev_docs/diagrams/`](dev_docs/diagrams/) — architecture diagrams (draw.io), the
  engineering source of truth.
- [`dev_docs/research/`](dev_docs/research/) — the platform research the phase 7-11
  contracts were derived from, ported de-placed from the pre-cut instance.

`docs/playbook/` and `docs/runbook/` are adopter-facing and deliberately survive
adoption. `npm run framework-docs` gates the whole contract: the strip list is derived
from the wizard, and nothing an adopter keeps may link into a stripped path.

Dev workflow (agent-toolkit dev plugin): @.agent-toolkit/dev.md
<!-- dev-plugin:end -->
