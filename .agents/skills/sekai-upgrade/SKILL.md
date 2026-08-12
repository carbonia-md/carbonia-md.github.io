---
name: sekai-upgrade
description: |
  Pull a framework release into this instance. Adds/points the `framework`
  remote at sekai-kb, fetches tags, merges a requested `sekai-kb-vX.Y.Z` release
  tag (never framework `main`), build-verifies, walks any conflicts WITH the user
  alongside that version's CHANGELOG entry, and bumps `FRAMEWORK-VERSION`.
  Instance-owned files (`merge=ours` in `.gitattributes`) keep their content, and
  an intentionally absent `.agent-toolkit/` tree stays absent.
  TRIGGER when: user says "upgrade", "/sekai-upgrade", "update the framework", "pull the
  latest sekai-kb release", "bump to vX.Y.Z", or wants framework updates on an
  adopted instance.
allowed-tools:
  - Bash
  - Read
  - Edit
---

# /sekai-upgrade — Merge a framework release into this instance

Instances track sekai-kb by merging **immutable release tags, never framework
`main`** — the decision and the repo-topology contract behind it live with the
framework's own decision records in the
[sekai-kb repository](https://github.com/wilsonkichoi/sekai-kb), not in an adopted
instance. This skill wraps the tagged-release
merge flow; it does **not** auto-resolve conflicts — framework-owned code
conflicts are walked with the user, one file at a time, against the CHANGELOG.

The identical flow as copy-pasteable git for non-AI users is
`docs/runbook/UPGRADE.md`. This skill orchestrates that runbook; keep the two in
sync (drift = decay).

## 0. Preflight

Run from the instance repo root:

```bash
test -f .sekai-template && echo "STOP: this is the template, not an instance" || echo "instance: ok"
git config merge.ours.driver true   # load-bearing: see below
git status --porcelain
cat VERSION 2>/dev/null || echo "no VERSION (pre-contract instance)"
cat FRAMEWORK-VERSION 2>/dev/null || echo "no FRAMEWORK-VERSION (pre-wizard instance)"
npm run version:check
```

- **Set the `ours` merge driver first.** `.gitattributes merge=ours` names a
  driver git does NOT ship built-in; without `merge.ours.driver true` in this
  clone's config the attribute silently no-ops and the merge overwrites the user's
  place content/config. It is per-clone (not version-controlled), so set it every
  run — the command is idempotent. This is the single most common cause of a
  "framework upgrade clobbered my `place.config.ts`" report.
- **`.sekai-template` present** → this is the framework itself, not an instance.
  Stop; `/sekai-upgrade` is an instance operation.
- **Working tree not clean** → stop and tell the user to commit or stash first. A
  merge onto a dirty tree is unrecoverable-in-place.
- Note `VERSION` as the adopter's own release and `FRAMEWORK-VERSION` as the
  framework "from" version. `/sekai-upgrade` changes only the latter.

## 1. Point the `framework` remote and fetch tags

```bash
git remote get-url framework 2>/dev/null || git remote add framework https://github.com/wilsonkichoi/sekai-kb.git
git fetch framework --tags
git tag -l 'sekai-kb-v*' | sort -V
```

The last line is the available releases. If the user did not name a target,
propose the highest tag above the current `FRAMEWORK-VERSION` and confirm.

## 2. Show the CHANGELOG for the target before merging

The release's own notes are the map for any conflict. Read the target version's
section from the framework CHANGELOG and show it to the user, in particular the
**Upgrade note** (breaking config changes, new required fields):

```bash
# Prints the target version's entry only (stops before the next `## [` heading):
git show sekai-kb-vX.Y.Z:CHANGELOG.md | awk '/^## \[X\.Y\.Z\]/{p=1;print;next} p&&/^## \[/{exit} p'
```

If the Upgrade note names a new `place.config` key, remember: new keys default to
feature-off when absent (the framework SPEC's §Negative requirements, "New
`place.config` keys must be absent-safe", upstream in the
[sekai-kb repository](https://github.com/wilsonkichoi/sekai-kb)), so the merge
never *requires* config surgery — surface the new flag as an opt-in, do not edit
the user's `place.config.ts` to enable it.

## 3. Classify dev-plugin state — before merging

`merge=ours` protects the **content** of a path that exists on both sides. It does
not preserve an intentionally **absent** path: an instance adopted through
`npm run init` has no `.agent-toolkit/` tree, so a framework tag that touches
`.agent-toolkit/` produces a modify/delete conflict on shared history and adds the
whole framework tree back as a theirs-only addition on an unrelated-history first
merge. Dev-plugin presence or absence is therefore persistent instance state that
the upgrade must classify **before** merging (recorded in the framework's decision
records upstream):

```bash
# Always run the TARGET RELEASE's helper, never the copy in the instance tree.
# That copy is from the release the instance is LEAVING, so a release that fixes a
# helper would otherwise never apply its own fix on the upgrade that ships it. The
# extracted copy lives inside .git, so it never touches the working tree. Releases
# before v1.0.5 did not ship this helper at all; `git show` fails loudly on such a
# target instead of silently running an older helper.
HELPER="$(git rev-parse --git-dir)/sekai-dev-plugin-state.mjs"
git show sekai-kb-vX.Y.Z:scripts/upgrade/dev-plugin-state.mjs > "$HELPER"
node "$HELPER" classify   # prints `stripped` or `installed`; exit 3 = inconsistent
```

Keep both `$HELPER` and the printed state for step 5 — `reconcile` takes the
answer from *before* the merge, because after the merge the tree no longer shows
what the instance owned.

- **`stripped`** (`.agent-toolkit/` absent **and** no active `@.agent-toolkit/dev.md`
  reference in `AGENTS.md`/`CLAUDE.md`) → the absence is preserved through the
  merge. Framework dev-plugin state is never an implicit upgrade payload; running
  `dev:setup` is the only opt-in.
- **`installed`** (the adopter's `.agent-toolkit/dev.md` **and** the active
  reference are both present) → `merge=ours` keeps the adopter's config and rules.
- **Exit 3, inconsistent** (only one half present) → **stop before merging** and
  show the user the diagnostic. Do not guess whether to delete or install
  dev-plugin state; the remedy line names both deliberate repairs.

## 3b. Classify maintainer-doc state — also before merging

The framework's own maintainer documents (its product, architecture, delivery, and
decision records) are removed by `npm run init` for the same reason the dev-plugin
tree is: they describe how the framework is built, never how an instance is
operated. `merge=ours` cannot protect their absence either, so the same
classify-then-reconcile pass applies — **per path**, because these paths carry no
activation signal and an instance may legitimately keep its own document at one of
them while having none of the others:

```bash
# Same rule as above: the helper comes from the tag being merged, never from the
# instance tree, so the release's own version of this pass is the one that runs.
MDOCS_HELPER="$(git rev-parse --git-dir)/sekai-maintainer-docs-state.mjs"
git show sekai-kb-vX.Y.Z:scripts/upgrade/maintainer-docs-state.mjs > "$MDOCS_HELPER"
# --from-tag takes the path set from the release being merged; presence is still
# read from this working tree. Always pass it: the tag is the authority on what
# that release strips.
node "$MDOCS_HELPER" classify --from-tag sekai-kb-vX.Y.Z
```

The path set is derived from the wizard's own strip list, never restated, so the
upgrade and the adoption strip cannot disagree. `--from-tag` is what makes that
work on the **first** upgrade to a release that introduces the list: extracting the
helper out of the tag is not enough on its own, because the helper reads
`scripts/init/writer.mjs`, and on exactly that upgrade this tree's copy still
predates the export — without the flag it exits 3 and the classification the whole
pass depends on cannot be produced. Any other exit 3 means the list genuinely could
not be derived: stop and report it rather than merging blind. Keep `$MDOCS_HELPER`
for step 5; unlike the dev-plugin helper, the classification itself is recorded in
the git directory, so `reconcile` takes no state argument and no `--from-tag` —
after the merge the framework-owned wizard is the tag's.

- **owned** (the instance has a document at that path) → it is never deleted, and
  step 5 restores its pre-merge content if the merge changed it. If the user's
  instance owns any of these paths and has not marked them `merge=ours`, say so now:
  adding the attribute is a pre-merge action, and step 5 will otherwise stop the
  upgrade, because claiming a path is the instance's decision and not the
  framework's.
- **stripped** (absent) → the absence is preserved through the merge, exactly like
  dev-plugin state.

Capture the adopter-owned fields from the mixed-ownership npm manifests before
the merge, together with the pre-merge `FRAMEWORK-VERSION`. Sekai owns scripts and
dependencies; the adopter owns package name, description, privacy, and the
`VERSION` mirror. `FRAMEWORK-VERSION` rides the same capture because `merge=ours`
cannot hold it: a merge driver runs only on a three-way content merge, so an
instance that has not edited the file since the merge base has `ours == base` and
git fast-forwards the incoming value straight in — the file would claim the new
release before anything verified it. Step 5 puts the old value back; step 9 is the
only thing that moves it:

```bash
# Same rule again, and this helper is why the rule exists: the FRAMEWORK-VERSION
# capture arrived in v1.0.15, so an instance still on an earlier release carries a
# tree copy that does not capture the marker at all. Running that copy would lose
# the very guarantee this step exists to provide, on the one upgrade that fixes it.
PACKAGE_HELPER="$(git rev-parse --git-dir)/sekai-package-state.mjs"
git show sekai-kb-vX.Y.Z:scripts/upgrade/package-state.mjs > "$PACKAGE_HELPER"
PACKAGE_STATE="$(node "$PACKAGE_HELPER" capture)"
```

The capture accepts the versionless npm manifests produced by v1.0.8 so the
first migration to the synchronized manifest contract does not require manual
pre-editing.

## 3c. Report framework-owned divergence — still before merging

Framework-owned (`src/`, `scripts/`, `workers/`, `.agents/skills/`) states where a
file comes from and that every release replaces it wholesale. It is not a permission
boundary: the instance may edit any file in its own repository, and what that costs is
a conflict here (ADR 010). The framework's job is to price that edit twice — once
continuously, as the `::warning` `npm run worker-config:check` emits in the instance's
CI, and once now, with the framework's incoming value beside the instance's:

```bash
# Same tag-first rule as every helper above.
DIVERGENCE_HELPER="$(git rev-parse --git-dir)/sekai-framework-divergence.mjs"
git show sekai-kb-vX.Y.Z:scripts/upgrade/framework-divergence.mjs > "$DIVERGENCE_HELPER"
node "$DIVERGENCE_HELPER" report --target sekai-kb-vX.Y.Z
```

`docs/runbook/UPGRADE.md` step 4d is the same command in the manual flow; keep the two
in step. Show the report to the user before merging and keep it for step 6 — it is that
step's input, not a duplicate of it. What it adds over the post-merge conflict list is
everything git resolves silently: a file the instance changed that the framework did
not is kept without a conflict, and the user never learns they are carrying it.

- It reads the merge base, so it runs **before** the merge, on the clean tree
  preflight already required.
- It **writes nothing** — no state file, no staged path, no side taken. There is no
  reconcile step for it, and it is never run after the merge.
- Exit 0 with a "no merge base" report is the correct answer on the first
  unrelated-history merge: divergence is measured against a common ancestor and there
  is none yet. Do not read it as a clean bill of health, and do not work around it.
- Exit 0 with "no framework-owned file ... differs" means the instance carries no
  local edit in those trees; say so and move on.

## 4. Merge the tag (never `main`)

```bash
git merge --no-ff sekai-kb-vX.Y.Z -m "chore: upgrade framework to sekai-kb-vX.Y.Z"
```

`.gitattributes merge=ours` keeps the instance's **existing** copy of every
instance-owned file (`place.config.ts`, `knowledge/**`, `public/media/**`,
`CNAME`, `CLAUDE.md`, `AGENTS.md`, `README.md`, `CHANGELOG.md`, `VERSION`, `FRAMEWORK-VERSION`,
`scripts/ci/genericity-denylist.local.txt`, `.agent-toolkit/**`, `dev_docs/**`) — those do not
conflict. It says nothing about a path the instance **deleted** (`.agent-toolkit/`
on a wizard-adopted instance) or never had: git applies no merge driver there, so
step 5 owns that case. It also says nothing about a path the instance has not
**edited** since the merge base — `ours == base` means git resolves to theirs
without consulting the driver, which is why `FRAMEWORK-VERSION` is captured in
step 3b and restored in step 5 rather than trusted to the attribute.
`package.json` and `package-lock.json` are deliberately
not `merge=ours`: their scripts and dependencies must come from the framework,
while their adopter-owned fields are restored in step 5.

Run step 5 next whether the merge stopped on conflicts or completed on its own.

## 5. Reconcile dev-plugin state — immediately after the merge

```bash
node "$HELPER" reconcile --state <stripped|installed>   # the state from step 3
node "$MDOCS_HELPER" reconcile                          # the state recorded in step 3b
node "$PACKAGE_HELPER" reconcile "$PACKAGE_STATE"
```

- **`stripped`** → removes every `.agent-toolkit/` path the merge brought in,
  resolving both the modify/delete conflict and the theirs-only addition, and
  drops any active reference line the merge introduced into an entry file. If the
  merge already committed, it amends that merge commit, so the framework tree is
  never committed into the instance. The user is never asked to resolve a
  dev-plugin conflict — after this step the conflict list in step 6 contains only
  framework-owned files.
- **`installed`** → mutates nothing. It asserts the adopter's `.agent-toolkit/**`
  is byte-for-byte unchanged against the pre-merge revision and that the config
  and active reference survived, and it **reports** any framework path the merge
  added under `.agent-toolkit/`. Those are framework-development state, not
  adopter content: show the list and let the user decide per file (keep it, or
  `git rm -f -- <path>` before finalizing). The upgrade does not decide.
- **Maintainer docs** → per path: an absent path has whatever the merge introduced
  removed (resolving both the modify/delete conflict and the theirs-only addition,
  amending the merge commit if the merge already committed), and a path the
  instance owns is never deleted. Where the merge changed or deleted a file under an
  owned path that `git check-attr merge` reports as `ours`, the pre-merge content is
  **restored** and the merge commit amended the same way. That is the normal outcome,
  not a repair: a merge driver runs only on a three-way content merge, so an instance
  that kept the framework's document verbatim has `ours == base` and the attribute
  never fires — the same reason `FRAMEWORK-VERSION` needs the capture above.
  Framework files the merge added *under* an owned path are **reported** for the user
  to decide, the same rule the installed dev-plugin case follows. A partially owned
  set is normal and does not stop the upgrade; an owned path the instance never
  **claimed** (no `ours` attribute) **does** stop it, because reverting the
  framework's edit there would be the upgrade deciding ownership for the instance.
- A nonzero exit is a stop, not a warning. The diagnostic prints the attribute value
  and driver state it observed per failing path, and prescribes only the repairs
  those observations support — read it rather than assuming which one applies.
- Package reconciliation takes the incoming framework manifests, then restores
  the captured adopter name, description, privacy flag, and `VERSION` mirror. It
  resolves recurring version-line conflicts without discarding new framework
  scripts or dependencies. It also puts the pre-merge `FRAMEWORK-VERSION` back
  (amending the merge commit when git auto-committed), so the file still reads the
  OLD version here — that is correct, and step 9 is what changes it. An instance
  that had no `FRAMEWORK-VERSION` keeps having none until step 9 writes it.

## 6. Conflict report — walk each file WITH the user

Whatever is left after step 5 can only be a framework-owned file (`src/`,
`scripts/`, `workers/`, `.agents/skills/`) the instance edited locally, or a file
the instance chose to fork and manage locally. Neither is a rule the instance
broke: framework-owned states where the file comes from and that every release
replaces it wholesale, not what the instance may edit (ADR 010). A conflict here
is the cost that ownership predicts, and this step is where it gets paid — one
file at a time, with the user. A clean list here means the merge is ready for
step 7.

Do **not** blindly take one side. For each conflicted path, present a short
report and a proposal, then let the user decide:

```bash
git diff --name-only --diff-filter=U
```

Step 3c's report already named these paths with both values; this list is the subset
git could not settle on its own, so read the two together rather than starting over.
A path in 3c's report and not in this list needs no resolution — git kept the
instance's side — but it is still a divergence the instance carries into the next
release, and saying so is what keeps it a decision rather than a drift.

For each file, show: the path, the relevant CHANGELOG line for this version, and
the two sides (`git diff`). Then propose the resolution and its rationale:

- **Framework-owned file (`src/`, `scripts/`, `workers/`, `.agents/skills/`), no
  intentional local change** → propose taking framework
  (`git checkout --theirs <file>`), which ends the conflict at no later cost.
- **A change the instance intentionally forked** → propose keeping the local edit.
  This is a supported outcome, not a defect to undo: framework-owned states where a
  file comes from, not what the instance may edit (ADR 010). Name the cost — this
  file conflicts again on every release — and offer upstreaming to sekai-kb as the
  route that makes it stop, without requiring it.
- **`VERSION` modify/delete conflict on the first upgrade from v1.0.8** → keep
  the adopter file. v1.0.8 mistakenly tracked a framework `VERSION`; the next
  framework release deletes it. This is a one-time migration conflict. Later
  framework releases do not carry the path.

Apply only what the user approves (`git checkout --theirs/--ours <file>` or a
hand-merge), then `git add <file>`. Never `git checkout -f` the whole tree.

## 7. Build-verify before committing the merge

```bash
npm run build
```

The build must be green before the merge is finalized. If a merged framework
change broke the build (e.g. a config contract the Upgrade note called out),
resolve it now — do not commit a red merge. If the merge is still in progress
(conflicts were resolved in steps 5-6), finalize it:

```bash
git commit --no-edit
```

## 8. Reconcile instance-owned starter files (conversational diff)

`merge=ours` is deliberately blunt: it keeps the instance's version of every
instance-owned file and **silently discards the framework's changes** to those
same files. That is correct for `place.config.ts`, `knowledge/**`,
`public/media/**`, `CHANGELOG.md`, and `VERSION` — pure instance content. But the *content-bearing starter* files
the wizard seeded (`AGENTS.md` above all, and `README.md`) began as framework
boilerplate the instance lightly edited; a release that improves that boilerplate
(a new agent instruction, a corrected pointer) would vanish under `merge=ours`
with no signal. Surface those improvements instead of dropping them. `CLAUDE.md` is
exempt — it is a pure one-line `@AGENTS.md` shim with no content to diverge; if the
instance's copy is anything but that single line, reset it to the shim.

`FRAMEWORK-VERSION` is not reconciled here at all: step 5 already restored the
pre-merge value, and step 9 is the only step that moves it, after verification.

For each instance-owned **starter** file — at minimum `AGENTS.md` — diff the
instance's committed version against the incoming tag's version and, if they
differ, walk the difference WITH the user:

```bash
# AGENTS.md is the primary case; add README.md if the CHANGELOG entry mentions
# changes to it. CLAUDE.md is a fixed @AGENTS.md shim — nothing to reconcile.
for f in AGENTS.md README.md; do
  # Skip a starter file the tag does not carry — nothing to reconcile, and an
  # empty `git show` stream would otherwise report a spurious divergence.
  git cat-file -e "sekai-kb-vX.Y.Z:$f" 2>/dev/null || continue
  # `--no-index` already sets diff's exit status (1 = differ), so `--quiet` alone
  # suffices; no `--exit-code`, no output redirection.
  git diff --no-index --quiet -- "$f" <(git show "sekai-kb-vX.Y.Z:$f") \
    || echo "starter divergence: $f"
done
```

For each divergent starter file, show the user the framework's side
(`git show sekai-kb-vX.Y.Z:AGENTS.md`) next to theirs and propose adopting only
the framework improvements that do not clobber the user's own edits — never a
blind overwrite (the whole point of `merge=ours` is that the user's edits win by
default). Apply only what the user approves, then stage it:

```bash
git add <starter-file>   # only the files the user chose to update
```

Note: `AGENTS.md` is also where the dev-plugin reference line lives, so never
adopt the framework's dev-plugin block into a **stripped** instance while
reconciling this file — steps 3 and 5 exist to keep that state absent, and
re-adding the reference here would put the instance in the inconsistent state
that stops the next upgrade. `.agent-toolkit/**` itself is not a starter file and
is never reconciled conversationally; step 5 already settled it.

## 9. Bump FRAMEWORK-VERSION

Record the version just adopted (the tag's `vX.Y.Z`, matching the wizard's
`v`-prefixed form). This is the **only** step that moves `FRAMEWORK-VERSION`, and
it runs after step 7 verified the merged tree. Assert the result rather than
assuming the write took effect — until this point the file still holds the old
value that step 5 restored, so an unnoticed failure here leaves the instance
reporting a framework version it never adopted. Fold any starter-file updates
approved in step 8 into this commit (or a preceding one):

```bash
printf 'vX.Y.Z\n' > FRAMEWORK-VERSION
test "$(cat FRAMEWORK-VERSION)" = "vX.Y.Z" \
  || { echo "STOP: FRAMEWORK-VERSION is not vX.Y.Z after the bump"; exit 1; }
git add FRAMEWORK-VERSION && git commit -m "chore: FRAMEWORK-VERSION -> vX.Y.Z"
```

Do not change `package.json.version` here. It mirrors the adopter's unchanged
`VERSION`, not `FRAMEWORK-VERSION`.

## 10. Report

Tell the user: the adopted framework version moved from → to, the adopter's
`VERSION` remained unchanged, the dev-plugin state classified in
step 3 and what reconcile did with it, the maintainer-doc split classified in step
3b and what reconcile removed, kept, or reported for their decision, the
framework-owned divergences step 3c reported and which of them the merge settled
silently rather than as a conflict, which files
(if any) conflicted and how each was resolved, the build result, and any
Upgrade-note opt-ins they declined (new feature flags left off). Push is theirs to make — on an instance, pushing
`main` deploys.
