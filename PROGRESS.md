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
| M2 — pilot article end-to-end | ✅ done (different pilot article) | see notes below |
| M3 — UI chrome translation | ☐ not started | |
| M4 — home-page copy + place.config.ts schema | ☐ not started | |
| M5 — derived-data script fixes | 🔶 1/7 scripts fixed | `test-frontmatter.mjs` done (via M2); rest open |
| M6 — article-health locale-awareness | 🔶 loader bug fixed | `_derive_meta_from_path`/`FileTarget.lang` done (via M2); it-vocab checks still open |
| M7 — skills updates | 🔶 mostly done, out of order | done ahead of M2-M6 at user's request — see notes |
| M8 — remaining articles + full-site verification | 🔶 6/6 remaining articles drafted, none human-reviewed | see notes below |

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

### M2 — Content collection + pilot article end-to-end ✅
**Goal:** one real Italian article renders correctly through the full
pipeline.

**Ran ahead of plan, via the newly-built `/sekai-write` translate mode** (at
user's request) and picked a different pilot: `knowledge/History/
founding-and-unraveling-of-carbonia.md` → `knowledge/it/History/
founding-and-unraveling-of-carbonia.md` (not the originally-planned
`Food/la-lanterna.md` — the user pointed the skill at the History article
directly; both are valid pilots, the History one is just longer/richer, a
better stress test).

- [x] `[...lang]/[category]/[slug].astro` — related-data loading was already
      lang-parameterized (`src/lib/related-data.ts`, landed in M1).
- [x] `knowledge/it/History/founding-and-unraveling-of-carbonia.md` —
      full translation via `/sekai-write`'s translation mode: frontmatter
      (title/description/tags/subcategory/imageAlt/rationale translated;
      `category: 'History'` kept in English, matching the folder-name rule;
      `translatedFrom: 'en'` set), full body, footnotes, image captions,
      Further Reading. Stage 3 self-audit run (atom-by-atom number/date/name
      check, no added/dropped claims, structure preserved) — passed;
      `/sekai-factcheck`'s Translation Fidelity mode not separately
      dry-run this time (the inline Stage 3 self-audit covered it).
      `lastHumanReview: false` — genuinely not yet human-reviewed.

**Two real, load-bearing bugs found and fixed while verifying this
article** (not stubs — actually fixed, pulled forward from M5/M6 because
they blocked verifying the translate skill's own output):
1. **M6's loader bug, now fixed for real.** `article_health/loader.py`'s
   `_derive_meta_from_path` mis-derived `category="it"` instead of
   `"History"` for this exact file — confirmed live (`ci-deploy` HARD-failed
   on "frontmatter category (History) must match path category (it)").
   Fixed: added `place_languages()`/`non_default_language_codes()` to
   `article_health/place.py` (parses `place.config.ts`'s `languages` array,
   same pattern `build-content-dates.mjs` already used), and
   `_derive_meta_from_path` now detects a non-default-language first path
   segment and shifts the category index. Added `FileTarget.lang` (defaults
   `"en"`). `ci-deploy` now correctly passes (`hard=0`) on the Italian file.
2. **One M5 script fixed for real:** `scripts/core/test-frontmatter.mjs` had
   the documented one-level-deep `readdir` bug — it silently scanned 0 files
   for the `it/` top-level dir (no `.md` files directly inside it) rather
   than erroring, so `npm run test` reported "7 files scanned" with the
   Italian file invisibly excluded. Fixed the same way as the Python loader:
   read `place.config.ts`'s `languages`, and recurse one level into any
   top-level dir whose name is a non-default language code. `npm run test`
   now reports "8 files scanned" and validates the Italian file's
   frontmatter too. The other M5 scripts (`build-kb-index.mjs`,
   `build-related-tagoverlap.mjs`'s full per-lang fix, `build-map-markers.mjs`,
   `check-graph.mjs`, `build-dashboard-lite.mjs`, `generate-changelog-data.mjs`)
   are **still open** — this file's `ci-deploy`/`npm run test` passing does
   not mean M5 is done, only that these two specific, already-diagnosed bugs
   are.

**New gap found, not previously documented:** `plugins/remark-wikilinks.mjs`
builds its title→URL map by reading `knowledge/{folder}/` **only** (the flat
English root, confirmed by reading the plugin directly) — it has no
lang-awareness at all. Every wikilink in the Italian article (e.g.
`[[pineta-di-monte-rosmarino|Monte Rosmarino]]`) resolves to the
**English** URL (`/nature/pineta-di-monte-rosmarino`), confirmed in the
built `dist/it/history/.../index.html`. Not broken (the link works, it just
lands on the English page) — but worth fixing before this goes further,
since every Italian article's cross-references will silently point back
to English pages until the target articles are translated too, with no
mechanism to switch over automatically once they are. Not fixed here — out
of scope for this milestone, flagged for a later pass (M8 polish, or its
own item).

Verification (all run, all green): `npm run sync` (1 `it` file projected
alongside the 7 `en` files), `uv run python scripts/tools/article-health.py
knowledge/it/History/founding-and-unraveling-of-carbonia.md
--profile=ci-deploy` (`hard=0 warn=5` — the 5 warnings are exactly the
already-documented M6 Italian-vocab gap: `format-structure` doesn't
recognize `**In breve:**`/`## Per Saperne di Più`/`## Riferimenti`/`##
Fonti delle Immagini` as their English equivalents yet, plus the expected
"not human-reviewed" prose-health warning — none are HARD, none block
ship), `npm run build` (43 pages, `/it/history/founding-and-unraveling-of-
carbonia` renders with correct title/body), `npm run postbuild`, `npm run
test` (8/8), `npm run genericity`, `uv run pytest tests/article_health`
(322/322).

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

### M5 — Derived-data script fixes (all of them) 🔶
- [x] `test-frontmatter.mjs` — fixed early, during M2 (see M2 notes for the
      exact bug and fix — reads `place.config.ts`'s `languages` and recurses
      one level into any non-default-language top-level dir)
- [ ] `build-kb-index.mjs`
- [ ] `build-related-tagoverlap.mjs` (full fix, replaces M2 stub)
- [ ] `build-map-markers.mjs`
- [ ] `check-graph.mjs`
- [ ] `generate-changelog-data.mjs`
- [ ] `build-dashboard-lite.mjs`

Verification: each script surfaces the `it` pilot article like an `en` one.

### M6 — article-health locale-awareness 🔶
- [x] `loader.py::_derive_meta_from_path` fix + `FileTarget.lang` — fixed
      early, during M2 (see M2 notes for the exact bug and fix). Added
      `place_languages()`/`non_default_language_codes()` to
      `article_health/place.py` as the reusable primitive.
- [ ] `article-health.py::_get_all_source()` fix (the `--all`/dashboard
      one-level-deep bug — same shape as the now-fixed `test-frontmatter.mjs`
      bug, but not yet ported to this file)
- [ ] `prose_health.py`, `chronicle_lead.py`, `format_structure.py` — it vocab
      (confirmed live during M2: `format-structure` WARNs on the Italian
      article's `**In breve:**`/`## Per Saperne di Più`/`## Riferimenti`/
      `## Fonti delle Immagini` headings since it only recognizes their
      English forms — WARN only, doesn't block ship, but real)
- [ ] `word_count.py`/`paragraph_rhythm.py` threshold audit
- [ ] `test_loader.py` — it coverage (the fix landed without a dedicated
      regression test yet — worth adding before this drifts)

Verification: pytest suite passes (322/322, confirmed after the loader
fix). `--all --profile=dashboard` does **not** yet report the Italian
article — confirmed by running it: only `knowledge/History/founding-and-
unraveling-of-carbonia.md` (the English file) appears, the `it/` counterpart
is invisible, exactly as `_get_all_source()`'s still-open bug predicts. The
single-file run (`article-health.py knowledge/it/History/...md
--profile=ci-deploy`, done in M2) is unaffected since it bypasses
`_get_all_source()` entirely.

### M7 — Skills updates 🔶
**Landed out of sequence, at user's request, before M2-M6 — and since then,
actually exercised.** `/sekai-write`'s translation mode was used for real in
M2 to produce `knowledge/it/History/founding-and-unraveling-of-carbonia.md`,
following Stage 0 (mode=translation)→Stage 2 (draft+target path+
`translatedFrom`)→Stage 3 (inline fidelity self-audit)→Stage 4 (`ci-deploy`,
passed after the M6 loader fix)→Stage 5 (sync+build). The dedicated
`/sekai-factcheck` Translation Fidelity mode (Phase T) has **not** been
separately dry-run yet — M2 used Stage 3's inline self-audit instead of
escalating — so Phase T itself is still designed-but-unexercised even
though the mode it serves has now produced a real article.

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
- [x] `sekai-validate` — confirmed working for the single-file case: `npm
      run article-health -- knowledge/it/History/...md --profile=ci-deploy`
      now correctly derives `category=History` and passes (M2). **Still
      broken for `--all`/`--staged`-style corpus-wide runs** — that's
      `article-health.py::_get_all_source()`'s still-open bug (see M6), not
      a `sekai-validate` problem.
- [ ] `sekai-seed-articles` gap noted (deferred, per original plan — lower
      priority, used for initial seeding not translation).

Verification: see M2's notes above for the full real dry-run (translate →
self-audit → sync → article-health → build), including the two bugs it
surfaced and fixed along the way.

### M8 — Remaining articles + full-site verification 🔶

**New workflow variant found this milestone: reverse reconciliation
(it → en).** So far every translation had gone en → it (AI drafts from the
fact-checked English source). The user instead hand-edited the Italian
pilot article directly (`knowledge/it/History/founding-and-unraveling-of-
carbonia.md`) — content changes, not just prose polish — and asked for
those edits to be read back into the English source, since they're more
comfortable editing in Italian. Handled by diffing the Italian file against
its last-committed version, translating each substantive change back to
English by hand, and applying it to `knowledge/History/founding-and-
unraveling-of-carbonia.md`. Included a retitle (`'The Founding and
Unraveling of Carbonia'` → `'The Founding and Industrial Decline of
Carbonia'`), which required updating all 8 wikilink display-text references
to the article across both language trees, not just the two article files
themselves — easy to miss since `wikilink-target` only validates the slug
resolves, not that display text matches the target's current title.

Two edits were ambiguous enough (plausibly an accidental word-swap
`importate`→`importanti`, and a grammatically ambiguous union-dues
sentence) that they were left out of the English version and flagged back
to the user in chat rather than guessed at. One added claim (a former name
for Piazza Roma, "Piazza Impero," renamed after the regime fell) and one
intensified characterization ("state of siege" → "state of semi-slavery")
were incorporated as clearly intentional but are **not yet fact-checked**
— `lastVerified` was deliberately left unchanged on both files rather than
bumped, since bumping it would have falsely implied those specific claims
were re-verified. Worth a `/sekai-factcheck` pass (or a source added to
`source:`) before this ships as fully reviewed. The editor the user used
(Obsidian, per the new `.obsidian/` dir) also reformatted the Italian
file's YAML to unquoted/block style on save — restyled back to the
project's single-quoted/flow-array convention (style only, verified via
`frontmatter-format` warning count dropping back to baseline).

**All 6 remaining articles drafted** (2026-09-20), AI-translated directly
(not via a fresh `/sekai-write` dry-run each time — same translation
conventions as M2's pilot applied by hand, since the pipeline steps are now
well-understood): `Community/carbonia-santantioco-cycle-path.md`,
`Community/le-tre-finestre.md`, `Food/la-lanterna.md`,
`Landmarks/monte-sirai.md`, `Landmarks/piazza-roma.md`,
`Nature/pineta-di-monte-rosmarino.md` → all now exist under
`knowledge/it/{Category}/`. Every article: `category` kept English (folder
rule), `translatedFrom: 'en'` set, `lastHumanReview: false` (genuinely not
yet reviewed — user has not read these 6 yet), `lastVerified` unchanged from
source (facts not re-verified), footnote source titles left in their
original language (`piazza-roma.md`'s two footnotes), wikilink display text
translated but targets/slugs unchanged (still subject to the M2-documented
`remark-wikilinks.mjs` cross-language gap).

- [x] 6 remaining articles translated (drafted)
- [ ] human review of the 6 new translations (still open — same
      `lastHumanReview: false` state as M2's pilot)
- [ ] `capture-baseline.mjs` loops all enabled langs (untouched this pass)
- [x] full `npm run build` + post-build checks green (see verification below)

Verification (all run, all green): `npm run sync` (14 files projected: 7 en
+ 7 it), `node scripts/core/test-frontmatter.mjs` (14/14 OK),
`article-health.py --profile=ci-deploy` run individually on all 6 new files
(`hard=0` on every one; warn counts 5-7 each, all the same already-documented
categories: not-human-reviewed prose-health, missing `rationale:` block,
below-3-images media-richness on the shorter articles, and — confirmed via
one `--profile=dashboard` run on `monte-sirai.md` — the M6 `format-structure`
Italian-heading-vocab gap reproducing exactly as predicted, still WARN-only),
`npm run test` (14/14), `npm run genericity` (pass — `knowledge/` is outside
both gates' scan roots, confirmed a no-op as expected), `npm run build` (49
pages, all 7 `/it/...` article routes + 5 `/it/...` category-hub routes
present), `npm run postbuild` (internal-links: 808 links checked, 0 broken;
map-markers: 4 valid points / 3 categories — **unchanged from before this
batch**, confirming `build-map-markers.mjs` is still hardcoded to
`src/content/en` per M5's still-open item, not a regression — none of the 6
new articles' `geo:` fields are reflected on `/map` yet; graph: 21 nodes/20
edges; dashboard check passed), `uv run pytest tests/article_health`
(322/322, unchanged — no article_health code touched this pass).

**Not done in this pass, still open:** human review of all 7 Italian
articles (pilot + 6 new — `lastHumanReview: false` everywhere); the rest of
M5's script list (`build-kb-index.mjs`, `build-related-tagoverlap.mjs` full
fix, `check-graph.mjs`, `generate-changelog-data.mjs`,
`build-dashboard-lite.mjs`, plus now-confirmed-still-open
`build-map-markers.mjs`); M6's remaining items (`_get_all_source()`,
it-vocab tables, `word_count`/`paragraph_rhythm` threshold audit,
`test_loader.py` coverage); M3/M4 (UI chrome, home-page copy) — so `/it/`
routes for all 7 articles render with correct Italian article content but
still-English chrome, nav, and home page.

## Deferred / Non-goals

- Per-language RSS feeds (D6).
- Astro built-in `i18n` config (D3).
- `ARTICLE-PLAYBOOK.md` §9 / `AGENTS.md` "Language support boundary" wording
  update — deferred until this experiment validates, not a precondition for
  doing the work.
- `sekai-seed-articles` translate-awareness (M7) — lower priority, used for
  initial seeding not translation.
- Cross-language wikilink resolution (`plugins/remark-wikilinks.mjs`) —
  found during M2, not previously planned. Every wikilink always resolves
  to the English URL regardless of which language file it's in, since the
  plugin's title→URL map only ever reads the flat English `knowledge/`
  root. Not broken, just not lang-aware — worth its own pass once more
  than one article is translated (M8+).

## Upstream Discussion Notes (scratch)

_Running list of things worth raising with Wilson once this validates —
not a pitch doc, just notes as we go._

- The framework already ships more multi-lang scaffolding than the
  "English-only for now" framing suggests: `sync.sh`, `build-search-
  index.mjs`, `build-content-dates.mjs`, `build-git-info.mjs`, and now (per
  this instance's M2/M6 fixes) the `place.py` lang-parsing pattern are all
  either already lang-aware or trivially made so. The gap was concentrated
  in a predictable set of places (Astro routing, content collections,
  `article_health`'s path parsing, a handful of `knowledge/`-walking
  scripts) — a real "second language" checklist for sekai-kb adopters could
  probably be written from this experiment's PROGRESS.md almost directly.
- The `_derive_meta_from_path` / `_get_all_source` category of bug (one
  level too shallow for a lang-nested path) showed up in two independent
  scripts (`article_health/loader.py`, `test-frontmatter.mjs`) with the
  same shape. Worth asking Wilson whether a shared "walk knowledge/ honoring
  place.languages" helper belongs in the framework rather than every script
  reimplementing the same lang-detection regex over `place.config.ts`.

-
