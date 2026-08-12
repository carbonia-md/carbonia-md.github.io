# Origin decisions: the reasoning behind the framework's shape

**Framework maintainer document.** Reference, not contract. Ported de-placed from the
binding strategic plan that produced this framework — the document `dev_docs/PRD.md`,
`dev_docs/SPEC.md`, and ADRs 001-008 were all derived from.

> **Stripped at adoption.** `dev_docs/` is removed by `npm run init` (ADR 008, ADR 009).

**Why this file exists.** The PRD and SPEC state the framework's decisions in present tense
and drop the evidence. When a decision comes up for revision — and Phase 7 through 11 will
each surface one — the question is always "what was this actually weighed against?". That
is here.

**Scope.** Only the halves that govern *framework* code. The instance-specific halves —
phases 0-5, the extraction map with its verified line numbers, and the inherited-fork
disposition table — remain instance #1's rebuild history under ADR 008(b) and are not
duplicated here. `OMISSIONS.md` records what was left out and why.

## 1. The three strategic decisions

### 1.1 Hybrid rebuild in a fresh repository

Not fork continuation, and not a blind greenfield either. Create a fresh project and extract
into it, as literal files, the design system, a curated component subset, the build scripts,
and the editorial tooling. Write new page shells and everything else clean.

**The evidence, which the PRD compresses:**

- **The earlier greenfield attempt failed because design was described in prompts.** The
  hybrid copies the actual stylesheets and component files, so that failure mode does not
  apply. This is the origin of the design-parity fallback rule in `dev_docs/SPEC.md
  §Risk controls`: if a page fails parity, copy the reference implementation wholesale and
  re-genericize — **never re-prompt from a description**.
- **The fork's cost was structural, not incidental.** The last upstream merge alone was
  297 commits and required three phases of place-removal work. Afterwards, 34 `.astro`
  files still hardcoded the place name, and upstream assumptions (CJK recall paths,
  3000-article expectations) kept resurfacing.
- **The valuable inheritance was ~30 files out of 1,519.** Extraction was a bounded 2-3 day
  job; place-removal maintenance was unbounded.

Those two numbers — 30 of 1,519, and 297 commits producing three phases of cleanup — are
the entire quantitative case for the `No fork continuation and no upstream merging`
non-goal. The PRD carries the conclusion; this is the arithmetic.

### 1.2 One repository, genericity from day one, the framework cut as a numbered phase

Build under a hard genericity rule — zero place-specific strings in the code trees, all
place identity flowing from config plus content plus media — enforced by a CI gate from day
one. Cut the framework out as a scheduled phase, before any of the features the maintainer
personally wanted most.

**Why not framework-first:** with zero working instances you guess at the config surface
instead of deriving it from a real second place. That repeats the original coupling mistake
in mirror image.

**Why not two repositories in parallel:** doubles merge traffic during the highest-churn
period.

**Why not instance-first with extraction "later":** that is the deferral trap. The plan
closes it by making the cut a numbered phase with acceptance criteria, sequenced *ahead* of
the fun features. The phrasing worth keeping: *the fun features wait behind the framework;
that ordering is the anti-deferral guarantee.*

**Why the genericity gate is what makes any of this safe:** nothing place-specific can bake
into shared code, because the build fails if it does. A convention would have eroded; a gate
does not.

**On the name.** Sekai — "world": the framework is the world-level knowledge-base system and
each instance is one place in it. Instances stay *places*: `place.config.ts` and the `place:`
key keep their names. Framework v1 ships as a GitHub template plus an in-repo `npm run init`
wizard rather than a published CLI package, which delivers the full zero-to-deployed
capability without publishing ceremony. **Named trigger for publishing the CLI:** the second
external adopter appears, or the template flow shows friction — whichever comes first.

### 1.3 The autonomous layer as a modular plugin

A directory the site build never imports from — the site must build with it deleted — plus a
manifest listing enabled organs.

- **Default-on core (3):** boot identity (a sub-150-line replacement for a 753-line boot
  protocol), MEMORY (session handoff), REFLEXES (accumulated don't-do rules).
- **Opt-in:** MANIFESTO (voice guard), DIARY, ROUTINE (schedule SSOT), and an introspection
  pack.
- **Organs may not require each other.** Skills probe for organ existence and no-op when
  absent.

**The justification, stated more bluntly than ADR 003 does:** memory, reflexes, manifesto,
and routine earn their keep; the introspection organs are art. They stay available as a
plugin rather than being killed or being mandatory. The hard architectural requirements are
the no-cross-dependency rule and the site-builds-without-it rule — precisely the two things
the monolith it came from violated, and the two that make plug-and-play real rather than
aspirational.

`platform-notes.md §6` carries the per-organ audit that produced this split, including the
mode-load measurements behind the sub-150-line target.

## 2. Merge determinism: the four-part argument

`dev_docs/SPEC.md §Repo topology` states the guarantee. The full argument has four parts,
and the fourth is the one most easily lost:

(a) The merge target is an **immutable semver tag** with a changelog entry; breaking config
changes carry an upgrade note.
(b) The template contains **zero place content**, by CI-enforced construction.
(c) Instance-owned files carry **`merge=ours`**.
(d) **The ownership rule:** in an instance, `src/` and `scripts/` are framework-owned.
Instance-local edits to them are what break merge determinism. Customization goes through
config, content, and media; anything beyond that is upstreamed to the framework first and
pulled back as a release.

Parts (a)-(c) are mechanical. Part (d) is a discipline, and it is the remaining hole: the
reverse flow (an instance invents something and upstreams it) is allowed, but must land in
the framework within the same work item. Without (d), (a)-(c) still let an instance drift.

## 3. Process doctrine: machine gates over prose rules

From the execution protocol. **This is the principle that generated most of the framework's
CI surface, and it has never been written down in the framework's own documents.**

**The observed failure mode was rules-in-prose:** a 100-line skill read once at session
start, with its rules dropped by mid-session. Four fixes were adopted:

1. **Rules live in the queued task, not the skill.** The skill keeps at most five universal
   rules; everything task-specific is restated at point of use, every round.
2. **A mandatory self-check block ends every implementer report** — build output pasted,
   gate run and clean, files touched equal to files the task names, each acceptance
   criterion quoted with its evidence (command plus output). A blank or hand-waved entry is
   an automatic send-back.
3. **Machine gates over prose rules.** *When reviews keep catching the same rule violation,
   prefer adding a check to `scripts/ci/` over adding a paragraph to the skill.*
4. **Rebuild rules replace migration rules.** What carries unchanged: the reviewer
   re-verifies everything; minimal change; every changed line traces to the queued task.

Fix 3 is why `check-genericity.sh`, `check-english-only.mjs`, `check-scan-root-docs.mjs`,
`check-framework-docs.mjs`, `check-soundscape-schema-docs.mjs`, and
`check-upgrade-state.sh` exist rather than being paragraphs in `AGENTS.md`. It is also the
standing answer to "should this be a rule or a check?": if it has been violated more than
once, it is a check.

**A related discipline, worth stating because the guards embody it:** an assertion that
cannot fail is not evidence. Every gate in this repository that asserts an absence carries
planted inverse fixtures, and every selftest proves the guard fails on each defect class.
That convention comes from the same place as fix 2.

**Model policy.** The implementer model was fixed per task — the larger model for
extraction, genericity, and design-sensitive work; the smaller one for mechanical ports.
Reviewer defaults to the smaller model, with the larger one for design-parity acceptance
rounds and for the review that closes each phase. **No silent model substitution;** a swap
is a maintainer call. The dev-plugin packets carry this forward as their `Model:` field.

**Session-unit rule.** One session produces one reviewable commit group — roughly six files
of changed logic, or one page surface. Anything larger is split at queue time by the
reviewer; the implementer never re-scopes its own task.

*The two-terminal implementer/reviewer loop and its handoff files that these rules were
written for are dead as process — replaced by the dev plugin's execute/review/verify
lifecycle against a tracker. The four fixes outlived the loop they were written for, which
is why they are here and the loop mechanics are not.*

## 4. Risk register

Six risks, with the mitigation each produced. Five are still live.

| # | Risk | Mitigation, and where it lives now |
|---|---|---|
| 1 | **Design-parity failure repeats.** Highest-consequence. | Design is copied as files, never described. Side-by-side screenshot acceptance with human sign-off gating the phase exit; visual-regression baselines from day one. **Fallback: copy the reference implementation wholesale and re-genericize, never re-prompt from description** (`dev_docs/SPEC.md §Risk controls`). |
| 2 | **Genericity erodes and the cut becomes painful** — the trap that motivated everything. | CI gate from the first phase, denylist seeded from place names; config is the single ingress; acceptance required standing up a real second place end to end, which *proves* the cut rather than asserting it. |
| 3 | **The framework cut slips because instance features are more fun** — the deferral trap. | Structural, not willpower: the feature phases declare a dependency on the framework shipping, so the cut cannot legally be skipped. Reordering is a scope change requiring an explicit maintainer call. |
| 4 | **Two-repo drift after the cut.** | The four-part determinism argument in §2. Acceptance was a demonstrated clean tag merge. The ownership rule closes the remaining hole. |
| 5 | **Losing future upstream improvements.** | **Accepted cost, priced consciously.** Upstream stays readable; adoption becomes deliberate cherry-picking of *ideas*, re-implemented generic, never merges. Trigger to look: upstream tagged releases, skimmed quarterly. Nothing automatic. |
| 6 | **Over-engineering for hypothetical adopters.** | A framework feature exists only if a real instance uses it, or it is one of the named adopter needs. Everything else waits for a second real adopter to ask. Now `dev_docs/PRD.md`'s `No framework features for hypothetical adopters`. |

Risk 5 is the only one that is fully discharged rather than mitigated: it was accepted, and
the quarterly skim is the whole of the response.

## 5. Deferral discipline: named triggers, never "dormant"

The disposition of the inherited system used one rule that is worth restating as general
doctrine, because it is the sharpest anti-deferral device in the whole plan:

> Every deferred item carries a **named trigger**. There is no "dormant".

"Delete-now" meant: not extracted, no successor planned, dies with the archive. Anything
kept for later had to name the observable event that would revive it. Representative
triggers, de-placed:

| Deferred thing | Named trigger |
|---|---|
| A speciation/fork graph page | 3+ live instances exist (such a graph with one node is noise) |
| Contributor statistics generation | A second human contributor lands a merged PR |
| Analytics fetchers | The analytics accounts actually exist |
| Adding a second language | The maintainer decides to launch one; the cost is one wrapper directory and a config entry, by design |
| Publishing the CLI to a package registry | The second external adopter appears, or the template flow shows friction |

The value is that "later" becomes checkable. A reviewer can ask whether the trigger has
fired; nobody can ask whether it is "time yet". When Phase 7 through 11 defer something,
this is the form the deferral takes.

## 6. Stated non-goals that came from here

Recorded so a future reader can trace each `dev_docs/PRD.md` non-goal to its source:

- **No paid hosting or infra** — from the cost analysis (`upstream-reference.md §10`) plus
  the AWS comparison (`platform-notes.md §2.10`), which together show the free tier is
  sufficient and the alternative starts at $15-175/month.
- **No build-time OG generation, ever** — `platform-notes.md §1`.
- **No direct-push automation** — a deliberate divergence from the upstream routine model,
  which shipped straight to main (`upstream-reference.md §5`).
- **No fork continuation, no upstream merging** — §1.1 above, and risk 5.
- **Not carrying the scale machinery** — the disposition table, which stays in instance #1's
  history.
- **No framework features for hypothetical adopters** — risk 6.
- **English-only through the current roadmap** — the multi-language design existed and was
  deferred behind a named trigger (§5), not forgotten.
