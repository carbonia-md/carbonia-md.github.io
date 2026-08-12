# `npm run init` — the adoption wizard

The single writer of place identity. Interactive prompts (or a non-interactive
answers file) produce `place.config.ts` plus every adoption artifact; the same
answers always produce **byte-identical** output, whichever mode ran.

```sh
npm run init                                 # interactive
npm run init -- --answers answers.json       # non-interactive (the /sekai-adopt path)
npm run init -- --answers '{"place":{...}}'  # inline JSON also accepted
```

## What it writes

| Artifact | Behavior |
| --- | --- |
| `place.config.ts` | Regenerated in full from the answers. Single writer: the interactive and `--answers` paths share one resolution table and one serializer, so they cannot drift. |
| `knowledge/{Category}/` + `knowledge/INBOX.md` | Demo content is removed; one folder per chosen category (with `.gitkeep`) plus a fresh INBOX.md are seeded. |
| `CNAME` | Written with the domain. A `*.github.io` domain skips it (and removes a stale one) — GitHub Pages default domains must not carry a CNAME. |
| `AGENTS.md` | The instance's agent-instruction SSOT: place name/domain/tagline, the standard where-things-live / build / iron-rules sections, and the content working set. Read natively by Codex, and by Claude Code through the `CLAUDE.md` shim. Instance-owned; edit freely. |
| `CLAUDE.md` | A one-line `@AGENTS.md` shim so Claude Code inlines `AGENTS.md`. Instance-owned. |
| `CHANGELOG.md` | Replaces the framework release log with an instance-only changelog. Instance-owned; `/sekai-upgrade` reads framework notes from release tags instead. |
| `package.json` / `package-lock.json` | Rewrites the root package name and description for the adopter, keeps the package private, and sets the root package versions from the new adopter `VERSION` without its leading `v`. Scripts and dependencies remain framework-owned. |
| `VERSION` | The adopter's own release version, initialized to `v0.0.0`. Instance-owned and merge-protected. |
| `FRAMEWORK-VERSION` | The checked-out Sekai framework release this instance adopted. Instance-owned and merge-protected; `/sekai-upgrade` bumps it after verification. |
| `scripts/ci/genericity-denylist.local.txt` | The adopter's place name (lowercased, plus its no-space form) as **instance-owned** gate terms. `check-genericity.sh` reads this file additively; the framework denylist is never touched, so upgrades never conflict. Appends idempotently if the file already exists. |
| `.sekai-template` | Removed: the genericity/English-only gates revert from whole-tree (template mode) to code-trees-only (instance mode). |
| `.agent-toolkit/` | Removed, and the regenerated `AGENTS.md` carries no `@.agent-toolkit/dev.md` reference: a fresh instance ships zero dev-plugin state. That absence is **persistent instance state**, not a one-time deletion — `merge=ours` cannot protect a deleted path, so `/sekai-upgrade` classifies dev-plugin state before every merge and keeps it stripped (`docs/runbook/UPGRADE.md` §Dev-plugin state, and the dev-plugin decision record in the [framework repository](https://github.com/wilsonkichoi/sekai-kb)). Adopters who want the dev workflow opt in with `dev:setup`. |
| Framework maintainer docs | Removed: the framework's own product, architecture, and delivery documents plus its decision records. They describe how the framework is built, never how an instance is operated, so a fresh instance ships none of them. `docs/playbook/` (editorial canon) and `docs/runbook/` (operations) are **kept** — they are what you run the site with. The removal list is declared once, in `writer.mjs`; `npm run framework-docs` derives it from there and fails if anything an adopter keeps links into a removed path. |

**Re-run guard:** on an established instance (no `.sekai-template` marker and
articles already under `knowledge/`) the wizard aborts, because it reseeds
`knowledge/` with empty category folders. Pass `--force` to proceed anyway.

## Prompts

All prompts live in `prompt-table.mjs` as data rows — see "Extending" below.

| # | id | asks for | default |
| --- | --- | --- | --- |
| 1 | `place.name` | Place name (site wordmark) | *(required)* |
| 2 | `place.tagline` | One-sentence tagline | derived from name |
| 3 | `place.domain` | Domain (drives CNAME) | `<name-slug>.github.io` |
| 4 | `place.locale` | Locale code (`en` is the supported baseline) | `en` |
| 5 | `categories` | Preset menu (`coastal-town`, `city`, `small-town`) or custom entry; 5-14 categories, kebab-case slugs, reserved routes rejected | `coastal-town` |
| 6 | `map.center` | Leaflet center as `lat,lng` | *(required)* |
| 7 | `map.zoom` | Initial zoom (1-19) | `13` |
| 8 | `map.maxBounds` | Pan bounds as `south,west,north,east` | center ± 0.05/0.07° |
| 9-16 | `features.*` | One y/n per toggle: `graph`, `map`, `dashboard`, `soundscape`, `feedback`, `chat`, `social`, `analytics` | graph/map/dashboard on, rest off |
| 17 | `links.repo` | Instance GitHub repository URL | placeholder URL |
| 18 | `links.email` | Contact email | `hello@<domain>` |
| 19-21 | `links.social.*` | `twitter`, `threads`, `instagram` handles (blank = none; `@` added if missing) | none |

**Derived, never prompted:** `place.languages` = `[locale]`;
`seo.defaultOgImage` = `/og-default.png`; `seo.twitterHandle` mirrors the
Twitter handle when given; **`home.*` ships generic defaults** computed from
the place name and categories — no prompt walks the home-page copy. Replace it
by hand in `place.config.ts` (instance-owned), or let `/sekai-adopt` draft
place-specific copy behind the same human-approval gate as `/sekai-seed-articles`.

## Answers JSON (the `/sekai-adopt` contract)

Keys mirror the prompt ids (dot-paths). Any missing non-required key takes the
same default an interactive user gets by pressing Enter. Unknown **keys** (a
typo'd path is rejected, never silently defaulted) and malformed values are
hard errors (exit 1) — `/sekai-adopt` must not half-initialize.

```json
{
  "place": {
    "name": "Harborview",
    "tagline": "Open-source knowledge base for Harborview.",
    "domain": "harborview.example.com",
    "locale": "en"
  },
  "categories": "coastal-town",
  "map": {
    "center": [35.102, -120.658],
    "zoom": 13,
    "maxBounds": [[35.05, -120.72], [35.16, -120.58]]
  },
  "features": { "graph": true, "social": false },
  "links": {
    "repo": "https://github.com/example/harborview",
    "email": "hello@harborview.example.com",
    "social": { "twitter": "@harborview" }
  }
}
```

`categories` accepts a preset name (string) or a full array of
`{ slug, title, icon, description }`. Titles become `knowledge/{Title}/`
folder names, so path separators and control characters are rejected.
`place.name` and `map.center` are required; everything else defaults.

## Extending (schema-driven prompts)

Adding a future prompt — `features.mcp` (Phase 9), an analytics ID (Phase 10) —
is **a table entry in `prompt-table.mjs`, not new flow code**: add a row with
`id` (the config dot-path, which is also the answers-JSON path), `question`,
`kind` (`text`/`number`/`boolean`/`latlng`/`bounds`/`handle`/`categories`),
`default`, and optional `validate`. Both input modes, validation, and the
serializer pick the new field up from the row — including a row that opens a
**new top-level section** (e.g. `analytics.ga4`): the emitted config is
assembled from the resolved answers, not from a fixed key list, so nothing
else in the flow needs touching. The one companion edit is the `PlaceConfig`
declaration in **`place.config.ts`** (schema, not flow code) — `writer.mjs` holds
no copy of it, it re-emits the committed one, so a new prompt and its key are
edited in exactly two files. `npm run place-config:check` fails when they
disagree. New keys must follow the absent-safe spec rule: default to feature-off
when missing.

## Self-check (`npm run init:check`)

`check-init.sh` is the wizard's contract test, wired into CI (`init-check` job):

- **Tier 1** (always; non-destructive; tests the *committed* tree via
  `git archive HEAD`): runs `--answers` init on two scratch copies and
  byte-compares the two `place.config.ts` outputs; runs the **interactive**
  mode (piped stdin) with the same answers on a third copy and byte-compares
  it against the `--answers` output (the cross-mode no-drift contract);
  asserts every seeded artifact; asserts the maintainer-doc strip (four paths
  gone, both adopter doc trees kept) and re-runs that same predicate against
  planted inverse fixtures, requiring each to fail so an all-absent assertion
  cannot pass vacuously; plants a place-name string in `src/` and
  asserts the genericity gate fails via the local denylist, then passes once
  removed.
- **Tier 2** (`--build`; **destructive** — runs init in the current working
  tree, then `npm run build`): CI/disposable clones only.
