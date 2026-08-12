# Omissions: what the research port left behind, and why

**Framework maintainer document.**

> **Stripped at adoption.** `dev_docs/` is removed by `npm run init` (ADR 008, ADR 009).

## Why this file exists

The three files in this directory are a **de-placed port at full fidelity**, not a summary.
The transform applied was the genericity transform — the same one the framework cut applied
to `src/` — which removes place identity and nothing else. Cost tables, escalation paths,
worker skeletons, tuning constants, and rejected alternatives all survive, because none of
them are place identity.

A port still has edges. This file is where they are recorded, so that "it is not in the port"
is always answerable with either "here is the non-goal that excludes it" or "that is a
defect, go get it." **An omission that cannot be traced to an existing non-goal, ADR, or
ownership boundary is a bug in the port, not a decision.**

## Sources

| Source | Ported into | Byte-exact archive |
|---|---|---|
| Upstream architecture report, `§12 Notes` | `platform-notes.md` | instance #1, `dev_docs/research/` |
| Upstream architecture report, `§1-§11` | `upstream-reference.md` | same |
| Upstream LLM-facing wiki | `upstream-reference.md` | same |
| Binding strategic plan | `origin-decisions.md` | same |

The byte-exact originals live in instance #1's repository because they are that instance's
lineage under ADR 008(b), and because both repositories they were written in are dormant.
Anything below can be recovered from there.

## A. Excluded by a stated non-goal

### A1. Multi-language machinery

**Omitted:** the four-tier translation model cascade and its per-tier refusal-rate findings;
the batch translation system; the six-language routing and locale wrapper design; per-language
feed and sitemap generation; the translation-completeness matrix; the unidirectional
source-language-outward projection argument (`i18n != l10n`); the CJK bigram tokenizer
implementation; the character-ratio quality dimension.

**Excluded by:** `dev_docs/PRD.md` non-goal *English-only through the current roadmap* —
"no CJK or multi-language code paths, language profiles, or CJK test fixtures anywhere in
committed code or tests". Multi-language support is a post-project revisit, built fresh.

**Partially retained:** the *existence* and shape of these systems is recorded where it
explains a framework decision — the bigram approach as pattern 4 and the character-based
chunking rule in `platform-notes.md §2.2` are both kept, because they explain why the
search tokenizer and the chunker are pluggable.

**Hard constraint, not just policy:** both genericity gates scan the whole tree in template
mode (`check-genericity.sh:61-62`, `check-english-only.mjs:100`), and their exclusions are
filename-based. A verbatim port of this material would fail CI on CJK codepoints. Being
stripped at adoption is not an exemption — `.agent-toolkit/` is stripped too and is still
scanned.

### A2. Community, contribution, and funding apparatus

**Omitted:** the five contribution tiers; the four-level contributor progression ladder and
its promotion thresholds; the contributor interview flow; the shell-script onboarding
one-liner; the "token donation" framing; the payment-platform supporter attribution and its
figures; the governance, reviewer-board, and translation-board documents.

**Excluded by:** `dev_docs/PRD.md` non-goal *No framework features for hypothetical
adopters*, plus the named trigger recorded in `origin-decisions.md §5` — contributor
statistics revive when a second human contributor lands a merged PR. Nothing here has a
consumer today.

### A3. Place-politics data pages and the model-comparison benchmark

**Omitted:** the comparative statistics cards; the population pyramid; the democracy
timeline; the enterprise bubble chart; the open-data directory; the whole six-axis
sovereignty benchmark including its methodology and per-model results; the terminology
extraction script.

**Excluded by:** `dev_docs/PRD.md` non-goal *Not carrying the inherited fork's scale
machinery*, which names "place-politics data-viz pages" explicitly. These are also the most
place-specific artifacts in the source; a de-placed version would be content-free.

**Retained:** the *technique* where it generalizes — build-time inlined data with no runtime
API calls is pattern 2 in `upstream-reference.md §3`.

### A4. Social harvest apparatus

**Omitted:** the 89-file harvest orchestrator; its hosted-database dependency; the
short-form content queue lifecycle; the audience-metrics flywheel; the social posting
playbook and its drafts.

**Excluded by:** the same non-goal. sekai-kb rebuilt the capability from concept as the
Phase 6 snippet pipeline; the orchestrator has no successor.

**Retained:** the routine that publishes on a schedule appears in the cadence table
(`upstream-reference.md §5`) because Phase 11 needs the shape.

## B. Excluded by the ADR 008 ownership boundary

These are instance #1's rebuild history, not framework material. They stay in that
repository by decision, not by preference.

### B1. The extraction map

**Omitted:** the file-level manifest of which inherited file seeded which framework file,
with its verified line numbers and its two on-the-record corrections.

**Excluded by:** ADR 008(b) — "Instance #1 keeps the sections that record its own rebuild:
the extraction map... phases 0-5 and their packet-shaping notes, and ADRs 001 and 002".

### B2. The inherited-fork disposition table

**Omitted:** the per-subsystem verdicts across ~28 subsystems.

**Excluded by:** ADR 008(b), and named in `dev_docs/PRD.md` non-goals: "That disposition is
instance #1's rebuild history and stays in its repository."

**Retained:** the *doctrine* the table embodies — every deferral carries a named trigger,
there is no "dormant" — is in `origin-decisions.md §5` with de-placed examples, because it
is general and the framework applies it in every phase.

### B3. Phases 0-5 and the execution-loop mechanics

**Omitted:** the phase 0-5 task list with its estimates and gates; the two-terminal
implementer/reviewer loop; the handoff state files and their recovery procedure; the
bootstrap payload mapping; the instance-specific values (category set, map center, article
counts, the adopter-proof place, the archive waiting period).

**Excluded by:** ADR 008(b). Additionally, the loop is dead as process — replaced by the dev
plugin's execute/review/verify lifecycle against a tracker.

**Retained:** the four process fixes the loop produced (`origin-decisions.md §3`). They
outlived the loop, which is exactly why they were worth separating from it.

## C. Retained in altered form

Recorded because a reader comparing against the archive will notice the difference.

| Source form | Ported form | Why |
|---|---|---|
| A specific font file at ~15 MB in object storage, loaded on cold start | The fact, plus the note that the English-only equivalent is far smaller and may be bundleable | The constraint is real; the conclusion changes for an English-only framework, and pretending otherwise would carry a cost the framework does not have (`platform-notes.md §1`) |
| Worker skeleton targeting a vector index and a hosted small model | Carried verbatim, labelled as a shape reference with its divergences from SPEC named | The code is useful; copying it directly would contradict `dev_docs/SPEC.md` |
| Named model identifiers and per-token prices | Carried with `[as-of 2026-07]` markers and a re-verify instruction | Per the staleness decision: nothing was re-verified during the port |
| An 828-article, 6-language, 4,900-page system | Same figures, with a standing scale caveat | The numbers show where things break; they are not targets for an instance starting at tens of articles |
| Place names, domains, and a municipality in a GIS query | Role descriptions and `<Place Name>` placeholders | The genericity gate, and the point of the framework |

## D. Known gaps in the port itself

Not excluded by anything — simply not yet done. These are defects, listed so they are
visible rather than implicit.

1. **The upstream page-by-page breakdown (§5.1-§5.17) is summarized rather than ported
   section by section.** `upstream-reference.md` carries the graph parameters, the dashboard
   inventory, and the soundscape shape in full, but the landing, explore, article, category,
   resources, about, and changelog page breakdowns are not reproduced. They describe surfaces
   sekai-kb has already built and shipped, so the reference value is low — but this is a
   judgment call, not a non-goal, and the archive has them if a redesign ever needs them.
2. **The geocoding heuristic is named but not reproduced.** The source records a
   title-match/content-match point system with coordinate jitter for overlapping markers.
   `scripts/core/generate-map-markers.js` already implements sekai-kb's own version; the
   upstream constants were not diffed against it during this port. Worth doing if marker
   placement is ever revisited.
3. **The quality-gate chain is listed at one line per layer.** The per-gate thresholds beyond
   the 19% citation density figure were not extracted.

None of these three blocks Phase 7.
