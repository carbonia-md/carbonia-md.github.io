---
name: sekai-release
description: Release an adopted sekai-kb instance end to end. Use when an adopter maintainer invokes "$sekai-release" or "/sekai-release" with patch, minor, or major, says "release the instance" or "publish the adopter release", or asks to bump and publish the instance version. Creates the release branch, synchronizes versions, verifies, commits, pushes, opens and merges the release PR after green CI, tags the merged main commit as vX.Y.Z, pushes the tag, and cleans the release branch. Never use for the Sekai framework release train or routine article pull requests.
---

# Release an adopter instance

Run this only in an adopted sekai-kb instance. The skill owns the complete release
transaction. `VERSION` is the adopter SSOT; `package.json` and the two root
`package-lock.json` versions mirror it without `v`. `FRAMEWORK-VERSION` stays
unchanged.

An explicit invocation with exactly one of `patch`, `minor`, or `major`
authorizes the branch, version edits, commit, push, PR, merge, tag push, and local
and remote branch cleanup. If the level is absent, ask. Never infer it.

`docs/runbook/RELEASE.md` is the copy-pasteable human flow; keep it synchronized
with this skill.

## 1. Preflight

Run from the repository root:

```bash
test ! -f .sekai-template
test -f VERSION
git status --short
git switch main
git fetch origin --prune --tags
git pull --ff-only origin main
git merge-base --is-ancestor origin/main HEAD
git log --oneline origin/main..HEAD
npm run version:check
gh auth status
```

Hard-stop unless the tree is clean, `VERSION` exists, `origin/main` exists, local
`main` is equal to or strictly ahead of it, and `origin` resolves to the adopter's
GitHub repository. The pull synchronizes a behind branch; diverged history is a
blocker.

Every commit printed by `origin/main..HEAD` will be published in the release PR.
Show that list before continuing. Proceed without another confirmation only when
those commits came from workflows the maintainer already approved in the current
session, such as a completed `/sekai-upgrade`. Otherwise ask whether to include
them. Never silently publish unknown local commits.

## 2. Select the level and create the branch

Preview without writing, replacing the level:

```bash
npm run release:bump -- patch --dry-run
```

Show the current and proposed versions. With an explicitly supplied level,
continue without another confirmation. Let `vX.Y.Z` below be the proposed
version and verify that neither the release branch nor adopter tag exists locally
or remotely:

```bash
! git show-ref --verify --quiet refs/heads/chore/release-vX.Y.Z
! git ls-remote --exit-code --heads origin chore/release-vX.Y.Z
! git show-ref --verify --quiet refs/tags/vX.Y.Z
! git ls-remote --exit-code --tags origin refs/tags/vX.Y.Z
git switch -c chore/release-vX.Y.Z
```

The four existence checks must report no matching ref. Never reuse a release
branch, force a tag, or move an existing tag.

## 3. Update synchronized version fields

```bash
npm run release:bump -- patch
```

The command must change only:

- `VERSION`, using `vX.Y.Z`.
- `package.json.version`, using `X.Y.Z`.
- The two root `package-lock.json` version fields, using `X.Y.Z`.

It must not change `FRAMEWORK-VERSION`, article content, the changelog,
dependencies, or lockfile resolution.

## 4. Verify and commit

```bash
git diff -- VERSION package.json package-lock.json
git diff --stat
git diff --check
npm run version:check
npm run genericity
npm run test
npm run build
```

Hard-stop unless exactly the three expected files changed, all four version
fields agree, `FRAMEWORK-VERSION` is unchanged, and every command passes. Stage
only those files and commit:

```bash
git add VERSION package.json package-lock.json
git diff --cached --check
git commit -m "chore(release): vX.Y.Z"
```

Record the release commit SHA. Confirm the tree is clean before pushing.

## 5. Push, open, and merge the PR

Push `chore/release-vX.Y.Z` and open one non-draft PR against `main`. The title is
`chore(release): vX.Y.Z`. The body must list the version transition, unchanged
`FRAMEWORK-VERSION`, and verification commands.

Wait until CI reports its checks and every required check settles. Before
merging, verify that the PR is open, non-draft, cleanly mergeable, and still
points at the recorded release commit SHA. Hard-stop on a failed or cancelled
check, head SHA change, required review, merge conflict, or permission failure.

Merge with a merge commit and request remote branch deletion. Never squash or
rebase a release PR: the verified release commit must reach `main` unchanged.
Use guarded `gh` and `git` operations; do not hand the transaction to another
skill.

## 6. Tag the merged main commit and clean up

Read the merged PR's merge-commit SHA, then:

```bash
git switch main
git fetch origin --prune --tags
git pull --ff-only origin main
npm run version:check
```

Confirm `HEAD` is that merge commit, the tree is clean, `VERSION` is `vX.Y.Z`,
`FRAMEWORK-VERSION` is unchanged, and the target tag is still absent locally and
remotely.

Create a lightweight adopter tag on the merged `main` commit and push only that
tag:

```bash
! git show-ref --verify --quiet refs/tags/vX.Y.Z
! git ls-remote --exit-code --tags origin refs/tags/vX.Y.Z
git -c tag.gpgSign=false tag vX.Y.Z HEAD
git cat-file -t vX.Y.Z
git push origin refs/tags/vX.Y.Z
git ls-remote --tags origin refs/tags/vX.Y.Z
```

`git cat-file -t` must print `commit`, and the remote tag target must equal
`HEAD`. Adopter tags use `vX.Y.Z`; `sekai-kb-vX.Y.Z` belongs only to framework
releases. Do not create a GitHub Release object.

Delete the local release branch. If the merge did not delete the remote branch,
delete that exact remote branch now. Verify both refs are absent, local `main`
matches `origin/main`, and the worktree is clean. Never delete any other branch.

## 7. Report

Report the old and new adopter versions, release level, unchanged
`FRAMEWORK-VERSION`, release commit, PR URL, merge commit, CI results, tag target,
remote tag verification, and branch cleanup.
