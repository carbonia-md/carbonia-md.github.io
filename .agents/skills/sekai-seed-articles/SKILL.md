---
name: sekai-seed-articles
description: |
  Draft the first 5 starter articles for a sekai-kb instance. Grounds drafts in
  source material you supply (URLs, notes, prior text) and cites it; with no
  material, drafts from AI research. Every draft follows the editorial playbook
  and passes article-health before a structural human-approval gate — nothing is
  committed without your explicit approval in-flow.
  TRIGGER when: user says "seed articles", "/sekai-seed-articles", "draft my first
  articles", "starter articles", "write the first 5", or runs it after /sekai-adopt.
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - WebFetch
  - WebSearch
---

# /sekai-seed-articles — Draft the first 5 articles

Batch-drafts 5 starter articles across the instance's categories. This skill
orchestrates the batch, grounds it in source material, and enforces the approval
gate; the editorial standard and the per-article process live in the playbook —
follow them, do not restate them here (drift = decay).

## 0. Load context

Read `place.config.ts` for `place.name` and the `categories` list (each
category's `title` — the `knowledge/` folder name — and `slug`). Then read, in
full:

- `docs/playbook/ARTICLE-PLAYBOOK.md` — voice, structure, the quality bar.
- `docs/playbook/REWRITE-PIPELINE.md` — the per-article process (Stages 0–5)
  you execute for each draft.
- One shipped article as a frontmatter/structure template if any remain in
  `knowledge/` (e.g. `knowledge/{Category}/*.md`).

## 1. Source material — the two modes

Ask the user for any existing material about their place: source URLs, notes,
documents, prior wiki or blog text. If `/sekai-adopt` collected material, it is
already in this session's context — confirm it rather than re-asking.

- **Supplied-material mode** (material exists): every draft must be grounded in
  it and **cite it** — real URLs in the frontmatter `source:` list, and inline
  footnotes for sentence-level claims (playbook §4.6). Do not pad with
  unsupported claims to reach a word band.
- **AI-research mode** (no material): research per REWRITE-PIPELINE Stage 1 —
  cross-check numbers/dates/names against at least two sources, cite reachable
  URLs. The hard gate still holds: **no fabricated facts, sources, or quotes.**
  If a fact cannot be verified, leave it out.

## 2. Propose the 5 topics (approval point)

Pick 5 topics that span the instance's categories (not five of the same kind),
each with a one-line angle per playbook §2.1. Present the list — title,
category, angle, and which supplied source(s) back it — and get explicit
approval or edits **before drafting**. This keeps the batch aligned with what
the user actually wants seeded.

## 3. Draft each article

For each approved topic, run REWRITE-PIPELINE Stages 0–3 (perspective, research,
draft, self-fact-check) and apply the playbook §7 manual quality checklist (the
five-finger test, the structure check, the plastic-language scan) as you finish
the draft. The automated Stage-4 gate is step 4 below (with the profile note
there):

- Target path `knowledge/{Category}/{slug}.md` (`{Category}` is the folder name
  from `place.config.ts`; `{slug}` is the lowercase filename slug).
- Frontmatter, opening + At a Glance, body structure, and citations exactly per
  the playbook (§4, §5). Copy the frontmatter skeleton from §4.0 (canonical field
  order, single-quoted scalars, unquoted ISO dates, flow-array `tags`,
  `lastHumanReview: false` as a boolean); frontmatter completeness is checked in
  step 4; the `rationale` block is required for the instance's strict categories
  (§4.9).
- Voice: a local friend, not a brochure (§6). Length matches the topic's band
  (§1) — do not pad.

Write drafts to `knowledge/` only (never the derived `src/content/`). Leave them
**uncommitted** — the commit is gated in step 5.

## 4. Health-check every draft (must pass before the gate)

```bash
npm run sync
# per article — the deploy gate (the exact bar the instance's CI enforces):
npm run article-health -- knowledge/{Category}/{slug}.md --profile=ci-deploy
# frontmatter validation across all of knowledge/:
npm run test
# once all drafts are written — render + post-build contract checks:
npm run build
```

**Blocking bar = `ci-deploy`.** It runs every check and blocks on HARD only;
it is the same gate the instance's CI runs on the corpus
(`article-health --all --profile=ci-deploy`) and the bar the framework's own
text-first demo articles meet. A seeded article that passes `ci-deploy` + `test`
+ `build` will not break the instance's build or deploy. **HARD violation = fix
and re-run** before the article is eligible for the approval gate; never present
a failing draft as done. Capture the health output — it is the evidence the gate
decision rests on.

> **Note on `rewrite-stage-4` and images.** REWRITE-PIPELINE Stage 4 names the
> stricter `--profile=rewrite-stage-4`, which additionally HARD-requires a
> media-complete depth article (hero + scene images, ≥3). That is the
> aspirational author self-check, not the deploy bar: the framework's own demo
> corpus is text-first and clears `ci-deploy`, not `rewrite-stage-4`, and the
> image/media thresholds are long-form-calibrated and tunable per instance
> (playbook §8). When the adopter supplies images, add a hero (and scene images)
> and run `rewrite-stage-4` to clear the fuller bar. For a text-first starter
> with no supplied media, `ci-deploy` is the honest blocking gate — do not
> fabricate images to satisfy a stricter profile.

## 5. Human-approval gate (structural — nothing commits without it)

This gate is unconditional. Present to the user, in one place:

- the 5 drafts (or a readable summary + file paths),
- the `article-health` result per draft (all passing after step 4),
- for supplied-material mode, where each draft cites the supplied source.

Then **stop and ask for explicit approval to commit.** Do not run `git add` /
`git commit` until the user says yes. If the user requests changes, revise,
re-run step 4 for the touched articles, and return to this gate — never commit
around an unresolved request.

On explicit approval:

```bash
git add knowledge/
git commit -m "content: seed <N> starter articles"
```

Commit `knowledge/` only (`src/content/` is derived and gitignored). Report the
committed files, the health results, and any topic the user deferred.
