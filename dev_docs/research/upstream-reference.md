# Upstream reference: the system the framework was extracted from

**Framework maintainer document.** Reference, not contract. Ported de-placed from the
architecture study of the knowledge base sekai-kb was cut out of. It is the reference
implementation behind `scripts/core/`, `graph.astro`, the dashboard, and the Phase 11
routine substrate — useful when a framework build needs to know what the working version
of a feature looked like at scale.

> **Stripped at adoption.** `dev_docs/` is removed by `npm run init` (ADR 008, ADR 009).

**Scale caveat, applies to everything below.** The upstream system ran ~828 articles across
14 categories in 6 rendered languages, producing ~4,900 static pages. An adopted instance
starts at tens of articles in one language. Figures are recorded because they show where
things break, not because they are targets. Every quantitative claim is `[as-of 2026-07]`
and must be re-verified before it is acted on.

**What is deliberately not here.** The multi-language machinery, the anti-censorship model
cascade, the community and contribution tiers, and the place-politics data pages are
excluded — see `OMISSIONS.md`, which records each exclusion against the non-goal that
covers it.

## 1. The four-layer architecture

The thesis worth carrying: **every "dynamic" feature — search, maps, knowledge graphs,
dashboards — is pre-computed at build time**, which is what makes the whole system run on
free static hosting plus a CDN.

1. **`knowledge/`** — plain Markdown, the single source of truth.
2. **Prebuild scripts** — derive every JSON artifact the site needs (below).
3. **Static site generator** — compiles to static HTML; no server-side rendering.
4. **An agent-instruction layer** — identity, memory, and autonomous behaviour as Markdown
   files. Covered in `platform-notes.md §6`, which carries the honest assessment of it.

## 2. Prebuild pipeline

The upstream `prebuild` orchestrated 21 scripts in parallel (out of 64 npm scripts total).
sekai-kb's own chain is a subset; the ones with no sekai-kb counterpart are the interesting
column.

| Script | Purpose | In sekai-kb |
|---|---|---|
| `sync.sh` | Copy `knowledge/` to the derived content dir | yes |
| `build-search-index.mjs` | MiniSearch JSON (upstream: with CJK bigrams) | yes, plain word tokenization |
| `build-embeddings.mjs` | Semantic vectors for related-articles and RAG | Phase 7.2a |
| `build-content-dates.mjs` | Per-article last-modified from git, for sitemap `lastmod` | yes |
| `build-git-info.mjs` | Build-time git metadata | yes |
| `build-latest.mjs` | Recently-updated content index | yes |
| `generate-map-markers.js` | Geocode articles to map marker JSON | yes |
| `generate-api.js` | Static JSON endpoints | yes, as `/kb/` |
| `generate-og-images.mjs` | Batch OG screenshots | **no, and never** — see `platform-notes.md §1` |
| `generate-dashboard-data.js` | Health metrics | yes, dashboard-lite |
| `generate-dashboard-alerts.mjs` | Threshold-triggered alerts | no |
| `generate-dashboard-immune.py` | Quality metrics | no |
| `generate-changelog-data.js` | Git history to changelog JSON | yes |
| `generate-contributors-data.js` | Contributor stats | no — named trigger: a second human contributor lands a merged PR |
| `generate-supporters-data.js` | Financial supporter attribution | no |
| `generate-lang-switch-map.mjs` | Cross-language URL mapping | no — English-only |
| `extract-china-terms.py` | Flag politically-loaded terminology | no |
| `extract-build-perf.mjs` | Build performance instrumentation | no |
| `rag-query.mjs` | Local semantic search for an LLM context pipe | no |
| `test-frontmatter.mjs` | Frontmatter schema validation gate | yes |
| `post-build-check.mjs` | Post-build smoke tests | yes |

A further 100+ utility scripts sat outside the prebuild chain: the health linter, internal
link verification, translation, routine auditing, and the analytics fetchers that Phase 10
ports.

## 3. Ten patterns worth replicating

Carried nearly verbatim; these are the design decisions that make the architecture work.

1. **SSOT with a sync script.** One content directory; the derived directory is gitignored
   and never edited. This is sekai-kb iron rule 1.
2. **Build-time data generation.** Every dynamic-seeming feature is pre-computed as JSON or
   inlined data. Zero runtime API calls for content.
3. **CDN-loaded libraries.** Graph, chart, and search libraries load from a CDN only on the
   pages that need them — no bundling cost for pages that do not.
4. **Bigram search for unsegmented scripts.** Solves CJK tokenization with no external NLP
   service. Not a sekai-kb code path (English-only), recorded because it is the reason the
   search index builder is pluggable at the tokenizer.
5. **Vector map from TopoJSON.** No tile server and no map API key: download the region's
   TopoJSON and render with a geographic projection. sekai-kb chose Leaflet + OSM tiles
   instead, which trades the offline property for less code.
6. **Inline graph data.** The knowledge graph does not fetch: the page template computes
   nodes and edges at build time and inlines them into a `<script>` tag, so the graph
   renders with no loading state. See `.agent-toolkit/rules/astro-json-island-escape.md`
   for the escaping gotcha this creates.
7. **Incremental OG generation.** Screenshots cached by file mtime, with git rename tracking
   so a file move does not trigger full regeneration. Recorded as the sophisticated version
   of the wrong approach — see `platform-notes.md §1`.
8. **Language registry as config.** One file is the single source for enabled languages;
   everything else derives. sekai-kb keeps `place.languages[]` as a dormant seam.
9. **Autonomous scheduled agents.** Below, §5.
10. **Quality gates at every layer.** Pre-commit formatting; automated PR content review;
    CI article-health validation; post-build internal link verification. sekai-kb runs the
    same four-layer shape.

## 4. Knowledge graph: the actual force parameters

Upstream graph at 934 nodes and 1757 edges. The parameters are recorded because tuning a
force simulation from scratch is a day's work and these are known-good at this density.

**Node types.** A single center hub, category nodes, subcategory nodes derived from the
directory structure, and article nodes. Schema:
`{id, label, group, color, size, url, isSubcategory}`. Node size is citation count.

**Force simulation:**

| Force | Setting |
|---|---|
| `forceLink` distance | 700 center hub, 40 subcategory-to-article, 60 same-group, 250 default |
| `forceLink` strength | 1 |
| `forceManyBody` | strength -120 (repulsion) |
| `forceCenter` | viewport center |
| `forceCollide` | radius = `node.size + 3` |

**SVG structure:** zoom container `<g>` wrapping an edges `<line>` group, then a nodes
`<circle>` group, then a labels `<text>` group.

**Edge derivation:** wiki-links extracted from Markdown, plus shared tags across categories
**capped at 3 edges per tag** — without that cap a popular tag produces a hairball.

**Interactivity:** zoom and pan, node drag, click to navigate, search and highlight.

## 5. Autonomous routines: cadence, lifecycle, collisions

Reference for Phase 11. **Read this alongside `dev_docs/PRD.md`'s
`No direct-push automation` non-goal** — the upstream ship stage pushes to main directly,
and sekai-kb explicitly does not adopt that (ADR 005). Everything else here transfers.

**Substrate.** These were agent-CLI-native scheduled tasks stored per task as a skill file,
managed through a scheduling API — **not** CI cron jobs. Each fires as a fresh session in a
permissions-bypassing mode on a persistent host. A routine SSOT file is the source of truth;
the scheduled-task files are mirrors. 16 routines were active; a further one was paused with
its skill preserved for manual use.

**Cadence.** Eleven daily routines and five weekly, with the daily set spread across the
full 24 hours and the weekly set clustered in the small hours of one day. Model choice was
explicit per routine — the heavier reasoning tasks (rewrite, PR review, reporting,
self-improvement, audit) on the larger model, the mechanical ones (data refresh, index
rebuild, triage, candidate proposal) on the smaller one. Representative shape:

| Cadence | Purpose | Model class |
|---|---|---|
| daily 17:30 | Publish one queued short-form post | large |
| daily 19:00 | Full article rewrite cycle (~150 min) | large |
| daily 22:00 | PR review, link audit (starts the night chain) | large |
| daily 23:00 | Analytics and search-console data refresh | small |
| daily 00:30 | Translation sync (5.5 hr window) | small |
| daily 05:00 | Semantic index rebuild (~13 min, 4640 vectors, local GPU) | small |
| daily 06:00 | Morning data refresh | small |
| daily 06:30 | Audience metrics and reply reading | large |
| daily 07:00 | Reader feedback to tracker issues | small |
| daily 08:00 | Propose 3 short-form candidates | small |
| daily 08:30 | Morning PR review | large |
| weekly | Trend analysis and new-article proposals | small |
| weekly | Reflective narrative report | large |
| weekly | Promote lessons to canonical docs | large |
| weekly | Self-improvement proposals | large |
| weekly | 7-day cross-routine pattern detection | large |

**Five-stage lifecycle**, per routine:

1. **Become** — read the identity files to establish voice and constraints.
2. **Sync** — `git checkout main && git pull origin main`.
3. **Run** — execute the designated skill, which reads a canonical pipeline SOP.
4. **Ship** — commit and push. *Upstream pushed to main directly; sekai-kb ships via PR
   behind CI instead (ADR 005). This is the one stage the framework deliberately changes.*
5. **Finale** — write session memory.

**Collision handling** — the part that is easy to get wrong:

- 60-minute spacing between tasks.
- Git conflict detection.
- Orphaned workers produce a "rescue snapshot commit" rather than losing work.
- Sibling collisions (a long routine overlapping a chain) handled with a detached
  subprocess plus selective `git add`.

**Skills versus routines.** 38 skills implemented the business logic; the routines were thin
shells that called a skill on a schedule. That separation is worth keeping: it makes every
routine manually runnable and testable outside its schedule.

## 6. Article health scoring: the 14 dimensions

The upstream health linter scored every article on:

1. Frontmatter completeness
2. Title quality
3. Description length
4. Tag count and relevance
5. Citation/source density (19%+ for an A grade)
6. Internal link count (wiki-links to other articles)
7. Word count
8. Readability
9. Freshness (days since last edit)
10. Image presence
11. Heading structure
12. Paragraph length distribution
13. Unique content (not duplicate or thin)
14. Language-specific quality (character-ratio checks for CJK)

Articles below threshold were queued for the daily rewrite routine — the feedback loop that
makes the score do work rather than just report. Dimension 14 has no sekai-kb equivalent
(English-only). Dimension 5's 19% threshold is the one calibrated number worth carrying
into any retuning conversation.

## 7. Build configuration at scale

Where the upstream build sat, as a set of tripwires:

| Setting | Value | Note |
|---|---|---|
| Output | static, no SSR | |
| Build concurrency | 8 | tuned up from 4 |
| Node heap | 12 GB | dominated by the OG screenshot step |
| Build wall time | ~120 min | same cause |
| Pages produced | ~4,900 across 6 languages | |
| Sitemap | auto-generated with hreflang | |
| Feeds | per-language | |

The heap and wall-time figures both collapse when build-time OG generation is removed
(`platform-notes.md §1`). They are the single strongest argument in this document for a
design decision the framework has already taken.

## 8. Dashboard sections

What a mature version of `/dashboard` contained, as a menu for later phases rather than a
plan: summary stat cards; article distribution by category; per-language completeness matrix
with colour-coded cells; per-category health indicators; quality grade distribution;
internal link health; content freshness (days since last update per category); citation
density charts; recent activity timeline including automated routine logs; build and deploy
status. All generated at build time and refreshed on every deploy.

## 9. Soundscape

21 field recordings plus 23 "wanted" entries across 6 categories, native HTML5 `<audio>`
with no audio library and no waveform visualization, community-sourced with contributor
attribution. sekai-kb's Phase 6 soundscape follows this shape, including the wanted-list
concept.

## 10. Cost envelope

Minimal operation was about $15/month; full operation $80-235/month, of which AI compute for
the routines was $50-200 and therefore dominant. `[as-of 2026-07]` The infrastructure itself
was effectively free. This is the arithmetic behind `dev_docs/PRD.md`'s position that AI
compute is a development-process cost rather than an infra service.
