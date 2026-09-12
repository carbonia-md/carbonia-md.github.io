# PROGRESS.md — Italian-language support experiment

> Instance-only working tracker for adding `it` alongside `en` on carbonia-md.
> NOT an upstream pitch doc — see "Upstream Discussion Notes" at the bottom
> for what (if anything) gets raised with Wilson (sekai-kb owner) once this
> validates. This is a deliberate, informed override of
> `docs/playbook/ARTICLE-PLAYBOOK.md` §9 / `AGENTS.md`'s "Language support
> boundary," which currently says not to build on `place.locale`/
> `place.languages[]` yet — see Deferred / Non-goals.

## Status

| Milestone | Status | Notes |
|---|---|---|
| M1 — config schema, language registry, routing skeleton | ✅ done | see notes below |
| M2 — pilot article end-to-end | ☐ not started | |
| M3 — UI chrome translation | ☐ not started | |
| M4 — home-page copy + place.config.ts schema | ☐ not started | |
| M5 — derived-data script fixes | ☐ not started | |
| M6 — article-health locale-awareness | ☐ not started | |
| M7 — skills updates | 🔶 mostly done, out of order | done ahead of M2-M6 at user's request — see notes |
| M8 — remaining articles + full-site verification | ☐ not started | |

## Design Decisions Log

- **D1 — Routing shape:** `src/pages/` restructured under a rest-param
  folder, `src/pages/[...lang]/` — corrected during M1 from the originally
  planned `[[lang]]`, which isn't real Astro syntax (see M1 notes) — rather
  than per-language file duplication or a parallel `it/` tree. `en`
  unprefixed at `/`, `it` prefixed at `/it/...`. *Why:* one file serves every
  enabled language forever; a third language later is a config change, not
  more files. (2026-09-12)
- **D2 — `place.config.ts` locale-map + folder/display decoupling:**
  `categories[].title` and all `home.*` translatable copy become
  `Record<Lang, string>`. Filesystem-path consumers (`sync.sh`,
  `build-kb-index.mjs`, `build-related-tagoverlap.mjs`, `built-routes.ts`,
  `remarkWikilinks`) always read `.title.en`; display consumers read
  `.title[lang]` via a new `resolveLocale()` helper. *Why:* folder names are
  a filesystem identity, not a display concern — must never localize.
  (2026-09-12)
- **D3 — Hand-rolled i18n, not Astro's built-in `i18n` config:** extend
  `src/config/languages.ts` + `src/i18n/*`; do not add `astro.config.ts`'s
  `i18n` block. *Why:* avoids two competing routing/locale-detection
  mechanisms; this site needs static per-lang routes, not browser-locale
  redirects. (2026-09-12)
- **D4 — article-health locale vocab via check-level `lang` param:**
  `FileTarget.lang`, checks pick a vocab table keyed by `target.lang`,
  falling back to `en`. Rejected: per-language toml profiles (multiplies
  every future profile edit by N languages). (2026-09-12)
- **D5 — Translation-fidelity check is a new two-file comparison tool**
  (`scripts/tools/translation-fidelity.py`), not a bolt-on to the one-file
  article-health check API. Feeds a new "Phase T" in
  `FACTCHECK-PIPELINE.md`, replacing Phase 3/4 for translations. New
  `translatedFrom` frontmatter field. (2026-09-12)
- **D6 — RSS stays English-only** this round — explicit non-goal, not a
  silent gap. (2026-09-12)
- **D7 — SEO hreflang alternates:** found during exploration (not in the
  original ask); needed for correctness once two languages exist. Folded
  into M3/M4. (2026-09-12)

## Milestone detail

### M1 — Config schema, language registry, routing skeleton ✅
**Goal:** `it` recognized everywhere in config/routing; `en` behavior
byte-identical to today; no `it` content exists yet.

**Scope adjustment made during execution:** deferred the `place.config.ts`
locale-map schema change (`categories[].title`/`home.*` → `Record<Lang,
string>`) entirely to M4, instead of landing it here with placeholder values.
Reason: converting those types in M1 would force every consumer
(home/category-hub templates, nav, `sync.sh`, `built-routes.ts`) to switch to
`resolveLocale()` in the *same* commit to keep building — that's real M4
work, not a placeholder. M1 instead only added `languages: ['en','it']`;
category/home copy stays plain English strings (rendered as-is on `/it/`
until M3/M4 land translated chrome and copy). This is a sequencing fix, not a
scope cut — D2 is unchanged, it just lands in M4 as originally described
there.

**Routing correction found during implementation:** the plan's D1 called for
an Astro `[[lang]]` "optional dynamic segment." That syntax does not exist in
Astro's file-based router (confirmed by reading `astro/dist/core/routing/
parts.js`'s route-segment parser directly — `[[lang]]` parses as a dynamic
segment named literally `"[lang"`, not an optional `lang` param, and fails at
build time with `Missing parameter: lang`). The working equivalent is a rest
param folder, **`[...lang]`**: `getStaticPaths` still returns `{params:
{lang: undefined}}` for the default language and `{params: {lang: 'it'}}`
for others, exactly as planned — only the folder name differs
(`src/pages/[...lang]/...`, not `src/pages/[[lang]]/...`). No other design
decision changed.

**Second bug found:** a helper function (`loadRelatedData`) defined inline in
a page's frontmatter script, alongside but outside `getStaticPaths`, silently
vanished from the prerendered build (`ReferenceError: loadRelatedData is not
defined`) with no compile-time warning. Cause: `getStaticPaths` runs in an
isolated scope that can only see file imports, not sibling top-level
declarations in the same frontmatter — an easy trap since nothing flags it
until runtime. Fixed by moving it to `src/lib/related-data.ts` and importing
it. Worth remembering for any future page-level helper.

File checklist:
- [x] `place.config.ts` — `place.languages: ['en','it']` only (schema change deferred to M4, see above)
- [x] `src/config/languages.ts` — appended `it` entry
- [x] `src/i18n/utils.ts` — real `getLangFromUrl` (parses the first path segment against `ALL_LANGUAGE_CODES`)
- [x] `src/lib/locale.ts` (new) — `resolveLocale()` (unused until M4, added now since it's small and related)
- [x] `src/lib/lang-static-paths.ts` (new) — shared `getStaticPaths` for the 12 pages with no dynamic params of their own
- [x] `src/lib/related-data.ts` (new) — extracted from `[slug].astro` per the scope bug above
- [x] `src/content.config.ts` — collections derived from `ENABLED_LANGUAGE_CODES` via `Object.fromEntries`
- [x] `scripts/core/sync.sh` — always `mkdir -p` the per-lang `src/content/{lang}` dir (even with no source yet — the Astro collection needs the base dir to exist)
- [x] `src/pages/**` — restructured under `src/pages/[...lang]/` (16 → 14 moved files; `404.astro`, `rss.xml.ts`, `feed.xml.ts` stay at root, unprefixed, per D6/404 convention)
- [x] `[category]/[slug].astro`, `[category]/index.astro` — cross-product lang × existing params in `getStaticPaths`
- [x] `graph.astro` — `getCollection(lang)`, Hub-wikilink dir resolution now reads `knowledge/{lang}/{folder}` for non-default langs
- [x] `system.astro` — trivial `getStaticPaths` addition (no collection use)
- [x] 8 hardcoded `getCollection('en')` sites fixed: `[slug].astro`, `[category]/index.astro`, `graph.astro`, `soundscape.template.astro`, `chat.template.astro`, `explore.template.astro` (added `lang` derivation, had none before) — `feed.ts` intentionally left `en`-only per D6, now commented as intentional
- [x] `src/templates/category-hub.template.astro` — found and fixed a pre-existing `const lang: Lang = 'en'` stub (dead code from the original en-only trim) that would have silently ignored the real URL language forever
- [x] `src/utils/git-info.ts` — `getGitInfo()` gained a `lang` param (git-info keys are path-based and need the `{lang}/` prefix for non-default languages)
- [x] `src/lib/built-routes.ts` — `builtRoutes()`'s `pagesDir` default now points at `src/pages/[...lang]`; doc comments updated. `knowledgeCollectionIds()` deliberately left en-only for now (only consumer is the `qr:sheet` tool, out of core pipeline scope) — noted as a deferred item below.
- [x] `scripts/tools/qr-sheet.mjs` — updated its explicit `pagesDir` argument to match
- [x] `scripts/tools/lib/article_health/checks/link_target.py` — `EDITORIAL_REF` path string updated to the new page path (caught by `tests/article_health/test_editorial_refs.py`)

Verification (all run, all green):
- `npm run sync && npm run build` — 42 pages built (was ~21 pre-change), both
  `en` (unprefixed) and `it` (prefixed) route trees present. `it` pages
  currently render with 0 articles and English chrome/copy (no `it` content,
  `ui.it`, or translated `place.config.ts` copy yet — all expected, land in
  M2-M4).
- `npm run postbuild` — smoke/internal-links/map-markers/graph/dashboard/sounds all pass.
- `npm run test` (frontmatter validation) — 7/7 files OK.
- `npm run place-config:check` — passes.
- `npm run genericity` — passes (Italian scaffolding introduces no
  place-specific strings or CJK into the scanned code trees).
- `uv run pytest tests/article_health` — 322/322 passed after the
  `link_target.py` ref-path fix.
- `npm run test:snippet`, `npm run test:soundscape` — pass. `npm run
  test:feedback` fails on a pre-existing, unrelated environment issue
  (Playwright browser binary not installed locally) — not a regression from
  this work; feedback is a disabled feature (`features.feedback: false`) in
  this instance regardless.

**Gaps knowingly left for later milestones (not oversights):**
- No visible language switcher in `Header`/`Footer` yet — a reader has no UI
  way to move between `/` and `/it/` (only a direct URL edit works). Belongs
  naturally with M3's UI-chrome work; wasn't in the original exploration
  findings so is called out here explicitly.
- `<html lang="en">` is hardcoded on every page, `/it/` included —
  `Layout.astro`'s `lang` prop is never threaded from a page's resolved
  `lang`. Deferred to M3 alongside D7's hreflang work, since both are the
  same "thread `lang` through `<Layout>`/`<SEO>`" pass.
- `knowledgeCollectionIds()` (`built-routes.ts`) and the `qr:sheet` tool stay
  en-only; not part of the core build/test pipeline, low priority.

### M2 — Content collection + pilot article end-to-end
**Goal:** one real Italian article renders correctly through the full
pipeline.

- [ ] `knowledge/it/Food/la-lanterna.md` — AI-drafted pilot translation
- [ ] `build-related-tagoverlap.mjs` — stub `it.json` output
- [x] `[...lang]/[category]/[slug].astro` — related-data loading is already
      lang-parameterized (`src/lib/related-data.ts`, landed in M1 as a
      byproduct of the scope bug noted there); this milestone only needs the
      actual `knowledge/it/Food/la-lanterna.md` translation + the stub `it.json`

Verification: `npm run sync` projects the file correctly; `npm run build`
renders `/it/food/la-lanterna`.

### M3 — UI chrome translation
**Goal:** all `src/i18n/ui.ts` keys have an `it` counterpart.

- [ ] `src/i18n/ui.ts` — `ui.it = {...}`
- [ ] audit `useTranslations(lang)` call sites
- [ ] `src/components/SEO.astro` — hreflang alternates (D7)
- [ ] `scripts/ci/check-i18n-parity.mjs` (new)

Verification: parity script passes; Italian chrome renders on `/it/...`.

### M4 — Home-page copy + place.config.ts schema
**Goal:** home page + category copy renders translated on `/it`.

- [ ] `place.config.ts` — real Italian copy (replaces M1 placeholders)
- [ ] consumers switched to `resolveLocale()`
- [ ] re-confirm D2 hard rule held everywhere

Verification: `npm run sync` still finds all 7 en articles; `/it/` shows
Italian home copy.

### M5 — Derived-data script fixes (all of them)
- [ ] `build-kb-index.mjs`
- [ ] `build-related-tagoverlap.mjs` (full fix, replaces M2 stub)
- [ ] `build-map-markers.mjs`
- [ ] `check-graph.mjs`
- [ ] `generate-changelog-data.mjs`
- [ ] `test-frontmatter.mjs`
- [ ] `build-dashboard-lite.mjs`

Verification: each script surfaces the `it` pilot article like an `en` one.

### M6 — article-health locale-awareness
- [ ] `loader.py::_derive_meta_from_path` fix + `FileTarget.lang`
- [ ] `article-health.py::_get_all_source()` fix
- [ ] `prose_health.py`, `chronicle_lead.py`, `format_structure.py` — it vocab
- [ ] `word_count.py`/`paragraph_rhythm.py` threshold audit
- [ ] `test_loader.py` — it coverage

Verification: pytest suite passes; `--all --profile=dashboard` reports it
article correctly.

### M7 — Skills updates 🔶
**Landed out of sequence, at user's request, before M2-M6.** The skill
workflows exist and the site still builds clean, but they're mostly
*untested against real content* — no `it` article exists yet (that's
M2/M8), so "dry-run against the M2 pilot pair" couldn't happen yet. Treat
this as designed-and-wired, not yet exercised.

- [x] `docs/playbook/REWRITE-PIPELINE.md` — added translation as a third
      Stage 0 mode; Stage 1 skipped for it; Stage 2's target path and
      `translatedFrom` field; Stage 3 replaced with a translation-fidelity
      self-audit (or escalate to `/sekai-factcheck`'s new mode); Stage 4-5
      noted as mode-agnostic with the `{lang}/` path insert.
- [x] `docs/playbook/FACTCHECK-PIPELINE.md` — added a "Translation Fidelity"
      row to the Modes table and a full **Phase T** section (replaces Phase
      3/4 for this mode; Phases 1, 2, 5, 6 still run against the article
      pair). Added a `TRANSLATION-DRIFT` triage bucket to Phase 6 and folded
      it into the hard ship gate.
- [x] `.agents/skills/sekai-write/SKILL.md` — reads `place.languages` now;
      translation trigger phrases added; writes to
      `knowledge/{lang}/{Category}/{slug}.md` for translations (folder name
      itself never localizes — flagged explicitly, since that's the exact
      D2 hard rule a translation workflow could easily violate by accident).
- [x] `.agents/skills/sekai-factcheck/SKILL.md` — Translation Fidelity mode
      added alongside Quick/Full; reports the new `TRANSLATION-DRIFT` bucket.
- [x] `src/content.config.ts` — `translatedFrom: z.string().optional()`
      added to `articleSchema`.
- [x] `docs/playbook/ARTICLE-PLAYBOOK.md` §4.0 — `translatedFrom` documented
      in the optional-fields list.
- [ ] `sekai-validate` — **not yet confirmed working end-to-end.** It should
      Just Work once M6 fixes `article_health/loader.py`'s category-
      derivation bug, but that bug is still live — running
      `article-health` against a real `knowledge/{lang}/...` file today
      would mis-derive its category (see M6). Nothing to change in the
      skill itself; this is a real dependency on M6, not a checklist item
      to skip.
- [ ] `sekai-seed-articles` gap noted (deferred, per original plan — lower
      priority, used for initial seeding not translation).

Verification so far: `npm run build`, `npm run postbuild`, `npm run test`,
`npm run genericity`, and the article-health pytest suite (322/322) all
still pass after the schema/doc changes above — confirms nothing broke, not
that the new workflows produce a correct translation yet. Real
verification (dry-running `/sekai-write` in translate mode, then
`/sekai-factcheck` in Translation Fidelity mode, against a real article) is
M2's job, next.

### M8 — Remaining articles + full-site verification
- [ ] 6 remaining articles translated + human-reviewed
- [ ] `capture-baseline.mjs` loops all enabled langs
- [ ] full `npm run build` + post-build checks green

Verification: `npm run test`, `npm run article-health -- --all
--profile=ci-deploy`, `npm run build`, `npm run genericity` all green; 14
articles in dashboard; hreflang present; RSS still en-only.

## Deferred / Non-goals

- Per-language RSS feeds (D6).
- Astro built-in `i18n` config (D3).
- `ARTICLE-PLAYBOOK.md` §9 / `AGENTS.md` "Language support boundary" wording
  update — deferred until this experiment validates, not a precondition for
  doing the work.
- `sekai-seed-articles` translate-awareness (M7) — lower priority, used for
  initial seeding not translation.

## Upstream Discussion Notes (scratch)

_Running list of things worth raising with Wilson once this validates —
not a pitch doc, just notes as we go._

-
