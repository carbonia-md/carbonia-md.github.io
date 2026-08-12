# ROADMAP: Sekai KB

**Framework maintainer document.** This is the delivery-plan SSOT for the framework's
feature phases. Milestones are tracker project milestones, one per phase. Task packets
are converted from this document's detailed blocks by `/dev:plan`, never re-derived;
their Steps/Acceptance text governs packet detail.
Every phase transition is a maintainer gate — `/dev:plan` for phase n+1 runs only after
the maintainer confirms phase n closed. Estimates use `AI implement+review | Human`.

> **Stripped at adoption.** `npm run init` removes this file along with `dev_docs/PRD.md`,
> `dev_docs/SPEC.md`, and `dev_docs/adr/`. It plans the framework's own development, not an
> adopted instance's work (ADR 008).

**Scope of this document (2026-07-28, ADR 008).** Phases 0-5 built the first instance and
cut the framework out of it. That history — the extraction map, the inherited-fork
disposition, the per-task packet-shaping notes, and the phase-0-through-5 table — is
instance #1's rebuild record and stays in its repository. What moved here are the phases
whose code executes in `sekai-kb`: **6 through 11**, plus the amendments and ordering
rules that govern them. The tracker remains a single project spanning both repositories,
so task ids (`LB-*`) are continuous across the split.

| # | Milestone | Outcome | Scope (tasks) | Exit gate | Est |
|---|---|---|---|---|---|
| 6 | Social + engagement | Feedback (Worker + D1 + widget + triage), snippet pipeline, soundscape | 6.1a-c · 6.2 · 6.3 · 6.3b · 6.3c · 6.3d · 6.4 | Live submission → D1 → GitHub issue, and three real recordings; tag released; instance #1 adopts clean (6.4); maintainer phase confirm | AI 20.25h \| Human 3h |
| 7 | Differentiators | On-demand OG worker, RAG chat (bge-m3 + Workers AI, free tier end to end), QR flow | 7.1 · 7.2a-c · 7.3 · 7.4 | Eval set answered with citations, no hallucinated places (7.2c); tag released; instance #1 adopts clean (7.4); maintainer phase confirm | AI 14.5h \| Human 2.5h |
| 8 | Semiont plugin layer | Organ architecture in sekai-kb (config.json manifest, core organs); instance #1 enables core + MANIFESTO | 8.1 · 8.2 · 8.3 | Site builds with `semiont/` deleted and organs toggle via config only; tag released; instance #1 adopts clean (8.3); maintainer phase confirm | AI 5h \| Human 0.5h |
| 9 | MCP + AI delivery | Remote MCP server (`workers/mcp/`) exposing list_topics/get_article/search/semantic_search; AI-access page + `/kb/agent.md` boot file; adopter upgrade playbook proven on the first real post-cut feature release | 9.1 · 9.2 · 9.3 | An MCP client connected to the instance's `/mcp` endpoint answers a question about its place via tools, no clone; tag released; instance #1 adopts clean (9.3); maintainer phase confirm | AI 6h \| Human 0.75h |
| 10 | Perception (analytics) | GA4 + Search Console + Cloudflare Web Analytics live behind `features.analytics`; signal fetchers ported; dashboard analytics panels | 10.1 · 10.2 · 10.3 | Dashboard renders real traffic/search data from a fetch run, zero analytics IDs in `src/` outside place.config; tag released; instance #1 adopts clean (10.3); maintainer phase confirm | AI 5h \| Human 1.5h |
| 11 | Autonomous routines | ROUTINE organ activated: routine contract + `/schedule` skill; embeddings/index refresh (CI); maintainer (content PR review + link/health audits); feedback-triage; data-refresh; trend-discovery; social-publish; rewrite | 11.1-11.9 | Two routines live >= 1 week shipping only via PRs, zero direct pushes to main; tag released; instance #1 adopts clean (11.9); maintainer phase confirm | AI 17.25h \| Human 1.25h |

**Exit-gate shape (uniform for phases 6-11).** Every `Exit gate` cell above states the same
four things in the same order, and a phase is not closed until all four hold:

1. **The feature proof** — the phase-specific demonstration, run against something real.
2. **The tag** — `sekai-kb-vX.Y.Z` released, with a CHANGELOG entry and an **Upgrade note**
   for any config-schema addition.
3. **Instance #1 adopts it clean** — the adoption sequence in that repository's ROADMAP
   §"Phases 6-11": `/sekai-upgrade` against the tag, merged with a real merge commit and
   never a squash, instance-owned files untouched, the instance's own CI green on the
   merged tree, and `FRAMEWORK-VERSION` bumped only after that verification. Tracked as the
   phase's terminal packet, named in the cell.
4. **Maintainer phase confirm** — the gate `/dev:plan` for phase n+1 waits on.

Part 3 is why every phase has a terminal packet (6.4, 7.4, 8.3, 9.3, 10.3, 11.9): adoption
is real work with human steps, so it is tracked as a task rather than asserted as a
property. Those packets execute in the instance repository; the tag they adopt is cut in
`sekai-kb` at verify of the phase's last framework task.

**Totals for these phases:** AI ≈ 68h | Human ≈ 9.5h. Phases 6-8 close the original
plan (AI ≈ 39.75h | Human ≈ 6h); the extension phases 9-11 add AI ≈ 28.25h | Human ≈ 3.5h
and roughly 1.5-2 weeks elapsed. Phase 6's numbers are the 2026-07-29 planning amendment's
as revised by the three later Phase 6 amendments, not the original block estimates; phases
7, 8, 10, and 11 gained a terminal adoption packet in the 2026-08-04 exit-gate amendment;
Phase 7's are the 2026-08-05 planning amendment's. **Every figure in this paragraph is now
summed from the per-phase subtotals below** — the previous AI totals did not reconcile with
them (the stated AI ≈ 62.5h against an actual 67h before this amendment, and the
phase-6-through-8 and 9-through-11 splits likewise), because each amendment updated its own
phase's row without re-summing. The human total was correct throughout. Phases 0-5, and
therefore the grand totals for the whole programme, are recorded in instance #1's roadmap.

**Language policy:** every phase ships English-only. The framework carries no
CJK/multi-language code path, language profile, or gate — in ANY code tree (`src/`,
`scripts/`, `tests/`, `workers/`, `.agents/skills/`), test fixtures included, never just
the directory a DoD happens to name. Language support is a post-project revisit after
Phase 11 (PRD non-goals). `/dev:plan` must not emit packets that retain CJK code for
hypothetical adopters. Enforcement is machine: the genericity gate scans all code trees
and CI includes a CJK-codepoint scan.
**Adopter-facing boundary:** the adopter docs (README, the wizard-emitted `AGENTS.md`,
the playbook) state the support boundary explicitly rather than coding around it — UI
strings and editorial tooling are English-calibrated; Latin-script content largely works
(plain word tokenization; article-health prose thresholds may need retuning per
instance); CJK content is unsupported until the post-project multi-language revisit. The
schema seams (`place.locale`, `place.languages[]`) stay declared but dormant.

**Ordering rules (structural, not preference):** Phases 6 and 7 depend on the framework
cut — the framework ships before instance fun-features (ADR 002, held in instance #1's
history; SPEC `Risk controls`). Phase 9 depends on 7.2c (the inherited-fork
disposition's named MCP trigger); Phase 11 depends on 8.1 (ROUTINE organ architecture)
plus per-routine feature deps. Reordering is a scope change requiring the maintainer's
explicit call.

**Execution repo flow (post-cut ownership rule, ADR 004/005):** every
code task in these phases executes in the `sekai-kb` repository; each phase closes with a
tagged sekai-kb release (CHANGELOG entry + upgrade note for any config-schema addition),
and instance #1 adopts it via `/sekai-upgrade` — that pull is part 3 of each phase's exit
gate above, tracked as the phase's terminal packet (6.4, 7.4, 8.3, 9.3, 10.3, 11.9). The
only instance-side commits are instance-owned: feature flags in `place.config.ts`,
analytics IDs, ROUTINE.md entries, wrangler secrets. New `place.config` keys must be
absent-safe (missing key = feature off) so existing adopter instances upgrade without
config surgery.

The instance side of every one of those packets is the same four-step sequence, defined
once in instance #1's ROADMAP under "Phases 6-11" along with a per-phase table of the flags
it flips and the inputs only it has. The packets here reference that sequence rather than
restating it, so the two documents cannot drift into disagreement about what "adopts it
clean" means.

---

## Agent-toolkit migration amendment — approved 2026-07-19

Records the future-phase deltas from the dev-plugin 0.0.55 migration (ADR 006 +
addendum): `AGENTS.md` is the agent-instruction SSOT and adopter/instance-owned
(`merge=ours`); `CLAUDE.md` is a byte-exact one-line `@AGENTS.md` shim, never
content-bearing; all rules are dev-plugin state in `.agent-toolkit/rules/` and the
template ships none. These rulings govern packet conversion for the
affected phases. **Phases 6-7 and 10-11 need no changes** — their blocks touch none of
the migrated surfaces.

- **8.1 organ-loader ruling (supersedes task 8.1 step 2's "CLAUDE.md boot section" and
  ADR 003's original loader location):** the loader is a stable one-paragraph boot hook
  seeded into the starter `AGENTS.md` by the init wizard — read `semiont/config.json`,
  load enabled organs' boot files, no-op gracefully when the config is absent. All
  evolving loader logic and organ substance live in framework-owned `semiont/` files, so
  the adopter-owned hook rarely changes; when it must, the change reaches existing
  instances via `/sekai-upgrade`'s conversational starter-diff step, never a silent merge
  (same pattern as the dev-plugin reference line in `AGENTS.md`). Boot-time organ
  loading — MEMORY/REFLEXES inlined each session, ADR 003's core-organ intent — is
  preserved. The `/dev:plan` packet for 8.1 cites this ruling, not the superseded wording.
- **8.2 naming:** the acceptance's "become skill boots" reads as the 8.1 boot hook (the
  inherited `become` skill was re-dispositioned into 8.1 by the 2026-07-11 ruling).
- **9.3 corrections (applied inline in the extension block below):**
  `docs/runbook/UPGRADE.md` already exists (written in Phase 5), so 9.3
  extends and proves it rather than writing it; and the absent-safe schema rule lands
  in sekai-kb's `AGENTS.md` + playbook, not "the framework CLAUDE.md".

---

## Phase 6 planning amendment — approved 2026-07-29

Records the `/dev:plan` conversion decisions for Phase 6. The blocks below carry them
inline; this section is the rationale, and the packet bodies cite it.

- **6.1b splits into 6.1b + 6.1c.** The original block bundled the widget (frontend plus a
  `place.config` schema addition) with the triage skill (`wrangler` + `gh` ops tooling behind
  a human-approval loop). Different surfaces, different failure modes, independently
  verifiable, and keeping them together chained the widget behind the triage skill's manual
  criterion. Both still depend only on 6.1a, so they run in parallel.
- **Skill names take the `sekai-` prefix.** The block's `/snippet` and "a triage skill" become
  `/sekai-snippet` and `/sekai-triage-feedback` (`AGENTS.md` §Skill discovery and ownership:
  the namespace prevents collisions with adopter and tool-provided skills).
- **6.4 is a new packet, not an untracked gate.** The milestone's exit gate is real work with
  human steps, and Phase 5 tracked its closer the same way. It is the only Phase 6 packet
  whose `Execution repo:` is the instance.
- **6.3's "first three recordings" splits by repository (decision D1).** The template is a
  fictional place and cannot own field recordings, so the framework ships three synthesized
  demo clips that make the player and the visual bar provable, credited as synthesized rather
  than field-recorded, and stripped by the wizard at adoption. The three real recordings are
  6.4's instance-side work, which is where the block's Human 2h actually falls.
- **`workers/` joins the place-name gate's instance-mode scan roots in 6.1a (decision D2).**
  `.agent-toolkit/rules/genericity-gate-scope.md` recorded the gap as a deferral "for when
  that tree arrives"; 6.1a is the task that makes it arrive. Whole-tree template mode hides
  the hole in this repository, so shipping `workers/` without closing it would leave adopted
  instances with an unguarded place-identity ingress in framework-owned code. The change is
  one `SCAN_ROOTS` line plus the 13 statements `scripts/ci/check-scan-root-docs.mjs`
  registers for that gate, which fails CI on any site missed.
- **6.2 ships the runner and a manual sink, still zero platform adapters (decision D3).** The
  queue format documents `status: posted`; with an interface alone nothing can ever set it,
  so the lifecycle contract would ship with an unreachable state and 11.7 would inherit both
  the runner and the first adapter. The shipped sink is not a platform client: it prints the
  post text for the operator to paste and records the resulting URL, which is what happens
  before any account automation exists. `dev_docs/PRD.md`'s "no framework features for
  hypothetical adopters" is satisfied — no platform API client is built.
- **Estimates:** Phase 6 becomes AI ≈ 11.75h | Human ≈ 3h (was AI 9.5h | Human 2.5h), from
  the split, 6.4, D2, and D3.

---

## Phase 6 planning amendment — approved 2026-07-31

Records the one block added after 6.3 shipped. Same form as the 2026-07-29 amendment: the
block below carries the decision inline, this section is the rationale.

- **6.3b is a new block, inserted between 6.3 and 6.4.** 6.3 shipped `/soundscape` as a flat
  single-column list. The reference implementation of this page on the first instance's live
  site carries ordered categories, a card grid, per-category wishlists of sounds still wanted,
  and a contribute block; that shape is what makes the page a collection rather than a file
  listing. `dev_docs/PRD.md`'s "no framework features for hypothetical adopters" is satisfied by
  the same test 6.2's decision D3 used: a real instance runs this page shape in production, so
  the need is demonstrated rather than speculative.
- **It blocks 6.4 rather than following it.** 6.4 step 3 commits the instance's three real
  recordings as manifest entries against the tag cut in step 1. Landing the schema change
  after that tag would write those entries in the flat shape and rewrite them into categories
  on the next tag, and would confirm the phase exit gate's visual bar against a layout already
  scheduled to change. Ordering it before 6.4 costs the block's estimate and buys one write.
- **The manifest stays the single source.** Categories, wishlist entries, and the richer
  per-recording fields are declared in `knowledge/sounds/_manifest.md`, never in a data module
  under `src/` — the place-name and English-only gates scan that tree, and the reference
  instance's equivalent file could not exist here. A flat `sounds:` list keeps rendering, so
  an adopter's existing manifest is not broken by the release.
- **Estimates:** Phase 6 becomes AI ≈ 16h | Human ≈ 3h (was AI ≈ 11.75h | Human ≈ 3h), from
  6.3b alone.

---

## Phase 6 planning amendment — approved 2026-08-03

Records the one block added after 6.3b shipped. Same form as the 2026-07-31 amendment: the
block below carries the decision inline, this section is the rationale.

- **6.3c is a new block, inserted between 6.3b and 6.4.** 6.3 shipped the soundscape reader
  (`src/lib/sounds.ts`) and 6.3b shipped the categorized layout, but neither shipped a writer
  or a validation gate. Every other Phase 6 content surface has both: 6.2 ships
  `scripts/tools/snippet/publish.mjs` plus `npm run test:snippet` in CI, the feedback worker
  carries its own D1 schema and test suite, and the manifest itself is the one surface with no
  check at all — a typo'd `file`, a missing mp3, or a missing required field is silently
  dropped and CI says nothing. The writer (`npm run sounds:add`) and gate (`npm run
  sounds:check`) close that asymmetry.
- **It blocks 6.4 rather than following it.** 6.4 DoD 6 requires committing the instance's
  three real recordings through `npm run sounds:add`. Hand-writing the entries and shipping the
  tool later writes them twice and validates the exit gate against a path the framework does
  not support. Ordering the tool before 6.4 costs this block's estimate and buys one write
  — the same tradeoff the 2026-07-31 amendment made for 6.3b.
- **Estimates:** Phase 6 becomes AI ≈ 18.5h | Human ≈ 3h (was AI ≈ 16h | Human ≈ 3h), from
  6.3c alone.

---

## Phase 6 planning amendment — approved 2026-08-03

Records the one block added after 6.3c shipped. Same form as the amendment above: the block
carries the decision inline, this section is the rationale.

- **6.3d is a new block, inserted between 6.3c and 6.4.** 6.3c shipped the ingest writer and
  the manifest validation gate, but the writer published the recording verbatim. Consumer
  phones write capture coordinates, capture timestamp, device make and model, and OS version
  into the container; ffmpeg copies input metadata to its output by default and Astro copies
  `public/` into `dist/` byte-for-byte, so nothing between the recording and the published
  asset removed any of it. Found by `/dev:review-pr` on the instance's exit-gate PR, where
  three of the four committed recordings carried GPS to roughly ten metres. This is a
  framework defect: every adopter running `sounds:add` publishes the same data, and one
  recording near home publishes their home coordinates.
- **The writer fix alone does not close it.** Hand-placing a file into
  `public/media/sounds/` and hand-writing the manifest entry is a documented, supported path,
  so `sounds:check` gains the matching gate. Same asymmetry 6.3c closed for the manifest,
  applied to the published bytes.
- **It blocks 6.4 rather than following it.** 6.4 DoD 6 commits the instance's real
  recordings through `npm run sounds:add`. Shipping the exit gate before the strip publishes
  the coordinates first and scrubs them second, which is not a state a public site should
  pass through. Ordering the fix before 6.4 costs this block's estimate; 6.4 then adopts the
  tag and re-ingests or scrubs the four already-committed assets.
- **Estimates:** Phase 6 becomes AI ≈ 20.25h | Human ≈ 3h (was AI ≈ 18.5h | Human ≈ 3h),
  from 6.3d alone.

---

## Exit-gate amendment — approved 2026-08-04

Makes the adoption half of every phase gate explicit and uniform. Nothing about phase scope
or ordering changes; what changes is that a rule already stated in prose is now stated in
each phase's own `Exit gate` cell and tracked by a packet.

**What was wrong.** The `Execution repo flow` paragraph has always said that each phase
closes with a tagged release which instance #1 adopts, and that the pull is part of the exit
gate. The milestone table only carried that clause for phases 9, 10, and 11. Phase 6
deferred it to packet 6.4; phases 7 and 8 stated neither. Only 6.4 and 9.3 existed as
terminal packets, so for phases 7, 8, 10, and 11 the adoption step was work nobody had
estimated and no task tracked — the shape that lets a phase be declared closed while the
instance is still on the previous release.

**The rulings:**

- **Every phase 6-11 `Exit gate` cell states the same four parts in the same order** —
  feature proof, tag released, instance #1 adopts clean, maintainer confirm. The shape is
  written out once under the milestone table.
- **Every phase gets a terminal adoption packet:** 6.4 and 9.3 already existed; **7.4, 8.3,
  10.3, and 11.9 are new.** Each is modelled on 6.4, including its `Execution repo:` line —
  the packet's commits land in the instance, and the tag it adopts is cut in `sekai-kb` at
  verify of that phase's last framework task.
- **The instance side is referenced, never restated.** The four-step adoption sequence and
  the per-phase table of flags and instance-only inputs live in instance #1's ROADMAP under
  "Phases 6-11". These packets cite it. Two documents restating one sequence is exactly the
  drift `check-scan-root-docs.mjs` exists to prevent elsewhere.
- **`/dev:plan` converts the new packets like any other block.** They are ordinary tasks
  with human steps, not a ceremony appended after a phase closes.
- **Estimates:** the four new packets add AI ≈ 3.25h | Human ≈ 3h across phases 7, 8, 10,
  and 11. Totals above are updated; no existing block's estimate changed.

**Enforcement.** `npm run roadmap-gates` (`scripts/ci/check-roadmap-exit-gates.mjs`) fails
CI when a milestone row's exit gate omits the adoption clause or names a packet that no task
block defines. Prose has not held this rule — it was unenforced in four of six rows since it
was written — and the standing doctrine when a rule keeps being missed is to add a check
rather than another paragraph (`dev_docs/research/origin-decisions.md §3`).

---

## Phase 7 planning amendment — approved 2026-08-05

Records the `/dev:plan` conversion decisions for Phase 7. The Phase 7 blocks below carry
them inline; this section is the rationale, and the packet bodies cite it. Same form as the
four Phase 6 amendments.

- **D1 — chat generation is Workers AI free tier, not the Claude API.** The maintainer's
  ruling: an adopter brings their own Cloudflare account and nothing else, exactly as the
  feedback worker already requires, so **both** the embedding call and the generation call
  run on the Workers AI free tier. This supersedes block 7.2b step 1 ("pass top-k chunks to
  Claude"), the Human lines on 7.2b and 7.4 that budgeted for a Claude API key, and the
  milestone row's "Claude API". It also contradicts two statements in `dev_docs/SPEC.md` —
  §Stack's "**Chat generation calls the Claude API**" bullet and §New builds (6)'s "calls
  Claude with citation-required prompting" — and those edits land **in the 7.2b packet**,
  where the code proves them, rather than in a separate architecture pass. What survives the
  change is the discipline attached to the superseded bullet: the model is **not pinned in
  the SPEC**, it is chosen against the current Workers AI catalog at execution time, and
  `dev_docs/research/platform-notes.md §2.10` remains the documented quality/cost escalation
  to a hosted model. The gain is that the framework then ships with no third-party API key
  at all, which is the strongest available form of `dev_docs/PRD.md`'s no-paid-services
  non-goal; the cost is answer quality against a free 8B-class model, which the 7.2c
  evaluation set is what measures.
- **D2 — corpus embedding ships one provider, Workers AI REST.** SPEC §Stack permits
  "offline GPU or Workers AI" for the corpus; only the second is built. The port source is
  Ollama-based and its provider layer is dropped with the rest of its article-level and
  multi-language code. Removes 7.2a's Human 0.5h, which existed only for the GPU path.
- **D3 — the vectors artifact is derived and gitignored, with a tracked-file gate.**
  Block 7.2a says to emit the vectors into `workers/chat/`, which is correct, but the file
  carries article titles, URLs, and body text into a tree that may carry no place identity
  (`AGENTS.md` iron rule 2, and both machine gates scan `workers/`). It therefore takes the
  `wrangler.generated.toml` treatment exactly: `.gitignore`, the skip lists in both gates,
  and a `check-worker-config.mjs` failure if git tracks it.
- **D4 — the evaluation set lives in `knowledge/chat/_eval.md`,** not `workers/chat/eval/`
  as block 7.2c says. Same reason as D3: the questions are about the place. The leading `_`
  is what makes the three `knowledge/` scanners skip it, as with the soundscape manifest.
- **D5 — QR contexts live in `knowledge/chat/_contexts.md` and the printable sheet is
  `npm run qr:sheet`,** not a public route. Greetings are place content, and keeping the
  sheet a script means Phase 7 adds exactly one page (`/chat`) to the gated route list.
- **D6 — new `place.config` keys, all absent-safe:** `features.og?`, `workers.og?`,
  `workers.chat?`, plus `workers.chatDatabaseId?` only if 7.2b's rate limit falls back to
  D1 rather than the Workers rate-limiting binding. Missing key = capability off, per the
  spec invariant.
- **Port source:** the v1 `build-embeddings.mjs` the maintainer supplied at plan time is
  recorded in the 7.2a packet, not here — its path names the pre-cut instance, and the
  place-name gate scans this file in template mode.
- **Estimates:** Phase 7 becomes AI ≈ 14.5h | Human ≈ 2.5h (was AI ≈ 13.25h | Human ≈
  3.25h). AI gains 0.5h on 7.2a (the gitignore + two-gate + tracked-file wiring of D3) and
  0.5h on 7.2b (the rate limit and CORS the block did not name, which the feedback worker
  established as the house minimum for a public endpoint); Human loses 0.5h on 7.2a (D2)
  and 0.25h on 7.4 (no Claude API key to provision). The 13.25h it replaces was itself
  0.25h under the block sum.

---

## Detailed task blocks: Phases 6-8

These are the active source blocks for `/dev:plan`. Model names are advisory and
version-less; the maintainer chooses the session model. Every task executes in
`sekai-kb`, ships in a tagged release, and reaches an instance through `/sekai-upgrade`
unless its packet names an instance-owned edit — 6.4 is the one block that does, and it
names the instance in its own `Execution repo:` line.

**Phase 6: Social + engagement**

```text
[6.1a] Feedback backend: workers/feedback (Cloudflare Worker + D1)
  Effort: M | Model: Opus | Depends: framework cut
  Est: AI 2h + 0.5h review | Human 0.5h (Cloudflare account, wrangler auth, secrets)
  Steps:
    1. Build workers/feedback/ with D1 schema feedback(id, created_at, page, category,
       message, contact, user_agent, status).
    2. Expose POST with a honeypot field, per-IP rate limiting, and CORS locked to the
       configured site origin. Check in wrangler.toml and add exact deploy steps to the
       runbook.
  Acceptance: a curl POST against the deployed worker lands a row in D1; honeypot and
    rate-limit paths are verified
  Downstream: 6.1b, 11.4

[6.1b] Feedback frontend: widget behind features.feedback + workers.feedback
  Effort: S | Model: Opus | Depends: 6.1a
  Est: AI 1h + 0.25h review
  Steps:
    1. Build FeedbackWidget.astro on article pages behind features.feedback. Reuse no
       Supabase-shaped code from the inherited fork.
    2. Add the absent-safe workers.feedback endpoint key (wizard prompt table entry; the
       wizard stays the single writer of place.config.ts).
  Acceptance: a live-site submission lands in D1; the widget is absent with either the
    flag off or the endpoint key missing
  Downstream: 6.4

[6.1c] Feedback triage: /sekai-triage-feedback (D1 -> deduplicated GitHub issues)
  Effort: S | Model: Opus | Depends: 6.1a
  Est: AI 1h + 0.25h review
  Steps:
    1. Build the skill: read status='new' rows through wrangler, classify, deduplicate,
       file GitHub issues linking the article, mark rows triaged with the issue URL.
    2. Gate every write behind explicit human approval, as /sekai-seed-articles does.
  Acceptance: triage produces a GitHub issue; a duplicate comments instead of filing a
    second one
  Downstream: 6.4, 11.4

[6.2] Snippet pipeline: skill + inbox + adapter interface + manual-sink runner
  Effort: M | Model: Sonnet | Depends: framework cut
  Est: AI 2.5h + 0.5h review
  Steps:
    1. Build /sekai-snippet: select article, generate short-form draft, append it to
       knowledge/SNIPPET-INBOX.md with status pending. A human changes pending to approved.
    2. Define the platform-adapter interface. Add no platform adapter until an instance
       account exists; then add one adapter per platform.
    3. Ship the runner plus a manual sink so approved -> posted is reachable without any
       platform API (2026-07-29 amendment, decision D3).
  Acceptance: /sekai-snippet <article> yields an approved-queue entry; the runner marks it
    posted through the manual sink; publish posts to a platform after an account and
    adapter are wired
  Downstream: 6.4, 11.7

[6.3] Soundscape page + manifest contract + demo audio
  Effort: M | Model: Sonnet | Depends: framework cut
  Est: AI 1.5h + 0.5h review
  Steps:
    1. Build the page from the archived soundscape template as design reference, behind
       features.soundscape.
    2. Define knowledge/sounds/ manifest entries with title, location, credit, and file.
       Use native HTML5 audio and no player library.
    3. Ship three synthesized demo clips so the player and the visual bar are provable in
       the template; the wizard strips them at adoption. The three real recordings are
       instance-side work in 6.4 (2026-07-29 amendment, decision D1).
  Acceptance: audio plays on mobile Safari; the page passes the visual bar; an absent
    manifest renders the empty state with a green build
  Downstream: 6.4

[6.3b] Soundscape layout: manifest categories, card grid, wishlist, contribute block
  Effort: M/L | Model: Opus | Depends: 6.3
  Est: AI 3.5h + 0.75h review
  Steps:
    1. Extend knowledge/sounds/_manifest.md to an ordered categories list (id, icon, title,
       optional article link), each carrying its recordings and a wishlist of sounds still
       wanted; a flat sounds list still renders as one implicit category.
    2. Normalize both shapes in src/lib/sounds.ts, validate every new field with a named
       warning, and keep the three absent-safe cases identical.
    3. Rebuild the template: hero stats, one anchored section per category, a responsive
       card grid with the richer card, per-category empty state and wishlist, and a
       contribute block. No player library, no client framework, zero script tags.
  Acceptance: the page passes the visual bar at desktop and mobile widths; an existing flat
    manifest renders unchanged; an absent manifest still renders the empty state green
  Downstream: 6.3c, 6.4

[6.3c] Soundscape ingest: npm run sounds:add, manifest validation gate, authoring playbook
  Effort: M | Model: Opus | Depends: 6.3b
  Est: AI 2.5h + 0.5h review
  Decision: hand-writing manifest entries and shipping the tool later writes them twice, and
    validates the exit gate against a path the framework does not support. Build the tool
    first; 6.4 DoD 6 uses it to produce the three real recordings.
  Steps:
    1. Build scripts/ci/check-sounds.mjs (npm run sounds:check): imports the five field
       arrays from src/lib/sounds.ts, exits nonzero on missing required fields / unresolved
       file / path-escape / duplicate category id. Orphan mp3s are reported but do not fail.
    2. Build scripts/tools/sounds/add.mjs (npm run sounds:add): takes input audio paths +
       metadata, places/converts to public/media/sounds/<slug>.mp3, appends YAML entry to
       the manifest. Strictly additive; preserves surrounding bytes.
    3. Write docs/playbook/SOUNDSCAPE-PLAYBOOK.md: record, convert, add, verify, commit.
    4. Wire sounds:check into postbuild and CI; add sounds:selftest to CI.
  Acceptance: npm run sounds:add on a fixture produces a valid manifest that passes
    sounds:check; the self-test proves every failure class; genericity passes
  Downstream: 6.3d, 6.4

[6.3d] Soundscape ingest strips recording metadata: strip on write, gate on check
  Effort: M | Model: Opus | Depends: 6.3c
  Est: AI 1.5h + 0.25h review
  Decision: stripping is unconditional, with no opt-out flag. The manifest asks for a
    human-written location string precisely so the place is described in the instance's own
    words; shipping exact coordinates underneath it contradicts that field's purpose.
  Steps:
    1. Write every published file through ffmpeg with metadata, chapter, and ID3 writing
       disabled, on the conversion path and on the mp3 path alike. mp3 input is re-muxed
       (-c:a copy, lossless) rather than copied, which makes ffmpeg an unconditional
       prerequisite of npm run sounds:add.
    2. Extend sounds:check to scan every published mp3 and fail on any metadata tag or a
       wrong container. CI has no ffmpeg, and the gate also runs from an adopter's postbuild,
       so the container read is JavaScript and never shells out to ffprobe.
    3. Share the strip arguments and the container reader between writer and gate so the
       tool and the gate that judges it cannot drift.
    4. Extend sounds:selftest with one planted case per tag container; document the strip,
       the gate, and the non-retroactive remedy in the soundscape playbook.
  Acceptance: a tagged fixture converts and re-muxes to a file with no tag; the gate fails on
    each planted tag form naming the file and the field, and passes on the shipped tree; the
    release entry carries an upgrade note, because the fix is not retroactive to assets an
    adopter has already committed
  Downstream: 6.4

[6.4] Phase 6 exit gate: ship the tag, adopt it in the instance, go live
  Effort: M | Model: Opus | Depends: 6.1b, 6.1c, 6.2, 6.3, 6.3b, 6.3c, 6.3d
  Est: AI 1h + 0.25h review | Human 2.5h (Cloudflare setup, three recordings, confirm)
  Execution repo: the instance (every commit); the tag is cut in sekai-kb at verify of the
    last framework task.
  Steps:
    1. Cut the sekai-kb release covering 6.1a-6.3; adopt it with /sekai-upgrade (real merge
       commit, instance-owned files untouched, FRAMEWORK-VERSION bumped after verification).
    2. Enable features.feedback + workers.feedback + features.soundscape; deploy the
       instance's own worker, D1, and secrets.
    3. Record, convert, and commit the three real recordings with manifest entries.
  Acceptance: production submission -> D1 -> real GitHub issue; three recordings play on
    mobile Safari on the deployed site; maintainer phase confirm
  Downstream: Phase 7 entry
```

_Phase 6 subtotal: AI 20.25h | Human 3h_ (the three post-6.3 amendments; the earlier
16.25h/2.5h figure predated 6.3b, 6.3c, and 6.3d and is what the totals paragraph above
now re-sums from)

**Phase 7: Differentiators**

```text
[7.1] On-demand OG worker (Satori + resvg-wasm)
  Effort: M | Model: Sonnet | Depends: framework cut
  Est: AI 2.5h + 0.5h review
  Steps:
    1. Build workers/og/: GET /og/{slug}.png. Render title, category color, and site brand
       from /kb/topics.json data through Satori and resvg-wasm. Return long-lived cache
       headers and cache at the Cloudflare edge.
    2. Switch SEO.astro og:image to the worker URL behind a feature flag; retain static
       og-default.png as fallback.
  Acceptance: og:image URLs render per-article cards; cached responses complete in <200ms
  Downstream: 7.2a

[7.2a] Corpus embeddings: build-embeddings.mjs + gitignored static vectors
  Effort: M | Model: Opus | Depends: 7.1
  Est: AI 2.5h + 0.5h review | Human 0h
  Research: dev_docs/research/platform-notes.md §2 (RAG architecture, chunking, bge-m3
    constraints, Workers AI cost, V8 CPU budget, code skeleton)
  Decision: one embedding provider ships, Workers AI REST (2026-08-05 amendment, D2); the
    artifact is derived and gitignored because it carries place content into a tree that
    forbids place identity (D3). The port source's path is in the packet, not here (D6 note).
  Steps:
    1. Read the v1 build-embeddings.mjs named in the packet, and platform-notes.md §2, then
       port: chunk articles at 300-500 tokens on ## headings; embed with bge-m3 at 1024
       dimensions through the Workers AI REST API. Take the int8 unit quantization, the flat
       N x DIM layout, and the versioned manifest; leave the Ollama provider, the
       article-level embed text, the category map, and the language loop behind.
    2. Emit workers/chat/vectors.json, gitignored, with the skip entry in both machine gates
       and a check-worker-config.mjs failure if git ever tracks it.
    3. Keep it out of the prebuild chain: the site build stays green with no Cloudflare
       credentials. CI automation is 11.2's job.
  Acceptance: vectors cover every article (a zero-chunk article fails the run by name); chunk
    metadata includes title, url, category, and heading; the chunker's suite runs in CI with
    no network
  Downstream: 7.2b, 9.1, 11.2

[7.2b] Chat worker: query embedding + cosine retrieval + free-tier generation
  Effort: M | Model: Opus | Depends: 7.2a
  Est: AI 3h + 0.5h review | Human 0.25h (Workers AI binding + deploy)
  Decision: generation is Workers AI free tier, not the Claude API (2026-08-05 amendment,
    D1). This packet carries the two SPEC edits that ruling requires — §Stack's generation
    bullet and §New builds (6) — and keeps their not-pinned-here discipline: the model id is
    chosen against the current Workers AI catalog at execution time, never copied from the
    dated research.
  Steps:
    1. Build workers/chat/. Embed queries through Workers AI @cf/baai/bge-m3; decode the
       7.2a vectors once into global scope and retrieve by cosine; prompt a free-tier
       Workers AI text model with citation-required prompting; stream the response, ending
       with a machine-readable citation payload so no consumer parses prose.
    2. Lock CORS to the deploy-time origin and rate-limit per hashed IP, as workers/feedback
       does — a public endpoint that spends the shared 10k neurons/day allowance needs both.
  Acceptance: the deployed worker streams an answer from article content with citations, and
    refuses rather than inventing one when the corpus has no support
  Downstream: 7.2c, 9.1

[7.2c] /chat page + evaluation set
  Effort: M | Model: Opus | Depends: 7.2b
  Est: AI 2h + 0.5h review | Human 1h (review evaluation answers)
  Decision: the evaluation set lives in knowledge/chat/_eval.md, not workers/chat/eval/
    (2026-08-05 amendment, D4) — the questions are about the place.
  Steps:
    1. Build /chat in vanilla JS; render the worker's citation payload as linked cards.
    2. Write the 10-question evaluation set, eight answerable and two that must be refused,
       and run it against the live worker with npm run chat:eval.
  Acceptance: the evaluation set is answered from articles with citations and no
    hallucinated places; the runner exits nonzero on any citation that does not resolve to
    a real article
  Downstream: 7.3, 9.1

[7.3] QR flow: location-context deep links + printable codes
  Effort: S | Model: Sonnet | Depends: 7.2c
  Est: AI 1h + 0.25h review
  Decision: contexts live in knowledge/chat/_contexts.md and the sheet is npm run qr:sheet,
    not a public route (2026-08-05 amendment, D5).
  Steps:
    1. Add a ctx-param map from location slug to location-aware greeting and retrieval hint.
       The hint joins the embedded query, never the generation prompt.
    2. Add a printable QR sheet that generates codes for physical locations.
  Acceptance: scanning a location code opens /chat with a location-aware greeting
  Downstream: 7.4

[7.4] Phase 7 exit gate: ship the tag, adopt it in the instance, go live
  Effort: S | Model: Opus | Depends: 7.1, 7.2c, 7.3
  Est: AI 1h + 0.25h review | Human 1.25h (Cloudflare setup, eval review, printed QR
    placements)
  Execution repo: the instance (every commit); the tag is cut in sekai-kb at verify of the
    last framework task.
  Steps:
    1. Cut the sekai-kb release covering 7.1-7.3, with an upgrade note for the chat and OG
       config keys; adopt it with /sekai-upgrade (real merge commit, instance-owned files
       untouched, instance CI green, FRAMEWORK-VERSION bumped after verification).
    2. Enable features.chat and features.og; build the instance's own vectors and deploy its
       own chat and og workers with the Workers AI binding. No third-party API key exists
       to provision (2026-08-05 amendment, D1).
    3. Write the instance's own evaluation set, choose its QR locations and their ctx slugs,
       and print the sheet.
  Acceptance: the deployed instance answers the evaluation set from its own articles with
    citations; og:image renders per-article cards in a real social preview; a scanned
    location code opens /chat with that location's greeting; maintainer phase confirm
  Downstream: Phase 8 entry
```

_Phase 7 subtotal: AI 14.5h | Human 2.5h_

**Phase 8: Semiont plugin layer**

The agent-toolkit migration amendment above controls the `AGENTS.md` boot-hook location
and supersedes the original `CLAUDE.md` loader wording.

```text
[8.1] Organ architecture in sekai-kb: semiont/config.json + loader + core organs
  Effort: M | Model: Opus | Depends: framework cut
  Est: AI 2.5h + 0.5h review
  Steps:
    1. Add semiont/config.json plus organs/{memory,reflexes,manifesto,diary,routine,
       introspection}/ scaffolds. The site build never imports semiont/; CI must prove a
       build succeeds with the directory absent.
    2. Seed a stable one-paragraph boot hook into starter AGENTS.md. It reads config.json,
       loads enabled organ boot files, and no-ops when config is absent. Core organs are
       MEMORY.md and REFLEXES.md; total boot read remains below 150 lines.
    3. Enforce ADR 003: no organ reads another organ's files; every skill probes for organ
       existence and no-ops gracefully when absent.
  Acceptance: site builds with semiont/ absent; disabling an organ removes its boot cost
  Downstream: 8.2, 11.1

[8.2] Instance #1 enables core + MANIFESTO; DIARY and ROUTINE stay off
  Effort: S | Model: Sonnet | Depends: 8.1
  Est: AI 1h + 0.25h review
  Steps:
    1. Enable memory, reflexes, and manifesto in the instance's semiont/config.json.
    2. Salvage MANIFESTO prose by hand from the v1 archive; the organ shell is new.
  Acceptance: the AGENTS.md boot hook reads <150 lines; organs toggle through config only
  Downstream: 8.3

[8.3] Phase 8 exit gate: ship the tag, adopt it in the instance
  Effort: S | Model: Sonnet | Depends: 8.1, 8.2
  Est: AI 0.5h + 0.25h review | Human 0.5h (MANIFESTO prose, confirm)
  Execution repo: the instance (every commit); the tag is cut in sekai-kb at verify of the
    last framework task.
  Steps:
    1. Cut the sekai-kb release covering 8.1, with an upgrade note for the semiont/
       config.json manifest and the AGENTS.md boot hook (a starter-diff change, surfaced
       conversationally by /sekai-upgrade rather than merged silently).
    2. Adopt it with /sekai-upgrade (real merge commit, instance-owned files untouched,
       instance CI green, FRAMEWORK-VERSION bumped after verification).
    3. Turn on memory, reflexes, and manifesto in the instance's semiont/config.json;
       leave diary and routine off.
  Acceptance: the instance builds with semiont/ deleted and with it present; its enabled
    organ set matches its config and nothing else loads; maintainer phase confirm
  Downstream: Phase 9 entry
```

_Phase 8 subtotal: AI 5h | Human 0.5h_

---

## Detailed task blocks: Phases 9-11

`/dev:plan` converts packets from here; Steps/Acceptance text governs packet detail.
Model policy: all execution Opus (2026-07-07); reviews follow `.agent-toolkit/dev.md`
defaults. Decisions behind these blocks (scheduler substrate, ship mode, analytics stack,
release train): ADR 005.

**Phase 9: MCP + AI delivery**
```
[9.1] MCP server worker (workers/mcp/)
  Effort: M | Model: Opus | Depends: 7.2c (named MCP trigger honored)
  Est: AI 2.5h + 0.5h review | Human 0.25h (wrangler route, client test)
  Steps:
    1. Stateless Streamable-HTTP MCP server on Cloudflare Workers (createMcpHandler
       pattern; no Durable Objects at single-instance scale — verified free-tier viable
       2026-07, see ADR 005; document McpAgent/DO as the scale-up path for adopters
       needing sessions).
    2. Tools: list_topics (serves /kb/topics.json), get_article (slug →
       /kb/articles/{slug}.md), search (keyword over /kb/search-index.json),
       semantic_search (query embed via Workers AI @cf/baai/bge-m3 + in-worker cosine
       over the 7.2a vectors).
    3. Factor the retrieval code shared with workers/chat into workers/lib/; surgical
       refactor of the chat worker to consume it.
    4. Place identity from config; new feature flag features.mcp (absent-safe schema
       extension, links-precedent note in SPEC; init-wizard prompt tracked).
  Acceptance: an MCP client connected to the deployed endpoint answers a question about
    the instance's place via tool calls; genericity CI green; chat worker eval (7.2c set)
    still passes post-refactor
  Downstream: 9.2, 11.2 (vector redeploy path)
[9.2] AI-access page + agent boot file
  Effort: S | Model: Opus | Depends: 9.1
  Est: AI 1h + 0.25h review
  Steps:
    1. /ai page (successor to the inherited-fork MCP page) documenting every AI
       consumption path — llms.txt, /kb/ protocol, MCP endpoint + client config snippets,
       /chat — all generated from place.config.
    2. build-kb-index.mjs additionally emits /kb/agent.md: a vendor-agnostic boot file
       (identity, voice, topic index, fetch instructions), genericized; llms.txt links it.
  Acceptance: a browsing AI given only the domain can enumerate and use all access paths;
    genericity CI green
  Downstream: none
[9.3] Adopter upgrade playbook (docs/runbook/UPGRADE.md) + first real feature-release proof
  Effort: S | Model: Opus | Depends: 9.1, 9.2, framework cut
  Est: AI 1.5h + 0.25h review | Human 0.5h (the maintainer runs the instance upgrade as
    the adopter)
  Steps:
    1. Ship Phase 9 as sekai-kb release vX.Y: CHANGELOG entry with the features.mcp
       upgrade note — the first real config-schema addition since the cut.
    2. Run /sekai-upgrade in instance #1 against the tag as the proof.
    3. Extend docs/runbook/UPGRADE.md (exists since Phase 5) for adopters
       FROM that real run: discover releases (watch tags / CHANGELOG), read upgrade
       notes, run /sekai-upgrade (AI path) or the manual fetch → merge-tag → build commands
       (non-AI path), handle conflict reports, enable newly added feature flags
       (absent-safe: skipping the flag = feature stays off), verify FRAMEWORK-VERSION
       bumped.
    4. Add the absent-safe schema rule to sekai-kb's AGENTS.md + playbook so future
       framework changes preserve it (per ADR 006, CLAUDE.md is a one-line @AGENTS.md
       shim — never content-bearing).
  Acceptance: the instance runs the real Phase-9 upgrade clean end-to-end; a first-timer
    following UPGRADE.md alone can state the exact commands and the flag to flip for MCP
  Downstream: every later framework release (10, 11, and beyond) ships against this playbook
```

_Phase 9 subtotal: AI 6h | Human 0.75h_

**Phase 10: Perception (analytics)**
```
[10.1] Analytics wiring behind features.analytics
  Effort: S | Model: Opus | Depends: a live domain; scheduled post-9
  Est: AI 1h + 0.25h review | Human 0.5h (create GA4 property, verify Search Console,
    enable CF Web Analytics)
  Steps:
    1. Cloudflare Web Analytics beacon + GA4 gtag injected by HeadInlineScripts only when
       features.analytics is true; place.config gains analytics IDs (absent-safe schema
       extension, init-wizard prompt tracked).
    2. Runbook gains account-setup steps: GA4 property, Search Console verification,
       CF Web Analytics.
  Acceptance: beacons fire on the live site with the flag on, absent with it off; zero
    analytics IDs in src/ outside place.config
  Downstream: 10.2, 11.5
[10.2] Signal fetchers + dashboard analytics panels
  Effort: M | Model: Opus | Depends: 10.1, quality tooling
  Est: AI 2.5h + 0.5h review | Human 0.5h (API credentials/secrets)
  Steps:
    1. Port fetch-ga4.py / fetch-search-console.py / fetch-cloudflare.py from the v1
       archive (the named trigger has fired), parameterized by config; emit
       src/data/analytics/*.json behind `npm run fetch:analytics`.
    2. Dashboard gains traffic/search panels (Chart.js per SPEC `Stack` only if needed);
       build stays green when the JSONs are absent (graceful degradation).
    3. Credentials via local env / Actions secrets, documented in the runbook.
  Acceptance: `npm run fetch:analytics` refreshes the JSONs and the dashboard renders
    them; clean build without credentials
  Downstream: 10.3, 11.5, 11.6

[10.3] Phase 10 exit gate: ship the tag, adopt it in the instance, go live
  Effort: S | Model: Sonnet | Depends: 10.1, 10.2
  Est: AI 0.5h + 0.25h review | Human 0.5h (GA4 property, Search Console verification,
    CF Web Analytics token, fetcher credentials as Actions secrets)
  Execution repo: the instance (every commit); the tag is cut in sekai-kb at verify of the
    last framework task.
  Steps:
    1. Cut the sekai-kb release covering 10.1-10.2, with an upgrade note for the
       place.config analytics IDs (absent-safe: a missing key means analytics stays off).
    2. Adopt it with /sekai-upgrade (real merge commit, instance-owned files untouched,
       instance CI green, FRAMEWORK-VERSION bumped after verification).
    3. Enable features.analytics, add the instance's own IDs, and register the fetcher
       credentials as Actions secrets.
  Acceptance: beacons fire on the live instance with the flag on and are absent with it
    off; a real fetch run populates the dashboard panels; maintainer phase confirm
  Downstream: Phase 11 entry
```

_Phase 10 subtotal: AI 5h | Human 1.5h_

**Phase 11: Autonomous routines**
```
[11.1] Routine substrate + contract (ROUTINE organ activation + /schedule skill)
  Effort: M | Model: Opus | Depends: 8.1
  Est: AI 2.5h + 0.5h review | Human 0.25h (first scheduled-task registration)
  Steps:
    1. Implement the hybrid substrate (ADR 005): deterministic pipelines = GitHub Actions
       cron/push-triggers; AI routines = Claude Code native scheduled tasks on the
       operator's machine.
    2. semiont/organs/routine/ROUTINE.md is SSOT: each routine = {id, substrate:
       gh-actions|claude-cron, schedule, skill, model, depends, ship-mode:
       auto-merge-data|human-merge}. /schedule skill registers/unregisters against the
       declared substrate (writes the GH workflow or the native scheduled task).
    3. Routine lifecycle contract (five stages, PR discipline replacing direct
       push): sync main → run skill → ship via PR per ship-mode → finale writes MEMORY
       organ entry. Routines NEVER push main directly.
    4. Kill switch: routine organ disabled in semiont/config.json = no routine fires.
       Collision rule: spacing documented in ROUTINE.md.
  Acceptance: a demo no-op routine registered on each substrate fires once, opens a PR,
    logs to MEMORY; disabling the organ stops both
  Downstream: 11.3, 11.4, 11.5, 11.6, 11.7, 11.8
[11.2] Embeddings + index refresh pipeline (CI-triggered, deterministic)
  Effort: S | Model: Opus | Depends: 7.2a, 9.1
  Est: AI 1.5h + 0.25h review
  Steps:
    1. GH Actions job on push-to-main touching knowledge/**: rebuild chunk vectors via
       Workers AI @cf/baai/bge-m3 (single-instance scale fits the 10k-neurons/day free
       tier; the offline GPU path stays documented as the alternative per SPEC `Stack`),
       redeploy the vectors JSON consumed by workers/chat + workers/mcp.
    2. Verify + document that search/kb/graph indexes already rebuild on every deploy
       (no gap).
  Acceptance: editing an article on main updates chat + MCP retrieval within one deploy
    cycle, no manual step
  Downstream: none
[11.3] Maintainer routine: content PR review + link/health audit
  Effort: M | Model: Opus | Depends: 11.1, quality tooling
  Est: AI 2.5h + 0.5h review
  Steps:
    1. Content PR review workflow on pull_request touching knowledge/** — editorial +
       factcheck rubric sourced from the playbook, review comment posted; flips
       .agent-toolkit/dev.md review_action_installed: true. Least-privilege permissions per
       .agent-toolkit/rules/github-actions-least-privilege.md.
    2. Scheduled maintainer routine (claude-cron): internal-link audit + article-health
       sweep; regressions filed as tracker stubs, feeding the 11.8 rewrite queue.
  Acceptance: a contributor PR receives an automated editorial review; a planted broken
    link produces an issue
  Downstream: 11.8
[11.4] Feedback-triage routine
  Effort: S | Model: Opus | Depends: 11.1, 6.1b
  Est: AI 1h + 0.25h review
  Steps:
    1. Register 6.1b's triage skill as a claude-cron routine (daily): read D1,
       dedupe/classify, file GitHub issues linking the article.
  Acceptance: a seeded D1 row becomes a GitHub issue on the next scheduled run
  Downstream: none
[11.5] Data-refresh routine
  Effort: S | Model: Opus | Depends: 11.1, 10.2
  Est: AI 1h + 0.25h review
  Steps:
    1. Register the 10.2 fetchers as a gh-actions routine (daily): fetch → data-only PR
       with auto-merge-on-green label → dashboard freshens on deploy.
  Acceptance: a scheduled run lands a merged data PR and the dashboard shows the new date
  Downstream: 11.6
[11.6] Trend-discovery routine (news-lens for the instance)
  Effort: M | Model: Opus | Depends: 11.1; 10.2 enriches, not required
  Est: AI 2h + 0.5h review | Human 0.25h (approve first proposals)
  Steps:
    1. Weekly claude-cron routine: scan configured local sources (the source list is a
       place-generic mechanism — knowledge/SOURCES.md; an instance seeds its own city
       news, event calendars, community forums) + analytics signals when present.
    2. Propose article ideas and snippet candidates → INBOX.md entries + tracker Backlog
       stubs with source links. Proposals only — never writes articles directly.
  Acceptance: a run yields >=3 sourced proposals in INBOX.md; zero direct article commits
  Downstream: 11.7 feed, 11.8 feed
[11.7] Social-publish routine
  Effort: S | Model: Opus | Depends: 11.1, 6.2 + a first instance account exists (named
    trigger, per 6.2's adapter contract)
  Est: AI 1h + 0.25h review
  Steps:
    1. Register a claude-cron routine publishing approved SNIPPET-INBOX entries via the
       6.2 platform adapter; publish log appended to the inbox entry.
  Acceptance: an approved snippet posts to the wired platform on schedule;
    pending/unapproved entries never post
  Downstream: none
[11.8] Rewrite routine (KB freshness)
  Effort: M | Model: Opus | Depends: 11.1, 11.3
  Est: AI 2h + 0.5h review | Human 0.25h (merge first rewrite PR)
  Steps:
    1. Scheduled claude-cron routine: pick the lowest-health/stalest article from the
       11.3 sweep queue; rewrite per playbook (editorial bar, sources, lastVerified bump).
    2. Open a content PR (human-merge ship-mode), which the 11.3 review workflow then
       reviews.
  Acceptance: a run produces a rewrite PR whose article-health score exceeds the prior
    score; the PR carries the automated review
  Downstream: 11.9

[11.9] Phase 11 exit gate: ship the tag, adopt it in the instance, run the routines live
  Effort: S | Model: Opus | Depends: 11.1-11.8
  Est: AI 0.5h + 0.25h review | Human 0.5h (ROUTINE.md entries, first scheduled-task
    registration, merge approval on the first rewrite PR)
  Execution repo: the instance (every commit); the tag is cut in sekai-kb at verify of the
    last framework task.
  Steps:
    1. Cut the sekai-kb release covering 11.1-11.8, with an upgrade note for the routine
       organ and the /schedule skill.
    2. Adopt it with /sekai-upgrade (real merge commit, instance-owned files untouched,
       instance CI green, FRAMEWORK-VERSION bumped after verification).
    3. Turn the routine organ on in the instance's semiont/config.json, write the
       instance's own ROUTINE.md entries, and register the first scheduled tasks. Which
       routines the instance runs, on what schedule, and in which ship-mode is
       instance-owned work, not an adoption step.
  Acceptance: two routines have run for >= 1 week on the live instance shipping only via
    PRs, with zero direct pushes to main over that window (git log on main is the
    evidence); maintainer phase confirm
  Downstream: none — this closes the roadmap
```

_Phase 11 subtotal: AI 17.25h | Human 1.25h_
