# Carbonia

Knowledge base for **Carbonia** (alusci.github.io), built on the
[sekai-kb](https://github.com/wilsonkichoi/sekai-kb) framework. Open-source, AI-friendly knowledge base for Carbonia.

This file — **`AGENTS.md`** — is the single source of truth for agent instructions
in this instance, for **every** agent CLI: codex-cli reads it natively, and Claude
Code reaches it through a one-line `@AGENTS.md` shim in `CLAUDE.md`.

> This file is **instance-owned** (`merge=ours` in `.gitattributes`): framework
> upgrades never overwrite it. Edit it freely to describe your instance.

## Where things live

- **Place identity (the one file to edit):** `place.config.ts` — name, tagline,
  domain, categories, map, feature toggles, links, and home-page copy.
- **Content (single source of truth):** `knowledge/{Category}/*.md` — plain Markdown.
  Everything the site renders is derived from this at build time.
- **Media:** `public/media/` and other `public/` assets.
- **Instance history:** `CHANGELOG.md` records changes to this instance only.
  Framework release notes remain in immutable `sekai-kb` tags.
- **Versions:** `VERSION` is this instance's release SSOT. `FRAMEWORK-VERSION`
  records the adopted Sekai release. `package.json.version` mirrors `VERSION`
  without the leading `v`.

## How the site builds

`knowledge/` → `sync.sh` → parallel prebuild (kb-index, search, content-dates,
git-info, related, changelog, map-markers, dashboard-lite) → `astro build` →
post-build contract checks. `src/content/` and `src/data/` are derived, gitignored
projections of `knowledge/` — never edit them directly.

## Iron rules

1. **SSOT:** `knowledge/` is the only content source of truth; `src/content/` is
   derived (gitignored, written by sync) and never edited directly.
2. **Genericity + English-only:** zero place-specific strings and zero CJK/multi-language
   code paths in any code tree; test fixtures are code, and so are the framework
   skills. Place identity flows only from `place.config.ts` + `knowledge/` +
   `public/media/`. Machine-gated by `npm run genericity`, whose two gates each carry
   their **own** roots: `scripts/ci/check-genericity.sh` (place-name denylist) scans
   `src/`, `scripts/`, `tests/`, `workers/`, `.agents/skills/`;
   `scripts/ci/check-english-only.mjs` (CJK codepoints) scans `src/`, `scripts/`,
   `tests/`, `workers/`, `.agents/skills/`; the two lists agree today but are stated
   separately, and a gate skips any of its roots that this instance does not have.
3. **Framework vs instance:** `src/`, `scripts/`, `workers/`, and
   `.agents/skills/` are framework-owned — the framework ships them and every release
   replaces them wholesale. That is a **default and an upgrade contract, not an access
   boundary**: this is your repository and you may edit any file in it. The recommended
   routes are still the cheap ones — customize through `place.config.ts`,
   `knowledge/`, and `public/media/`, and upstream anything larger to sekai-kb so it
   comes back as a tagged release and stops conflicting. What a direct edit costs is a
   merge conflict on that file at the next `/sekai-upgrade`, and the framework says so
   rather than preventing it: a gate running here fails your build only for something
   that harms someone other than you — account-scoped collisions (a Worker `name`, a
   D1 `database_name`), committed credentials, security boundaries. Every other
   divergence warns, names both values, and names that cost
   (`docs/runbook/UPGRADE.md` §Framework-owned files). The genericity gate remains the
   structural guarantee for rule 2, which is a different rule and stays fatal.

## Skill discovery

Codex discovers project skills natively from `.agents/skills/*/SKILL.md`. Claude
Code must discover them from the same path by reading each file's YAML `name` and
`description`, then load the full file when the user names a skill or the request
matches its description. The framework-owned skills use the `sekai-` prefix to
avoid collisions with instance and tool-provided skills.

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
