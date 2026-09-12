# FACTCHECK-PIPELINE — Fact-Check Methodology

> **Core principle:** every date, number, name, and quoted claim must pass four
> gates: (1) source URL resolves, (2) source actually published the content,
> (3) the article's description of the source is accurate, (4) the article's
> claim matches the source. Any gate failed = trust leak.
>
> This document is the process contract the framework's fact-check skill
> executes. The editorial standard it protects lives in
> [ARTICLE-PLAYBOOK.md](ARTICLE-PLAYBOOK.md) (§4.6 citations, §4.8 quote
> fidelity).

---

## Modes

| Mode                      | Budget                        | Trigger                                                          |
| ------------------------- | ------------------------------ | ----------------------------------------------------------------- |
| **Quick**                 | 15-30 min, 5-10 source checks  | During [REWRITE-PIPELINE.md](REWRITE-PIPELINE.md) Stage 3 (every article before ship) |
| **Full**                  | 60-90 min, 15+ source checks   | Post-ship audit, reader challenge, periodic patrol                |
| **Translation Fidelity**  | 15-30 min, whole article       | REWRITE-PIPELINE.md Stage 3, translation mode (`/sekai-write` translating an article into another enabled language) |

Translation Fidelity mode replaces Phase 3 and Phase 4 with
[Phase T](#phase-t-translation-fidelity) below; Phases 1, 2, 5, and 6 still
apply, but run once per **article pair** (source + translation) instead of
against primary sources — the source's claims were already fact-checked
when it shipped (or last audited), so this mode checks the translation
didn't drift from them, not whether they're true.

---

## Phase 1: Scope

1. **Classify article tier:**
   - A: People / sensitive / historical claims with citations (full audit)
   - B: General depth articles (10+ sourced claims)
   - C: Hub pages, food/trail soft features (spot-check only)
2. **Set sampling target:** A = all claims; B = 50%; C = 5-10 highest-risk.
3. **Identify the ground truth:** for facts about this place that the knowledge
   base already covers, the ground truth is `knowledge/`. For external facts,
   identify the authoritative source (municipal records, regional archives, the
   local historical society, news outlets).

**Translation Fidelity mode:** skip tiering and sampling — check the whole
article. A translation is short enough that spot-checking isn't worth the
risk of missing a drifted claim, and the ground truth is the **source
article**, not external sources (its claims were already tiered and audited
when it shipped).

---

## Phase 2: Atomic Decomposition

Extract verifiable atoms from the article. Each atom is one factual claim.

8 atom types: **date, place, action, quote, number, person, organization,
object**.

For each atom, record: the claim text, its source (footnote/URL or `knowledge/`
file), and which of the 4 gates apply.

**Translation Fidelity mode:** decompose both the source article and the
translation, aligning atoms one-to-one (the translation's Nth date should be
the source's Nth date, etc.) — a misalignment is itself a finding, since it
usually means an atom was added, dropped, or reordered.

---

## Phase 3: Source Authority Audit

*(Skip for Translation Fidelity mode — go to [Phase T](#phase-t-translation-fidelity) instead.)*

For each atom (or sampled subset per tier):

1. **URL resolves** — fetch the source; 404/403 = dead link.
2. **Source is real** — the publication exists and published this content.
3. **Description accurate** — the article's characterization of the source
   matches what the source actually says.
4. **Claim matches source** — the specific fact in the article is supported by
   the source, not just thematically related.

For place-specific claims (dates, building names, population, geography):
cross-check against the `knowledge/` ground truth. If `knowledge/` and the
article disagree, the article is wrong until proven otherwise.

Appropriate source types, in rough order of authority: government/municipal
records, county or regional archives, the local historical society, established
news outlets, museum/gallery/institution pages, state or national records. A
personal blog or an SEO listicle is corroboration at best, never the sole source
for a contested claim.

---

## Phase 4: Verbatim Check

*(Skip for Translation Fidelity mode — a translated quote cannot be checked
as verbatim text against a same-language source; see
[Phase T](#phase-t-translation-fidelity).)*

For every quoted passage or specific number:

1. **Quotes must be verbatim.** No paraphrasing inside quotation marks. If the
   source says X, the article must say X exactly, not a "cleaner" version.
2. **Numbers must trace to a specific source.** "About 23,000" needs a census
   or municipal record, not a guess.
3. **Over-citing detection:** if one source is used to back 5+ separate claims,
   verify each claim individually against that source.

---

## Phase T: Translation Fidelity

*(Translation Fidelity mode only — replaces Phase 3 and Phase 4 above. The
source article already passed Phase 3/4 when it shipped or was last
audited; translating it doesn't re-litigate those source claims, it checks
that the translation didn't drift from them. Continue to Phase 5 afterward.)*

For each atom pair aligned in Phase 2, compare the translation against the
**source article** — never against the source article's own primary
sources; that audit already happened.

1. **Every atom present.** Each number, date, proper noun, and named
   quantity in the source appears in the translation — verbatim or
   correctly localized (`3 May 2020` → `3 maggio 2020` is fine; a changed
   number, dropped date, or renamed person is not).
2. **No atom added.** The translation introduces no claim the source
   doesn't make. A translator "helpfully" clarifying or expanding a claim is
   a fidelity violation, not an improvement.
3. **Quoted material re-read for meaning, not matched verbatim.** A
   translated quotation cannot pass a word-for-word check by construction —
   comparing text across languages that way is meaningless. Instead: read
   the source quote and the translated quote side by side and judge whether
   the translation preserves what was said, who said it, and its tone. This
   is the one judgment call in an otherwise mechanical phase.
4. **Structure preserved.** Same section order, same footnote/source count,
   same citations — a translation that silently drops a citation or a
   `## References` entry has drifted structurally, independent of whether
   the prose reads well.
5. **Provenance recorded.** The translation's frontmatter carries
   `translatedFrom: '{sourceLang}'` (e.g. `translatedFrom: 'en'`). Missing
   this is itself a finding (Phase 6: SOFT-FIX) — it's how a reader or a
   later audit finds the source to re-check against.

---

## Phase 5: Cross-Claim Consistency

Check the article's internal consistency:

1. **Arithmetic:** do the parts add up to the stated total?
2. **Timeline:** are dates in the correct chronological order? Does "founded in
   1927" conflict with "by 1920, the town had..."?
3. **Cross-reference:** if article A cites article B, does B actually say what A
   claims it says? Check both `knowledge/` files.

Translation Fidelity mode: check the translation's internal consistency the
same way, then confirm it still agrees with the source (a translation that's
internally consistent but disagrees with the source has drifted, even if
Phase T's atom-by-atom pass missed it).

---

## Phase 6: Triage and Fix

Classify each finding:

- **PASS** — source supports the claim, all 4 gates clear.
- **SOFT-FIX** — minor wording adjustment (description slightly off, but claim
  is supported). Fix the description.
- **HARD-FIX** — claim not supported by source. Either find a better source or
  cut the claim.
- **DEAD-LINK** — source URL is 404/403. Find a replacement source or cut.
- **TRANSLATION-DRIFT** — Translation Fidelity mode only: an atom was added,
  dropped, mistranslated, or structurally altered relative to the source.
  Fix by re-translating the affected passage against the source — never by
  independently inventing a correction, which would re-introduce exactly the
  unsourced-claim risk translation fidelity exists to prevent.

**Hard gate:** no article ships with unresolved HARD-FIX, DEAD-LINK, or
TRANSLATION-DRIFT findings. Fix them in `knowledge/` (the SSOT), then
`npm run sync`.

Machine assist for the citation side:

```bash
npm run article-health -- knowledge/{Category}/{slug}.md --profile=rewrite-stage-3-5
```

---

## Output

Record findings in the fixing commit's message (Quick mode), or in a standalone
report file if your instance keeps an audit trail (Full mode). Minimum: list of
atoms checked, pass/fail per atom, any fixes applied.
