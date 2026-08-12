# ADR 010: Framework-owned trees warn about upgrade risk; they do not block adopter edits

**Status:** Accepted (2026-08-10)
**Deciders:** Wilson Choi
**Amends:** ADR 004 and ADR 006 in the enforcement half of the ownership contract. Their
tagged-release topology and their instance-owned path set stand unchanged.

## Context

`AGENTS.md` iron rule 3 and `dev_docs/SPEC.md` §Repo topology rule (d) declare `src/` and
`scripts/` framework-owned, with `workers/` covered by the same doctrine. Until this ADR that
was not only prose. `scripts/ci/check-worker-config.mjs` holds every committed
`workers/*/wrangler.toml` to the framework constants in its `EXPECTED` table, it has **no
template-mode branch**, and it runs in the `genericity` job of the `.github/workflows/deploy.yml`
an adopter inherits at adoption. An adopter who retunes a value in their own checkout gets a red
build in their own repository:

```text
FAIL: the committed worker contract does not hold:
  workers/chat/wrangler.toml: [vars] RELEVANCE_FLOOR
      found:    "0.52"
      expected: "0.46" (the framework placeholder/constant)
```

The workflow comment is explicit that this was intended: "it fails in an adopter's checkout
too — which is the point."

**Defect 1: the gate conflates two unlike things.** Its real job is stopping account-scoped
deployment identity from being committed — a Worker `name`, a D1 `database_name`, an
`ALLOWED_ORIGIN`. Two instances sharing those collide inside one Cloudflare account, and the
place-name denylist gate cannot catch the class on its own, because `name = "coastal-feedback"`
carries no denylisted term. That is a genuine correctness concern. The gate also freezes the
deploy-time **tuning** constants in the same pass — a retrieval relevance floor, a rate-limit
ceiling — which are numbers a corpus or a place legitimately differs on. The second is
collateral, not the gate's purpose.

**Defect 2: the cost is charged at the wrong time.** Blocking at CI presents a hand-edit as an
error the adopter must undo. The actual cost of a hand-edit is a merge conflict at the next
`/sekai-upgrade`: later, cheaper, and now LLM-assisted. A warning that names that cost lets the
adopter decide with the tradeoff in front of them.

**Defect 3, found while writing this ADR: the upgrade path silently destroys the very edits the
gate forbids.** `docs/runbook/UPGRADE.md` tells an adopter to resolve every framework-owned
conflict by discarding their own side, in a blind sweep with no per-file review:

```bash
for f in $(git diff --name-only --diff-filter=U); do git checkout --theirs "$f" && git add "$f"; done
```

Step 7 of the same runbook is gentler but still lands on "take framework unless you
intentionally forked it (in which case: upstream it to sekai-kb so it stops conflicting)". So
the current design is not merely restrictive, it is incoherent: it refuses the edit loudly at CI
and deletes it silently at merge. Relaxing the gate without fixing this would take adopters from
"you are blocked from editing" to "you may edit, and we delete it without telling you" — strictly
worse than the status quo, which is why the runbook correction is part of this decision rather
than a follow-on.

**A precedent already exists in this codebase.** `scripts/deploy/gen-worker-config.mjs` handles
the mirror case — an instance sets `workers.<key>` for a var a framework release removed — and
deliberately warns rather than fails, with the reasoning written out at the call site: "an
instance reaching this reached it by upgrading, and refusing to generate would leave them unable
to deploy the other five workers over one stale key." This ADR generalizes a judgment the
codebase had already made once.

`dev_docs/PRD.md` §Non-goals, amended 2026-08-10, sets the product doctrine this ADR implements:
the framework does not police an adopter's own repository, and machine enforcement blocks only
what harms someone other than the person editing.

## Options considered

| Option | Pros | Cons | Cost |
|---|---|---|---|
| **Keep the hard block** | Zero work; the committed contract is provably intact everywhere | Adopter's own CI reds on a legitimate edit; contradicts the amended PRD; leaves defect 3 unaddressed | none |
| **Drop the gate in instance mode entirely** | Simplest rule to state; maximal adopter freedom | An adopter can commit a colliding `database_name` or a real `ALLOWED_ORIGIN` with nothing said; loses the one protection the denylist gate cannot provide | low |
| **Split by var class, mode-gated** (chosen) | Identity stays protected; tuning becomes the adopter's call; the classification already exists in `WORKER_VAR_OVERRIDES`; template mode unchanged | Two behaviors to hold in one gate; the warning must reach the adopter somewhere they will read it | moderate |
| **Add explicit `tier:` fields to `EXPECTED`** | Classification visible at the call site | Duplicates what `WORKER_VAR_OVERRIDES` already encodes, creating a second thing to keep in sync — the exact defect class `guard-or-explain-prose-drift.md` exists to stop | moderate |

## Decision

**(a) Machine enforcement blocks only harm beyond the editor.** A framework gate running in an
adopter's repository may fail their build only for something that harms a party other than the
person making the edit: account-scoped collisions, committed credentials, and security
boundaries. Everything else warns and names the upgrade cost. This is the rule a future gate
author applies; it is stated once here and once in `dev_docs/SPEC.md` §Negative requirements, and
it governs gates that do not exist yet.

**(b) The worker-config gate becomes mode-gated.** In **template mode** (the `.sekai-template`
marker is present) every current check stays fatal, unchanged. The framework's own contract is
not relaxed: a changed default must remain a deliberate edit to `EXPECTED` as well as to the
template, which is what keeps the gate a contract rather than a restatement of whatever the file
happens to say. In **instance mode** the gate splits per the next two decisions.

**(c) The identity/tuning classification is derived, never duplicated.** `WORKER_VAR_OVERRIDES`
in `scripts/deploy/wrangler-config.mjs` already names exactly which `[vars]` keys an instance may
retune, and `check-worker-config.mjs` already cross-checks it against `docs/runbook/DEPLOY.md` in
both directions. In instance mode, a `[vars]` key registered there warns on mismatch. `name`, any
`database_name`, any `database_id`, and `ALLOWED_ORIGIN` stay fatal. No new classification data is
introduced.

**(d) An unregistered `[vars]` key warns in instance mode.** An adopter adding a var the
framework never shipped is exercising the edit right this ADR grants, so it is not a build
failure in their tree. It remains fatal in template mode, where an unregistered key still means a
worker nothing is checking.

**(e) The divergence is reported in two places, with two different messages.** The gate emits a
GitHub Actions `::warning` naming the file, the key, both values, and the consequence — a merge
conflict at the next `/sekai-upgrade`. `/sekai-upgrade` reports the same file at merge time with
the framework's incoming value beside the instance's. CI gives continuous visibility; the upgrade
gives it at the moment the cost is actually paid. Neither message alone is sufficient: CI alone
lets an adopter forget for months, and upgrade alone lets the divergence accumulate unseen.

**(f) `docs/runbook/UPGRADE.md`'s blind `--theirs` sweep is removed in the same change that
relaxes the gate.** It is replaced with per-file review guidance that names the framework-owned
files the adopter has diverged on and requires a decision on each. Real `/sekai-upgrade`
reconciliation tooling — enumerating drifted framework-owned paths and presenting both values —
is a separate task, because it touches `scripts/upgrade/` and owes its own self-test surface in
`scripts/upgrade/check-upgrade-state.sh`. Splitting it this way leaves no window in which an
adopter can act on the new permission and lose the result silently.

**(g) Upstreaming stays the recommended route, not the required one.** It buys conflict-free
upgrades. `docs/runbook/UPGRADE.md` says so as a benefit rather than as the only permitted
resolution.

## Consequences

- **`AGENTS.md` iron rule 3 is reworded, and reaches existing instances only by hand.**
  `AGENTS.md` carries `merge=ours`, so the template's new wording lands for future adopters and
  never overwrites an existing instance's copy. The release carrying this change needs a
  `CHANGELOG.md` **Upgrade note** telling instances to update their own text. A doctrine change
  that ships silently to existing instances is the failure mode this consequence exists to
  prevent.
- **The gate acquires a mode branch it did not have.** `scripts/ci/check-worker-config-selftest.sh`
  gains planted-defect classes for both modes, since a mode-gated check that was only ever proven
  in one mode is half-tested.
- **Warnings can be ignored, and some will be.** An adopter who retunes a value and ignores both
  messages hits a merge conflict at upgrade with no memory of why. Accepted: that is a conflict
  over a value they chose, in a file they chose to edit, with the framework's value visible beside
  theirs. The alternative was refusing the edit outright.
- **Two instances can now diverge from the framework in ways the framework cannot see.** This
  weakens the "instances merge tags only, so behavior is determinate" property from ADR 004 for
  the tuning surface specifically. Accepted for tuning; deliberately not accepted for deployment
  identity, which is why (c) keeps that half fatal.
- **This does not license the framework to stop caring where identity lives.** `place.config.ts`
  remains the structured home for a retuned value, and `docs/runbook/DEPLOY.md` keeps pointing
  there. A structured key survives merges without conflict and is machine-validated; a hand-edit
  is permitted, not preferred.
- **Forecloses** a future gate that machine-blocks an adopter on ownership grounds alone. Any such
  proposal must first show harm beyond the editor, per (a).
