# UPGRADE — Pulling framework releases into an instance

Companion to `DEPLOY.md`. Every command is copy-pasteable. This is the manual git
flow for non-AI users; the `/sekai-upgrade` skill (`.agents/skills/sekai-upgrade/`) drives the
identical steps for an AI CLI. Keep the two in sync.

Instances track the sekai-kb framework by merging **immutable release tags, never
framework `main`** — the tagged-release decision and the repo-topology contract behind
it live with the framework's own decision records in the
[sekai-kb repository](https://github.com/wilsonkichoi/sekai-kb), which adoption does not
copy into your instance. A tag is reproducible: everyone
at `sekai-kb-v1.2.3` has byte-identical
framework code, and the merge is deterministic because instance-owned files carry
`.gitattributes merge=ours`.

> A fuller `UPGRADE.md` (edge cases, rollback) is formalized in task 9.3; this is
> the working runbook the release discipline ships with (task 5.4).

---

## Establishing the merge base (one-time, first upgrade only)

**Why this step exists.** A GitHub "Use this template" clone — and the first
instance, whose squash-merge history shares no commits with the framework even
though the template was cut from it — has a git history **unrelated** to
sekai-kb's. Git therefore has no common ancestor to diff against, so the first
merge must be told the histories are unrelated. That first merge creates a real
merge commit with the framework tag as a parent; from then on every
`git merge sekai-kb-vX.Y.Z` is a one-command incremental merge with the previous
tag as the computed base.

**Chosen mechanism: an `--allow-unrelated-histories` merge, not a graft.** A
`git replace --graft` would fake an ancestor without a merge commit, but graft
refs are local — they do not survive a fresh clone or reach CI, so the instance
would build differently for every contributor. A merge commit is permanent,
pushed, and identical for everyone. That determinism is the whole point (the
framework SPEC's §Risk controls, "Two-repo drift", upstream in the
[sekai-kb repository](https://github.com/wilsonkichoi/sekai-kb)), so the merge wins
over the graft.

Run once, from the instance repo root (already done for the first instance in task
5.4 — this is the reproducible record):

```bash
# 1. Enable the `ours` merge driver. `.gitattributes merge=ours` names a driver
#    called `ours` that git does NOT ship built-in — without this config line the
#    attribute silently no-ops and a merge overwrites your place content/config.
#    Git config is per-clone (not version-controlled), so every clone of this
#    instance runs this once:
git config merge.ours.driver true

# 2. Instance-owned files must be merge=ours BEFORE the first merge, or the merge
#    will try to overwrite your place content/config. Confirm .gitattributes lists
#    them (see "Instance-owned files" below), then:
git remote add framework https://github.com/wilsonkichoi/sekai-kb.git
git fetch framework --tags
TARGET=sekai-kb-v1.0.9
TARGET_VERSION="${TARGET#sekai-kb-}"

# 3. Classify dev-plugin state BEFORE merging (see "Dev-plugin state" below).
#    Every upgrade helper is run FROM THE TARGET TAG, never from the copy in your
#    tree: your copy came from the release you are leaving, so a release that fixes
#    a helper would otherwise never apply its own fix on the upgrade that ships it
#    ("Helper version skew" below). The extracted copy lives inside .git, never in
#    your tree. Releases before v1.0.5 did not ship this helper; `git show` fails
#    loudly on such a target rather than silently running an older one.
HELPER="$(git rev-parse --git-dir)/sekai-dev-plugin-state.mjs"
git show "$TARGET":scripts/upgrade/dev-plugin-state.mjs > "$HELPER"
STATE="$(node "$HELPER" classify)" && echo "dev-plugin state: $STATE"

# 4. Classify maintainer-doc state BEFORE merging (see "Maintainer-doc state"
#    below). Same tag-first extraction.
#    --from-tag takes the path set from the release you are merging, while path
#    presence is still read from your working tree. On the FIRST upgrade to a
#    release that introduces that list, your tree's scripts/init/writer.mjs still
#    predates it, so without the flag this exits 3 and cannot classify at all.
MDOCS_HELPER="$(git rev-parse --git-dir)/sekai-maintainer-docs-state.mjs"
git show "$TARGET":scripts/upgrade/maintainer-docs-state.mjs > "$MDOCS_HELPER"
node "$MDOCS_HELPER" classify --from-tag "$TARGET"

# 4b. Capture adopter-owned package identity, and the pre-merge FRAMEWORK-VERSION,
#     before the mixed-ownership manifests merge. Same tag-first extraction, and
#     this helper is why the rule exists: the FRAMEWORK-VERSION capture arrived in
#     v1.0.15, so an earlier tree copy does not capture the marker at all.
PACKAGE_HELPER="$(git rev-parse --git-dir)/sekai-package-state.mjs"
git show "$TARGET":scripts/upgrade/package-state.mjs > "$PACKAGE_HELPER"
PACKAGE_STATE="$(node "$PACKAGE_HELPER" capture)"
#    Exit 3 = inconsistent state (only one half of the dev workflow present), or a
#    maintainer-doc path set that could not be derived: stop here and repair it
#    deliberately, as the diagnostic says.

# 4d. Report the framework-owned files you have diverged on, with the framework's
#     incoming value beside yours (see "Framework-owned files" below). Same
#     tag-first extraction; the helper writes nothing and resolves nothing.
#     On THIS flow it has no merge base to measure against — that is what the
#     --allow-unrelated-histories in step 5 is about — so it says so and claims
#     nothing. Run it anyway: the answer is the honest one, and every upgrade
#     after this one gets the full report.
DIVERGENCE_HELPER="$(git rev-parse --git-dir)/sekai-framework-divergence.mjs"
git show "$TARGET":scripts/upgrade/framework-divergence.mjs > "$DIVERGENCE_HELPER"
node "$DIVERGENCE_HELPER" report --target "$TARGET"

# 5. The first merge — the ONLY one that needs --allow-unrelated-histories:
git merge --allow-unrelated-histories "$TARGET"

# 6. Reconcile dev-plugin, maintainer-doc, and package state immediately after the
#    merge command, whether it
#    stopped on conflicts or completed on its own:
node "$HELPER" reconcile --state "$STATE"
node "$MDOCS_HELPER" reconcile
node "$PACKAGE_HELPER" reconcile "$PACKAGE_STATE"
```

> **The `merge.ours.driver true` line is load-bearing and per-clone.** It is not
> stored in the repo. A fresh clone of this instance, or a CI checkout that does a
> tag merge, must set it first or `merge=ours` does nothing. `/sekai-upgrade` sets it in
> its preflight; the wizard-adopted instance's first `/sekai-upgrade` does the same.

The merge outcome, file by file:

- **Instance-owned files** (`place.config.ts`, `knowledge/**`, `CLAUDE.md`, …) —
  kept as yours automatically by `merge=ours`. No conflict. **Caveat:** `merge=ours`
  protects files you *already have* from being overwritten; it does **not** stop a
  theirs-only file under those paths from being *added*, and it does **not**
  preserve a path you deliberately *deleted*. If the template ships demo
  content (`knowledge/` articles for its example place), that content lands in your
  instance on the first merge — strip it in the cleanup step below. The deleted-path
  case is `.agent-toolkit/` on a wizard-adopted instance; step 5's `reconcile` keeps
  it absent.
- **Files only the framework has** (e.g. `.agents/skills/`, `SystemDiagram.astro`)
  — added to your instance.
- **Files only you have** (your docs, research, tracker config) — untouched; a
  merge never deletes a path absent on the incoming side.
- **Framework-owned files you also carry** (`src/`, `scripts/`, `workers/`,
  `.agents/skills/`) — a file whose two sides are byte-identical merges cleanly even
  with unrelated histories, so what conflicts here is the set where the content
  actually differs: a framework change made since your clone was cut, an edit of your
  own, or both. **Each one is a decision, and it is yours.** Framework-owned means the
  framework ships that file and every release replaces it wholesale; it does not mean
  you may not edit it. Taking the framework's version is the default that costs
  nothing later. Keeping your own is supported, and costs this same conflict again on
  every release until you upstream it.

```bash
# v1.0.8 -> v1.0.9 only: keep the adopter's VERSION when the framework deletes
# its mistaken template copy.
git diff --name-only --diff-filter=U | grep -Fxq VERSION \
  && git checkout --ours VERSION && git add VERSION || true

# List what is left to decide. Nothing is resolved for you: a loop that took one
# side for every path would silently delete work you meant to keep.
git diff --name-only --diff-filter=U
```

Then, one file at a time, read both sides before choosing. Step 4d's report already
named each of these files with your value beside the framework's; `:2:` is your version
and `:3:` is the framework's incoming one, which is how you read the same pair once the
merge is in progress. The target's CHANGELOG entry (printed in the
routine flow's step 3, and readable here with
`git show "$TARGET":CHANGELOG.md`) is what says why the framework's side changed:

```bash
git diff ":2:<file>" ":3:<file>"                 # yours vs the framework's incoming
git checkout --theirs -- <file> && git add <file>  # take the framework's
git checkout --ours   -- <file> && git add <file>  # keep yours, knowingly
```

Then remove the template-only marker (an instance is not the template) and any
demo content the merge added. A "Use this template" adopter reseeds via `/sekai-adopt`;
an existing instance re-basing onto the framework strips the template's demo
articles so only its own `knowledge/` remains:

```bash
git rm --ignore-unmatch .sekai-template
# Demo articles added by the merge = present in the tag's knowledge/, absent from
# your pre-merge tree. `git merge` set ORIG_HEAD to that pre-merge tree at merge
# start (correct whether or not the merge is committed yet — unlike HEAD@{1}).
# List and remove them (yours are untouched by merge=ours):
comm -13 <(git ls-tree -r --name-only ORIG_HEAD -- knowledge/ | sort) \
         <(git ls-tree -r --name-only "$TARGET" -- knowledge/ | sort) \
  | while read -r f; do git rm -f -- "$f"; done
```

Build-verify, finalize, record the version:

```bash
npm run build
git commit --no-edit
# Until this line FRAMEWORK-VERSION still holds the OLD value that step 6 restored.
# Assert the bump instead of assuming the write took: a silent failure here leaves
# your instance reporting a framework version it never adopted.
printf '%s\n' "$TARGET_VERSION" > FRAMEWORK-VERSION
test "$(cat FRAMEWORK-VERSION)" = "$TARGET_VERSION" \
  || { echo "STOP: FRAMEWORK-VERSION is not $TARGET_VERSION after the bump"; exit 1; }
git add FRAMEWORK-VERSION && git commit -m "chore: FRAMEWORK-VERSION -> $TARGET_VERSION"
```

From here on, upgrades are the routine flow below — no `--allow-unrelated-histories`
ever again.

---

## Routine upgrade (every release after the base is set)

```bash
# 0. The ours driver must be set in THIS clone (see the establishment section —
#    it is per-clone, not version-controlled). Harmless to re-run:
git config merge.ours.driver true

# 1. Working tree clean? (stash or commit first — a merge onto a dirty tree bites.)
git status --porcelain

# 2. VERSION is your instance release and never changes here. Pick a framework
#    target above FRAMEWORK-VERSION.
git fetch framework --tags
git tag -l 'sekai-kb-v*' | sort -V
cat VERSION
cat FRAMEWORK-VERSION
TARGET=sekai-kb-v1.0.9
TARGET_VERSION="${TARGET#sekai-kb-}"

# 3. Read the target's CHANGELOG entry first — especially its Upgrade note.
git show "$TARGET":CHANGELOG.md | awk -v h="## [${TARGET_VERSION#v}]" '$0==h{p=1} p&&$0!=h&&/^## \[/{exit} p'

# 4. Classify dev-plugin state BEFORE merging (see "Dev-plugin state" below).
#    Exit 3 = inconsistent state: stop and repair it deliberately.
#    Every helper is run FROM THE TARGET TAG, never from the copy in your tree —
#    see "Helper version skew" below for why the tree copy is never the right one.
HELPER="$(git rev-parse --git-dir)/sekai-dev-plugin-state.mjs"
git show "$TARGET":scripts/upgrade/dev-plugin-state.mjs > "$HELPER"
STATE="$(node "$HELPER" classify)" && echo "dev-plugin state: $STATE"

# 4b. Classify maintainer-doc state BEFORE merging (see "Maintainer-doc state"
#     below). Per path, so owning one of those paths and not the others is fine.
#     --from-tag takes the path set from the release being merged; presence still
#     comes from your working tree. Exit 3 = the path set could not be derived:
#     stop rather than merge blind.
MDOCS_HELPER="$(git rev-parse --git-dir)/sekai-maintainer-docs-state.mjs"
git show "$TARGET":scripts/upgrade/maintainer-docs-state.mjs > "$MDOCS_HELPER"
node "$MDOCS_HELPER" classify --from-tag "$TARGET"

# 4c. Capture adopter-owned package identity and version, and the pre-merge
#     FRAMEWORK-VERSION, before merging. merge=ours cannot hold FRAMEWORK-VERSION
#     on its own: a merge driver runs only on a three-way content merge, so if you
#     have not edited the file since the merge base git fast-forwards the incoming
#     value in and the file claims a release nothing has verified yet. This capture
#     arrived in v1.0.15, which is exactly why the helper comes from the tag: an
#     earlier tree copy has no FRAMEWORK-VERSION handling at all.
PACKAGE_HELPER="$(git rev-parse --git-dir)/sekai-package-state.mjs"
git show "$TARGET":scripts/upgrade/package-state.mjs > "$PACKAGE_HELPER"
PACKAGE_STATE="$(node "$PACKAGE_HELPER" capture)"

# 4d. Report the framework-owned files you have diverged on, BEFORE the merge
#     generates conflicts. For each one the report names your value and the
#     framework's incoming value — key by key for a wrangler.toml, as the
#     differing region for anything else. It writes nothing and resolves nothing;
#     step 7 is where you decide. Reading it here rather than from the conflict
#     list is deliberate: the conflict list holds only what git could not resolve
#     on its own, so an edit git merged silently — yours kept because the
#     framework never touched that file — never appears in it at all.
DIVERGENCE_HELPER="$(git rev-parse --git-dir)/sekai-framework-divergence.mjs"
git show "$TARGET":scripts/upgrade/framework-divergence.mjs > "$DIVERGENCE_HELPER"
node "$DIVERGENCE_HELPER" report --target "$TARGET"

# 5. Merge the tag (never main). merge=ours keeps your content/config.
git merge --no-ff "$TARGET" -m "chore: upgrade framework to $TARGET"

# 6. Reconcile dev-plugin, maintainer-doc, and package state immediately after the
#    merge command — whether it stopped on conflicts or completed on its own.
#    Stripped: the framework's .agent-toolkit/ is removed again (conflicts and
#    additions alike) so you never resolve a dev-plugin conflict by hand.
#    Installed: nothing is touched; your config and rules are asserted
#    byte-for-byte unchanged, and any framework path the merge ADDED under
#    .agent-toolkit/ is reported for you to keep or remove. The maintainer-doc
#    reconcile applies the same rule per path: absent stays absent, yours stays
#    yours, and it stops if the merge touched a document you own. The package
#    reconcile also puts your pre-merge FRAMEWORK-VERSION back, so after this it
#    still reads the version you were on — step 8 is what changes it.
#    reconcile needs no --from-tag: the wizard in your tree is the tag's by now.
node "$HELPER" reconcile --state "$STATE"
node "$MDOCS_HELPER" reconcile
node "$PACKAGE_HELPER" reconcile "$PACKAGE_STATE"

# 7. If conflicts remain: they can only be framework-owned files you edited locally,
#    or the one-time VERSION modify/delete conflict when leaving v1.0.8. Keep the
#    adopter VERSION in that one case. Every other one is a per-file decision, and
#    nothing here resolves them for you. Step 4d already named these files with both
#    values; this list is the subset git could not settle by itself.
git diff --name-only --diff-filter=U
#    For each file: read the CHANGELOG line for this release (step 3), then read your
#    side against the framework's incoming side, then choose. Taking the framework's
#    version is the default and ends the conflict. Keeping your own edit is a
#    supported outcome — it is your repository — and the cost is that this same file
#    conflicts again on every release until you upstream the change to sekai-kb,
#    which is the recommended route precisely because it makes the conflict stop:
#    git diff ":2:<file>" ":3:<file>"                   # yours vs framework incoming
#    git checkout --theirs -- <file> && git add <file>   # take framework
#    git checkout --ours   -- <file> && git add <file>   # keep yours, knowingly
#    git commit --no-edit                                # finalize the merge

# 8. Build-verify, then record the newly adopted framework version. Until this
#    point FRAMEWORK-VERSION still holds the OLD value that step 6 restored — that
#    is the contract, not a bug. Assert the bump rather than assuming the write
#    took effect.
npm run build
printf '%s\n' "$TARGET_VERSION" > FRAMEWORK-VERSION
test "$(cat FRAMEWORK-VERSION)" = "$TARGET_VERSION" \
  || { echo "STOP: FRAMEWORK-VERSION is not $TARGET_VERSION after the bump"; exit 1; }
git add FRAMEWORK-VERSION && git commit -m "chore: FRAMEWORK-VERSION -> $TARGET_VERSION"
```

**New `place.config` keys never require surgery.** Every new config key defaults
to feature-off when absent (the framework SPEC's §Negative requirements, "New
`place.config` keys must be absent-safe", upstream in the
[sekai-kb repository](https://github.com/wilsonkichoi/sekai-kb)), so a release
that adds `features.newthing` builds on your instance untouched; the CHANGELOG
Upgrade note tells you what you are opting out of. Enable it by editing
`place.config.ts` yourself when you want it — the upgrade never edits your config.

Pushing `main` deploys (see `DEPLOY.md` §CI) — that step is yours to make.

---

## Framework-owned files: a default and an upgrade contract, not a lock

`src/`, `scripts/`, `workers/`, and `.agents/skills/` are framework-owned: the
framework ships them, and every release replaces them wholesale. That is a statement
about where those files come from, not a permission boundary. This is your
repository, and you may edit any file in it.

What an edit costs is stated rather than prevented. A framework check running in your
repository fails your build only for something that harms someone other than you —
account-scoped collisions (a Worker `name`, a D1 `database_name`), committed
credentials, security boundaries. Every other divergence from a framework-owned file
**warns**: `npm run worker-config:check` names the file, the key, your value, the
framework's, and the cost, and your CI run carries it as an annotation rather than a
failure. The cost is the conflict this document is about: that file conflicts on every
release until the two sides agree again.

That is said twice, on purpose, and the second time is at the merge. Step 4d of both
flows above runs:

```bash
node "$DIVERGENCE_HELPER" report --target "$TARGET"
```

which walks the framework-owned trees — `src/`, `scripts/`, `workers/`, and
`.agents/skills/` — and, for every path whose content differs from your merge base with
the target, prints your value beside the framework's incoming one: key by key for a
`wrangler.toml` (`[vars] RELEVANCE_FLOOR`, yours, the framework's), as the differing
region for anything else. It names how each path meets the merge (yours kept, both
sides changed, a modify/delete, or already settled — your side and the framework's
incoming side now being the same content, which is where upstreaming an edit leaves
you on the release that ships it back) so a file git will merge silently is visible
too. It
writes nothing, stages nothing, and resolves nothing in either direction: the decision
is yours, and it is made with both values in front of you rather than reconstructed
from two revisions afterwards. On the very first merge there is no common ancestor to
measure against, so it says that and claims nothing.

Three ways to make it agree, in order of what they cost you later:

1. **Use the configured seam if one exists.** A value with a `place.config.ts` key
   (`workers.chatRelevanceFloor` and the rest of the table in `DEPLOY.md`) belongs
   there: instance-owned, never in conflict, and it reaches the same deployed value.
2. **Upstream the change to sekai-kb.** Recommended for anything without a seam: it
   comes back as a tagged release, every instance gets it, and the file stops
   conflicting for you.
3. **Keep the fork.** Supported. You resolve this one file on each upgrade, with the
   framework's incoming version in front of you.

## Instance-owned files (`merge=ours`)

These paths carry `merge=ours` in the instance `.gitattributes`, so framework tag
merges keep the instance's version:

| Path | Why instance-owned |
| ---- | ------------------ |
| `place.config.ts` | the place's identity and feature flags |
| `knowledge/**` | the place's articles (the content SSOT) |
| `public/media/**` | the place's images and media |
| `CNAME` | the instance's custom domain |
| `CLAUDE.md` | one-line `@AGENTS.md` shim (written by the wizard) |
| `AGENTS.md` | instance-owned agent-instruction SSOT (rendered by the wizard) |
| `README.md` | instance repo front page (rendered by the wizard) |
| `CHANGELOG.md` | instance work history; framework notes are read from the target tag |
| `VERSION` | the instance's own release version; framework upgrades never change it |
| `FRAMEWORK-VERSION` | adopted framework tag; bumped explicitly after upgrade verification |
| `scripts/ci/genericity-denylist.local.txt` | the place's own denylisted terms |
| `.agent-toolkit/**` | dev-plugin state (config + promoted rules) — each repo owns its own |
| `dev_docs/**` | your own product, architecture, delivery, or decision records, plus any captured baselines, at the framework's maintainer-doc path |

The last entry is inert for most instances: the wizard strips the framework's
copy, so there is nothing at that path to protect. It matters for an instance that
writes its **own** product, architecture, delivery, or decision records there, which
the maintainer-doc split explicitly allows — the attribute ships with the framework
so such an instance is protected from its first merge onward rather than having to
remember. It is one directory rather than a list of files, so a document you add
later is protected without an edit here. Its *absence* is a different problem the
attribute cannot solve; see "Maintainer-doc state" below.

Adopters add their own instance-specific files to `.gitattributes` the same way.
The list is append-only from the framework baseline; the framework never removes a
`merge=ours` entry, so an upgrade cannot start overwriting a file you own.

**`merge=ours` also does nothing on a file you have not edited.** The driver runs
only on a three-way content merge. If your copy is identical to the merge base and
the framework changed its copy, git resolves to theirs without consulting the
driver at all. That is why `FRAMEWORK-VERSION` is captured before the merge and
restored after it (steps 4c and 6) instead of being left to the attribute: it must
still read the version you were on until the explicit post-verification bump.

`package.json` and `package-lock.json` are mixed-ownership files, so they do not
use `merge=ours`. Sekai owns scripts, dependencies, and lock resolution. The
adopter owns package name, description, privacy, and the version mirrored from
`VERSION`. Every upgrade captures those adopter fields before merging, takes the
incoming framework manifests, then restores the captured fields with
`scripts/upgrade/package-state.mjs`. This deterministic reconciliation prevents
recurring framework/adopter version conflicts while still delivering dependency
updates.

Sekai v1.0.8 mistakenly carried a template `VERSION`. The first later upgrade
deletes that framework path, which can produce a modify/delete conflict against
the adopter's copy. Resolve that one path with `git checkout --ours VERSION &&
git add VERSION`. Subsequent Sekai releases do not track `VERSION`, so the conflict
does not recur.

**`merge=ours` protects content, not absence.** It applies to a path that exists on
both sides of the merge. A path you deliberately deleted gets no merge driver at
all: on shared history the framework's change to it becomes a modify/delete
conflict, and on an unrelated-history first merge the framework's whole tree is
added back as theirs-only content. That is exactly the `.agent-toolkit/` case, and
it is why the flows above carry a classify step and a reconcile step.

## Helper version skew — always run the target tag's helper

Every `scripts/upgrade/*.mjs` helper the flows above bootstrap is extracted from
`$TARGET` into `.git/`, never taken from `scripts/upgrade/` in your working tree.
The tree's copy is not a cache of the same thing: it is the copy that shipped with
the release you are **leaving**. Preferring it means a release that *changes* a
helper never gets to apply that change on the upgrade that ships it — the one
upgrade where it matters.

This is not hypothetical. The `FRAMEWORK-VERSION` capture in `package-state.mjs`
arrived in v1.0.15; an instance still on v1.0.11 has a tree copy with no
`FRAMEWORK-VERSION` handling at all. Bootstrapping that copy to adopt v1.0.15
would capture nothing, restore nothing, and leave the marker claiming a release
that no build had verified — precisely the defect v1.0.15 exists to fix.

Two consequences follow, both intended:

- The extraction is unconditional. There is no `test -f` fallback to the tree copy,
  because the tree copy is never the right one.
- A `$TARGET` that predates a helper fails loudly on `git show` instead of silently
  running an older helper. Adopt a release that carries the helper (the classify
  steps name the minimum tag) rather than working around the error.

`scripts/upgrade/check-upgrade-state.sh` case 13 is the regression gate: it derives
the bootstrap form from these documents and drives the skew end to end against a
fixture whose tree copy predates the capture.

## Dev-plugin state (`.agent-toolkit/`) — classified on every upgrade

`AGENTS.md` and `.agent-toolkit/**` are the dev-plugin's own files, and whether the
dev workflow is installed is **persistent instance state** the upgrade preserves in
either direction (recorded in the framework's decision records upstream).
`/sekai-upgrade` and the flows
above classify it before merging with `dev-plugin-state.mjs classify`, bootstrapped
from the target tag as "Helper version skew" above requires:

| State | Means | The upgrade does |
| ----- | ----- | ---------------- |
| `stripped` | `.agent-toolkit/` absent **and** no active `@.agent-toolkit/dev.md` reference in `AGENTS.md`/`CLAUDE.md` | Keeps both absent. `reconcile --state stripped` removes every `.agent-toolkit/` path the merge brought in — conflicted or cleanly added — and amends the merge commit if the merge already committed, so the framework tree is never committed into your instance. You never resolve a dev-plugin conflict by hand. |
| `installed` | your own `.agent-toolkit/dev.md` **and** the active reference are both present | Keeps your config and rules. `merge=ours` does the work; `reconcile --state installed` mutates nothing and asserts your `.agent-toolkit/**` is byte-for-byte unchanged, then reports any framework path the merge *added* under it for you to keep or `git rm -f`. |
| inconsistent | only one half present (a tree with no active reference, or a reference with no tree) | **Stops before merging**, exit 3, with a diagnostic naming both deliberate repairs. The upgrade never guesses whether to delete or install dev-plugin state. |

A wizard-adopted instance is `stripped`: `npm run init` removes `.agent-toolkit/`
and regenerates `AGENTS.md` without the framework's dev-plugin sentinel block, both
being framework-development state rather than adopter content. Framework dev-plugin
state is never reacquired implicitly — running `dev:setup`, which writes your own
config and reference, is the only way in. A framework or first-instance checkout
that keeps its own `.agent-toolkit/` is `installed` and relies on `merge=ours` so a
framework tag never replaces its dev config with the framework's.

## Maintainer-doc state — classified on every upgrade

The framework keeps its own maintainer documents — its product, architecture,
delivery, and decision records — beside the code they govern, and `npm run init`
removes them from your clone: they describe how the framework is built, never how
your instance is operated. Your editorial playbook and this runbook are adopter
docs and always stay.

Their absence has the same problem as an absent `.agent-toolkit/`: `merge=ours`
cannot protect a path you do not have, so without a reconcile step every release
that touched those documents would put the framework's copies back in your tree.
`maintainer-docs-state.mjs classify`, bootstrapped from the target tag as "Helper
version skew" above requires, records the split before the merge, **per path** — the paths are independent, and there is no inconsistent
state to stop on:

| Per-path state | Means | The upgrade does |
| -------------- | ----- | ---------------- |
| `stripped` | you have no document at that path (every wizard-adopted instance, for every path) | Keeps it absent. `reconcile` removes whatever the merge introduced there — conflicted or cleanly added — and amends the merge commit if the merge already committed. You never resolve one of these conflicts by hand. |
| `owned` | you keep your own document at that path | Keeps yours. If the merge changed or deleted a file there, `reconcile` **restores** your pre-merge content — amending the merge commit if git already committed it — and never deletes anything, then reports any framework file the merge *added* underneath it for you to keep or `git rm -f`. |

Owning some of these paths and not others is a normal state and never stops the
upgrade.

The restore is not a fallback for a misconfigured clone; it is the normal path.
`merge=ours` names a driver git runs **only on a three-way content merge**, so if
you kept the framework's document at one of these paths verbatim, your copy still
equals the merge base, git resolves to theirs, and the attribute never fires — with
the attribute set and the driver configured, both. Keeping a framework document
unedited is the common case, so the upgrade puts your pre-merge content back rather
than stopping. This is the same mechanic that makes `FRAMEWORK-VERSION` need an
explicit capture and restore, and it applies to every `merge=ours` path.

What does stop the upgrade is an owned path you never **claimed**: the merge changed
a document you keep, and `git check-attr merge` reports no `ours` for it, so nothing
in your `.gitattributes` says that path is yours. Reverting the framework's edit
there would be the upgrade deciding ownership on your behalf, so it stops and tells
you to mark the path. The diagnostic prints what it observed — the attribute value
git resolved for each failing path, and whether `merge.ours.driver` is configured in
this clone — and prescribes only the repairs those observations support, so it never
sends you to fix something already in place. It also names the undo that works from
where you are: `git merge --abort` while the merge is still in progress,
`git reset --hard ORIG_HEAD` once git has committed it (which it does when the
framework's edits applied without a conflict). The upgrade never lets the framework's
copy overwrite a document you wrote.

The path set is derived from the init wizard's own strip list at runtime rather
than restated, so the upgrade cannot disagree with what adoption removed; if that
list cannot be read, the helper stops instead of assuming there is nothing to
protect. `--from-tag "$TARGET"` is what makes that derivation work on the **first**
upgrade to a release that introduces the list: extracting the helper from the tag
is not enough, because it reads `scripts/init/writer.mjs`, and on exactly that
upgrade your tree's copy still predates the export. Pass the flag on every
`classify` — the release you are merging is the authority on what it strips.

## Reconciling instance-owned starter files (every upgrade)

`merge=ours` keeps your version of an instance-owned file and **silently drops the
framework's changes** to it. That is what you want for `place.config.ts`,
`knowledge/**`, media, `CHANGELOG.md`, and `VERSION`. But the *content-bearing starter* files the wizard seeded
— `AGENTS.md` above all, and `README.md` — started as framework boilerplate; a
release that improves that boilerplate would vanish with no signal. `CLAUDE.md` is
exempt: it is a pure one-line `@AGENTS.md` shim carrying no content that can diverge,
so if yours is anything but that single line, reset it to the shim rather than
reconciling it. After a merge, diff each content-bearing starter against the tag and
decide, file by file, whether to pull any framework improvement in (the `/sekai-upgrade`
skill does this conversationally):

`FRAMEWORK-VERSION` is not reconciled here: step 6 already restored the value you
were on, and the final upgrade step bumps it only after verification succeeds.

```bash
# Show where your AGENTS.md diverges from the tag you just merged, then read both
# sides and hand-pick improvements — never a blind overwrite (your edits win by
# default; that is the point of merge=ours).
git diff --no-index -- AGENTS.md <(git show sekai-kb-v1.0.2:AGENTS.md)
# Apply only the lines you want, then: git add AGENTS.md
```
