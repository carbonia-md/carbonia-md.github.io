# RELEASE — Explicit adopter releases

Adopter releases are maintainer decisions. Routine article and maintenance pull
requests do not change `VERSION`. The `/sekai-release` skill drives this same
end-to-end flow for an AI CLI.

## Version ownership

| Value | Meaning | Format |
| --- | --- | --- |
| `VERSION` | adopter release SSOT | `vX.Y.Z` |
| `package.json.version` | npm-compatible mirror of `VERSION` | `X.Y.Z` |
| root `package-lock.json` versions | lockfile mirrors of `VERSION` | `X.Y.Z` |
| `FRAMEWORK-VERSION` | adopted Sekai release, unchanged by adopter releases | `vX.Y.Z` |

The Sekai template does not contain `VERSION`. Init creates it at `v0.0.0` for a
new adopter. Adopter tags use `vX.Y.Z`; `sekai-kb-vX.Y.Z` is reserved for the
framework release train.

## Release authorization

An explicit `/sekai-release patch`, `/sekai-release minor`, or
`/sekai-release major` authorizes the complete release transaction: branch,
version edits, verification, commit, push, PR, merge, tag push, and release-branch
cleanup. Without an explicit level, ask before writing or publishing anything.

## Preflight

Start from the adopted repository with no uncommitted work. Clean commits already
on local `main`, including a completed framework upgrade, can ship in the same
release PR after the maintainer reviews their exact list.

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
OLD_VERSION="$(cat VERSION)"
ADOPTED_FRAMEWORK_VERSION="$(cat FRAMEWORK-VERSION)"
```

The pull synchronizes a behind branch. Hard-stop if the tree is dirty, local
`main` is then diverged from `origin/main`, `origin` is not the adopter's GitHub
repository, or GitHub authentication is unavailable. Every commit printed by
the final `git log` will be included in the release PR. Continue only after
confirming that list; do not silently publish unknown commits.

## Prepare the release

Replace `patch` with the explicitly selected level. Preview first:

```bash
npm run release:bump -- patch --dry-run
```

Set the proposed version and derived branch from the preview. The example below
uses `v1.2.3`:

```bash
RELEASE_VERSION=v1.2.3
RELEASE_BRANCH="chore/release-${RELEASE_VERSION}"
! git show-ref --verify --quiet "refs/heads/${RELEASE_BRANCH}"
! git ls-remote --exit-code --heads origin "${RELEASE_BRANCH}"
! git show-ref --verify --quiet "refs/tags/${RELEASE_VERSION}"
! git ls-remote --exit-code --tags origin "refs/tags/${RELEASE_VERSION}"
git switch -c "${RELEASE_BRANCH}"
npm run release:bump -- patch
```

The four existence checks must find nothing. Stop rather than reusing a branch,
moving a tag, or forcing a release ref.

The bump must change only `VERSION`, `package.json.version`, and the two root
`package-lock.json` version fields. It must not change `FRAMEWORK-VERSION`, the
changelog, dependencies, lockfile resolution, or article content.

## Verify and commit

```bash
git diff -- VERSION package.json package-lock.json
git diff --stat
git diff --check
npm run version:check
npm run genericity
npm run test
npm run build
test "$(cat FRAMEWORK-VERSION)" = "${ADOPTED_FRAMEWORK_VERSION}"
git add VERSION package.json package-lock.json
git diff --cached --check
git commit -m "chore(release): ${RELEASE_VERSION}"
RELEASE_COMMIT="$(git rev-parse HEAD)"
test -z "$(git status --short)"
```

Confirm the diff contains exactly the three expected files, all four version
fields agree, and `FRAMEWORK-VERSION` is unchanged.

## Push and open the PR

Resolve the GitHub repository from `origin`, push the branch, and open one
non-draft PR against `main`:

```bash
ORIGIN_URL="$(git remote get-url origin)"
GH_REPO="$(gh repo view "${ORIGIN_URL}" --json nameWithOwner --jq .nameWithOwner)"
git push -u origin "${RELEASE_BRANCH}"
PR_URL="$(gh pr create --repo "${GH_REPO}" --base main --head "${RELEASE_BRANCH}" \
  --title "chore(release): ${RELEASE_VERSION}" \
  --body "## Summary

- release ${OLD_VERSION} -> ${RELEASE_VERSION}
- keep FRAMEWORK-VERSION at ${ADOPTED_FRAMEWORK_VERSION}

## Verification

- npm run version:check
- npm run genericity
- npm run test
- npm run build")"
PR_NUMBER="${PR_URL##*/}"
```

The PR body records the exact version transition, unchanged framework version,
and verification commands.

Wait until CI reports checks and all required checks settle:

```bash
gh pr checks "${PR_NUMBER}" --repo "${GH_REPO}" --watch --interval 10
gh pr view "${PR_NUMBER}" --repo "${GH_REPO}" \
  --json state,isDraft,mergeable,mergeStateStatus,headRefOid,statusCheckRollup
```

Confirm the PR is open, non-draft, cleanly mergeable, and `headRefOid` equals
`RELEASE_COMMIT`. Stop on any failed or cancelled check, required review, head
change, conflict, or permission failure.

Merge with a merge commit so the verified release commit reaches `main`
unchanged. Never squash or rebase a release PR.

```bash
gh pr merge "${PR_NUMBER}" --repo "${GH_REPO}" --merge --delete-branch
MERGE_COMMIT="$(gh pr view "${PR_NUMBER}" --repo "${GH_REPO}" --json mergeCommit --jq .mergeCommit.oid)"
```

## Tag merged main and clean up

```bash
git switch main
git fetch origin --prune --tags
git pull --ff-only origin main
test "$(git rev-parse HEAD)" = "${MERGE_COMMIT}"
test -z "$(git status --short)"
npm run version:check
test "$(cat VERSION)" = "${RELEASE_VERSION}"
test "$(cat FRAMEWORK-VERSION)" = "${ADOPTED_FRAMEWORK_VERSION}"
! git show-ref --verify --quiet "refs/tags/${RELEASE_VERSION}"
! git ls-remote --exit-code --tags origin "refs/tags/${RELEASE_VERSION}"
git -c tag.gpgSign=false tag "${RELEASE_VERSION}" HEAD
git cat-file -t "${RELEASE_VERSION}"
git push origin "refs/tags/${RELEASE_VERSION}"
git ls-remote --tags origin "refs/tags/${RELEASE_VERSION}"
```

The two tag existence checks before `git tag` must find nothing.
`git cat-file -t` must print `commit`, and the remote tag target must match
`MERGE_COMMIT`. Never force or move a release tag. Do not create a GitHub Release
object.

Delete only the exact release branch, then verify cleanup and synchronization:

```bash
if git show-ref --verify --quiet "refs/heads/${RELEASE_BRANCH}"; then
  git branch -d "${RELEASE_BRANCH}"
fi
if git ls-remote --exit-code --heads origin "${RELEASE_BRANCH}" >/dev/null 2>&1; then
  git push origin --delete "${RELEASE_BRANCH}"
fi
test -z "$(git branch --list "${RELEASE_BRANCH}")"
test -z "$(git ls-remote --heads origin "${RELEASE_BRANCH}")"
test "$(git rev-parse main)" = "$(git rev-parse origin/main)"
test -z "$(git status --short)"
```

Report the version transition, unchanged `FRAMEWORK-VERSION`, release and merge
commits, PR URL, CI result, tag target, remote tag verification, and branch
cleanup.

## Failure behavior

The version helper stops without writing when:

- `.sekai-template` exists.
- The release level is not `patch`, `minor`, or `major`.
- `VERSION` is not a v-prefixed semantic version.
- `package.json` or either lockfile root version has drifted from `VERSION`.

The publishing flow stops without merging or tagging when CI, review,
mergeability, authentication, branch, or tag guards fail. Preserve the release
branch and PR for diagnosis; never bypass a failed guard.
