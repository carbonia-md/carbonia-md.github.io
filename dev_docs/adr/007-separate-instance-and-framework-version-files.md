# ADR 007: Separate instance and framework version files

**Status:** Accepted (2026-07-26, maintainer-approved)
**Deciders:** Wilson Choi

> **Moved to sekai-kb (2026-07-28, ADR 008).** The version contract is enforced by
> framework code (`scripts/ci/check-version-contract.mjs`, `scripts/release/`,
> `scripts/init/writer.mjs`), so the decision lives beside it.

## Context

Sekai and each adopter need npm-compatible package metadata, but they have independent
release trains. A manifest version in Sekai means the framework release; the same field
in an instance means that instance's release. `VERSION` in the framework was also
misleading because a reader reasonably interpreted it as the Sekai version.

An adopter and its framework have independent release trains. An instance can release
without changing Sekai, and can adopt a Sekai release without releasing itself. One field
cannot represent both versions.

## Options

| Option | Pros | Cons | Cost |
|---|---|---|---|
| Keep both versions in `package.json` | One JSON file | A package has one release identity; the second field is nonstandard metadata | Ambiguous |
| Add `package.json.framework_version` and keep `FRAMEWORK-VERSION` | Familiar field | Two SSOTs for the same value; drift is inevitable | Rejected duplication |
| Use repository-specific file SSOTs and npm mirrors | Correct meaning in each repository; npm tooling works; CI can reject drift | Upgrade must reconcile mixed-ownership manifests | Bounded helper |

## Decision

- Sekai contains `FRAMEWORK-VERSION`, not `VERSION`. It is the v-prefixed Sekai release
  SSOT. Sekai `package.json.version` and the lockfile root versions mirror it without
  the leading `v`; tags use `sekai-kb-${FRAMEWORK-VERSION}`.
- An adopter contains both files. `VERSION` is its own v-prefixed release SSOT;
  `FRAMEWORK-VERSION` records the exact Sekai release it has integrated. An adopter
  initializes `VERSION` to `v0.0.0` and protects both files with `merge=ours`.
- Adopter `package.json.version` and lockfile root versions mirror `VERSION` without the
  leading `v`. `FRAMEWORK-VERSION` never appears in the adopter npm manifest.
- Init creates `VERSION`, writes adopter package identity, initializes all npm version
  mirrors to `0.0.0`, and carries forward the checked-out `FRAMEWORK-VERSION`.
- `npm run release:bump -- patch|minor|major` is the only automated adopter version
  writer. It runs only on explicit maintainer request; routine article PRs do not bump.
- Package manifests have mixed ownership. `/sekai-upgrade` takes incoming framework scripts,
  dependencies, and lock resolution, then restores the captured adopter name,
  description, privacy flag, and `VERSION` mirror.
- CI validates file formats, npm mirrors, private-package status, package/lock identity,
  and framework tag agreement.

## Consequences

- Framework upgrades never change or describe the adopter's release.
- Adopter releases never imply a framework upgrade.
- npm tools receive a real package version without becoming the release SSOT.
- The first release after v1.0.8 deletes Sekai's mistaken `VERSION`; an adopter keeps
  its file through the one-time modify/delete conflict.
- Framework and adopter package versions differ by design. The upgrade helper resolves
  that recurring textual overlap while retaining incoming framework-owned fields.
