# REWRITE-PIPELINE — Article Write/Rewrite

> All articles (new, rewrite, or translation) follow one linear pipeline. Mode
> is determined in Stage 0; Stages 1-5 are mode-agnostic **except where a
> stage below explicitly branches by mode** — translation replaces Stage 1
> and reshapes Stage 3, since its source material is an already-researched,
> already-fact-checked article rather than the world. The editorial standard
> the pipeline enforces lives in [ARTICLE-PLAYBOOK.md](ARTICLE-PLAYBOOK.md);
> this document is the process contract the framework's writing skills
> execute.

---

## Stage 0: Perspective

Determine scope before research begins.

1. **Mode**: new article, rewrite of existing, or **translation** of an
   existing article into another language enabled in `place.config.ts`'s
   `place.languages`?
2. **Angle** (new/rewrite only): what makes this topic relevant to this place
   specifically? What's the local memory, cultural context, or geographic
   connection? (Translation inherits the source article's angle — it isn't
   re-decided.)
3. **Existing material** (rewrite only): read the current `knowledge/` file,
   extract what to keep vs. what to rework.
4. **Translation source** (translation only): read the source article in
   full — `knowledge/{Category}/{slug}.md` for the default language, or
   `knowledge/{sourceLang}/{Category}/{slug}.md` otherwise. It is already
   researched and fact-checked; translating carries that work forward
   instead of repeating it (Stage 1 and Stage 3 change shape below).
5. **Editorial load**: read [ARTICLE-PLAYBOOK.md](ARTICLE-PLAYBOOK.md) in full.
   It defines voice, structure, and the quality bar — especially §2 (five things
   to find before you write). Translation still follows the same voice and
   structure rules; §2's "five things" is a new/rewrite research step, not a
   translation one.

Output: mental model of what you're writing and why. No file written yet.

---

## Stage 1: Research

**Translation mode skips this stage.** The source article's Stage 1 already
happened; translating is not re-researching. Go straight to Stage 2.

Gather facts. Every claim must be sourceable.

1. Search for relevant information (web, local files, prior knowledge base
   articles).
2. Cross-check any numbers, dates, or names against at least two sources.
3. Note gaps: if a fact can't be verified, flag it rather than guessing.

**Hard gate — no fabricated facts.** If `knowledge/` has no answer and research
can't confirm it, write nothing for that claim. A missing fact is a smaller
problem than an invented one.

---

## Stage 2: Draft

Write the article per [ARTICLE-PLAYBOOK.md](ARTICLE-PLAYBOOK.md) standards.

- Structure: frontmatter → opening paragraph → At a Glance → body → citations
  (playbook §4).
- Voice: a local friend, not a brochure and not an encyclopedia (playbook §6).
- Length: match depth to topic (playbook §1). No padding; no artificial brevity.
- Target: `knowledge/{Category}/{slug}.md`. Category folders come from
  `place.config.ts`; the filename is the article's slug (lowercase).

**Translation mode:** translate the source article's prose faithfully — same
structure (opening → At a Glance → body → citations), same claims, same
footnote/source list. Translate footnote text and quote attributions; never
invent or drop a source in the process. A quoted primary source is
translated for meaning, not smoothed into more natural-sounding target-
language prose at the cost of accuracy (Stage 3 below checks this). Target:
`knowledge/{lang}/{Category}/{slug}.md` — the **same** `{Category}` and
`{slug}` as the source article; only the language-root segment changes. Add
`translatedFrom: '{sourceLang}'` to the frontmatter (e.g. `translatedFrom:
'en'`) so the pairing is recorded, not just implied by matching paths.

---

## Stage 3: Fact-check

Self-audit the draft against Stage 1 sources.

1. Every named date, number, person, or place: verify against research notes.
2. Any claim without a source: either source it or cut it.
3. If web sources were used: confirm URLs are reachable.

For anything beyond a quick self-audit (post-ship audits, contested claims), run
the full methodology in [FACTCHECK-PIPELINE.md](FACTCHECK-PIPELINE.md).

Machine assist for the prose side of this stage:

```bash
npm run article-health -- knowledge/{Category}/{slug}.md --profile=rewrite-stage-3
```

**Translation mode** replaces claim-verification-against-sources with a
**translation-fidelity check** — the source's facts were already verified;
what could go wrong now is drift introduced by translating, not a bad fact.
Run [FACTCHECK-PIPELINE.md](FACTCHECK-PIPELINE.md)'s Translation Fidelity
mode (Phase T), or as a minimum self-audit:

1. Every number, date, proper noun, and named quantity in the source appears
   in the translation too — verbatim or correctly localized (`3 May 2020` →
   `3 maggio 2020` is fine; a changed number is not).
2. No claim is added that isn't in the source; no claim from the source is
   silently dropped.
3. Every blockquoted primary-source quote: re-read side by side with the
   source and confirm the translation preserves its meaning — a translated
   quote can't be checked as verbatim text the way a same-language quote
   can, which is why Phase 4's Verbatim Check doesn't apply to translations.

Machine assist still applies to prose mechanics (not fidelity — article-health
has no Italian-language checks yet, see this instance's PROGRESS.md M6):

```bash
npm run article-health -- knowledge/{lang}/{Category}/{slug}.md --profile=rewrite-stage-3
```

---

## Stage 4: Quality-checklist gate

Mode-agnostic from here on — the `knowledge/{Category}/{slug}.md` path
shown below is `knowledge/{lang}/{Category}/{slug}.md` for a translation
(Stage 2's target path); everything else in Stages 4-5 applies as written.

Run the article through the quality gate in
[ARTICLE-PLAYBOOK.md §7](ARTICLE-PLAYBOOK.md) — the five-finger test, the
structure check, the plastic-language scan, and the automated verification.

There are two article-health bars here, and they are not the same gate:

**Mandatory ship gate — `ci-deploy`.** This is the bar every article must clear
to commit and deploy; it is the exact profile the instance's CI runs over the
whole corpus (`article-health --all --profile=ci-deploy`). It runs every check
and blocks on HARD violations only. A text-first article passes it.

```bash
npm run article-health -- knowledge/{Category}/{slug}.md --profile=ci-deploy
```

**Media-complete self-check — `rewrite-stage-4`.** This is the aspirational
depth-article self-check for long-form pieces once images are supplied. It runs a
media/structure-focused check list and HARD-promotes the depth checks
(`image-health` with a hero + scene images floor of ≥3 length-scaled,
`word-count`, `chronicle-lead`, `viz-health`). It is a self-check, **not** the
universal new-article gate, and it is **run in addition to `ci-deploy`, never
instead of it**: `ci-deploy` runs the full check set (`checks = "*"`) while
`rewrite-stage-4` runs only its named subset, so passing `rewrite-stage-4` does
**not** imply passing `ci-deploy` (e.g. `footnote-format` and `link-url-mangle`
are HARD in `ci-deploy` but don't run under `rewrite-stage-4`). The framework's
own demo corpus is text-first and clears `ci-deploy`, not `rewrite-stage-4`. Run
it when you have supplied media and want to hold a depth article to the stricter
media bar — after, not instead of, the `ci-deploy` gate above. Its image/media
thresholds are long-form-calibrated and tunable per instance — see
[ARTICLE-PLAYBOOK.md §8](ARTICLE-PLAYBOOK.md).

```bash
npm run article-health -- knowledge/{Category}/{slug}.md --profile=rewrite-stage-4
```

Check:

- Frontmatter complete and valid (`npm run test` validates all of `knowledge/`)
- No orphan wikilinks or broken link targets
- Word count appropriate for the topic's band
- No playbook violations (voice, structure, sourcing)

Fix any `ci-deploy` HARD failures before proceeding. **`ci-deploy` fail = don't
commit.** Do not fabricate images to satisfy `rewrite-stage-4`.

---

## Stage 5: Sync

Run the sync to project the new/updated `knowledge/` file into the build:

```bash
npm run sync
```

Then verify the article renders:

```bash
npm run build
```

`src/content/` is a derived, gitignored projection of `knowledge/` — never edit
it directly (the SSOT rule). Commit the `knowledge/` file. Done.
