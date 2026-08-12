---
name: sekai-framework-release
description: Cut and publish a Sekai framework patch, minor, or major release end to end. Use when a Sekai maintainer says "$sekai-framework-release", "release the framework", "cut the next Sekai release", or "publish sekai-kb vX.Y.Z". Updates the framework version contract and changelog, opens and merges the release PR after green CI, pushes the immutable sekai-kb-vX.Y.Z tag, and cleans the release branch. Never use for adopter instance releases; use $sekai-release there.
---

# Release the Sekai framework

Run this only in the canonical `sekai-kb` template repository. It owns the full
release transaction. `FRAMEWORK-VERSION` is the SSOT; `package.json` and the two
root `package-lock.json` versions mirror it without `v`. `pyproject.toml` stays at
the independent internal-tooling version.

An explicit invocation with exactly one of `patch`, `minor`, or `major`
authorizes the branch, commit, push, PR, merge, tag push, and branch cleanup. If
the level is absent, ask. Never infer it.

## 1. Preflight

From the repository root:

```bash
test -f .sekai-template
test ! -f VERSION
git status --short
git switch main
git pull --ff-only origin main
npm run version:check
```

Hard-stop unless the tree is clean, `origin` resolves to
`wilsonkichoi/sekai-kb`, `main` matches `origin/main`, the current lightweight
`sekai-kb-vX.Y.Z` tag exists locally and remotely, and that tag matches
`FRAMEWORK-VERSION`. Fetch tags before deciding.

Read the complete `## [Unreleased]` section. Hard-stop if it has no release
entries. Derive one factual sentence summarizing those entries; do not invent
features or upgrade requirements.

## 2. Prepare the release

Preview with the bundled helper, replacing the level, date, and summary:

```bash
node .agents/skills/sekai-framework-release/scripts/prepare-release.mjs patch --date YYYY-MM-DD --summary "One factual release summary." --dry-run
```

Show the current and proposed versions. With an explicitly supplied release
level, continue without another confirmation. Create the exact branch reported
by the helper, then run the same command without `--dry-run`:

```bash
git switch -c chore/release-vX.Y.Z
node .agents/skills/sekai-framework-release/scripts/prepare-release.mjs patch --date YYYY-MM-DD --summary "One factual release summary."
```

The helper must change exactly:

- `CHANGELOG.md`: move all current Unreleased content under a dated release
  heading and advance the comparison links.
- `FRAMEWORK-VERSION`: `vX.Y.Z`.
- `package.json.version`: `X.Y.Z`.
- The two root `package-lock.json` versions: `X.Y.Z`.

It must not create `VERSION`, change `pyproject.toml`, touch dependencies, create
a commit or tag, or modify released changelog sections.

## 3. Verify and commit

```bash
git diff -- CHANGELOG.md FRAMEWORK-VERSION package.json package-lock.json
git diff --stat
npm run version:check
npm run genericity
npm run genericity:selftest
npm run test
npm run article-health:test
npm run article-health -- --all --profile=ci-deploy
npm run build
git diff --check
```

Hard-stop unless exactly the four expected files changed and every command
passes. Stage only those files and commit:

```bash
git add CHANGELOG.md FRAMEWORK-VERSION package.json package-lock.json
git diff --cached --check
git commit -m "chore(release): sekai-kb vX.Y.Z"
```

## 4. Push, open, and merge the PR

Push the release branch and open one PR against `main`. The PR body must list the
version transition, released changelog entries, and verification commands. Wait
for every required check to settle. Hard-stop on failure, draft state, head SHA
change, or non-clean mergeability.

Merge with a merge commit, matching prior framework releases, and clean the
local and remote release branch. When the host provides `dev:merge-pr`, use its
`merge-cleanup` operation with merge policy `merge`; otherwise use guarded `gh`
and `git` operations that preserve the same result. Never squash a framework
release PR.

## 5. Tag the merged main commit

Update local `main` with `git pull --ff-only origin main`, then rerun
`npm run version:check`. Confirm `HEAD` is the PR merge commit, the tree is clean,
and the target tag is absent locally and remotely.

Create a lightweight tag and push only that tag:

```bash
git tag sekai-kb-vX.Y.Z
git cat-file -t sekai-kb-vX.Y.Z
git push origin sekai-kb-vX.Y.Z
git ls-remote --tags origin refs/tags/sekai-kb-vX.Y.Z
```

`git cat-file -t` must print `commit`. Never force or move an existing tag.
Do not create a GitHub Release object; the established Sekai release artifact is
the immutable lightweight tag.

## 6. Report

Report the old and new framework versions, release level, release PR URL, release
commit, tag target, remote tag verification, CI results, and branch cleanup.
State that adopters can now run `$sekai-upgrade` against the new tag.
