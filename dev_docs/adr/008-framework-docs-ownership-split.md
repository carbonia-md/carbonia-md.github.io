# ADR 008: Framework maintainer docs live in sekai-kb and are stripped at adoption

**Status:** Accepted (2026-07-28, maintainer-approved 2026-07-27)
**Deciders:** Wilson Choi
**Executes:** LB-61 (sekai-kb side) + LB-62 (instance #1 side)

## Context

Phases 6-11 are framework feature phases whose code executes in `sekai-kb` (ADR 004,
ADR 005). Their product intent, architecture contracts, delivery blocks, and accepted
decisions were all written in instance #1's repository, because that is where the
framework was built before it was cut out (ADR 002, held there as its own history).

The result was a repository that owns the code but not the documents governing it:

1. **Every framework session read its contracts from a sibling checkout.** An agent
   working in `sekai-kb` had no `dev_docs/SPEC.md` to cite and no ADR directory to check. The
   dev config's binding-docs list pointed across a repository boundary, so the contract a
   task must satisfy was only reachable if the other clone happened to exist locally.
2. **`/dev:plan` amended documents in a repository the work does not happen in.** A phase
   plan for framework code produced ROADMAP amendments in the instance repository, so the
   plan and the diff it governs could never appear in one review.
3. **The documents mixed two ownerships.** One SPEC held both the framework's contracts
   (repo topology, build pipeline, negative requirements) and one instance's rebuild
   history (the extraction map, the inherited-fork disposition). A reader could not tell
   which statements bound the framework and which recorded how the first instance came to
   exist.

A fourth constraint shaped the answer: whatever lands in `sekai-kb` ships to every
adopter through the GitHub template and every later tag merge. Framework maintainer
documents are exactly as irrelevant to an adopter as the framework's own dev-plugin state,
which ADR 006 ruling (c) already strips at adoption.

## Decision

**(a) The framework's own PRD, SPEC, ROADMAP, and ADRs live in `sekai-kb`, under
`docs/`.** `dev_docs/PRD.md`, `dev_docs/SPEC.md`, `dev_docs/ROADMAP.md`, and `dev_docs/adr/` are the
framework's product, engineering, and delivery SSOTs, beside the code they govern.

**(b) The split is by section, not wholesale.** The framework receives the sections that
state framework contracts. Instance #1 keeps the sections that record its own rebuild:
the extraction map (which inherited file seeded which framework file), the inherited-fork
disposition table, phases 0-5 and their packet-shaping notes, and ADRs 001 and 002, which
decided how that one instance was rebuilt. ADRs 003 through 007 move, keeping their
numbers and filenames, because each governs framework code. Continuity of ADR numbering
across the two repositories is deliberate: renumbering would break every existing citation
for no gain, and the moved files carry a header note saying where they came from.

**(c) `sekai-kb` gets its own PRD, written fresh.** The framework's customers, north star,
and non-goals are not the first instance's with the place name removed. It is written from
the generic half of the source document, not copied.

**(d) The init wizard strips the maintainer docs, exactly as it strips
`.agent-toolkit/`.** `npm run init` removes `dev_docs/PRD.md`, `dev_docs/SPEC.md`,
`dev_docs/ROADMAP.md`, and `dev_docs/adr/` from an adopter clone. `docs/playbook/` and
`docs/runbook/` stay: those are how an adopter writes articles and operates the site.
`scripts/init/check-init.sh` asserts the strip on a tree the wizard really stripped, with
planted inverse fixtures proving the assertion can fail.

**(e) No file that survives adoption may link into a stripped path.** A dangling
reference in an adopter's tree is worse than no reference, because the reader cannot tell
whether the document was deleted or never existed. `scripts/ci/check-framework-docs.mjs`
derives the stripped path list from the wizard itself and fails CI on any link into it
from a file adoption keeps. Bare citations by name ("ADR 004") are not links and remain
legal in framework code comments; adopter-facing prose that cites a maintainer doc points
at the upstream repository instead.

**(f) Instance #1 must mark the four paths `merge=ours` before adopting the release that
carries them.** It has its own documents at exactly those paths. Without the attribute the
first tag merge that includes framework maintainer docs conflicts with, or overwrites, the
instance's own PRD, SPEC, and ROADMAP. This is why the release carries an upgrade note and
why the instance-side work is a separate task (LB-62).

**(g) The tracker stays a single project.** One project ("LB Rebuild") continues to span
both repositories. The alternative — one project per repository — would split a
dependency chain that genuinely crosses the boundary (a framework release and the
instance upgrade that adopts it are two tasks in one phase gate) and would make phase
milestones ambiguous. A packet's `Execution repo:` field already names where its code
lands, which is the only routing information a session needs.

## Consequences

- A framework session resolves its contracts from its own checkout. `/dev:plan` for
  phases 6-11 reads and amends `sekai-kb/dev_docs/ROADMAP.md`.
- The two repositories hold the same four paths with different content and different
  owners. That is intended, and `merge=ours` on the instance side is what keeps it
  stable. Until LB-62 lands, both repositories carry copies; that intermediate state is
  planned, not drift.
- Adopters see no change: the wizard removes all four paths, and the gate proves nothing
  they keep points at them.
- Moved prose was genericized to pass template-mode gates, which scan the whole tree. The
  moved documents therefore say "the instance" where they once named a place, and
  "the maintainer" where they named a person, except in ADR provenance headers, where
  naming the decider is the point.
- **A stripped adopter would reacquire the maintainer docs on upgrade.** The wizard strip
  protects a *fresh* adoption only; a later framework tag merge re-adds the paths, because
  `merge=ours` cannot protect an absent path. This decision did not carry the fix. The
  **Addendum** below now does.

## Addendum: maintainer-doc state across an upgrade (2026-07-28)

**Status:** Accepted. **Executes:** LB-63. Closes the open consequence above.

The problem is ADR 006's addendum in a second location. A stripped adopter has none of the
four paths; git therefore applies no merge driver to them and re-adds the framework's copies
on every tag merge that touched them — as theirs-only additions on an unrelated-history
first merge, as a modify/delete conflict on shared history. `/sekai-upgrade` classifies
maintainer-doc state before the merge and reconciles it immediately after, the same
before/after shape the dev-plugin helper uses. Five design questions separate this case from
that one:

**(a) Classification is per path, not whole-set.** Dev-plugin state is classified from two
signals — the tree and the active reference that activates it — so a half-present state is
an inconsistency that stops the upgrade. Maintainer docs have no activation signal:
pre-merge presence is the entire classification, and the paths are mutually independent.
An adopter may legitimately write their own product document at one of these paths and
never have a decision-record directory. Applying ADR 006's mixed-state hard stop would
break that adopter for doing something correct, so a partially owned set is a normal
state and never a stop. Present pre-merge = **owned**: never deleted, asserted unchanged.
Absent pre-merge = **stripped**: whatever the merge introduced there is removed.

**(b) The path set is derived from the wizard at runtime, never restated.** The helper reads
`scripts/init/writer.mjs`'s exported `MAINTAINER_DOCS` from the repository it operates on —
the same single source `scripts/ci/check-framework-docs.mjs` derives from. A hardcoded copy
in the upgrade path would drift from the strip it exists to preserve, and a helper that
names the paths in its own source would also have to be exempted from the
dangling-reference scan. The parser itself lives in the helper, because the helper must run
standalone when extracted from a tag (see (e)) and so cannot import it from the gate; the
gate imports it from the helper instead. One parser over one source, in one direction — the
two cannot read the wizard differently. If the wizard is missing or its array unparseable,
the helper stops rather
than guessing: a silently empty path set would classify every path as absent and delete
nothing while reporting success.

**(c) The classification is captured, not recomputed after the merge.** `classify` writes a
state file under `.git/`, in the `package-state.mjs` idiom, because after the merge the tree
no longer shows what the instance owned. `reconcile` re-derives the path list from the
*merged* tree, so a path the target tag newly declares maintainer-owned is also handled: it
is not in the captured state, and its pre-merge presence is read directly from the pre-merge
revision. A newer strip list therefore takes effect on the upgrade that introduces it,
rather than one release later.

**(d) Owned-but-unprotected stops the upgrade; it is never silently overwritten.** An
instance that carries these paths without `merge=ours` on them, or without
`merge.ours.driver` configured in that clone, hits a real content conflict or a driver
fallback. Reconcile treats any owned path that is unmerged or changed against the pre-merge
revision as a hard stop naming both repairs. The framework's copy never wins by default over
a document the instance wrote. Framework paths the merge *adds* under an owned directory are
**reported, not deleted** — the same rule ADR 006's addendum applies to framework
dev-plugin paths, for the same reason: that is a content decision the maintainer makes.

**(e) The helper is a sibling, not a generalization of the dev-plugin helper.**
`dev-plugin-state.mjs` is built around a tree plus an activation reference in an entry file;
maintainer docs have neither. Generalizing it would rewrite a shipped, regression-tested
contract to serve a case that shares only the before/after call shape. The sibling reuses
the hard-won mechanics — `ORIG_HEAD` for the pre-merge revision, `--git-path MERGE_HEAD`
resolved absolutely for linked worktrees, distinct-path counting over `git ls-files -u`,
amending the merge commit when git auto-committed it — and both are driven by the same
regression harness. Instances upgrading from a release older than this helper obtain it the
way they already obtain the dev-plugin one: extracted from the target tag into the git
directory, never into the working tree.

**Consequences of the addendum.** A stripped adopter's upgrade is clean with no manual
step, which retires the manual instruction in the v1.0.12 upgrade note. An instance that
owns documents at these paths must still mark them `merge=ours` before its first merge of a
release carrying them; the helper detects the omission and stops, but does not repair it.
`scripts/upgrade/check-upgrade-state.sh` covers both helpers, and its `--selftest`
non-vacuity proof extends to the new cases.
