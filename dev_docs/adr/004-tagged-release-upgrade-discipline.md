# ADR 004: Tagged-release upgrade discipline for instances

**Status:** Accepted (2026-07-05 revision)
**Deciders:** Wilson Choi, with Fable 5 as architect

> **Moved to sekai-kb (2026-07-28, ADR 008).** This decision governs the framework's
> release train and the upgrade tooling under `scripts/upgrade/`, so it lives beside
> that code.

## Context

After Phase 5 there are two repositories: `sekai-kb` (framework SSOT, GitHub template) and
instance #1, with more instances expected. The inherited fork demonstrated how
instance/upstream merges rot: a moving upstream main re-floods place-specific assumptions
and every merge becomes a triage project. Instances need framework updates without that
cost.

## Decision

Instances merge **immutable semver release tags, never framework main**:
`git fetch framework && git merge sekai-kb-vX.Y.Z`. Determinism by construction:

1. Merge target is a tag with a `CHANGELOG.md` entry; breaking config changes carry an
   upgrade note.
2. The template contains zero place content (CI-enforced by the genericity gate in
   template mode).
3. Instance-owned files (`place.config.ts`, `knowledge/**`, `public/media/**`, `CNAME`,
   `CLAUDE.md`) carry `.gitattributes merge=ours` — the mechanism already proven on the
   inherited fork's `CLAUDE.md`. ADR 006 extends this list; `.gitattributes` in this
   repository is the operative record.
4. **Ownership rule:** in an instance, `src/` and `scripts/` are framework-owned.
   Customization goes through config/content/media; anything beyond is upstreamed to
   sekai-kb first, then pulled back as a release (reverse flow lands in sekai-kb within
   the same work item — review-checklist enforced, SPEC `Risk controls`).

`VERSION` records the instance's own release. `FRAMEWORK-VERSION` records the adopted
Sekai release; the `/sekai-upgrade` skill wraps
fetch → capture adopter package state → merge tag → reconcile mixed-ownership npm
manifests → build-verify → conflict report → framework-version bump, proven by a
demonstrated tag merge as acceptance. Adopter releases are independent and
run explicitly through `/sekai-release` (ADR 007).

## Consequences

- Upgrades are reproducible on every instance at the same version.
- Instance-local drift in framework-owned trees is the one hole the ownership rule closes;
  it costs contributors an upstream-first habit.
- The fork-vs-rewrite failure mode cannot structurally recur between sekai-kb and its
  instances.
