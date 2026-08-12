#!/usr/bin/env bash
#
# check-upgrade-state.sh — contract regression harness for the dev-plugin
# upgrade-state helper (`scripts/upgrade/dev-plugin-state.mjs`, LB-44 / ADR 006 /
# SPEC "Repo topology").
#
# The contract under test (CLI only — this harness never re-implements the
# helper's logic; it copies the real file out of this repo and drives it):
#
#   node scripts/upgrade/dev-plugin-state.mjs classify [--repo <dir>]
#   node scripts/upgrade/dev-plugin-state.mjs reconcile --state <stripped|installed> [--repo <dir>]
#
#   dev-plugin tree = `.agent-toolkit/`; dev config = `.agent-toolkit/dev.md`.
#   "active reference" = the literal `@.agent-toolkit/dev.md` in AGENTS.md or
#   CLAUDE.md on a line that is NOT inside an HTML comment (a reference inside a
#   comment is inert).
#     stripped  = tree absent      AND no active reference
#     installed = dev config present AND an active reference present
#     anything else = mixed/inconsistent
#   classify prints exactly `stripped` or `installed` on stdout (exit 0); on a
#   mixed state it prints a diagnostic naming the offending facts and a remedy on
#   STDERR and exits 3.
#   reconcile runs immediately AFTER the merge command, with --state set to what
#   classify printed BEFORE the merge. Exit 0 success / 1 failure / 2 usage.
#     --state stripped  removes every `.agent-toolkit/` path the merge brought in
#                       (modify/delete conflicts and theirs-only additions),
#                       removes any active reference the merge introduced into an
#                       entry file, and amends the merge commit if the merge
#                       already committed — the framework tree is never committed.
#     --state installed mutates nothing: asserts `.agent-toolkit/**` is
#                       byte-for-byte unchanged against the pre-merge revision,
#                       asserts config + active reference survive, and REPORTS
#                       (does not delete) framework paths the merge ADDED.
#
# Cases (each an independent disposable git repo under $(mktemp -d)):
#   0. reconcile usage contract — missing / invalid --state exits 2 and mutates
#      nothing.
#   1. stripped, shared history  — clone at fw-v1, init-wizard strip, merge fw-v2
#      (modify/delete conflict on the dev config), reconcile, finalize.
#   2. stripped, unrelated history — fresh repo, first framework merge with
#      --allow-unrelated-histories; passes whether or not the merge conflicts.
#      Sub-case 2b pins the no-conflict shape (git auto-commits the merge), which
#      is the only shape that exercises the amend path and the "reference the
#      merge introduced into an entry file" clause.
#   3. installed — adopter-owned dev config + rule survive a tag merge byte-for-byte.
#   4. mixed: tree present, reference absent (plus two inert-comment variants).
#   5. mixed: reference active, tree absent (in AGENTS.md and in CLAUDE.md).
#
# Cases 6-10 cover the second helper, `scripts/upgrade/maintainer-docs-state.mjs`
# (ADR 008 addendum). Its contract:
#
#   node scripts/upgrade/maintainer-docs-state.mjs classify  [--repo <dir>] [--from-tag <tag>] [--state <file>]
#   node scripts/upgrade/maintainer-docs-state.mjs reconcile [--repo <dir>] [--from-tag <tag>] [--state <file>]
#   node scripts/upgrade/maintainer-docs-state.mjs paths     [--repo <dir>] [--from-tag <tag>]
#
#   The path set is DERIVED from the init wizard's exported MAINTAINER_DOCS, so
#   this harness derives its fixtures from the same source (`paths`) instead of
#   restating them. `--from-tag` moves only that derivation to the tag being
#   merged; presence is always read from the pre-merge working tree.
#   Classification is PER PATH, with no activation signal and no
#   mixed state:
#     owned    = present before the merge -> never deleted; a change the merge made
#                is RESTORED where `git check-attr merge` reports `ours` for the
#                file, and stops the upgrade where it does not
#     stripped = absent  before the merge -> whatever the merge introduced is removed
#
#   The restore is there because `merge=ours` names a driver git runs only on a
#   three-way CONTENT merge: an instance whose copy still equals the merge base has
#   `ours == base`, git resolves to theirs, and the attribute never fires (case 14).
#   classify records its answer in the git directory; reconcile consumes it after
#   the merge. Exit 0 success / 1 failure / 2 usage / 3 contract underivable.
#
#   6. stripped instance, shared history (modify/delete on every doc path).
#   7. stripped instance, unrelated-history first merge (theirs-only additions;
#      the auto-commit shape exercises the amend path).
#   8. fully owned instance protected by merge=ours, where `ours != base` so the
#      driver really does fire: every path byte-for-byte unchanged, and a framework
#      file ADDED under an owned directory is REPORTED, never deleted. Case 14 is
#      the other half — same attribute, `ours == base`, driver never consulted.
#   9. partially owned instance: per-path outcome, and the run does NOT stop —
#      owning some of these paths and not others is a legitimate adopter state.
#  10. owned but UNCLAIMED — `git check-attr merge` does not report `ours` — in two
#      shapes (mid-merge, and the framework's edits merging cleanly so git
#      auto-commits): reconcile stops, reports the attribute value and the driver
#      state it OBSERVED, prescribes only the repair those observations support, and
#      the framework's copy never wins. The undo it prescribes depends on the shape —
#      `git merge --abort` mid-merge, `git reset --hard ORIG_HEAD` once the merge
#      is committed — and the auto-commit sub-case runs the prescribed command and
#      asserts it restores the instance's own documents.
#      10b is the third shape and is NOT a stop: the attribute is present and only
#      `merge.ours.driver` is unset, so git text-merges and conflicts — the instance
#      claimed the path, so reconcile restores it and reports the missing driver.
#  11. FIRST upgrade to the release that introduces MAINTAINER_DOCS: the working
#      tree's wizard predates the export, so classify without `--from-tag` cannot
#      derive the path set (exit 3) and `--from-tag <the tag being merged>` must
#      still produce the classification the whole pass depends on.
#
# Case 12 covers the third helper, `scripts/upgrade/package-state.mjs`, on the one
# path `merge=ours` cannot protect:
#
#   node scripts/upgrade/package-state.mjs capture              -> prints the state path
#   node scripts/upgrade/package-state.mjs reconcile <state>
#
#  12. FRAMEWORK-VERSION holds its PRE-MERGE value across the merge and changes
#      only on the explicit post-verification bump. A merge driver runs only on a
#      three-way content merge, so an instance that has not touched the file since
#      the merge base has `ours == base` and git fast-forwards to theirs — the
#      fixture pins that, with the attribute set and the driver configured, before
#      requiring reconcile to undo it. Sub-case 12b is the no-conflict shape, where
#      git auto-commits and reconcile must amend the merge commit.
#  12c. The other half of that contract: an instance that had NO FRAMEWORK-VERSION
#      must not gain one. This is the `frameworkVersion === null` branch, a state
#      `/sekai-upgrade` step 0 names explicitly ("pre-wizard instance"), and a
#      regression in it would leave every present-value fixture above green.
#
#  13. Helper version skew: every upgrade helper is bootstrapped from the TARGET
#      TAG, never from the copy in the instance's working tree — that copy shipped
#      with the release the instance is leaving, so preferring it means a release
#      which CHANGES a helper never applies the change on the upgrade that ships
#      it. 13a derives the bootstrap form from both adopter-facing documents; 13b
#      drives the skew end to end (fw-v1 ships a package-state.mjs with no
#      FRAMEWORK-VERSION handling, fw-v2 ships the real one) and pins that the
#      retired tree-first form loses the marker, so 13a guards a real difference.
#
#  14. maintainer docs the instance kept from the framework VERBATIM: `ours == base`,
#      so with the attribute set AND the driver configured git still fast-forwards to
#      theirs. reconcile restores the pre-merge content and amends the auto-committed
#      merge. This is the common adopter state, and before LB-88 it was a hard stop
#      whose printed remedy was already satisfied.
#
# Every seeded maintainer-doc directory carries a record whose NAME is not pure ASCII
# (DOC_RECORDS). Git C-quotes such a path in line-based `diff --name-status` and
# `ls-files -u` output, and a quoted literal is neither a pathspec git accepts nor a
# path `check-attr` resolves — so a producer inside the helper that drops `-z` reads
# the file as unclaimed and stops the upgrade with the remedy that cannot fix it. Case
# 14 pins the cleanly-merged producer and case 10b the conflicted one.
#
# Cases 15a-15f cover the fourth helper, `scripts/upgrade/framework-divergence.mjs`
# (ADR 010 (e)). Its contract:
#
#   node scripts/upgrade/framework-divergence.mjs report --target <tag> [--repo <dir>]
#   node scripts/upgrade/framework-divergence.mjs roots [--repo <dir>]
#
#   BEFORE the merge, every framework-owned path (the roots `roots` prints, from
#   which this harness derives its fixtures) whose content at HEAD differs from the
#   same path at `git merge-base HEAD <target>` is reported with the instance's value
#   and the incoming framework value: key by key for a `.toml`, as the differing
#   region otherwise. Reading the merge base rather than `--diff-filter=U` afterwards
#   is the point — the conflict list holds only what git could not resolve, so an
#   edit the framework never collided with is merged silently and never appears in
#   it. Exit 0 report / 1 not producible / 2 usage.
#
#  15a. A planted divergence is enumerated with BOTH values, and only it: a worker
#       template the instance retuned (three distinct floors across merge base,
#       target, and instance, so presenting the wrong side is caught), an edited
#       source file, and two framework-owned paths neither side touched that must
#       NOT appear.
#  15b. The same run writes nothing: HEAD, the porcelain status, the index, and every
#       file in the working tree and the git directory are identical afterwards. No
#       path is resolved in either direction, which is the whole difference between
#       this report and the `--theirs` sweep ADR 010 (f) removed.
#  15c. An instance with no framework-owned edit gets a clean report and no extra step.
#  15d. An unrelated-history first merge has no common ancestor: the report says so
#       and claims no divergence, rather than declaring every framework file drifted.
#  15e. The report's TOML key view agrees with `scripts/deploy/wrangler-config.mjs`
#       over every committed worker template. The helper cannot import that module —
#       it runs as a lone file extracted from a release tag — so the two readers are
#       held to one answer here instead.
#  15f. A CONVERGED path: the instance changed a file and the release ships that exact
#       content, so the path differs from the merge base but not from the target. It
#       is reported as settled with no conflict, and no value pair or "differing
#       region" header is printed over the empty diff between two identical blobs.
#       This is not an exotic shape — it is the success state of the route ADR 010 (g)
#       recommends, so an instance that upstreamed its edit meets it on the very
#       release that brings the edit back.
#
# Three option-contract checks close the loop from the other side:
#
#   - `reconcile` must REJECT `--from-tag` (exit 2). Reconciliation derives from the
#     MERGED tree on purpose: that is how a merge which did not bring the wizard
#     through gets exposed rather than papered over by reading the tag instead.
#   - The options the adopter-facing upgrade documents tell a user to pass are
#     checked, PER INVOKED COMMAND, against the helper's own COMMAND_OPTIONS table,
#     so a renamed or misplaced flag fails CI rather than leaving a runbook that
#     exits 2 at runtime. The extraction is scoped to that literal and carries a
#     non-vacuity probe, because the helper's source is full of single-quoted git
#     arguments (`--quiet`, `--ignore-unmatch`, ...) that a whole-file grep would
#     wrongly report as accepted CLI options.
#   - The framework-owned roots the divergence report walks are derived from that
#     helper and required to appear in both documents, with a probe proving the
#     pattern can fail. A root the report covers and the runbook does not name leaves
#     an adopter reading a list missing the tree their edit is in.
#
# `--selftest` proves the suite is non-vacuous: it re-runs cases 1, 2, 6, 7, 8, 9,
# 10, 11, 12, 12c, 13, 14, 15a and 15f with their load-bearing step DELIBERATELY SKIPPED and
# requires each
# case's own assertions to FAIL. A skipped run that passes means the case
# cannot detect the regression it exists to guard, and --selftest exits nonzero. No
# assertion that depends on that step is gated on the skip toggle, because gating one
# out is how a case silently becomes vacuous. For the reconcile helpers the skipped
# step is `reconcile`; for the report-only divergence helper it is the report itself,
# which the toggle replaces with an empty one.
#
# Fixtures use only generic names (Example / Instance / fw-v1) — this repo is in
# whole-tree template mode, so the genericity + English-only gates scan this file
# and everything it writes into scripts/.
#
# Usage:
#   bash scripts/upgrade/check-upgrade-state.sh             every case listed above
#   bash scripts/upgrade/check-upgrade-state.sh --selftest  non-vacuity proof
#
# Portability: macOS bash 3.2 + CI bash 5 (no mapfile/readarray, no associative
# arrays, no ${var,,}, CDPATH unset before cd-in-$()).

set -euo pipefail
unset CDPATH
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." >/dev/null 2>&1 && pwd)"

HELPER_SRC="$ROOT/scripts/upgrade/dev-plugin-state.mjs"
if [ ! -f "$HELPER_SRC" ]; then
  echo "❌ upgrade-state check FAILED: helper not found at $HELPER_SRC" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# The helper is driven from a stable copy outside every fixture (exercising
# `--repo`), because a stripped adopter merging the framework for the first time
# (case 2) has no copy of it until the merge lands. Case 1 additionally drives the
# fixture's own committed copy with plain cwd resolution, covering both CLI forms.
HELPER="$TMP/helper/dev-plugin-state.mjs"
mkdir -p "$TMP/helper" "$TMP/nohooks"
cp "$HELPER_SRC" "$HELPER"

MDOCS_HELPER_SRC="$ROOT/scripts/upgrade/maintainer-docs-state.mjs"
if [ ! -f "$MDOCS_HELPER_SRC" ]; then
  echo "❌ upgrade-state check FAILED: helper not found at $MDOCS_HELPER_SRC" >&2
  exit 1
fi
MDOCS_HELPER="$TMP/helper/maintainer-docs-state.mjs"
cp "$MDOCS_HELPER_SRC" "$MDOCS_HELPER"

PACKAGE_HELPER_SRC="$ROOT/scripts/upgrade/package-state.mjs"
if [ ! -f "$PACKAGE_HELPER_SRC" ]; then
  echo "❌ upgrade-state check FAILED: helper not found at $PACKAGE_HELPER_SRC" >&2
  exit 1
fi
PACKAGE_HELPER="$TMP/helper/package-state.mjs"
cp "$PACKAGE_HELPER_SRC" "$PACKAGE_HELPER"

DIVERGENCE_HELPER_SRC="$ROOT/scripts/upgrade/framework-divergence.mjs"
if [ ! -f "$DIVERGENCE_HELPER_SRC" ]; then
  echo "❌ upgrade-state check FAILED: helper not found at $DIVERGENCE_HELPER_SRC" >&2
  exit 1
fi
DIVERGENCE_HELPER="$TMP/helper/framework-divergence.mjs"
cp "$DIVERGENCE_HELPER_SRC" "$DIVERGENCE_HELPER"

# The framework-owned roots the divergence report walks are DERIVED from the helper,
# never restated here: a hardcoded fixture list would keep passing after the helper
# gained a root, which is the drift this suite exists to catch one tree over.
FRAMEWORK_OWNED_ROOTS="$(node "$DIVERGENCE_HELPER" roots --repo "$ROOT")" || {
  echo "❌ upgrade-state check FAILED: could not derive the framework-owned root set" >&2
  exit 1
}
if [ -z "$FRAMEWORK_OWNED_ROOTS" ]; then
  echo "❌ upgrade-state check FAILED: the derived framework-owned root set is empty" >&2
  exit 1
fi

# The maintainer-doc path set under test is DERIVED from the init wizard by the
# helper itself, never restated here — a hardcoded fixture list would keep passing
# after the wizard's strip list changed, which is the drift both the gate and the
# upgrade exist to prevent. Driving the out-of-tree copy against --repo is also the
# shape an instance uses when it extracts the helper from a release tag.
MAINTAINER_DOCS="$(node "$MDOCS_HELPER" paths --repo "$ROOT")" || {
  echo "❌ upgrade-state check FAILED: could not derive the maintainer-doc path set from the wizard" >&2
  exit 1
}
if [ -z "$MAINTAINER_DOCS" ]; then
  echo "❌ upgrade-state check FAILED: the derived maintainer-doc path set is empty" >&2
  exit 1
fi

REF_LINE='Dev workflow (agent-toolkit dev plugin): @.agent-toolkit/dev.md'

fail() {
  echo "❌ upgrade-state check FAILED: $1" >&2
  exit 1
}

ok() { echo "✓ $1"; }

# ---------------------------------------------------------------------------
# Harness-side contract predicates (independent of the implementation)
# ---------------------------------------------------------------------------

# Count active `@.agent-toolkit/dev.md` references in a file: occurrences on
# lines outside HTML comments, with comment state carried across lines so a
# multi-line `<!-- ... -->` block makes every reference inside it inert.
active_ref_count() {
  if [ ! -f "$1" ]; then echo 0; return; fi
  awk '
    function strip(line,   i, j, out) {
      out = ""
      while (length(line) > 0) {
        if (incomment) {
          i = index(line, "-->")
          if (i == 0) return out
          line = substr(line, i + 3)
          incomment = 0
        } else {
          j = index(line, "<!--")
          if (j == 0) return out line
          out = out substr(line, 1, j - 1)
          line = substr(line, j + 4)
          incomment = 1
        }
      }
      return out
    }
    { if (index(strip($0), "@.agent-toolkit/dev.md") > 0) n++ }
    END { print n + 0 }
  ' "$1"
}

assert_no_active_reference() { # dir label
  local f count
  for f in AGENTS.md CLAUDE.md; do
    count="$(active_ref_count "$1/$f")"
    [ "$count" = "0" ] || fail "$2: $f carries $count active @.agent-toolkit/dev.md reference(s) after reconcile"
  done
  ok "$2: no active dev-plugin reference in AGENTS.md / CLAUDE.md"
}

assert_active_reference() { # dir label
  local total
  total=$(( $(active_ref_count "$1/AGENTS.md") + $(active_ref_count "$1/CLAUDE.md") ))
  [ "$total" -gt 0 ] || fail "$2: the adopter's active dev-plugin reference did not survive the merge"
  ok "$2: adopter's active dev-plugin reference survived"
}

assert_no_tree_paths_in_commit() { # dir rev label
  local paths
  paths="$(git -C "$1" ls-tree -r --name-only "$2" | grep '^\.agent-toolkit/' || true)"
  [ -z "$paths" ] || fail "$3: commit $2 carries dev-plugin paths: $(echo "$paths" | tr '\n' ' ')"
  ok "$3: finalized merge commit carries no .agent-toolkit/ path"
}

assert_no_unmerged_paths() { # dir label
  local u
  u="$(git -C "$1" diff --name-only --diff-filter=U)"
  [ -z "$u" ] || fail "$2: unmerged paths remain after reconcile (the user was left to resolve them): $(echo "$u" | tr '\n' ' ')"
  ok "$2: no unmerged paths remain — no dev-plugin conflict reached the user"
}

assert_no_unmerged_tree_paths() { # dir label
  local u
  u="$(git -C "$1" diff --name-only --diff-filter=U | grep '^\.agent-toolkit/' || true)"
  [ -z "$u" ] || fail "$2: dev-plugin paths left unmerged by reconcile: $(echo "$u" | tr '\n' ' ')"
  ok "$2: no .agent-toolkit/ path left unmerged"
}

assert_is_merge_commit() { # dir label
  local parents
  parents="$(git -C "$1" rev-list --parents -n 1 HEAD | wc -w | tr -d ' ')"
  [ "$parents" -ge 3 ] || fail "$2: HEAD is not a merge commit (the framework merge did not happen)"
  ok "$2: HEAD is a real merge commit"
}

# ---------------------------------------------------------------------------
# Helper invocation
# ---------------------------------------------------------------------------

HELPER_STATUS=0
HELPER_OUT=""
HELPER_ERR=""

run_helper() { # dir subcommand [args...]
  local dir="$1"
  shift
  HELPER_STATUS=0
  node "$HELPER" "$@" --repo "$dir" > "$TMP/stdout.txt" 2> "$TMP/stderr.txt" || HELPER_STATUS=$?
  HELPER_OUT="$(cat "$TMP/stdout.txt")"
  HELPER_ERR="$(cat "$TMP/stderr.txt")"
}

run_helper_in_repo() { # dir subcommand [args...] — cwd form, repo's own copy
  local dir="$1"
  shift
  HELPER_STATUS=0
  ( cd "$dir" && node scripts/upgrade/dev-plugin-state.mjs "$@" ) \
    > "$TMP/stdout.txt" 2> "$TMP/stderr.txt" || HELPER_STATUS=$?
  HELPER_OUT="$(cat "$TMP/stdout.txt")"
  HELPER_ERR="$(cat "$TMP/stderr.txt")"
}

assert_classify() { # dir label expected
  run_helper "$1" classify
  [ "$HELPER_STATUS" -eq 0 ] || fail "$2: classify exited $HELPER_STATUS (expected 0); stderr: $HELPER_ERR"
  [ "$HELPER_OUT" = "$3" ] || fail "$2: classify printed '$HELPER_OUT' on stdout (expected exactly '$3')"
  ok "$2: classify = $3"
}

assert_classify_mixed() { # dir label
  run_helper "$1" classify
  [ "$HELPER_STATUS" -eq 3 ] || fail "$2: classify exited $HELPER_STATUS (expected 3 for a mixed state); stdout: '$HELPER_OUT'; stderr: '$HELPER_ERR'"
  [ -n "$HELPER_ERR" ] || fail "$2: classify exited 3 with no diagnostic on stderr"
  printf '%s' "$HELPER_ERR" | grep -q '\.agent-toolkit' \
    || fail "$2: mixed-state diagnostic does not name the offending dev-plugin facts: $HELPER_ERR"
  printf '%s' "$HELPER_ERR" | grep -Eiq 'remed|fix|resolve|restore|re-add|re-run|rerun|remove|delete' \
    || fail "$2: mixed-state diagnostic names no remedy: $HELPER_ERR"
  if printf '%s' "$HELPER_OUT" | grep -Eq 'stripped|installed'; then
    fail "$2: classify leaked a state verdict on stdout for a mixed state: '$HELPER_OUT'"
  fi
  ok "$2: classify exits 3, diagnoses on stderr with a remedy, prints no verdict on stdout"
}

# reconcile, honoring the --selftest skip toggle (SKIP_RECONCILE=1).
run_reconcile() { # dir state label
  if [ "${SKIP_RECONCILE:-0}" = "1" ]; then
    echo "   (selftest: reconcile --state $2 DELIBERATELY SKIPPED)"
    HELPER_STATUS=0
    HELPER_OUT=""
    HELPER_ERR=""
    return 0
  fi
  run_helper "$1" reconcile --state "$2"
}

assert_reconcile_ok() { # dir state label
  run_reconcile "$1" "$2" "$3"
  [ "$HELPER_STATUS" -eq 0 ] \
    || fail "$3: reconcile --state $2 exited $HELPER_STATUS (expected 0); stdout: '$HELPER_OUT'; stderr: '$HELPER_ERR'"
  [ "${SKIP_RECONCILE:-0}" = "1" ] || ok "$3: reconcile --state $2 exited 0"
}

# ---------------------------------------------------------------------------
# Maintainer-doc helper invocation (ADR 008 addendum)
# ---------------------------------------------------------------------------

run_mdocs() { # dir subcommand [args...]
  local dir="$1"
  shift
  HELPER_STATUS=0
  node "$MDOCS_HELPER" "$@" --repo "$dir" > "$TMP/stdout.txt" 2> "$TMP/stderr.txt" || HELPER_STATUS=$?
  HELPER_OUT="$(cat "$TMP/stdout.txt")"
  HELPER_ERR="$(cat "$TMP/stderr.txt")"
}

# Sorted, space-separated tokens from a comma-separated helper field, so an
# assertion does not depend on the order the wizard happens to list paths in.
# The helper prints the literal `none` for an empty side; that is the same
# assertion as an empty expectation, so it normalizes away.
# `sed` rather than `grep -v`: an empty result is a legitimate answer here, and a
# grep that filters every line exits 1, which `set -e` turns into a silent abort.
normalize_list() { # raw
  printf '%s' "$1" | tr ', ' '\n\n' | sed '/^$/d; /^none$/d' | sort | paste -sd ' ' -
}

mdocs_field() { # field — reads the classify output in $HELPER_OUT
  printf '%s\n' "$HELPER_OUT" | sed -n "s/^maintainer-docs-state: $1: //p"
}

assert_mdocs_classify() { # dir label expected-owned expected-stripped [extra classify args...]
  local dir="$1" label="$2" want_owned="$3" want_stripped="$4"
  local owned stripped
  shift 4
  run_mdocs "$dir" classify "$@"
  [ "$HELPER_STATUS" -eq 0 ] || fail "$label: classify exited $HELPER_STATUS (expected 0); stderr: $HELPER_ERR"
  owned="$(normalize_list "$(mdocs_field owned)")"
  stripped="$(normalize_list "$(mdocs_field stripped)")"
  [ "$owned" = "$(normalize_list "$want_owned")" ] \
    || fail "$label: classify reported owned='$owned' (expected '$(normalize_list "$want_owned")')"
  [ "$stripped" = "$(normalize_list "$want_stripped")" ] \
    || fail "$label: classify reported stripped='$stripped' (expected '$(normalize_list "$want_stripped")')"
  ok "$label: classify — owned: ${owned:-none} | stripped: ${stripped:-none}"
}

# reconcile, honoring the --selftest skip toggle (SKIP_RECONCILE=1).
run_mdocs_reconcile() { # dir label
  if [ "${SKIP_RECONCILE:-0}" = "1" ]; then
    echo "   (selftest: maintainer-docs reconcile DELIBERATELY SKIPPED)"
    HELPER_STATUS=0
    HELPER_OUT=""
    HELPER_ERR=""
    return 0
  fi
  run_mdocs "$1" reconcile
}

assert_mdocs_reconcile_ok() { # dir label
  run_mdocs_reconcile "$1" "$2"
  [ "$HELPER_STATUS" -eq 0 ] \
    || fail "$2: reconcile exited $HELPER_STATUS (expected 0); stdout: '$HELPER_OUT'; stderr: '$HELPER_ERR'"
  [ "${SKIP_RECONCILE:-0}" = "1" ] || ok "$2: reconcile exited 0"
}

# An owned path the instance never CLAIMED (`check-attr merge` does not report
# `ours`) must STOP the upgrade, and the diagnostic must report what it observed
# rather than assuming. Routed through run_mdocs_reconcile so --selftest can skip
# it: an upgrade that does NOT stop is exactly the regression this assertion guards.
#
# Every caller of this assertion has the driver CONFIGURED — the unconfigured shape
# is a restore now (case 10b), not a stop — so the diagnostic must report that
# observation and must not prescribe configuring it. A remedy the reader has already
# satisfied is what made the LB-88 stop unescapable.
#
# The third argument is a failing FILE inside the stopped path. The expected attribute
# value is read out of git for that file rather than written here: the assertion is
# that the diagnostic echoes what git really resolved, whatever word git uses for it.
# Hardcoding `unspecified` would couple this to git's name for one particular unset
# state and misreport a caller whose path resolves to some other non-`ours` value.
assert_mdocs_reconcile_stops() { # dir label failing-file
  local observed
  run_mdocs_reconcile "$1" "$2"
  [ "$HELPER_STATUS" -ne 0 ] \
    || fail "$2: reconcile exited 0 on an unclaimed owned path — the framework copy was allowed to win"
  [ -n "$HELPER_ERR" ] || fail "$2: reconcile failed with no diagnostic on stderr"
  printf '%s' "$HELPER_ERR" | grep -q 'merge=ours' \
    || fail "$2: the diagnostic does not name the missing .gitattributes marking: $HELPER_ERR"
  printf '%s' "$HELPER_ERR" | grep -q 'merge.ours.driver' \
    || fail "$2: the diagnostic does not report what it observed about the per-clone driver: $HELPER_ERR"
  # Observed, not assumed: the attribute value git really resolves for the path.
  printf '%s' "$HELPER_ERR" | grep -q 'check-attr merge' \
    || fail "$2: the diagnostic does not report the observed \`check-attr merge\` value: $HELPER_ERR"
  observed="$(git -C "$1" check-attr merge -- "$3" | sed 's/.*: //')"
  [ -n "$observed" ] || fail "$2: fixture guard — git resolved no merge attribute for $3"
  [ "$observed" != "ours" ] \
    || fail "$2: fixture guard — git reports \`ours\` for $3, so this is not the unclaimed-path shape"
  printf '%s' "$HELPER_ERR" | grep -Fq "$observed" \
    || fail "$2: the diagnostic does not print the value git actually resolved for $3 (\`$observed\`): $HELPER_ERR"
  if printf '%s' "$HELPER_ERR" | grep -q 'git config merge.ours.driver true'; then
    fail "$2: the diagnostic prescribes configuring a driver that IS already configured in this clone — a remedy that cannot fix the stop: $HELPER_ERR"
  fi
  ok "$2: reconcile stops, reports both observations (attribute \`$observed\`), and prescribes only the repair they support"
}

# ---------------------------------------------------------------------------
# Divergence-report helper invocation (ADR 010 (e))
# ---------------------------------------------------------------------------

run_divergence() { # dir subcommand [args...]
  local dir="$1"
  shift
  HELPER_STATUS=0
  node "$DIVERGENCE_HELPER" "$@" --repo "$dir" > "$TMP/stdout.txt" 2> "$TMP/stderr.txt" || HELPER_STATUS=$?
  HELPER_OUT="$(cat "$TMP/stdout.txt")"
  HELPER_ERR="$(cat "$TMP/stderr.txt")"
}

# The report, honoring the --selftest skip toggle. SKIP_RECONCILE is this harness's
# generic "skip the load-bearing step" switch; this helper has no reconcile, so the
# load-bearing step IS the report, and skipping it means substituting an empty one.
# Every assertion that reads the report stays ungated, which is what makes the
# selftest run prove the case detects a report that omits a real divergence.
run_divergence_report() { # dir target label
  if [ "${SKIP_RECONCILE:-0}" = "1" ]; then
    echo "   (selftest: the divergence report is DELIBERATELY SKIPPED)"
    HELPER_STATUS=0
    HELPER_OUT=""
    HELPER_ERR=""
    return 0
  fi
  run_divergence "$1" report --target "$2"
}

assert_divergence_report_ok() { # dir target label
  run_divergence_report "$1" "$2" "$3"
  [ "$HELPER_STATUS" -eq 0 ] \
    || fail "$3: report --target $2 exited $HELPER_STATUS (expected 0); stdout: '$HELPER_OUT'; stderr: '$HELPER_ERR'"
  [ "${SKIP_RECONCILE:-0}" = "1" ] || ok "$3: report --target $2 exited 0"
}

assert_report_names() { # label needle noun-phrase
  printf '%s\n' "$HELPER_OUT" | grep -Fq "$2" \
    || fail "$1: the report does not name $3 (looked for '$2'). Report was:
$HELPER_OUT"
  ok "$1: the report names $3"
}

assert_report_silent_about() { # label needle noun-phrase
  if printf '%s\n' "$HELPER_OUT" | grep -Fq "$2"; then
    fail "$1: the report names $3 ('$2'), so it is not scoped to what actually diverged. Report was:
$HELPER_OUT"
  fi
  ok "$1: the report does not name $3"
}

# Everything the repository is, as one comparable string: the committed head, the
# porcelain status, and every file in the working tree AND the git directory. A
# report that wrote a state file, staged a path, or resolved a conflict changes one
# of these. `find` rather than `git ls-files` on purpose — an untracked artifact
# inside .git is exactly the write a git-only listing would miss.
repo_snapshot() { # dir
  git -C "$1" rev-parse HEAD
  git -C "$1" status --porcelain
  ( cd "$1" && find . -type f | LC_ALL=C sort )
  git -C "$1" ls-files -s
}

# ---------------------------------------------------------------------------
# Fixture builders
# ---------------------------------------------------------------------------

# Every fixture repo carries the wizard, because the helper derives the path set
# from it rather than from a list of its own.
write_wizard() { # dir
  local rel
  mkdir -p "$1/scripts/init"
  {
    printf 'export const MAINTAINER_DOCS = [\n'
    for rel in $MAINTAINER_DOCS; do printf "  '%s',\n" "$rel"; done
    printf '];\n'
  } > "$1/scripts/init/writer.mjs"
}

# A wizard from BEFORE the strip list was exported. This is the tree an instance
# really has on its first upgrade to the release that introduces MAINTAINER_DOCS:
# the docs already exist, the export does not, so the path set can only come from
# the tag being merged.
write_legacy_wizard() { # dir
  mkdir -p "$1/scripts/init"
  printf 'export const PLACEHOLDER_SETTINGS = { seeded: true };\n' > "$1/scripts/init/writer.mjs"
}

# A file path gets a file; a directory path gets one record inside it.
# Documents at the CURRENTLY declared paths. Delegates to write_docs_at so every
# fixture document has the same body shape wherever it sits: rename detection compares
# a file at the old path with one at the new path, so a one-line body here and a full
# one there would make the framework's own relocation look like a delete plus an add and
# quietly remove the asymmetry the relocation case exists to reproduce.
write_maintainer_docs() { # dir marker
  write_docs_at "$1" "$MAINTAINER_DOCS" "$2"
}

# The init wizard's strip, as an adopter's tree really looks afterwards.
strip_maintainer_docs() { # dir
  local rel
  for rel in $MAINTAINER_DOCS; do rm -rf "$1/$rel"; done
}

# The record files write_docs_at seeds inside a DIRECTORY entry of the maintainer-doc
# set. The second one carries a non-ASCII byte on purpose, and it is a guard rather
# than decoration: git's line-based `diff --name-status` and `ls-files -u` output
# C-quotes any path holding a byte above 0x7f (`core.quotePath` defaults to true), and
# the quoted literal is neither a pathspec git accepts nor a path `check-attr`
# resolves. A producer inside the helper that drops `-z` therefore reads this file as
# unclaimed and stops the upgrade with the one remedy that cannot fix it — the LB-88
# defect itself, in a shape a pure-ASCII fixture cannot reach. Latin script only: the
# English-only gate bans CJK codepoints in `scripts/`, and the language support
# boundary (AGENTS.md) puts Latin-script content inside what the framework supports.
NON_ASCII_DOC_RECORD="003-non-ascii-café.md"
DOC_RECORDS="001-example.md $NON_ASCII_DOC_RECORD"

# A concrete FILE inside the maintainer-doc set, for the conflict fixtures below.
# Mirrors seed_maintainer_docs: a `*.md` entry is itself a file, and any other entry
# is a directory the seeder fills with the DOC_RECORDS above. Deriving the file from
# the entry shape rather than requiring a `*.md` entry is what lets the declaration be
# a single directory (ADR 009) without this fixture losing its conflict target.
first_doc_file() { # — a concrete file path the seeder writes
  local rel
  for rel in $MAINTAINER_DOCS; do
    case "$rel" in
      *.md) printf '%s' "$rel"; return ;;
      *)    printf '%s/001-example.md' "$rel"; return ;;
    esac
  done
  fail "fixture: the derived maintainer-doc set is empty"
}

# The non-ASCII record inside the first DIRECTORY entry, or empty when the declared
# set holds only file entries — the seeder writes records only inside directories, so
# a declaration that ever becomes file-only loses this pin rather than failing on a
# path nothing wrote.
non_ascii_doc_file() { # — the seeded non-ASCII file path, or empty
  local rel
  for rel in $MAINTAINER_DOCS; do
    case "$rel" in
      *.md) ;;
      *)    printf '%s/%s' "$rel" "$NON_ASCII_DOC_RECORD"; return ;;
    esac
  done
}

# Every file the seeder wrote under one maintainer-doc entry, compared byte-for-byte
# against a copy kept before the merge. Walks DOC_RECORDS rather than naming
# 001-example.md, so the non-ASCII record is covered wherever a case asserts content.
assert_doc_entry_matches() { # instance-dir kept-tree rel label
  local record
  case "$3" in
    *.md)
      cmp "$1/$3" "$2/$3" \
        || fail "$4: $3 is not byte-for-byte its pre-merge copy"
      ;;
    *)
      for record in $DOC_RECORDS; do
        cmp "$1/$3/$record" "$2/$3/$record" \
          || fail "$4: $3/$record is not byte-for-byte its pre-merge copy"
      done
      ;;
  esac
}

assert_maintainer_docs_absent() { # dir label
  local rel
  for rel in $MAINTAINER_DOCS; do
    [ ! -e "$1/$rel" ] || fail "$2: $rel survives in the working tree"
    [ -z "$(git -C "$1" ls-files -- "$rel")" ] || fail "$2: $rel is still tracked in the index"
    [ -z "$(git -C "$1" ls-files -u -- "$rel")" ] || fail "$2: $rel still has unmerged entries"
  done
  ok "$2: no maintainer-doc path in the working tree or the index"
}

assert_maintainer_docs_not_in_commit() { # dir rev label
  local rel paths
  for rel in $MAINTAINER_DOCS; do
    paths="$(git -C "$1" ls-tree -r --name-only "$2" -- "$rel")"
    [ -z "$paths" ] || fail "$3: commit $2 carries maintainer-doc path(s): $(echo "$paths" | tr '\n' ' ')"
  done
  ok "$3: finalized merge commit carries no maintainer-doc path"
}

configure_repo() { # dir
  git -C "$1" config user.email "harness@example.invalid"
  git -C "$1" config user.name "Upgrade Harness"
  git -C "$1" config commit.gpgsign false
  git -C "$1" config tag.gpgsign false
  git -C "$1" config merge.ours.driver true   # required for merge=ours (docs/runbook/UPGRADE.md)
  git -C "$1" config core.hooksPath "$TMP/nohooks"
}

init_repo() { # dir
  mkdir -p "$1"
  git -C "$1" init -q
  git -C "$1" symbolic-ref HEAD refs/heads/main
  configure_repo "$1"
}

write_gitattributes() { # dir — byte-identical in framework and instances
  cat > "$1/.gitattributes" <<'EOF'
AGENTS.md merge=ours
CLAUDE.md merge=ours
CHANGELOG.md merge=ours
VERSION merge=ours
FRAMEWORK-VERSION merge=ours
place.config.ts merge=ours
.agent-toolkit/** merge=ours
EOF
}

# An instance that owns documents at the maintainer-doc paths must mark them
# instance-owned BEFORE its first merge of a release that carries them; a file path
# takes the path itself, a directory path takes a `/**` glob.
append_maintainer_doc_attributes() { # dir
  local rel
  for rel in $MAINTAINER_DOCS; do
    case "$rel" in
      *.md) printf '%s merge=ours\n' "$rel" >> "$1/.gitattributes" ;;
      *) printf '%s/** merge=ours\n' "$rel" >> "$1/.gitattributes" ;;
    esac
  done
}

write_dev_config() { # file marker
  cat > "$1" <<EOF
---
tracker: linear
context_file: AGENTS.md
rules_dir: .agent-toolkit/rules/
---

# Example dev config ($2)
EOF
}

# Framework AGENTS.md: dev-plugin block between sentinels, reference on the last
# line inside the block (the shape the init wizard strips).
write_framework_agents_md() { # file
  cat > "$1" <<EOF
# Example Framework

Template instructions for the Example framework.

<!-- dev-plugin:start - the init wizard strips this block, and the
     .agent-toolkit/ tree it points at, from adopter clones. Framework state only. -->
## Framework development

This repository is developed with the agent-toolkit dev plugin. Adopters do not
need any of this.

$REF_LINE
<!-- dev-plugin:end -->
EOF
}

write_instance_agents_md() { # file variant
  case "$2" in
    no-reference)
      cat > "$1" <<'EOF'
# Example Instance

Instance instructions. This instance keeps no dev-plugin state.
EOF
      ;;
    active-reference)
      cat > "$1" <<EOF
# Example Instance

Instance instructions. This instance runs the dev plugin.

## Dev workflow

$REF_LINE
EOF
      ;;
    inert-reference-inline)
      cat > "$1" <<EOF
# Example Instance

Instance instructions. The reference below is commented out and therefore inert.

<!-- $REF_LINE -->
EOF
      ;;
    inert-reference-block)
      cat > "$1" <<EOF
# Example Instance

Instance instructions. The reference below sits inside a multi-line HTML comment
and is therefore inert.

<!-- dev-plugin:start - disabled for this instance.
## Dev workflow

$REF_LINE
<!-- dev-plugin:end -->
EOF
      ;;
    *) fail "unknown AGENTS.md variant: $2" ;;
  esac
}

write_instance_changelog() { # file
  cat > "$1" <<'EOF'
# Instance changelog

Instance-only sentinel. Framework upgrades must preserve these bytes.
EOF
}

assert_instance_changelog() { # repo label
  grep -Fq 'Instance-only sentinel' "$1/CHANGELOG.md" \
    || fail "$2: framework CHANGELOG.md replaced the instance changelog"
  if grep -Fq 'Framework release fw-v2' "$1/CHANGELOG.md"; then
    fail "$2: framework release history leaked into the instance changelog"
  fi
  ok "$2: instance CHANGELOG.md is preserved"
}

write_instance_framework_version() { # file
  printf 'instance-v1\n' > "$1"
}

write_instance_version() { # file
  printf 'adopter-v7\n' > "$1"
}

assert_instance_framework_version() { # repo label
  [ "$(cat "$1/FRAMEWORK-VERSION")" = "instance-v1" ] \
    || fail "$2: framework merge replaced FRAMEWORK-VERSION before the explicit bump"
  ok "$2: FRAMEWORK-VERSION is preserved through the merge"
}

assert_instance_version() { # repo label
  [ "$(cat "$1/VERSION")" = "adopter-v7" ] \
    || fail "$2: framework merge replaced the adopter's VERSION"
  ok "$2: adopter VERSION is preserved"
}

# Framework repo carrying legacy fw-v1 (which mistakenly tracked VERSION) and
# corrected fw-v2 (which deletes it so only adopters carry VERSION).
build_framework() { # dir [legacy-wizard]
  local fw="$1"
  init_repo "$fw"
  mkdir -p "$fw/.agent-toolkit/rules" "$fw/src" "$fw/scripts/upgrade"
  write_framework_agents_md "$fw/AGENTS.md"
  write_dev_config "$fw/.agent-toolkit/dev.md" "fw-v1"
  cat > "$fw/.agent-toolkit/rules/example-rule.md" <<'EOF'
---
tier: doctrine
---
# Example rule (framework-owned, fw-v1)
EOF
  write_gitattributes "$fw"
  if [ "${2:-}" = "legacy-wizard" ]; then write_legacy_wizard "$fw"; else write_wizard "$fw"; fi
  write_maintainer_docs "$fw" "fw-v1"
  # Adopter-facing docs live beside the maintainer docs and must survive the strip
  # and every upgrade — the other half of the ownership boundary.
  mkdir -p "$fw/docs/playbook"
  printf '# Editorial canon (adopter-facing, survives adoption)\n' > "$fw/docs/playbook/keep.md"
  printf '# Framework changelog\n\nFramework release fw-v1.\n' > "$fw/CHANGELOG.md"
  printf 'template-v1\n' > "$fw/VERSION"
  printf 'framework-v1\n' > "$fw/FRAMEWORK-VERSION"
  printf 'export const place = { name: "Example", tagline: "The framework demo place." };\n' > "$fw/place.config.ts"
  printf 'export const FRAMEWORK_APP = "fw-v1";\n' > "$fw/src/app.js"
  cp "$HELPER_SRC" "$fw/scripts/upgrade/dev-plugin-state.mjs"
  git -C "$fw" add -A
  git -C "$fw" commit -q -m "Example framework fw-v1"
  git -C "$fw" tag fw-v1

  write_dev_config "$fw/.agent-toolkit/dev.md" "fw-v2"
  cat > "$fw/.agent-toolkit/rules/new-rule.md" <<'EOF'
---
tier: gotcha
triggers:
  paths:
    - "src/**"
---
# New rule (framework-owned, added in fw-v2)
EOF
  printf 'export const FRAMEWORK_APP = "fw-v2";\n' > "$fw/src/app.js"
  # fw-v2 always exports the strip list, so a `legacy-wizard` framework models the
  # release that INTRODUCES it — the first-upgrade shape case 11 drives.
  write_wizard "$fw"
  # fw-v2 CHANGES every maintainer doc (so a stripped instance on shared history
  # hits the modify/delete case) and ADDS one record the instance cannot have (so
  # the owned case exercises the report-never-delete rule).
  write_maintainer_docs "$fw" "fw-v2"
  local docdir
  for docdir in $MAINTAINER_DOCS; do
    case "$docdir" in
      *.md) ;;
      *) printf '# Decision record 002 (added in fw-v2)\n' > "$fw/$docdir/002-added-in-fw-v2.md" ;;
    esac
  done
  printf '# Framework changelog\n\nFramework release fw-v2.\n' > "$fw/CHANGELOG.md"
  rm "$fw/VERSION"
  printf 'framework-v2\n' > "$fw/FRAMEWORK-VERSION"
  git -C "$fw" add -A
  git -C "$fw" commit -q -m "Example framework fw-v2"
  git -C "$fw" tag fw-v2
}

# Common instance skeleton (no AGENTS.md, no dev-plugin state, not committed).
lay_instance_skeleton() { # dir
  mkdir -p "$1/src" "$1/scripts/upgrade"
  write_gitattributes "$1"
  write_wizard "$1"   # framework scripts survive adoption; the strip removes docs, not the wizard
  printf 'export const place = { name: "Instance", tagline: "The adopting instance." };\n' > "$1/place.config.ts"
  printf 'export const INSTANCE_APP = "instance-local";\n' > "$1/src/app.js"
  printf '@AGENTS.md\n' > "$1/CLAUDE.md"
  write_instance_changelog "$1/CHANGELOG.md"
  write_instance_version "$1/VERSION"
  write_instance_framework_version "$1/FRAMEWORK-VERSION"
  cp "$HELPER_SRC" "$1/scripts/upgrade/dev-plugin-state.mjs"
}

clone_at_v1() { # framework-dir dest
  git clone -q "$1" "$2"
  configure_repo "$2"
  git -C "$2" checkout -q -B main fw-v1
  write_instance_changelog "$2/CHANGELOG.md"
  write_instance_version "$2/VERSION"
  write_instance_framework_version "$2/FRAMEWORK-VERSION"
}

# Resolve any conflict the harness itself is responsible for finishing, then
# commit. Instance-owned entry/config files take OURS (that is what merge=ours
# declares them to be); framework-owned code takes THEIRS. Dev-plugin paths are
# never touched here — resolving them is reconcile's job and is asserted before
# this runs.
finalize_merge() { # dir label
  local path
  git -C "$1" diff --name-only --diff-filter=U | while IFS= read -r path; do
    case "$path" in
      AGENTS.md|CLAUDE.md|CHANGELOG.md|VERSION|FRAMEWORK-VERSION|place.config.ts)
        git -C "$1" checkout --ours -- "$path" 2>/dev/null || true
        ;;
      *)
        git -C "$1" checkout --theirs -- "$path" 2>/dev/null || true
        ;;
    esac
    git -C "$1" add -A -- "$path"
  done
  if git -C "$1" rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then
    git -C "$1" commit -q --no-edit || fail "$2: could not finalize the merge commit"
  fi
}

# ---------------------------------------------------------------------------
# Case 1 — stripped instance, shared history
# ---------------------------------------------------------------------------
case_stripped_shared_history() { # workdir
  local work="$1" fw inst
  fw="$work/fw"
  inst="$work/instance"
  mkdir -p "$work"
  build_framework "$fw"
  clone_at_v1 "$fw" "$inst"

  # Simulate the init wizard's strip: remove the tree and the reference.
  rm -rf "$inst/.agent-toolkit"
  write_instance_agents_md "$inst/AGENTS.md" no-reference
  git -C "$inst" add -A
  git -C "$inst" commit -q -m "Adopt Example framework: strip dev-plugin state"

  # cwd form, from the instance's own committed copy of the helper.
  run_helper_in_repo "$inst" classify
  [ "$HELPER_STATUS" -eq 0 ] || fail "case 1: classify exited $HELPER_STATUS (expected 0); stderr: $HELPER_ERR"
  [ "$HELPER_OUT" = "stripped" ] || fail "case 1: classify printed '$HELPER_OUT' (expected exactly 'stripped')"
  ok "case 1: classify = stripped (cwd form, repo's own copy of the helper)"

  local merge_status=0
  git -C "$inst" merge --no-edit fw-v2 >/dev/null 2>&1 || merge_status=$?
  [ "$merge_status" -ne 0 ] \
    || fail "case 1: the fw-v2 merge did not stop on the dev-config modify/delete conflict (fixture no longer exercises the contract)"
  git -C "$inst" diff --name-only --diff-filter=U | grep -q '^\.agent-toolkit/dev\.md$' \
    || fail "case 1: expected .agent-toolkit/dev.md to be the unmerged modify/delete path"
  ok "case 1: fw-v2 merge stops on the .agent-toolkit/dev.md modify/delete conflict"

  assert_reconcile_ok "$inst" stripped "case 1"
  git -C "$inst" diff --name-only --diff-filter=U | grep -qx 'VERSION' \
    || fail "case 1: expected the one-time VERSION modify/delete conflict after dev-plugin reconciliation"
  ok "case 1: one-time framework VERSION deletion leaves the adopter VERSION for explicit resolution"
  finalize_merge "$inst" "case 1"

  assert_is_merge_commit "$inst" "case 1"
  assert_no_tree_paths_in_commit "$inst" HEAD "case 1"
  [ ! -e "$inst/.agent-toolkit" ] || fail "case 1: .agent-toolkit/ survives in the working tree"
  assert_no_active_reference "$inst" "case 1"

  git -C "$inst" show HEAD:src/app.js | grep -q 'fw-v2' \
    || fail "case 1: the framework's non-dev-plugin change (src/app.js at fw-v2) did not land — reconcile discarded the merge"
  ok "case 1: the framework's non-dev-plugin change (src/app.js @ fw-v2) landed"
  assert_instance_changelog "$inst" "case 1"
  assert_instance_version "$inst" "case 1"
  assert_instance_framework_version "$inst" "case 1"

  # 1b — the same stripped shared-history upgrade run from a LINKED GIT WORKTREE
  # (`git worktree add`), not a standalone clone. Git answers `rev-parse
  # --git-path MERGE_HEAD` with an ABSOLUTE path there
  # (`<main>/.git/worktrees/<name>/MERGE_HEAD`) instead of the repo-relative
  # `.git/MERGE_HEAD`, so a helper that resolves it as repo-relative misses the
  # file, believes the merge already committed, and runs `git commit --amend`
  # mid-merge — which git refuses. Review finding B1 on PR #16.
  local inst_wt wt
  inst_wt="$work/instance-worktree-main"
  wt="$work/instance-worktree-linked"
  clone_at_v1 "$fw" "$inst_wt"
  rm -rf "$inst_wt/.agent-toolkit"
  write_instance_agents_md "$inst_wt/AGENTS.md" no-reference
  git -C "$inst_wt" add -A
  git -C "$inst_wt" commit -q -m "Adopt Example framework: strip dev-plugin state"
  git -C "$inst_wt" worktree add -q "$wt" -b upgrade-in-worktree HEAD

  # Fixture guard: this must really be a linked worktree (.git is a file there).
  [ -f "$wt/.git" ] || fail "case 1b: fixture is not a linked worktree (.git is not a gitfile)"
  case "$(git -C "$wt" rev-parse --git-path MERGE_HEAD)" in
    /*) : ;;
    *) fail "case 1b: fixture guard — git no longer answers --git-path absolutely in a linked worktree, so the topology under test is gone" ;;
  esac
  assert_classify "$wt" "case 1b" stripped

  merge_status=0
  git -C "$wt" merge --no-edit fw-v2 >/dev/null 2>&1 || merge_status=$?
  [ "$merge_status" -ne 0 ] \
    || fail "case 1b: the fw-v2 merge did not stop on the dev-config modify/delete conflict (fixture no longer exercises the in-progress path)"
  git -C "$wt" rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1 \
    || fail "case 1b: fixture guard — no merge in progress after the conflicting merge"
  ok "case 1b: linked-worktree upgrade stops mid-merge with MERGE_HEAD set"

  assert_reconcile_ok "$wt" stripped "case 1b"
  if [ "${SKIP_RECONCILE:-0}" != "1" ]; then
    git -C "$wt" rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1 \
      || fail "case 1b: reconcile finalized or amended the merge instead of leaving it in progress — it misread the linked worktree's MERGE_HEAD path"
    ok "case 1b: reconcile took the merge-in-progress path (did not try to amend)"
  fi
  git -C "$wt" diff --name-only --diff-filter=U | grep -qx 'VERSION' \
    || fail "case 1b: expected the one-time VERSION modify/delete conflict"
  finalize_merge "$wt" "case 1b"
  assert_is_merge_commit "$wt" "case 1b"
  assert_no_tree_paths_in_commit "$wt" HEAD "case 1b"
  [ ! -e "$wt/.agent-toolkit" ] || fail "case 1b: .agent-toolkit/ survives in the linked worktree"
  assert_no_active_reference "$wt" "case 1b"
  assert_instance_changelog "$wt" "case 1b"
  assert_instance_version "$wt" "case 1b"
  assert_instance_framework_version "$wt" "case 1b"
}

# ---------------------------------------------------------------------------
# Case 2 — stripped instance, unrelated history, first framework merge
# ---------------------------------------------------------------------------
case_stripped_unrelated_history() { # workdir
  local work="$1" fw inst
  fw="$work/fw"
  inst="$work/instance"
  mkdir -p "$work"
  build_framework "$fw"

  init_repo "$inst"
  lay_instance_skeleton "$inst"
  write_instance_agents_md "$inst/AGENTS.md" no-reference
  git -C "$inst" add -A
  git -C "$inst" commit -q -m "Example instance, own history"
  [ ! -e "$inst/.agent-toolkit" ] || fail "case 2: fixture is not stripped"

  assert_classify "$inst" "case 2" stripped

  git -C "$inst" remote add framework "$fw"
  git -C "$inst" fetch -q framework --tags
  # The merge may or may not conflict depending on fixture shape; both shapes are
  # in contract (the no-conflict shape is the amend path).
  git -C "$inst" merge --no-edit --allow-unrelated-histories fw-v2 >/dev/null 2>&1 || true
  if git -C "$inst" rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then
    ok "case 2: unrelated-history merge stopped with conflicts (merge in progress)"
  else
    ok "case 2: unrelated-history merge auto-committed (reconcile must take the amend path)"
  fi

  assert_reconcile_ok "$inst" stripped "case 2"
  assert_no_unmerged_tree_paths "$inst" "case 2"
  finalize_merge "$inst" "case 2"

  assert_is_merge_commit "$inst" "case 2"
  assert_no_tree_paths_in_commit "$inst" HEAD "case 2"
  [ ! -e "$inst/.agent-toolkit" ] || fail "case 2: .agent-toolkit/ survives in the working tree"
  assert_no_active_reference "$inst" "case 2"
  assert_instance_changelog "$inst" "case 2"
  assert_instance_version "$inst" "case 2"
  assert_instance_framework_version "$inst" "case 2"

  # 2b — the same unrelated-history first merge, shaped so the merge COMPLETES
  # WITHOUT CONFLICTS (every framework path is theirs-only or merge=ours). This
  # is the amend path: git auto-commits the merge with `.agent-toolkit/**` and
  # the framework's own AGENTS.md (active reference) in the tree, so reconcile
  # must rewrite that commit rather than resolve an index.
  local inst2="$work/instance-autocommit"
  init_repo "$inst2"
  mkdir -p "$inst2/src"
  write_gitattributes "$inst2"
  printf 'export const place = { name: "Instance", tagline: "The adopting instance." };\n' > "$inst2/place.config.ts"
  printf 'export const FRAMEWORK_APP = "fw-v2";\n' > "$inst2/src/app.js"
  write_instance_changelog "$inst2/CHANGELOG.md"
  write_instance_version "$inst2/VERSION"
  write_instance_framework_version "$inst2/FRAMEWORK-VERSION"
  git -C "$inst2" add -A
  git -C "$inst2" commit -q -m "Example instance without entry files, own history"

  assert_classify "$inst2" "case 2b" stripped

  git -C "$inst2" remote add framework "$fw"
  git -C "$inst2" fetch -q framework --tags
  git -C "$inst2" merge --no-edit --allow-unrelated-histories fw-v2 >/dev/null 2>&1 || true
  if git -C "$inst2" rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then
    fail "case 2b: fixture no longer auto-commits the merge, so the amend path is not exercised"
  fi
  git -C "$inst2" ls-tree -r --name-only HEAD | grep -q '^\.agent-toolkit/' \
    || fail "case 2b: fixture guard — the auto-committed merge did not bring in .agent-toolkit/ (nothing to amend)"
  [ "$(active_ref_count "$inst2/AGENTS.md")" -gt 0 ] \
    || fail "case 2b: fixture guard — the auto-committed merge did not introduce an active reference into AGENTS.md"
  ok "case 2b: unrelated-history merge auto-committed with .agent-toolkit/ and an active reference in the tree"

  assert_reconcile_ok "$inst2" stripped "case 2b"
  assert_is_merge_commit "$inst2" "case 2b"
  assert_no_tree_paths_in_commit "$inst2" HEAD "case 2b"
  [ ! -e "$inst2/.agent-toolkit" ] || fail "case 2b: .agent-toolkit/ survives in the working tree"
  assert_no_active_reference "$inst2" "case 2b"
  assert_instance_changelog "$inst2" "case 2b"
  assert_instance_version "$inst2" "case 2b"
  assert_instance_framework_version "$inst2" "case 2b"
  local dirty
  dirty="$(git -C "$inst2" status --porcelain)"
  [ -z "$dirty" ] || fail "case 2b: reconcile left the amended merge uncommitted: $(echo "$dirty" | tr '\n' ' ')"
  ok "case 2b: reconcile amended the merge commit itself (working tree clean)"
}

# ---------------------------------------------------------------------------
# Case 3 — installed instance: adopter-owned dev-plugin state preserved
# ---------------------------------------------------------------------------
case_installed_preserved() { # workdir
  local work="$1" fw inst keep
  fw="$work/fw"
  inst="$work/instance"
  keep="$work/expected"
  mkdir -p "$work" "$keep"
  build_framework "$fw"
  clone_at_v1 "$fw" "$inst"

  # Adopter-owned dev-plugin state: own dev config content, own rule, own
  # AGENTS.md carrying an active (uncommented) reference line.
  cat > "$inst/.agent-toolkit/dev.md" <<'EOF'
---
tracker: linear
context_file: AGENTS.md
rules_dir: .agent-toolkit/rules/
---

# Instance dev config (adopter-owned, must survive every framework merge)

This content belongs to the instance, not to the framework.
EOF
  cat > "$inst/.agent-toolkit/rules/adopter-sentinel.md" <<'EOF'
---
tier: doctrine
---
# Adopter sentinel rule

Written by the adopting instance. A framework merge must not touch these bytes.
EOF
  write_instance_agents_md "$inst/AGENTS.md" active-reference
  git -C "$inst" add -A
  git -C "$inst" commit -q -m "Instance dev-plugin state"

  cp "$inst/.agent-toolkit/dev.md" "$keep/dev.md"
  cp "$inst/.agent-toolkit/rules/adopter-sentinel.md" "$keep/adopter-sentinel.md"

  assert_classify "$inst" "case 3" installed

  git -C "$inst" merge --no-edit fw-v2 >/dev/null 2>&1 || true
  assert_reconcile_ok "$inst" installed "case 3"

  # Reported, not deleted: the framework path the merge ADDED under .agent-toolkit/.
  if [ "${SKIP_RECONCILE:-0}" != "1" ]; then
    printf '%s\n%s\n' "$HELPER_OUT" "$HELPER_ERR" | grep -q 'new-rule\.md' \
      || fail "case 3: reconcile did not report the framework path the merge added (.agent-toolkit/rules/new-rule.md); stdout: '$HELPER_OUT'; stderr: '$HELPER_ERR'"
    ok "case 3: reconcile reports the framework-added .agent-toolkit/rules/new-rule.md"
    [ -f "$inst/.agent-toolkit/rules/new-rule.md" ] \
      || fail "case 3: reconcile --state installed DELETED the framework-added path (it must report, not delete)"
    ok "case 3: reconcile --state installed deleted nothing"
  fi

  finalize_merge "$inst" "case 3"

  [ -f "$inst/.agent-toolkit/dev.md" ] || fail "case 3: the adopter's .agent-toolkit/dev.md was deleted by the merge"
  [ -f "$inst/.agent-toolkit/rules/adopter-sentinel.md" ] || fail "case 3: the adopter's rule file was deleted by the merge"
  cmp "$inst/.agent-toolkit/dev.md" "$keep/dev.md" \
    || fail "case 3: the adopter's .agent-toolkit/dev.md is not byte-for-byte identical after the merge"
  cmp "$inst/.agent-toolkit/rules/adopter-sentinel.md" "$keep/adopter-sentinel.md" \
    || fail "case 3: the adopter's rule file is not byte-for-byte identical after the merge"
  ok "case 3: adopter dev config and rule are byte-for-byte unchanged (cmp)"

  assert_active_reference "$inst" "case 3"
  assert_classify "$inst" "case 3 (post-merge)" installed
  assert_instance_changelog "$inst" "case 3"
  assert_instance_version "$inst" "case 3"
  assert_instance_framework_version "$inst" "case 3"
}

# ---------------------------------------------------------------------------
# Case 4 — mixed: dev-plugin tree present, no active reference
# ---------------------------------------------------------------------------
case_mixed_tree_without_reference() { # workdir
  local work="$1" variant inst
  mkdir -p "$work"
  for variant in no-reference inert-reference-inline inert-reference-block; do
    inst="$work/$variant"
    init_repo "$inst"
    lay_instance_skeleton "$inst"
    mkdir -p "$inst/.agent-toolkit/rules"
    write_dev_config "$inst/.agent-toolkit/dev.md" "instance"
    cat > "$inst/.agent-toolkit/rules/example-rule.md" <<'EOF'
---
tier: doctrine
---
# Example rule (instance)
EOF
    write_instance_agents_md "$inst/AGENTS.md" "$variant"
    git -C "$inst" add -A
    git -C "$inst" commit -q -m "Mixed state: tree present, $variant"

    # Fixture guard: the harness's own reader must agree the reference is inert.
    [ "$(active_ref_count "$inst/AGENTS.md")" = "0" ] \
      || fail "case 4/$variant: fixture is not actually reference-free (harness reader found an active reference)"
    assert_classify_mixed "$inst" "case 4/$variant (tree present, reference $variant)"
  done
}

# ---------------------------------------------------------------------------
# Case 5 — mixed: active reference, dev-plugin tree absent
# ---------------------------------------------------------------------------
case_mixed_reference_without_tree() { # workdir
  local work="$1" entry inst
  mkdir -p "$work"
  for entry in AGENTS.md CLAUDE.md; do
    inst="$work/${entry%.md}"
    init_repo "$inst"
    lay_instance_skeleton "$inst"
    if [ "$entry" = "AGENTS.md" ]; then
      write_instance_agents_md "$inst/AGENTS.md" active-reference
    else
      write_instance_agents_md "$inst/AGENTS.md" no-reference
      printf '@AGENTS.md\n\n%s\n' "$REF_LINE" > "$inst/CLAUDE.md"
    fi
    git -C "$inst" add -A
    git -C "$inst" commit -q -m "Mixed state: active reference in $entry, no tree"

    [ ! -e "$inst/.agent-toolkit" ] || fail "case 5/$entry: fixture unexpectedly has a dev-plugin tree"
    [ "$(active_ref_count "$inst/$entry")" -gt 0 ] \
      || fail "case 5/$entry: fixture has no active reference (harness reader)"
    assert_classify_mixed "$inst" "case 5/$entry (active reference, tree absent)"
  done
}

# ---------------------------------------------------------------------------
# Usage contract — reconcile exits 2 on a usage error (never 0, never a mutation)
# ---------------------------------------------------------------------------
case_usage_errors() { # workdir
  local work="$1" inst before after
  inst="$work/instance"
  mkdir -p "$work"
  init_repo "$inst"
  lay_instance_skeleton "$inst"
  write_instance_agents_md "$inst/AGENTS.md" no-reference
  git -C "$inst" add -A
  git -C "$inst" commit -q -m "Example instance"
  before="$(git -C "$inst" rev-parse HEAD)"

  run_helper "$inst" reconcile
  [ "$HELPER_STATUS" -eq 2 ] \
    || fail "usage: reconcile without --state exited $HELPER_STATUS (expected 2); stdout: '$HELPER_OUT'; stderr: '$HELPER_ERR'"
  [ -n "$HELPER_ERR" ] || fail "usage: reconcile without --state exited 2 with no message on stderr"
  ok "usage: reconcile without --state exits 2 with a stderr message"

  run_helper "$inst" reconcile --state bogus
  [ "$HELPER_STATUS" -eq 2 ] \
    || fail "usage: reconcile --state bogus exited $HELPER_STATUS (expected 2); stdout: '$HELPER_OUT'; stderr: '$HELPER_ERR'"
  [ -n "$HELPER_ERR" ] || fail "usage: reconcile --state bogus exited 2 with no message on stderr"
  ok "usage: reconcile --state bogus exits 2 with a stderr message"

  after="$(git -C "$inst" rev-parse HEAD)"
  [ "$before" = "$after" ] || fail "usage: a usage error moved HEAD"
  [ -z "$(git -C "$inst" status --porcelain)" ] || fail "usage: a usage error dirtied the working tree"
  ok "usage: neither usage error touched HEAD or the working tree"
}

# ---------------------------------------------------------------------------
# Case 6 — maintainer docs: stripped instance, shared history
# ---------------------------------------------------------------------------
case_mdocs_stripped_shared_history() { # workdir
  local work="$1" fw inst
  fw="$work/fw"
  inst="$work/instance"
  mkdir -p "$work"
  build_framework "$fw"
  clone_at_v1 "$fw" "$inst"

  # The init wizard's strip: an adopted instance carries none of these paths.
  strip_maintainer_docs "$inst"
  write_instance_agents_md "$inst/AGENTS.md" no-reference
  git -C "$inst" add -A
  git -C "$inst" commit -q -m "Adopt Example framework: strip maintainer docs"

  assert_mdocs_classify "$inst" "case 6" "" "$MAINTAINER_DOCS"

  local merge_status=0
  git -C "$inst" merge --no-edit fw-v2 >/dev/null 2>&1 || merge_status=$?
  [ "$merge_status" -ne 0 ] \
    || fail "case 6: the fw-v2 merge did not stop on a maintainer-doc modify/delete conflict (fixture no longer exercises the contract)"
  git -C "$inst" diff --name-only --diff-filter=U | grep -q "^$(first_doc_file)$" \
    || fail "case 6: expected $(first_doc_file) among the unmerged modify/delete paths"
  ok "case 6: fw-v2 merge stops on the maintainer-doc modify/delete conflict"

  assert_mdocs_reconcile_ok "$inst" "case 6"
  assert_maintainer_docs_absent "$inst" "case 6"
  finalize_merge "$inst" "case 6"

  assert_is_merge_commit "$inst" "case 6"
  assert_maintainer_docs_not_in_commit "$inst" HEAD "case 6"
  git -C "$inst" show HEAD:src/app.js | grep -q 'fw-v2' \
    || fail "case 6: the framework's non-doc change (src/app.js at fw-v2) did not land — reconcile discarded the merge"
  ok "case 6: the framework's non-doc change (src/app.js @ fw-v2) landed"
  [ -f "$inst/docs/playbook/keep.md" ] || fail "case 6: the adopter-facing doc tree did not survive the upgrade"
  ok "case 6: adopter-facing docs/playbook/ survives"
}

# ---------------------------------------------------------------------------
# Case 7 — maintainer docs: stripped instance, unrelated history, first merge
# ---------------------------------------------------------------------------
case_mdocs_stripped_unrelated_history() { # workdir
  local work="$1" fw inst
  fw="$work/fw"
  inst="$work/instance"
  mkdir -p "$work"
  build_framework "$fw"

  init_repo "$inst"
  lay_instance_skeleton "$inst"
  write_instance_agents_md "$inst/AGENTS.md" no-reference
  git -C "$inst" add -A
  git -C "$inst" commit -q -m "Example instance, own history"

  assert_mdocs_classify "$inst" "case 7" "" "$MAINTAINER_DOCS"

  git -C "$inst" remote add framework "$fw"
  git -C "$inst" fetch -q framework --tags
  git -C "$inst" merge --no-edit --allow-unrelated-histories fw-v2 >/dev/null 2>&1 || true
  if git -C "$inst" rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then
    ok "case 7: unrelated-history merge stopped with conflicts (merge in progress)"
  else
    git -C "$inst" ls-tree -r --name-only HEAD -- "$(first_doc_file)" | grep -q . \
      || fail "case 7: fixture guard — the auto-committed merge did not bring in the maintainer docs (nothing to amend)"
    ok "case 7: unrelated-history merge auto-committed the framework's maintainer docs (reconcile must amend)"
  fi

  assert_mdocs_reconcile_ok "$inst" "case 7"
  assert_maintainer_docs_absent "$inst" "case 7"
  finalize_merge "$inst" "case 7"

  assert_is_merge_commit "$inst" "case 7"
  assert_maintainer_docs_not_in_commit "$inst" HEAD "case 7"
  local dirty
  dirty="$(git -C "$inst" status --porcelain)"
  [ -z "$dirty" ] || fail "case 7: reconcile left the merge uncommitted: $(echo "$dirty" | tr '\n' ' ')"
  ok "case 7: working tree clean after the upgrade"
}

# ---------------------------------------------------------------------------
# Case 8 — maintainer docs: fully owned instance, protected by merge=ours
# ---------------------------------------------------------------------------
case_mdocs_owned_preserved() { # workdir
  local work="$1" fw inst keep rel docdir
  fw="$work/fw"
  inst="$work/instance"
  keep="$work/expected"
  mkdir -p "$work" "$keep"
  build_framework "$fw"
  clone_at_v1 "$fw" "$inst"

  # The instance keeps documents at every maintainer-doc path, with its own
  # content, and marks them instance-owned before merging.
  write_maintainer_docs "$inst" "instance-owned"
  append_maintainer_doc_attributes "$inst"
  write_instance_agents_md "$inst/AGENTS.md" no-reference
  git -C "$inst" add -A
  git -C "$inst" commit -q -m "Instance documents at the maintainer-doc paths"

  mkdir -p "$keep/tree"
  for rel in $MAINTAINER_DOCS; do
    mkdir -p "$keep/tree/$(dirname "$rel")"
    cp -R "$inst/$rel" "$keep/tree/$rel"
  done

  assert_mdocs_classify "$inst" "case 8" "$MAINTAINER_DOCS" ""

  git -C "$inst" merge --no-edit fw-v2 >/dev/null 2>&1 || true
  assert_mdocs_reconcile_ok "$inst" "case 8"

  # Reported, not deleted: the framework record the merge ADDED under the owned
  # directory path. Deliberately NOT gated on SKIP_RECONCILE — the report is the
  # only reconcile-dependent behavior in this case, so gating it out would make the
  # case pass without reconcile and leave it vacuous.
  printf '%s\n%s\n' "$HELPER_OUT" "$HELPER_ERR" | grep -q '002-added-in-fw-v2\.md' \
    || fail "case 8: reconcile did not report the framework file the merge added under an owned path; stdout: '$HELPER_OUT'"
  ok "case 8: reconcile reports the framework-added record"
  for docdir in $MAINTAINER_DOCS; do
    case "$docdir" in
      *.md) ;;
      *) [ -f "$inst/$docdir/002-added-in-fw-v2.md" ] \
           || fail "case 8: reconcile DELETED the framework-added record (it must report, not delete)" ;;
    esac
  done
  ok "case 8: reconcile deleted nothing"

  finalize_merge "$inst" "case 8"

  for rel in $MAINTAINER_DOCS; do
    assert_doc_entry_matches "$inst" "$keep/tree" "$rel" "case 8"
  done
  ok "case 8: every instance-owned maintainer-doc file is byte-for-byte unchanged (cmp)"
  assert_mdocs_classify "$inst" "case 8 (post-merge)" "$MAINTAINER_DOCS" ""
}

# ---------------------------------------------------------------------------
# Case 9 — maintainer docs: the DECLARATION RELOCATES across the upgrade
# (per-path, never a stop)
# ---------------------------------------------------------------------------
#
# This is the mixed-ownership case, and ADR 009 is what makes it the realistic one.
# `classify` runs BEFORE the merge and derives from the working tree's wizard, which
# still names the OLD paths. `reconcile` runs after and re-derives from the MERGED
# tree, which names the new one. Their union is a set where some entries are owned
# and some are stripped, which is the branch under test — and it is no longer
# constructible by owning one declared path and not another, because the declaration
# is now a single directory.
#
# The instance models the documented upgrade order: relocate its own documents and
# commit that FIRST, then merge the tag. Done that way the old paths are already gone
# at the pre-merge revision, so they classify as stripped, and the new directory is
# present, so it classifies as owned. Merging without relocating first is the
# modify/delete shape cases 6 and 7 already cover.
#
# LEGACY_MAINTAINER_DOCS is fixture history: a declaration a previous release carried.
# A past contract is not derivable from the current source, so it is written here —
# unlike the live set, which is always derived.
LEGACY_MAINTAINER_DOCS="docs/PLAN.md docs/decisions"
# The one superseded path fw-v2 still ships a file at (see build_framework_relocating).
LEGACY_SURVIVING_DOC="docs/PLAN.md"

# The wizard as a NAMED release declared it, rather than as this repository does now.
write_wizard_declaring() { # dir path-list
  local rel
  mkdir -p "$1/scripts/init"
  {
    printf 'export const MAINTAINER_DOCS = [\n'
    for rel in $2; do printf "  '%s',\n" "$rel"; done
    printf '];\n'
  } > "$1/scripts/init/writer.mjs"
}

# Seed/strip at an explicit path list, so the fixture can hold documents at the paths
# a previous release declared as well as at the current ones.
#
# The BODY matters, and this is the whole reason the relocation case is realistic.
# Git decides rename-versus-delete-plus-add by CONTENT SIMILARITY against the merge
# base. The framework and the instance hold entirely different documents at the same
# maintainer-doc paths -- that is ADR 008's whole premise -- so when both relocate:
#
#   framework side: base doc -> new path, high similarity  => detected as a RENAME
#   instance side:  base doc deleted, unrelated doc added  => delete + add
#
# and rename-on-one-side plus delete-on-the-other is a rename/delete conflict, which
# git never routes through a merge driver. `merge=ours` therefore cannot protect these
# paths through a relocation, by construction rather than by misconfiguration.
#
# An earlier form of this helper wrote one-line bodies differing only by a marker word.
# Those are similar enough that git paired them across BOTH sides, so the fixture saw a
# tidy add/add that `merge=ours` resolved -- and the case passed while asserting a merge
# shape that cannot occur in production. The bodies below are long and side-specific so
# the similarity asymmetry is real.
write_docs_at() { # dir path-list marker
  local rel record body
  case "$3" in
    instance-owned)
      body="This document belongs to the adopting instance. It records that instance's own
product decisions, its own delivery order, and the constraints its operators chose.
None of this text appears in the framework's document at the same path: the two
repositories deliberately hold different content there, which is what makes a
relocation produce asymmetric rename detection.
Instance-side body line six.
Instance-side body line seven.
Instance-side body line eight."
      ;;
    *)
      body="This document belongs to the framework. It records the framework's architecture
contracts, its negative requirements, and the phases its maintainers execute.
It is stripped from an adopter clone at init, and an instance that keeps its own
document at this path owns that path instead.
Framework-side body line six ($3).
Framework-side body line seven.
Framework-side body line eight."
      ;;
  esac
  for rel in $2; do
    case "$rel" in
      *.md)
        mkdir -p "$1/$(dirname "$rel")"
        printf '# Maintainer doc: %s (%s)\n\n%s\n' "$rel" "$3" "$body" > "$1/$rel"
        ;;
      *)
        mkdir -p "$1/$rel"
        for record in $DOC_RECORDS; do
          printf '# Decision record %s (%s)\n\n%s\n' "$record" "$3" "$body" > "$1/$rel/$record"
        done
        ;;
    esac
  done
}

# A framework whose fw-v1 declares the legacy paths and whose fw-v2 relocates the
# declaration to the current one — the release shape this suite's own repository ships.
build_framework_relocating() { # dir
  local fw="$1"
  init_repo "$fw"
  mkdir -p "$fw/.agent-toolkit/rules" "$fw/src" "$fw/scripts/upgrade"
  write_framework_agents_md "$fw/AGENTS.md"
  write_dev_config "$fw/.agent-toolkit/dev.md" "fw-v1"
  printf -- '---\ntier: doctrine\n---\n# Example rule (framework-owned, fw-v1)\n' \
    > "$fw/.agent-toolkit/rules/example-rule.md"
  write_gitattributes "$fw"
  # fw-v1 ships the legacy maintainer-doc attributes, exactly as the pre-relocation
  # framework did. fw-v2 replaces them with the single new-directory line, so
  # `.gitattributes` itself is a conflicting file across this upgrade -- which is what
  # happens in production and is part of why the relocation is not a clean merge.
  for rel in $LEGACY_MAINTAINER_DOCS; do
    case "$rel" in
      *.md) printf '%s merge=ours\n' "$rel" >> "$fw/.gitattributes" ;;
      *)    printf '%s/** merge=ours\n' "$rel" >> "$fw/.gitattributes" ;;
    esac
  done
  write_wizard_declaring "$fw" "$LEGACY_MAINTAINER_DOCS"
  write_docs_at "$fw" "$LEGACY_MAINTAINER_DOCS" "fw-v1"
  mkdir -p "$fw/docs/playbook"
  printf '# Editorial canon (adopter-facing, survives adoption)\n' > "$fw/docs/playbook/keep.md"
  printf '# Framework changelog\n\nFramework release fw-v1.\n' > "$fw/CHANGELOG.md"
  printf 'template-v1\n' > "$fw/VERSION"
  printf 'framework-v1\n' > "$fw/FRAMEWORK-VERSION"
  printf 'export const place = { name: "Example", tagline: "The framework demo place." };\n' > "$fw/place.config.ts"
  printf 'export const FRAMEWORK_APP = "fw-v1";\n' > "$fw/src/app.js"
  cp "$HELPER_SRC" "$fw/scripts/upgrade/dev-plugin-state.mjs"
  git -C "$fw" add -A
  git -C "$fw" commit -q -m "Example framework fw-v1 (legacy maintainer-doc declaration)"
  git -C "$fw" tag fw-v1

  # fw-v2 relocates the DECLARATION to the current path set. One superseded path is
  # deliberately left behind in the framework tree, still carrying content: a release
  # that moves a declaration does not necessarily delete every file the old one named.
  # That lingering path is what gives reconcile something only it can do here — the
  # merge re-adds the framework's copy to an instance that owns nothing there, and
  # removing it is the `!owned` branch under test. Without it this case would pass on
  # the merge alone and prove nothing (the selftest asserts exactly that).
  local rel first=1
  for rel in $LEGACY_MAINTAINER_DOCS; do
    if [ "$first" = 1 ]; then first=0; continue; fi
    git -C "$fw" rm -r -q -- "$rel"
  done
  write_docs_at "$fw" "$LEGACY_SURVIVING_DOC" "fw-v2"
  write_gitattributes "$fw"
  for rel in $MAINTAINER_DOCS; do
    case "$rel" in
      *.md) printf '%s merge=ours\n' "$rel" >> "$fw/.gitattributes" ;;
      *)    printf '%s/** merge=ours\n' "$rel" >> "$fw/.gitattributes" ;;
    esac
  done
  write_wizard_declaring "$fw" "$MAINTAINER_DOCS"
  write_maintainer_docs "$fw" "fw-v2"
  for rel in $MAINTAINER_DOCS; do
    case "$rel" in
      *.md) ;;
      *) printf '# Decision record 002 (added in fw-v2)\n' > "$fw/$rel/002-added-in-fw-v2.md" ;;
    esac
  done
  printf 'export const FRAMEWORK_APP = "fw-v2";\n' > "$fw/src/app.js"
  printf '# Framework changelog\n\nFramework release fw-v2.\n' > "$fw/CHANGELOG.md"
  rm "$fw/VERSION"
  printf 'framework-v2\n' > "$fw/FRAMEWORK-VERSION"
  git -C "$fw" add -A
  git -C "$fw" commit -q -m "Example framework fw-v2 (maintainer-doc declaration relocated)"
  git -C "$fw" tag fw-v2
}

case_mdocs_declaration_relocated() { # workdir
  local work="$1" fw inst rel owned_file
  fw="$work/fw"
  inst="$work/instance"
  mkdir -p "$work"
  build_framework_relocating "$fw"
  clone_at_v1 "$fw" "$inst"

  # The instance's own documents, at the paths fw-v1 declared.
  write_docs_at "$inst" "$LEGACY_MAINTAINER_DOCS" "instance-owned"
  write_instance_agents_md "$inst/AGENTS.md" no-reference
  git -C "$inst" add -A
  git -C "$inst" commit -q -m "Instance writes its own documents at the legacy paths"

  # Step 1 of the documented upgrade: relocate, protect, COMMIT — before any merge.
  for rel in $LEGACY_MAINTAINER_DOCS; do git -C "$inst" rm -r -q -- "$rel"; done
  write_docs_at "$inst" "$MAINTAINER_DOCS" "instance-owned"
  append_maintainer_doc_attributes "$inst"
  git -C "$inst" add -A
  git -C "$inst" commit -q -m "Relocate this instance's own documents to the new path"

  # Pre-merge, classify can only speak about what the pre-merge wizard DECLARES, which
  # is the legacy set — and the instance has relocated away from all of it, so every
  # legacy path is stripped and nothing is owned. The new path is not yet declared
  # anywhere, so it appears in neither list.
  #
  # This is the load-bearing detail of the whole relocation: what makes the instance's
  # relocated documents survive is NOT the captured state. It is reconcile re-deriving
  # the declaration from the MERGED tree and then asking `existedAt(pre-merge revision)`
  # for anything the capture did not classify. Because the relocation was committed
  # before the merge, that question answers yes and the tree is treated as owned. An
  # instance that merged first and relocated afterwards would be answered no.
  assert_mdocs_classify "$inst" "case 9" "" "$LEGACY_MAINTAINER_DOCS"

  git -C "$inst" merge --no-edit fw-v2 >/dev/null 2>&1 || true

  # THE RELOCATION CONFLICTS, AND THAT IS THE CONTRACT.
  #
  # Both sides moved their maintainer docs to the same new path. Against the merge base
  # -- which carries the FRAMEWORK's document at the old path -- the framework's move is
  # a high-similarity rename, while the instance's move is a delete plus an unrelated
  # add, because the instance's document shares almost no text with the framework's.
  # Rename on one side and delete on the other is a rename/delete conflict, and git
  # applies no merge driver to those. `merge=ours` cannot reach them.
  #
  # This is asserted, not tolerated. If a future git or a future doc layout made the
  # relocation merge cleanly, the upgrade documentation would be describing a shape that
  # no longer happens, and this assertion is what would catch that.
  owned_file="$(first_doc_file)"
  if [ "${SKIP_RECONCILE:-0}" != "1" ]; then
    git -C "$inst" ls-files -u -- "$owned_file" | grep -q . \
      || fail "case 9: the relocation merged without conflict on $owned_file.
  The upgrade documentation tells adopters to expect a rename/delete conflict on every
  maintainer-doc path and to resolve each one to OURS. If the merge is now clean, that
  guidance is wrong and must be rewritten in the same commit that relaxes this check."
    ok "case 9: the relocation conflicts on the maintainer-doc paths (rename/delete; no merge driver applies)"
  fi

  # The documented resolution: take OURS for every conflicted maintainer-doc path. This
  # is the step an adopter performs by hand (or /sekai-upgrade walks with them), and
  # taking --theirs here is the data-loss mistake the upgrade note exists to prevent.
  for rel in $(git -C "$inst" diff --name-only --diff-filter=U -- $MAINTAINER_DOCS); do
    if git -C "$inst" cat-file -e ":2:$rel" 2>/dev/null; then
      git -C "$inst" checkout --ours -- "$rel" 2>/dev/null || true
      git -C "$inst" add -- "$rel"
    else
      # Ours deleted it (the framework's own record, which this instance never had).
      git -C "$inst" rm -q -f -- "$rel" 2>/dev/null || true
    fi
  done

  # Only now is reconcile meaningful: it runs on a resolved tree, and a mixed set of
  # owned and superseded paths must not stop it.
  assert_mdocs_reconcile_ok "$inst" "case 9"

  if [ "${SKIP_RECONCILE:-0}" != "1" ]; then
    grep -Fq "instance-owned" "$inst/$owned_file" \
      || fail "case 9: the relocated $owned_file lost the instance's content to the framework's"
    ok "case 9: the relocated documents kept the instance's content"
    for rel in $LEGACY_MAINTAINER_DOCS; do
      [ ! -e "$inst/$rel" ] || fail "case 9: legacy path $rel came back into the working tree"
      [ -z "$(git -C "$inst" ls-files -- "$rel")" ] || fail "case 9: legacy path $rel is still tracked"
      [ -z "$(git -C "$inst" ls-files -u -- "$rel")" ] \
        || fail "case 9: legacy path $rel still has unmerged entries"
    done
    ok "case 9: no path from the superseded declaration survived the upgrade, including the one the framework still ships"
  fi

  finalize_merge "$inst" "case 9"
  assert_is_merge_commit "$inst" "case 9"
  for rel in $LEGACY_MAINTAINER_DOCS; do
    [ -z "$(git -C "$inst" ls-tree -r --name-only HEAD -- "$rel")" ] \
      || fail "case 9: the finalized merge commit carries superseded path $rel"
  done
  git -C "$inst" ls-tree -r --name-only HEAD -- "$owned_file" | grep -q . \
    || fail "case 9: the finalized merge commit dropped the instance's own $owned_file"
  ok "case 9: per-path outcome survives into the merge commit"
}

# ---------------------------------------------------------------------------
# Case 10 — maintainer docs: OWNED BUT UNCLAIMED — the upgrade must stop
# (10b is the sibling shape: claimed, but the per-clone driver is unset — a restore)
# ---------------------------------------------------------------------------
case_mdocs_owned_unprotected() { # workdir
  local work="$1" fw inst owned before
  mkdir -p "$work"

  # 10a — the instance never marked these paths `merge=ours`. `check-attr merge`
  # reports `unspecified`, so the instance never claimed them, and reverting the
  # framework's edits would be the framework deciding ownership on its behalf.
  fw="$work/no-attribute/fw"
  inst="$work/no-attribute/instance"
  mkdir -p "$work/no-attribute"
  build_framework "$fw"
  clone_at_v1 "$fw" "$inst"

  owned="$(first_doc_file)"
  write_maintainer_docs "$inst" "instance-owned"
  write_instance_agents_md "$inst/AGENTS.md" no-reference
  git -C "$inst" add -A
  git -C "$inst" commit -q -m "Instance documents at the maintainer-doc paths (no-attribute)"

  before="$(git -C "$inst" rev-parse HEAD)"
  assert_mdocs_classify "$inst" "case 10/no-attribute" "$MAINTAINER_DOCS" ""

  git -C "$inst" merge --no-edit fw-v2 >/dev/null 2>&1 || true
  git -C "$inst" rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1 \
    || fail "case 10/no-attribute: fixture guard — expected the merge to stop mid-merge (both sides edited these paths)"
  assert_mdocs_reconcile_stops "$inst" "case 10/no-attribute" "$owned"
  if [ "${SKIP_RECONCILE:-0}" != "1" ]; then
    printf '%s' "$HELPER_ERR" | grep -q 'merge --abort' \
      || fail "case 10/no-attribute: mid-merge diagnostic does not prescribe the abort: $HELPER_ERR"
  fi

  # The instance's own document must still be its own: nothing committed, and the
  # committed content at the pre-merge revision untouched.
  git -C "$inst" show "$before:$owned" | grep -Fq 'instance-owned' \
    || fail "case 10/no-attribute: the instance's committed $owned no longer holds its own content"
  [ "$(git -C "$inst" rev-parse HEAD)" = "$before" ] \
    || fail "case 10/no-attribute: the failed reconcile advanced HEAD"
  ok "case 10/no-attribute: the framework copy did not win and HEAD did not move"

  # 10b — the attribute IS there and the per-clone driver is NOT configured, so git
  # falls back to a plain text merge and conflicts. The instance HAS claimed these
  # paths, so this is a restore, not a stop: the upgrade puts its documents back and
  # tells it the driver is missing. Stopping here would be the LB-88 defect in its
  # other shape — an unescapable halt over a condition the upgrade can repair.
  local inst2 keep2 rel nonascii
  fw="$work/no-driver/fw"
  inst2="$work/no-driver/instance"
  keep2="$work/no-driver/expected"
  mkdir -p "$work/no-driver" "$keep2/tree"
  build_framework "$fw"
  clone_at_v1 "$fw" "$inst2"

  write_maintainer_docs "$inst2" "instance-owned"
  append_maintainer_doc_attributes "$inst2"
  git -C "$inst2" config --unset merge.ours.driver   # per-clone, not version-controlled
  write_instance_agents_md "$inst2/AGENTS.md" no-reference
  git -C "$inst2" add -A
  git -C "$inst2" commit -q -m "Instance documents at the maintainer-doc paths (no-driver)"

  for rel in $MAINTAINER_DOCS; do
    mkdir -p "$keep2/tree/$(dirname "$rel")"
    cp -R "$inst2/$rel" "$keep2/tree/$rel"
  done

  if [ -n "$(git -C "$inst2" config --get merge.ours.driver || true)" ]; then
    fail "case 10/no-driver: fixture guard — the ours driver is still configured, so the unconfigured shape is gone"
  fi
  assert_mdocs_classify "$inst2" "case 10/no-driver" "$MAINTAINER_DOCS" ""

  git -C "$inst2" merge --no-edit fw-v2 >/dev/null 2>&1 || true
  git -C "$inst2" rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1 \
    || fail "case 10/no-driver: fixture guard — expected the merge to stop mid-merge (an undefined driver falls back to a text merge)"
  git -C "$inst2" ls-files -u -- "$owned" | grep -q . \
    || fail "case 10/no-driver: fixture guard — $owned did not conflict, so there is nothing for the restore to resolve"
  ok "case 10/no-driver: the undefined driver left the instance's documents conflicted"

  assert_mdocs_reconcile_ok "$inst2" "case 10/no-driver"
  # Deliberately NOT gated on SKIP_RECONCILE: these two are the only
  # reconcile-dependent assertions before finalize_merge, and gating them out is how
  # a case silently becomes vacuous.
  printf '%s\n%s\n' "$HELPER_OUT" "$HELPER_ERR" | grep -Fq "$owned" \
    || fail "case 10/no-driver: reconcile did not name the restored path; stdout: '$HELPER_OUT'; stderr: '$HELPER_ERR'"
  printf '%s\n%s\n' "$HELPER_OUT" "$HELPER_ERR" | grep -q 'merge.ours.driver' \
    || fail "case 10/no-driver: reconcile restored without reporting that the driver is not configured; stdout: '$HELPER_OUT'"
  ok "case 10/no-driver: reconcile restores and reports the missing per-clone driver"

  # The `-z` pin on the CONFLICTED producer (`git ls-files -u`). Without it git
  # C-quotes this path, the quoted literal resolves to no `merge` attribute, and the
  # restore turns into the hard stop this task exists to remove.
  nonascii="$(non_ascii_doc_file)"
  if [ -n "$nonascii" ]; then
    printf '%s\n%s\n' "$HELPER_OUT" "$HELPER_ERR" | grep -Fq "$nonascii" \
      || fail "case 10/no-driver: reconcile did not name the restored non-ASCII path ($nonascii) verbatim; stdout: '$HELPER_OUT'; stderr: '$HELPER_ERR'"
    ok "case 10/no-driver: reconcile names the restored non-ASCII conflicted path verbatim"
  fi

  [ -z "$(git -C "$inst2" ls-files -u -- $MAINTAINER_DOCS)" ] \
    || fail "case 10/no-driver: reconcile left a maintainer-doc conflict for the user to resolve"
  finalize_merge "$inst2" "case 10/no-driver"
  assert_is_merge_commit "$inst2" "case 10/no-driver"
  for rel in $MAINTAINER_DOCS; do
    assert_doc_entry_matches "$inst2" "$keep2/tree" "$rel" "case 10/no-driver"
  done
  ok "case 10/no-driver: every instance-owned maintainer-doc file is byte-for-byte its pre-merge copy (cmp)"

  # 10c — the same unprotected instance, but the framework's edits apply WITHOUT a
  # conflict, so git auto-commits the merge. `git merge --abort` does not work once
  # the merge is committed, so the diagnostic must send the user to ORIG_HEAD
  # instead. Review finding B1 on PR #39: the earlier remedy was unconditional and
  # failed with `no merge to abort` in exactly this shape.
  local inst3 fw3 before3
  fw3="$work/clean-auto-merge/fw"
  inst3="$work/clean-auto-merge/instance"
  mkdir -p "$work/clean-auto-merge"
  build_framework "$fw3"
  clone_at_v1 "$fw3" "$inst3"
  # The instance carries the maintainer docs from its own history and never edited
  # them, and never marked them merge=ours — so fw-v2's edits merge cleanly. It
  # also drops the framework's VERSION the same way fw-v2 does, because that
  # one-time modify/delete conflict would otherwise stop the merge for an unrelated
  # reason and this fixture needs git to auto-commit.
  git -C "$inst3" rm -q -f VERSION
  write_instance_agents_md "$inst3/AGENTS.md" no-reference
  git -C "$inst3" add -A
  git -C "$inst3" commit -q -m "Instance carries the maintainer-doc paths unprotected"
  before3="$(git -C "$inst3" rev-parse HEAD)"

  assert_mdocs_classify "$inst3" "case 10/clean-auto-merge" "$MAINTAINER_DOCS" ""

  git -C "$inst3" merge --no-edit fw-v2 >/dev/null 2>&1 || true
  if git -C "$inst3" rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then
    fail "case 10/clean-auto-merge: fixture no longer auto-commits the merge, so the committed-merge remedy is not exercised"
  fi
  ok "case 10/clean-auto-merge: the framework's doc edits merged cleanly and git committed the merge"

  assert_mdocs_reconcile_stops "$inst3" "case 10/clean-auto-merge" "$owned"
  if [ "${SKIP_RECONCILE:-0}" != "1" ]; then
    printf '%s' "$HELPER_ERR" | grep -q 'ORIG_HEAD' \
      || fail "case 10/clean-auto-merge: the diagnostic does not name the committed-merge undo (ORIG_HEAD): $HELPER_ERR"
    if printf '%s' "$HELPER_ERR" | grep -q 'merge --abort'; then
      fail "case 10/clean-auto-merge: the diagnostic prescribes \`git merge --abort\`, which fails once the merge is committed: $HELPER_ERR"
    fi
    ok "case 10/clean-auto-merge: the diagnostic prescribes the undo that actually works here"
    # The prescribed remedy must really return the instance to its own documents.
    git -C "$inst3" reset --hard ORIG_HEAD >/dev/null 2>&1 \
      || fail "case 10/clean-auto-merge: the prescribed \`git reset --hard ORIG_HEAD\` failed"
    [ "$(git -C "$inst3" rev-parse HEAD)" = "$before3" ] \
      || fail "case 10/clean-auto-merge: the prescribed undo did not restore the pre-merge commit"
    grep -Fq 'fw-v1' "$inst3/$owned" \
      || fail "case 10/clean-auto-merge: after the undo, $owned does not hold the instance's pre-merge content"
    ok "case 10/clean-auto-merge: the prescribed undo restores the instance's pre-merge documents"
  fi
}

# ---------------------------------------------------------------------------
# Case 11 — maintainer docs: FIRST upgrade to the release that introduces the
# strip list. The helper is bootstrapped out of the tag, but the working tree's
# wizard predates the export, so the derivation must come from the tag while
# presence still comes from the tree.
# ---------------------------------------------------------------------------
case_mdocs_first_upgrade_from_tag() { # workdir
  local work="$1" fw inst
  fw="$work/fw"
  inst="$work/instance"
  mkdir -p "$work"
  build_framework "$fw" legacy-wizard
  clone_at_v1 "$fw" "$inst"

  # The instance carries no maintainer docs (an earlier adoption removed them),
  # and its wizard is fw-v1's — the one that predates MAINTAINER_DOCS.
  strip_maintainer_docs "$inst"
  write_instance_agents_md "$inst/AGENTS.md" no-reference
  git -C "$inst" add -A
  git -C "$inst" commit -q -m "Adopt Example framework at fw-v1: strip maintainer docs"

  # Fixture guards: this must really be the pre-export tree, and the tag must
  # really carry the export. Without both, the case proves nothing.
  if grep -q 'MAINTAINER_DOCS' "$inst/scripts/init/writer.mjs"; then
    fail "case 11: fixture guard — the working tree's wizard already exports MAINTAINER_DOCS, so the first-upgrade shape is gone"
  fi
  git -C "$inst" show fw-v2:scripts/init/writer.mjs | grep -q 'MAINTAINER_DOCS' \
    || fail "case 11: fixture guard — fw-v2 does not export MAINTAINER_DOCS, so there is nothing to derive from the tag"
  ok "case 11: fixture is the first-upgrade shape (tree's wizard predates the export, fw-v2 carries it)"

  # The defect this criterion exists for: deriving from the working tree cannot
  # produce the classification at all.
  run_mdocs "$inst" classify
  [ "$HELPER_STATUS" -eq 3 ] \
    || fail "case 11: classify without --from-tag exited $HELPER_STATUS (expected 3 on a wizard that predates the export); stdout: '$HELPER_OUT'"
  printf '%s' "$HELPER_ERR" | grep -q -- '--from-tag' \
    || fail "case 11: the underivable diagnostic does not point at --from-tag: $HELPER_ERR"
  ok "case 11: classify without --from-tag exits 3 and names --from-tag as the remedy"

  # The contract: the path set comes from the tag, presence from this tree.
  assert_mdocs_classify "$inst" "case 11" "" "$MAINTAINER_DOCS" --from-tag fw-v2

  local merge_status=0
  git -C "$inst" merge --no-edit fw-v2 >/dev/null 2>&1 || merge_status=$?
  [ "$merge_status" -ne 0 ] \
    || fail "case 11: the fw-v2 merge did not stop on a maintainer-doc modify/delete conflict (fixture no longer exercises the contract)"

  # reconcile takes no --from-tag: after the merge the framework-owned wizard is
  # the tag's, so the working tree is once again a correct derivation source.
  assert_mdocs_reconcile_ok "$inst" "case 11"
  assert_maintainer_docs_absent "$inst" "case 11"
  finalize_merge "$inst" "case 11"

  assert_is_merge_commit "$inst" "case 11"
  assert_maintainer_docs_not_in_commit "$inst" HEAD "case 11"
  grep -q 'MAINTAINER_DOCS' "$inst/scripts/init/writer.mjs" \
    || fail "case 11: the framework's wizard did not land, so later upgrades still cannot derive the path set"
  ok "case 11: the release's wizard landed — later upgrades need no --from-tag"
}

# ---------------------------------------------------------------------------
# Case 12 — FRAMEWORK-VERSION holds its pre-merge value across the merge and
# changes only on the explicit post-verification bump.
#
# Deliberately NOT built on build_framework: this case needs npm manifests on both
# tags and a FRAMEWORK-VERSION the instance has NOT touched since the merge base.
# That last part is the whole point — `merge=ours` names a driver git only invokes
# on a three-way content merge, so an instance with `ours == base` gets theirs
# fast-forwarded in and silently claims the incoming release before anything has
# verified it.
# ---------------------------------------------------------------------------

# `versioned` mirrors VERSION into the manifests; `versionless` writes the v1.0.8
# shape, which the capture accepts so the first migration needs no pre-editing.
write_npm_manifests() { # dir name shape version
  local pkg lock
  pkg="$1/package.json"
  lock="$1/package-lock.json"
  if [ "$3" = "versioned" ]; then
    cat > "$pkg" <<EOF
{
  "name": "$2",
  "version": "$4",
  "private": true,
  "description": "Example package",
  "scripts": { "build": "true" }
}
EOF
    cat > "$lock" <<EOF
{
  "name": "$2",
  "version": "$4",
  "lockfileVersion": 3,
  "packages": { "": { "name": "$2", "version": "$4" } }
}
EOF
  else
    cat > "$pkg" <<EOF
{
  "name": "$2",
  "private": true,
  "description": "Example package",
  "scripts": { "build": "$4" }
}
EOF
    cat > "$lock" <<EOF
{
  "name": "$2",
  "lockfileVersion": 3,
  "packages": { "": { "name": "$2" } }
}
EOF
  fi
}

# Two framework tags whose only interesting difference is FRAMEWORK-VERSION plus
# one manifest field, so each sub-case controls the merge shape exactly.
build_version_framework() { # dir shape
  local fw="$1" shape="$2"
  init_repo "$fw"
  mkdir -p "$fw/src"
  write_gitattributes "$fw"
  printf 'marker\n' > "$fw/.sekai-template"
  printf 'export const FRAMEWORK_APP = "fw-v1";\n' > "$fw/src/app.js"
  printf 'v1.0.0\n' > "$fw/FRAMEWORK-VERSION"
  if [ "$shape" = "versioned" ]; then
    write_npm_manifests "$fw" "example-framework" versioned "1.0.0"
  else
    write_npm_manifests "$fw" "example-framework" versionless "old-framework-build"
  fi
  git -C "$fw" add -A
  git -C "$fw" commit -q -m "Example framework fw-v1"
  git -C "$fw" tag fw-v1

  printf 'export const FRAMEWORK_APP = "fw-v2";\n' > "$fw/src/app.js"
  printf 'v1.0.1\n' > "$fw/FRAMEWORK-VERSION"
  if [ "$shape" = "versioned" ]; then
    write_npm_manifests "$fw" "example-framework" versioned "1.0.1"
  else
    write_npm_manifests "$fw" "example-framework" versionless "new-framework-build"
  fi
  git -C "$fw" add -A
  git -C "$fw" commit -q -m "Example framework fw-v2"
  git -C "$fw" tag fw-v2
}

run_package_capture() { # dir label — prints the state path
  local out
  out="$( cd "$1" && node "$PACKAGE_HELPER" capture )" \
    || fail "$2: package-state capture failed"
  [ -n "$out" ] || fail "$2: package-state capture printed no state path (the helper was a silent no-op)"
  printf '%s' "$out"
}

# package-state reconcile, honoring the --selftest skip toggle (SKIP_RECONCILE=1).
run_package_reconcile() { # dir state-file label
  if [ "${SKIP_RECONCILE:-0}" = "1" ]; then
    echo "   (selftest: package-state reconcile DELIBERATELY SKIPPED)"
    return 0
  fi
  ( cd "$1" && node "$PACKAGE_HELPER" reconcile "$2" ) > "$TMP/stdout.txt" 2> "$TMP/stderr.txt" \
    || fail "$3: package-state reconcile failed; stderr: $(cat "$TMP/stderr.txt")"
  ok "$3: package-state reconcile exited 0"
}

assert_framework_version() { # dir expected label where
  local found
  found="$(cat "$1/FRAMEWORK-VERSION")"
  [ "$found" = "$2" ] || fail "$3: FRAMEWORK-VERSION is '$found' $4 (expected '$2')"
  ok "$3: FRAMEWORK-VERSION is $2 $4"
}

assert_framework_version_committed() { # dir expected label
  local found
  found="$(git -C "$1" show HEAD:FRAMEWORK-VERSION)"
  [ "$found" = "$2" ] || fail "$3: the commit carries FRAMEWORK-VERSION '$found' (expected '$2')"
  ok "$3: the commit carries FRAMEWORK-VERSION $2"
}

# The explicit post-verification bump (`/sekai-upgrade` step 9 / UPGRADE.md step 8),
# including the assertion that step now makes rather than assuming its write took.
bump_framework_version() { # dir target label
  printf '%s\n' "$2" > "$1/FRAMEWORK-VERSION"
  [ "$(cat "$1/FRAMEWORK-VERSION")" = "$2" ] \
    || fail "$3: the documented bump assertion would not have caught a failed write"
  git -C "$1" add -- FRAMEWORK-VERSION
  git -C "$1" commit -q -m "chore: FRAMEWORK-VERSION -> $2"
}

case_framework_version_survives_merge() { # workdir
  local work="$1" fw inst state
  fw="$work/fw"
  inst="$work/instance"
  mkdir -p "$work"
  build_version_framework "$fw" versioned

  git clone -q "$fw" "$inst"
  configure_repo "$inst"
  git -C "$inst" checkout -q -B main fw-v1
  git -C "$inst" rm -q -f .sekai-template
  printf 'v7.0.0\n' > "$inst/VERSION"
  write_npm_manifests "$inst" "example-instance" versioned "7.0.0"
  # FRAMEWORK-VERSION is deliberately NOT touched here.
  git -C "$inst" add -A
  git -C "$inst" commit -q -m "Adopt Example framework at fw-v1"

  # Fixture guards: the attribute and the driver are both in place, and the
  # instance's FRAMEWORK-VERSION is identical to the merge base. That pair is what
  # makes `merge=ours` insufficient, and it is the state this case exists for.
  grep -qx 'FRAMEWORK-VERSION merge=ours' "$inst/.gitattributes" \
    || fail "case 12: fixture guard — FRAMEWORK-VERSION is not marked merge=ours"
  [ "$(git -C "$inst" config merge.ours.driver)" = "true" ] \
    || fail "case 12: fixture guard — the ours driver is not configured in this clone"
  git -C "$inst" diff --quiet fw-v1 HEAD -- FRAMEWORK-VERSION \
    || fail "case 12: fixture guard — the instance changed FRAMEWORK-VERSION since the merge base, so merge=ours would fire and the case would prove nothing"
  assert_framework_version "$inst" "v1.0.0" "case 12" "before the merge"

  state="$(run_package_capture "$inst" "case 12")"

  git -C "$inst" merge --no-edit fw-v2 >/dev/null 2>&1 || true

  # The defect, pinned: with the attribute set and the driver configured, the merge
  # still moved the file, because git never invoked the driver.
  assert_framework_version "$inst" "v1.0.1" "case 12" "after the merge (merge=ours did not protect it)"

  run_package_reconcile "$inst" "$state" "case 12"
  assert_framework_version "$inst" "v1.0.0" "case 12" "after reconcile"

  finalize_merge "$inst" "case 12"
  assert_is_merge_commit "$inst" "case 12"
  assert_framework_version_committed "$inst" "v1.0.0" "case 12"

  # Only now, after verification, does the explicit bump move it.
  bump_framework_version "$inst" "v1.0.1" "case 12"
  assert_framework_version "$inst" "v1.0.1" "case 12" "after the explicit bump"
  assert_framework_version_committed "$inst" "v1.0.1" "case 12"

  # 12b — the same contract where the merge COMPLETES WITHOUT CONFLICTS, so git
  # auto-commits it. reconcile must rewrite that commit rather than resolve an
  # index, or the merge commit itself ships the unverified version.
  local fw2 inst2 state2
  fw2="$work/autocommit/fw"
  inst2="$work/autocommit/instance"
  mkdir -p "$work/autocommit"
  build_version_framework "$fw2" versionless

  git clone -q "$fw2" "$inst2"
  configure_repo "$inst2"
  git -C "$inst2" checkout -q -B main fw-v1
  git -C "$inst2" rm -q -f .sekai-template
  # The adopter adds only VERSION: the versionless manifests are accepted as-is, so
  # nothing the framework also edits differs on this side and the merge is clean.
  printf 'v7.0.0\n' > "$inst2/VERSION"
  git -C "$inst2" add -A
  git -C "$inst2" commit -q -m "Adopt Example framework at fw-v1 (versionless manifests)"

  git -C "$inst2" diff --quiet fw-v1 HEAD -- FRAMEWORK-VERSION \
    || fail "case 12b: fixture guard — the instance changed FRAMEWORK-VERSION since the merge base"
  state2="$(run_package_capture "$inst2" "case 12b")"

  git -C "$inst2" merge --no-edit fw-v2 >/dev/null 2>&1 || true
  if git -C "$inst2" rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then
    fail "case 12b: fixture no longer auto-commits the merge, so the amend path is not exercised"
  fi
  assert_is_merge_commit "$inst2" "case 12b"
  assert_framework_version_committed "$inst2" "v1.0.1" "case 12b (the auto-committed merge, before reconcile)"

  run_package_reconcile "$inst2" "$state2" "case 12b"
  assert_framework_version "$inst2" "v1.0.0" "case 12b" "after reconcile"
  assert_is_merge_commit "$inst2" "case 12b"
  assert_framework_version_committed "$inst2" "v1.0.0" "case 12b"
  local dirty
  dirty="$(git -C "$inst2" status --porcelain)"
  [ -z "$dirty" ] || fail "case 12b: reconcile left the amended merge uncommitted: $(echo "$dirty" | tr '\n' ' ')"
  ok "case 12b: reconcile amended the merge commit itself (working tree clean)"

  bump_framework_version "$inst2" "v1.0.1" "case 12b"
  assert_framework_version_committed "$inst2" "v1.0.1" "case 12b"
}

# ---------------------------------------------------------------------------
# Case 12c — the instance had NO FRAMEWORK-VERSION before the merge.
#
# `/sekai-upgrade` step 0 names this state explicitly ("no FRAMEWORK-VERSION
# (pre-wizard instance)"), and it is the other half of DoD 2's contract: restoring
# an absent file means removing whatever the merge introduced. It exercises a
# distinct `frameworkVersion === null` branch, so a regression there would leave
# every present-value fixture green while a pre-wizard instance silently gained the
# incoming version before anything verified it.
# ---------------------------------------------------------------------------
case_framework_version_absent_stays_absent() { # workdir
  local work="$1" fw inst state
  fw="$work/fw"
  inst="$work/instance"
  mkdir -p "$work"
  build_version_framework "$fw" versionless

  git clone -q "$fw" "$inst"
  configure_repo "$inst"
  git -C "$inst" checkout -q -B main fw-v1
  git -C "$inst" rm -q -f .sekai-template
  git -C "$inst" rm -q -f FRAMEWORK-VERSION
  printf 'v7.0.0\n' > "$inst/VERSION"
  git -C "$inst" add -A
  git -C "$inst" commit -q -m "Adopt Example framework at fw-v1 without a FRAMEWORK-VERSION"

  [ ! -e "$inst/FRAMEWORK-VERSION" ] \
    || fail "case 12c: fixture guard — the instance still carries a FRAMEWORK-VERSION"
  state="$(run_package_capture "$inst" "case 12c")"
  grep -q '"frameworkVersion": null' "$state" \
    || fail "case 12c: capture did not record the absent FRAMEWORK-VERSION as null: $(cat "$state")"
  ok "case 12c: capture recorded the absent FRAMEWORK-VERSION as null"

  git -C "$inst" merge --no-edit fw-v2 >/dev/null 2>&1 || true
  [ -e "$inst/FRAMEWORK-VERSION" ] \
    || fail "case 12c: fixture guard — the merge did not bring FRAMEWORK-VERSION in, so there is nothing to remove"
  ok "case 12c: the merge re-introduced FRAMEWORK-VERSION into an instance that had none"

  run_package_reconcile "$inst" "$state" "case 12c"
  [ ! -e "$inst/FRAMEWORK-VERSION" ] \
    || fail "case 12c: FRAMEWORK-VERSION survives in the working tree after reconcile (expected absent)"
  [ -z "$(git -C "$inst" ls-files -- FRAMEWORK-VERSION)" ] \
    || fail "case 12c: FRAMEWORK-VERSION is still tracked in the index after reconcile"
  ok "case 12c: reconcile removed the FRAMEWORK-VERSION the merge introduced"

  finalize_merge "$inst" "case 12c"
  assert_is_merge_commit "$inst" "case 12c"
  [ -z "$(git -C "$inst" ls-tree -r --name-only HEAD -- FRAMEWORK-VERSION)" ] \
    || fail "case 12c: the finalized merge commit carries a FRAMEWORK-VERSION the instance never adopted"
  ok "case 12c: the merge commit carries no FRAMEWORK-VERSION"

  # The explicit post-verification bump is what creates it for the first time.
  bump_framework_version "$inst" "v1.0.1" "case 12c"
  assert_framework_version "$inst" "v1.0.1" "case 12c" "after the explicit bump"
  assert_framework_version_committed "$inst" "v1.0.1" "case 12c"
}

# ---------------------------------------------------------------------------
# Case 13 — helper version skew: the documented bootstrap runs the TARGET TAG's
# helper, never the copy in the instance's working tree.
#
# The tree's copy is not a cache of the same file: it shipped with the release the
# instance is LEAVING. A bootstrap that prefers it means a release which CHANGES a
# helper never applies that change on the upgrade that ships it — the one upgrade
# where it matters. That is not hypothetical: the FRAMEWORK-VERSION capture in
# package-state.mjs arrived in v1.0.15, so an instance on v1.0.11 carries a copy
# with no FRAMEWORK-VERSION handling at all, and the retired `test -f <tree copy>
# || <from tag>` form selected exactly that copy to adopt v1.0.15.
#
# 13a derives the bootstrap form from the two adopter-facing documents, so the
# retired shape cannot come back in prose. 13b drives the skew end to end: one
# instance bootstraps as documented and keeps its FRAMEWORK-VERSION, an identical
# instance bootstraps the retired way and loses it. The second half is the
# non-vacuity proof — a fixture where both forms behave the same would make 13a a
# guard over nothing.
# ---------------------------------------------------------------------------

# A pre-v1.0.15 package-state.mjs: it carries the adopter's npm identity across the
# merge and knows nothing about FRAMEWORK-VERSION. Written rather than checked out
# of this repo's own history, because a fixture must not depend on the tags of the
# checkout running it. Its only job is to be faithfully OLD and distinguishable.
write_stale_package_helper() { # path
  cat > "$1" <<'EOF'
#!/usr/bin/env node
// Pre-FRAMEWORK-VERSION package-state helper (fixture). Captures and restores the
// adopter-owned npm manifest fields only.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const gitDir = resolve(root, execFileSync('git', ['rev-parse', '--git-dir'], { encoding: 'utf8' }).trim());
const statePath = resolve(gitDir, 'sekai-package-state.json');
const pkgPath = resolve(root, 'package.json');
const lockPath = resolve(root, 'package-lock.json');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);
const OWNED = ['name', 'version', 'private', 'description'];

const [command, arg] = process.argv.slice(2);
if (command === 'capture') {
  const pkg = readJson(pkgPath);
  const state = {};
  for (const key of OWNED) state[key] = pkg[key];
  writeJson(statePath, state);
  process.stdout.write(`${statePath}\n`);
} else if (command === 'reconcile') {
  const state = readJson(arg || statePath);
  const pkg = readJson(pkgPath);
  const lock = readJson(lockPath);
  for (const key of OWNED) {
    if (state[key] === undefined) delete pkg[key];
    else pkg[key] = state[key];
  }
  if (state.name !== undefined) lock.name = state.name;
  if (state.version !== undefined) lock.version = state.version;
  if (lock.packages && lock.packages['']) {
    if (state.name !== undefined) lock.packages[''].name = state.name;
    if (state.version !== undefined) lock.packages[''].version = state.version;
  }
  writeJson(pkgPath, pkg);
  writeJson(lockPath, lock);
} else {
  process.stderr.write('usage: package-state.mjs <capture|reconcile [state]>\n');
  process.exit(2);
}
EOF
}

# A framework whose fw-v1 ships the STALE helper and whose fw-v2 ships the REAL
# one — the release-changes-a-helper shape, which build_version_framework (same
# helper on both tags) cannot express.
build_skew_framework() { # dir
  local fw="$1"
  init_repo "$fw"
  mkdir -p "$fw/src" "$fw/scripts/upgrade"
  write_gitattributes "$fw"
  printf 'marker\n' > "$fw/.sekai-template"
  printf 'export const FRAMEWORK_APP = "fw-v1";\n' > "$fw/src/app.js"
  printf 'v1.0.0\n' > "$fw/FRAMEWORK-VERSION"
  write_npm_manifests "$fw" "example-framework" versioned "1.0.0"
  write_stale_package_helper "$fw/scripts/upgrade/package-state.mjs"
  git -C "$fw" add -A
  git -C "$fw" commit -q -m "Example framework fw-v1 (package-state without FRAMEWORK-VERSION)"
  git -C "$fw" tag fw-v1

  printf 'export const FRAMEWORK_APP = "fw-v2";\n' > "$fw/src/app.js"
  printf 'v1.0.1\n' > "$fw/FRAMEWORK-VERSION"
  write_npm_manifests "$fw" "example-framework" versioned "1.0.1"
  cp "$PACKAGE_HELPER_SRC" "$fw/scripts/upgrade/package-state.mjs"
  git -C "$fw" add -A
  git -C "$fw" commit -q -m "Example framework fw-v2 (package-state captures FRAMEWORK-VERSION)"
  git -C "$fw" tag fw-v2
}

# An instance adopted at fw-v1, so its tree carries the STALE helper.
build_skew_instance() { # fw dir label
  local inst="$2"
  git clone -q "$1" "$inst"
  configure_repo "$inst"
  git -C "$inst" checkout -q -B main fw-v1
  git -C "$inst" rm -q -f .sekai-template
  printf 'v7.0.0\n' > "$inst/VERSION"
  write_npm_manifests "$inst" "example-instance" versioned "7.0.0"
  # FRAMEWORK-VERSION is deliberately NOT touched: `ours == base` is what makes
  # merge=ours insufficient and the capture load-bearing (case 12).
  git -C "$inst" add -A
  git -C "$inst" commit -q -m "Adopt Example framework at fw-v1"

  git -C "$inst" diff --quiet fw-v1 HEAD -- FRAMEWORK-VERSION \
    || fail "$3: fixture guard — the instance changed FRAMEWORK-VERSION since the merge base"
  if grep -q 'FRAMEWORK_VERSION' "$inst/scripts/upgrade/package-state.mjs"; then
    fail "$3: fixture guard — the instance's tree copy already handles FRAMEWORK-VERSION, so there is no skew to exercise"
  fi
  ok "$3: the instance's tree copy of package-state.mjs predates the FRAMEWORK-VERSION capture"
}

# The bootstrap the documents prescribe, run verbatim from the instance root (the
# documents' own working directory) rather than paraphrased. Prints an absolute
# path so the caller can drive it from anywhere.
bootstrap_helper_from_tag() { # instance tag — prints the helper path
  local helper
  helper="$( cd "$1" && PACKAGE_HELPER="$(git rev-parse --git-dir)/sekai-package-state.mjs" \
    && git show "$2:scripts/upgrade/package-state.mjs" > "$PACKAGE_HELPER" \
    && cd "$(dirname "$PACKAGE_HELPER")" && printf '%s/%s' "$(pwd)" "$(basename "$PACKAGE_HELPER")" )"
  [ -n "$helper" ] || fail "bootstrap: the documented extraction produced no helper path"
  printf '%s' "$helper"
}

case_helper_bootstrap_version_skew() { # workdir
  local work="$1" fw inst helper state found

  # --- 13a: the documented bootstrap form, derived from the documents ----------
  local doc var file
  for doc in $UPGRADE_DOCS; do
    [ -f "$doc" ] || fail "case 13a: $doc is missing"
    if grep -q 'test -f "\$[A-Z_]*HELPER"' "$doc"; then
      fail "case 13a: $(basename "$doc") prefers the working tree's copy of an upgrade helper (retired \`test -f \$..._HELPER ||\` form); the helper must come from the target tag"
    fi
    # Per helper: the variable is assigned the .git path, and the tag's copy is
    # extracted into it. Requiring both, per document, keeps a rename from making
    # this vacuous.
    while IFS= read -r var; do
      file="$(printf '%s' "$var" | cut -d: -f1)"
      var="$(printf '%s' "$var" | cut -d: -f2)"
      grep -q "^$var=\"\$(git rev-parse --git-dir)/sekai-$file\.mjs\"" "$doc" \
        || fail "case 13a: $(basename "$doc") does not bootstrap \$$var from the git directory"
      grep -q "git show .*:scripts/upgrade/$file\.mjs > \"\$$var\"" "$doc" \
        || fail "case 13a: $(basename "$doc") does not extract scripts/upgrade/$file.mjs from the target tag into \$$var"
    done <<'EOF'
dev-plugin-state:HELPER
maintainer-docs-state:MDOCS_HELPER
package-state:PACKAGE_HELPER
framework-divergence:DIVERGENCE_HELPER
EOF
    ok "case 13a: $(basename "$doc") bootstraps all four helpers from the target tag"
  done

  # --- 13b: the skew itself, end to end ---------------------------------------
  fw="$work/fw"
  inst="$work/documented"
  mkdir -p "$work"
  build_skew_framework "$fw"
  build_skew_instance "$fw" "$inst" "case 13b"

  assert_framework_version "$inst" "v1.0.0" "case 13b" "before the merge"
  helper="$(bootstrap_helper_from_tag "$inst" fw-v2)"
  case "$helper" in
    "$inst"/scripts/*) fail "case 13b: the bootstrap wrote the helper into the working tree" ;;
  esac
  grep -q 'FRAMEWORK_VERSION' "$helper" \
    || fail "case 13b: the helper bootstrapped from fw-v2 has no FRAMEWORK-VERSION handling — the fixture's tags are the wrong way round"
  ok "case 13b: the documented bootstrap took the target tag's helper, outside the working tree"

  state="$( cd "$inst" && node "$helper" capture )" \
    || fail "case 13b: capture failed with the tag's helper"
  [ -n "$state" ] || fail "case 13b: capture printed no state path"

  git -C "$inst" merge --no-edit fw-v2 >/dev/null 2>&1 || true
  assert_framework_version "$inst" "v1.0.1" "case 13b" "after the merge (merge=ours did not protect it)"

  if [ "${SKIP_RECONCILE:-0}" = "1" ]; then
    echo "   (selftest: package-state reconcile DELIBERATELY SKIPPED)"
  else
    ( cd "$inst" && node "$helper" reconcile "$state" ) >/dev/null 2>"$TMP/stderr.txt" \
      || fail "case 13b: reconcile failed with the tag's helper; stderr: $(cat "$TMP/stderr.txt")"
  fi
  assert_framework_version "$inst" "v1.0.0" "case 13b" "after reconcile with the tag's helper"

  finalize_merge "$inst" "case 13b"
  assert_is_merge_commit "$inst" "case 13b"
  assert_framework_version_committed "$inst" "v1.0.0" "case 13b"

  # The retired form, on an identical instance: the tree's helper wins and the
  # marker silently adopts the incoming release. This is what 13a now forbids in
  # prose, and it is why 13b is not a test of nothing.
  local inst2 helper2 state2
  inst2="$work/tree-first"
  build_skew_instance "$fw" "$inst2" "case 13b (retired form)"
  helper2=scripts/upgrade/package-state.mjs
  [ -f "$inst2/$helper2" ] \
    || fail "case 13b: fixture guard — the instance has no tree copy, so the retired form would have fallen through to the tag anyway"
  state2="$( cd "$inst2" && node "$helper2" capture )" \
    || fail "case 13b: capture failed with the instance's own stale helper"
  git -C "$inst2" merge --no-edit fw-v2 >/dev/null 2>&1 || true
  ( cd "$inst2" && node "$helper2" reconcile "$state2" ) >/dev/null 2>&1 || true
  found="$(cat "$inst2/FRAMEWORK-VERSION")"
  [ "$found" = "v1.0.1" ] \
    || fail "case 13b: the retired tree-first bootstrap kept FRAMEWORK-VERSION at '$found'; the fixture no longer distinguishes the two forms, so 13a guards nothing"
  ok "case 13b: the retired tree-first bootstrap loses FRAMEWORK-VERSION (v1.0.1) — the two forms are distinguishable"
}

# ---------------------------------------------------------------------------
# Case 14 — maintainer docs: the instance KEPT THE FRAMEWORK'S COPY VERBATIM, so
# `ours == base` and the `ours` driver never runs.
#
# This is the same mechanic case 12 pins for FRAMEWORK-VERSION, one tree over. A
# merge driver runs only on a three-way CONTENT merge, so an instance that has not
# edited a document since the merge base has git resolve to theirs without ever
# consulting the driver — with the attribute set and the driver configured, both.
# Case 8 cannot reach this shape: there the instance wrote its own content, `ours !=
# base`, and the driver really does fire. Both must keep passing, because they are
# the two halves of what `merge=ours` does and does not guarantee.
#
# Keeping a framework document verbatim is the COMMON adopter state, not an edge
# case, so the upgrade restores the pre-merge content rather than stopping. Before
# LB-88 it stopped, and prescribed marking the path `merge=ours` and configuring the
# driver — both already true here, which made re-running reproduce the stop.
#
# The merge is shaped to AUTO-COMMIT, because that is the shape the defect was found
# in on a real instance upgrade, and the only one that drives the amend path.
# ---------------------------------------------------------------------------
case_mdocs_owned_ours_equals_base() { # workdir
  local work="$1" fw inst keep rel owned docdir dirty nonascii
  fw="$work/fw"
  inst="$work/instance"
  keep="$work/expected"
  mkdir -p "$work" "$keep/tree"
  build_framework "$fw"
  clone_at_v1 "$fw" "$inst"

  owned="$(first_doc_file)"

  # The instance CLAIMS the maintainer-doc paths but writes no content of its own
  # there: it keeps fw-v1's documents byte-for-byte. It also drops the framework's
  # VERSION the way fw-v2 does, so that one-time modify/delete conflict does not stop
  # the merge for an unrelated reason — this fixture needs git to auto-commit.
  append_maintainer_doc_attributes "$inst"
  write_instance_agents_md "$inst/AGENTS.md" no-reference
  git -C "$inst" rm -q -f VERSION
  git -C "$inst" add -A
  git -C "$inst" commit -q -m "Instance claims the maintainer-doc paths without changing them"

  for rel in $MAINTAINER_DOCS; do
    mkdir -p "$keep/tree/$(dirname "$rel")"
    cp -R "$inst/$rel" "$keep/tree/$rel"
  done

  # Fixture guards. Both repairs the pre-LB-88 diagnostic prescribed are already in
  # place, and the documents are identical to the merge base — that pair is exactly
  # what makes `merge=ours` insufficient, and it is the state this case exists for.
  grep -q 'merge=ours' "$inst/.gitattributes" \
    || fail "case 14: fixture guard — the maintainer-doc paths are not marked merge=ours"
  [ "$(git -C "$inst" config merge.ours.driver)" = "true" ] \
    || fail "case 14: fixture guard — the ours driver is not configured in this clone"
  git -C "$inst" diff --quiet fw-v1 HEAD -- $MAINTAINER_DOCS \
    || fail "case 14: fixture guard — the instance changed a maintainer doc since the merge base, so the driver would fire and the case would prove nothing"
  ok "case 14: fixture is the ours==base shape (attribute set, driver configured, documents identical to the merge base)"

  assert_mdocs_classify "$inst" "case 14" "$MAINTAINER_DOCS" ""

  git -C "$inst" merge --no-edit fw-v2 >/dev/null 2>&1 || true
  if git -C "$inst" rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then
    fail "case 14: fixture no longer auto-commits the merge, so the amend path is not exercised"
  fi
  # The defect, pinned: with the attribute set and the driver configured, the merge
  # still replaced the instance's documents, because git never invoked the driver.
  if cmp -s "$inst/$owned" "$keep/tree/$owned"; then
    fail "case 14: fixture guard — the merge left $owned unchanged, so there is nothing to restore"
  fi
  ok "case 14: the merge replaced the instance's maintainer docs (merge=ours did not protect them)"

  assert_mdocs_reconcile_ok "$inst" "case 14"
  # Deliberately NOT gated on SKIP_RECONCILE: with reconcile skipped this is the
  # first assertion that must fail, or the case guards nothing.
  printf '%s\n%s\n' "$HELPER_OUT" "$HELPER_ERR" | grep -Fq "$owned" \
    || fail "case 14: reconcile did not name the restored path; stdout: '$HELPER_OUT'; stderr: '$HELPER_ERR'"
  ok "case 14: reconcile names the restored path"

  # The `-z` pin on the CLEANLY-MERGED producer (`git diff --name-status`), the other
  # half of case 10/no-driver's. A path git C-quotes is read as unclaimed, so losing
  # `-z` fails the reconcile above rather than reaching here.
  nonascii="$(non_ascii_doc_file)"
  if [ -n "$nonascii" ]; then
    printf '%s\n%s\n' "$HELPER_OUT" "$HELPER_ERR" | grep -Fq "$nonascii" \
      || fail "case 14: reconcile did not name the restored non-ASCII path ($nonascii) verbatim; stdout: '$HELPER_OUT'; stderr: '$HELPER_ERR'"
    ok "case 14: reconcile names the restored non-ASCII path verbatim"
  fi

  finalize_merge "$inst" "case 14"
  assert_is_merge_commit "$inst" "case 14"

  for rel in $MAINTAINER_DOCS; do
    assert_doc_entry_matches "$inst" "$keep/tree" "$rel" "case 14"
  done
  ok "case 14: every instance-owned maintainer-doc file is byte-identical to its pre-merge blob (cmp), non-ASCII path included"

  # The restore landed in the merge commit itself, not as a follow-up commit.
  dirty="$(git -C "$inst" status --porcelain)"
  [ -z "$dirty" ] || fail "case 14: reconcile left the amended merge uncommitted: $(echo "$dirty" | tr '\n' ' ')"
  git -C "$inst" show "HEAD:$owned" | cmp - "$keep/tree/$owned" \
    || fail "case 14: the merge commit carries the framework's copy of $owned, not the instance's"
  ok "case 14: reconcile amended the merge commit itself (working tree clean)"

  # The restore must not have widened into a revert of the whole owned path: a
  # framework file the merge ADDED underneath it is still reported, never deleted —
  # the same rule case 8 pins.
  for docdir in $MAINTAINER_DOCS; do
    case "$docdir" in
      *.md) ;;
      *) [ -f "$inst/$docdir/002-added-in-fw-v2.md" ] \
           || fail "case 14: the restore DELETED the framework-added record (it must report, not delete)" ;;
    esac
  done
  ok "case 14: the framework-added record survives the restore (report, never delete)"

  git -C "$inst" show HEAD:src/app.js | grep -q 'fw-v2' \
    || fail "case 14: the framework's non-doc change (src/app.js at fw-v2) did not land — the restore discarded the merge"
  ok "case 14: the framework's non-doc change (src/app.js @ fw-v2) landed"
}

# ---------------------------------------------------------------------------
# Cases 15a-15e — the pre-merge divergence report
# (`scripts/upgrade/framework-divergence.mjs`, ADR 010 (e)).
#
#   node scripts/upgrade/framework-divergence.mjs report --target <tag> [--repo <dir>]
#   node scripts/upgrade/framework-divergence.mjs roots [--repo <dir>]
#
# The contract: BEFORE the merge, every framework-owned path whose content at HEAD
# differs from the same path at `git merge-base HEAD <target>` is listed with the
# instance's value and the incoming framework value. The set is read from the merge
# base rather than from `--diff-filter=U` afterwards, which is not the same list read
# at a different time: the conflict list holds only what git could not resolve, so a
# path the framework never touched is merged silently and never appears in it.
# Nothing is written and no path is resolved in either direction.
# ---------------------------------------------------------------------------

# A worker deploy template with one tuning value the fixture varies. Three distinct
# floors across merge base / framework target / instance is what lets case 15a tell
# "the framework's incoming value" apart from "the merge base value" — a report that
# compared against the wrong side would still print two different numbers.
write_divergence_worker() { # file relevance-floor
  cat > "$1" <<EOF
# Example worker deploy template (framework-owned).
name = "REPLACE_VIA_WORKER_CONFIG"
main = "src/index.mjs"

[vars]
RATE_LIMIT_MAX = "20"
# Tuned per corpus.
RELEVANCE_FLOOR = "$2"

[[d1_databases]]
binding = "DB"
database_name = "REPLACE_VIA_WORKER_CONFIG"
EOF
}

# fw-v1 -> fw-v2 changes src/app.js and the worker's floor, and deliberately leaves
# src/untouched.js and the skill alone, so a report that lists everything under the
# roots fails the precision assertions.
build_divergence_framework() { # dir
  local fw="$1"
  init_repo "$fw"
  mkdir -p "$fw/src" "$fw/workers/example" "$fw/.agents/skills/example" "$fw/scripts/upgrade"
  write_gitattributes "$fw"
  printf 'marker\n' > "$fw/.sekai-template"
  # The blank line is fixture, not formatting: it puts an empty CONTEXT line inside
  # the hunk the report renders, which is what case 15a's blank-line assertion needs.
  printf 'export const FRAMEWORK_APP = "fw-v1";\n\nexport const FRAMEWORK_TAIL = "shared";\n' > "$fw/src/app.js"
  printf 'export const FRAMEWORK_STABLE = "unchanged in both releases";\n' > "$fw/src/untouched.js"
  write_divergence_worker "$fw/workers/example/wrangler.toml" "0.46"
  printf '# Example skill (framework-owned, fw-v1)\n' > "$fw/.agents/skills/example/SKILL.md"
  cp "$DIVERGENCE_HELPER_SRC" "$fw/scripts/upgrade/framework-divergence.mjs"
  git -C "$fw" add -A
  git -C "$fw" commit -q -m "Example framework fw-v1"
  git -C "$fw" tag fw-v1

  printf 'export const FRAMEWORK_APP = "fw-v2";\n\nexport const FRAMEWORK_TAIL = "shared";\n' > "$fw/src/app.js"
  write_divergence_worker "$fw/workers/example/wrangler.toml" "0.50"
  git -C "$fw" add -A
  git -C "$fw" commit -q -m "Example framework fw-v2"
  git -C "$fw" tag fw-v2
}

build_divergence_instance() { # fw dir label [edits|clean|converged]
  local inst="$2" label="$3" variant="${4:-edits}"
  git clone -q "$1" "$inst"
  configure_repo "$inst"
  # A legal reader-side git setting, turned on deliberately: with it, git prints a
  # blank CONTEXT line as a truly empty line instead of a bare prefix space. The
  # report has no say over the config of the repository it runs in, so the fixture
  # uses the setting that makes an empty diff line indistinguishable from padding —
  # which is what a renderer that filters empty lines silently deletes.
  git -C "$inst" config diff.suppressBlankEmpty true
  git -C "$inst" checkout -q -B main fw-v1
  git -C "$inst" rm -q -f .sekai-template
  if [ "$variant" = "edits" ]; then
    write_divergence_worker "$inst/workers/example/wrangler.toml" "0.61"
    printf 'export const FRAMEWORK_APP = "fw-v1";\n// instance edit\n\nexport const FRAMEWORK_TAIL = "shared";\n' > "$inst/src/app.js"
  elif [ "$variant" = "converged" ]; then
    # The instance made exactly the change fw-v2 ships. This is what upstreaming
    # looks like from the instance's side one release later: diverged from the merge
    # base, identical to the target.
    printf 'export const FRAMEWORK_APP = "fw-v2";\n\nexport const FRAMEWORK_TAIL = "shared";\n' > "$inst/src/app.js"
  fi
  git -C "$inst" add -A
  git -C "$inst" commit -q -m "Adopt the Example framework at fw-v1"

  # Fixture guards: without these the assertions below could pass on a broken helper.
  git -C "$inst" diff --quiet fw-v1 fw-v2 -- src/untouched.js \
    || fail "$label: fixture guard — src/untouched.js differs between the tags, so it cannot prove precision"
  if [ "$variant" = "edits" ]; then
    git -C "$inst" diff --quiet HEAD fw-v2 -- workers/example/wrangler.toml \
      && fail "$label: fixture guard — the instance's worker template equals the target's, so nothing diverged"
    git -C "$inst" diff --quiet HEAD fw-v1 -- workers/example/wrangler.toml \
      && fail "$label: fixture guard — the instance did not retune the worker template"
    ok "$label: instance carries a retuned worker value and an edited source file"
  elif [ "$variant" = "converged" ]; then
    # Both halves of "converged" are guarded, because either one alone is a
    # different fixture: differing from the base is what puts the path in the
    # report at all, and matching the target is the shape under test.
    git -C "$inst" diff --quiet HEAD fw-v1 -- src/app.js \
      && fail "$label: fixture guard — the instance did not change src/app.js, so nothing diverged from the merge base"
    git -C "$inst" diff --quiet HEAD fw-v2 -- src/app.js \
      || fail "$label: fixture guard — the instance's src/app.js does not equal the target's, so this is not the converged shape"
    ok "$label: instance changed src/app.js to exactly the content fw-v2 ships"
  else
    git -C "$inst" diff --quiet HEAD fw-v1 -- src workers .agents \
      || fail "$label: fixture guard — the clean instance is not clean under the framework-owned roots"
    ok "$label: instance carries no framework-owned edit"
  fi
}

# --- 15a/15b: a planted divergence is enumerated with both values, and nothing is written
case_divergence_report() { # workdir
  local work="$1" fw inst before after
  fw="$work/fw"
  inst="$work/instance"
  mkdir -p "$work"
  build_divergence_framework "$fw"
  build_divergence_instance "$fw" "$inst" "case 15a" edits

  before="$(repo_snapshot "$inst")"
  assert_divergence_report_ok "$inst" fw-v2 "case 15a"

  assert_report_names "case 15a" "workers/example/wrangler.toml" "the worker template the instance retuned"
  assert_report_names "case 15a" "src/app.js" "the source file the instance edited"
  assert_report_names "case 15a" "[vars] RELEVANCE_FLOOR" "the diverged key with its table"

  # Both values, per DoD 2 — and they must be the two values that are actually in
  # play. Asserting only that two numbers appear would pass on a report echoing the
  # merge base at the instance, which is the mistake worth catching.
  printf '%s\n' "$HELPER_OUT" | grep -F 'yours:' | grep -Fq '"0.61"' \
    || fail "case 15a: the report does not present the instance's own value (\"0.61\") as theirs. Report was:
$HELPER_OUT"
  printf '%s\n' "$HELPER_OUT" | grep -F 'framework:' | grep -Fq '"0.50"' \
    || fail "case 15a: the report does not present the incoming framework value (\"0.50\"). Report was:
$HELPER_OUT"
  if printf '%s\n' "$HELPER_OUT" | grep -F 'framework:' | grep -Fq '"0.46"'; then
    fail "case 15a: the report presents the MERGE BASE value (\"0.46\") as the framework's incoming one. Report was:
$HELPER_OUT"
  fi
  ok "case 15a: the [vars] divergence carries the key, the instance's value, and the framework's incoming value"

  assert_report_names "case 15a" '+export const FRAMEWORK_APP = "fw-v2";' \
    "the framework's incoming side for the edited source file"

  # The rendered hunk must keep the file's blank line. Non-vacuity first: under this
  # instance's config git really does emit that context line as an empty one, so a
  # renderer that drops empty lines joins text the file separates and the reader is
  # shown a region that is not what either side contains.
  git -C "$inst" diff --no-color --unified=2 HEAD:src/app.js fw-v2:src/app.js \
    | grep -qx '' \
    || fail "case 15a: fixture guard — git emitted no empty line for the file's blank line, so the assertion below proves nothing"
  printf '%s\n' "$HELPER_OUT" | grep -qx '      ' \
    || fail "case 15a: the rendered hunk dropped the blank line inside it, so it shows lines as adjacent that the file separates. Report was:
$HELPER_OUT"
  ok "case 15a: the rendered hunk keeps a blank line git emitted as an empty one"
  assert_report_silent_about "case 15a" "src/untouched.js" \
    "a framework-owned file neither side changed"
  assert_report_silent_about "case 15a" ".agents/skills/example/SKILL.md" \
    "an untouched framework-owned skill"
  assert_report_silent_about "case 15a" "RATE_LIMIT_MAX" \
    "a [vars] key both sides agree on"

  # DoD 3: the report names the decision, it does not take one. Nothing in the
  # working tree, the index, the commit, or the git directory may move.
  after="$(repo_snapshot "$inst")"
  [ "$before" = "$after" ] || fail "case 15b: the report changed the repository. Difference:
$(diff <(printf '%s\n' "$before") <(printf '%s\n' "$after") || true)"
  [ -z "$(git -C "$inst" diff --name-only --diff-filter=U)" ] \
    || fail "case 15b: the report left unmerged paths behind"
  [ ! -e "$inst/.git/MERGE_HEAD" ] || fail "case 15b: the report started a merge"
  ok "case 15b: the report wrote nothing — no state file, no staged path, no resolution"
}

# --- 15c: an instance with no framework-owned edit gets a clean report
case_divergence_clean() { # workdir
  local work="$1" fw inst
  fw="$work/fw"
  inst="$work/instance"
  mkdir -p "$work"
  build_divergence_framework "$fw"
  build_divergence_instance "$fw" "$inst" "case 15c" clean

  assert_divergence_report_ok "$inst" fw-v2 "case 15c"
  assert_report_names "case 15c" "no framework-owned file" "the clean outcome in plain words"
  assert_report_silent_about "case 15c" "src/app.js" "a path the instance never touched"
  if printf '%s\n' "$HELPER_OUT" | grep -q '^  [^ ]'; then
    fail "case 15c: the clean report still carries path entries. Report was:
$HELPER_OUT"
  fi
  ok "case 15c: the clean report lists no path and adds no step to the upgrade"
}

# --- 15d: the first, unrelated-history merge has no base to measure against
case_divergence_unrelated_history() { # workdir
  local work="$1" fw inst
  fw="$work/fw"
  inst="$work/instance"
  mkdir -p "$work"
  build_divergence_framework "$fw"

  init_repo "$inst"
  mkdir -p "$inst/src"
  printf 'export const INSTANCE_APP = "own history";\n' > "$inst/src/app.js"
  git -C "$inst" add -A
  git -C "$inst" commit -q -m "Example instance, own history"
  git -C "$inst" remote add framework "$fw"
  git -C "$inst" fetch -q framework --tags
  [ -z "$(git -C "$inst" merge-base HEAD fw-v2 2>/dev/null || true)" ] \
    || fail "case 15d: fixture guard — the histories share a merge base, so this is not the first-merge shape"

  assert_divergence_report_ok "$inst" fw-v2 "case 15d"
  assert_report_names "case 15d" "no merge base" "the missing common ancestor"
  # The failure this pins: answering the unrelated-history case by declaring every
  # framework-owned file diverged, which is true of nothing and useless in practice.
  if printf '%s\n' "$HELPER_OUT" | grep -q '^  [^ ]'; then
    fail "case 15d: the report claims divergence on an unrelated-history first merge. Report was:
$HELPER_OUT"
  fi
  assert_report_silent_about "case 15d" "src/app.js" "a path as diverged with no merge base"
}

# --- 15f: a path both sides moved to the same content is settled, not a conflict
#
# The instance changed src/app.js and fw-v2 ships that exact content, so the path
# differs from the merge base (which is why it is in the report) and not from the
# target. A report that reads only "changed here AND changed in the framework" calls
# this a place a content conflict can land and then prints a "differing region"
# header over the empty diff between two identical blobs — advice that is wrong and a
# block that is blank, on the success state of the route ADR 010 (g) recommends.
case_divergence_converged() { # workdir
  local work="$1" fw inst
  fw="$work/fw"
  inst="$work/instance"
  mkdir -p "$work"
  build_divergence_framework "$fw"
  build_divergence_instance "$fw" "$inst" "case 15f" converged

  assert_divergence_report_ok "$inst" fw-v2 "case 15f"

  # The path is still listed: it IS a divergence from the merge base, and an adopter
  # reading the report should see that this file is one of the ones they touched.
  assert_report_names "case 15f" "src/app.js" "the path the instance changed"
  assert_report_names "case 15f" "no conflict" "the settled outcome"

  # The two defects, asserted separately: the wrong claim, and the empty block.
  assert_report_silent_about "case 15f" "content conflict can land" \
    "a content conflict on a path whose two sides are identical"
  assert_report_silent_about "case 15f" "differing region" \
    "a differing region between two identical blobs"
  # The value pair is the indented `yours:` / `framework:` block; the leading spaces
  # are what tell it apart from the outlook sentence, which ends "identical to yours:".
  assert_report_silent_about "case 15f" "  yours:" \
    "a value pair for a path with no differing value"
  ok "case 15f: a converged path reports as settled, with no conflict claim and no empty differing region"
}

# --- 15e: the report's TOML key view and the deploy-time parser agree
#
# The report names `[vars] RELEVANCE_FLOOR` rather than a diff hunk because a key is
# what an operator recognizes. That needs a TOML reader, and the helper cannot import
# `scripts/deploy/wrangler-config.mjs`: every upgrade helper runs as a lone file
# extracted from a release tag into the git directory. Two readers over one file
# format is a drift risk, so this holds them to the same key view over every worker
# template the repository really ships (guard-or-explain: the guard).
case_divergence_toml_key_view() {
  local out
  cat > "$TMP/toml-key-view.mjs" <<'EOF'
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [root, helperPath] = process.argv.slice(2);
const { parseWranglerToml } = await import(pathToFileURL(join(root, 'scripts/deploy/wrangler-config.mjs')).href);
const { tomlEntries } = await import(pathToFileURL(helperPath).href);

const workersDir = join(root, 'workers');
if (!existsSync(workersDir)) {
  process.stderr.write('no workers/ tree to compare\n');
  process.exit(1);
}
let checked = 0;
let sawVars = false;
for (const dir of readdirSync(workersDir).sort()) {
  const rel = `workers/${dir}/wrangler.toml`;
  const file = join(root, rel);
  if (!existsSync(file)) continue;
  const text = readFileSync(file, 'utf8');
  const parsed = parseWranglerToml(text);
  const deploy = [];
  for (const key of Object.keys(parsed.top)) deploy.push(key);
  for (const [table, keys] of Object.entries(parsed.tables)) {
    for (const key of Object.keys(keys)) deploy.push(`[${table}] ${key}`);
  }
  for (const [table, blocks] of Object.entries(parsed.arrays)) {
    blocks.forEach((block, i) => {
      for (const key of Object.keys(block)) deploy.push(`[[${table}]][${i}] ${key}`);
    });
  }
  const report = [...tomlEntries(text).keys()];
  const a = deploy.slice().sort();
  const b = report.slice().sort();
  if (a.join('|') !== b.join('|')) {
    process.stderr.write(`${rel}: the two readers disagree\n  deploy-time parser: ${a.join(', ')}\n  divergence report:  ${b.join(', ')}\n`);
    process.exit(1);
  }
  if (a.length === 0) {
    process.stderr.write(`${rel}: the derived key set is empty, so agreement proves nothing\n`);
    process.exit(1);
  }
  if (a.some((label) => label.startsWith('[vars] '))) sawVars = true;
  checked += 1;
}
if (checked === 0) {
  process.stderr.write('no committed worker template was compared\n');
  process.exit(1);
}
if (!sawVars) {
  process.stderr.write('no [vars] key was compared, so the table-scoped label form is untested\n');
  process.exit(1);
}
process.stdout.write(`${checked} worker template(s) compared\n`);
EOF
  out="$(node "$TMP/toml-key-view.mjs" "$ROOT" "$DIVERGENCE_HELPER_SRC" 2>&1)" \
    || fail "case 15e: the divergence report's TOML key view disagrees with the deploy-time parser: $out"
  ok "case 15e: the report's TOML key view matches scripts/deploy/wrangler-config.mjs ($out)"
}

# --- usage contract: the report refuses rather than guessing
case_divergence_usage() { # workdir
  local work="$1" fw inst
  fw="$work/fw"
  inst="$work/instance"
  mkdir -p "$work"
  build_divergence_framework "$fw"
  build_divergence_instance "$fw" "$inst" "divergence usage" clean

  run_divergence "$inst" report
  [ "$HELPER_STATUS" -eq 2 ] \
    || fail "divergence usage: report with no --target exited $HELPER_STATUS (expected 2); stderr: '$HELPER_ERR'"

  run_divergence "$inst" report --target no-such-tag
  [ "$HELPER_STATUS" -eq 1 ] \
    || fail "divergence usage: report --target no-such-tag exited $HELPER_STATUS (expected 1); stderr: '$HELPER_ERR'"
  printf '%s' "$HELPER_ERR" | grep -qi 'remedy' \
    || fail "divergence usage: the unknown-target diagnostic names no remedy: $HELPER_ERR"

  run_divergence "$inst" report --target fw-v2 --state whatever
  [ "$HELPER_STATUS" -eq 2 ] \
    || fail "divergence usage: an unknown flag exited $HELPER_STATUS (expected 2); stderr: '$HELPER_ERR'"

  run_divergence "$inst" bogus-subcommand
  [ "$HELPER_STATUS" -eq 2 ] \
    || fail "divergence usage: an unknown subcommand exited $HELPER_STATUS (expected 2); stderr: '$HELPER_ERR'"

  # The framework's own tree carries `.sekai-template`; there is no adopter
  # divergence to report there, and reporting one would be a fiction.
  run_divergence "$fw" report --target fw-v2
  [ "$HELPER_STATUS" -eq 2 ] \
    || fail "divergence usage: report in a template checkout exited $HELPER_STATUS (expected 2); stderr: '$HELPER_ERR'"
  printf '%s' "$HELPER_ERR" | grep -Fq '.sekai-template' \
    || fail "divergence usage: the template-mode refusal does not name the marker it saw: $HELPER_ERR"
  ok "divergence usage: missing --target, unknown target, unknown flag, unknown subcommand, and template mode all refuse"
}

# ---------------------------------------------------------------------------
# Documented-bootstrap contract — the flags the adopter-facing docs tell a user to
# run must be flags the helper actually accepts.
#
# The prose in `.agents/skills/sekai-upgrade/SKILL.md` and
# `docs/runbook/UPGRADE.md` states something about this code: which options the
# first-upgrade bootstrap passes. Derive that statement from the option parser
# instead of trusting it (guard-or-explain: a doc that states a CLI form must fail
# CI when the CLI changes under it).
# ---------------------------------------------------------------------------
UPGRADE_DOCS="$ROOT/.agents/skills/sekai-upgrade/SKILL.md $ROOT/docs/runbook/UPGRADE.md"

# The accepted options of ONE command, read out of the helper's COMMAND_OPTIONS
# literal. Scoping the extraction to that block is load-bearing: the helper's source
# is full of single-quoted git arguments (`--quiet`, `--verify`, `--ignore-unmatch`,
# `--no-edit`, ...), and a grep over the whole file would report them as accepted CLI
# options, so the guard would pass on a document telling a user to run a command that
# exits 2. Per command, because `--from-tag` is deliberately not an option of
# `reconcile`.
# The helper source defaults to the maintainer-doc helper, because that is the one
# most callers here ask about; the divergence report passes its own, since both
# helpers declare a COMMAND_OPTIONS table in the same shape and both are invoked by
# the same two documents.
accepted_options_for() { # command [helper-source]
  awk -v cmd="$1" '
    /^const COMMAND_OPTIONS = \{/ { inblock = 1; next }
    inblock && /^\};/            { inblock = 0 }
    inblock && $0 ~ ("^  " cmd ": \\{")  { print }
  ' "${2:-$MDOCS_HELPER_SRC}" | grep -o -- "'--[a-z-]*'" | tr -d "'" | sort -u
}

case_documented_flags_exist() {
  local doc line cmd flag flags accepted used probe

  # Non-vacuity: the helper really does contain single-quoted arguments that are NOT
  # CLI options. Pin one, so a derivation that widens back to "every quoted string"
  # is caught here rather than by a user whose documented command exits 2.
  probe='--ignore-unmatch'
  grep -q -- "'$probe'" "$MDOCS_HELPER_SRC" \
    || fail "documented flags: the non-vacuity probe '$probe' is gone from the helper; pin another internal git argument"
  for cmd in classify reconcile paths; do
    if accepted_options_for "$cmd" | grep -qx -- "$probe"; then
      fail "documented flags: '$cmd' accepts the internal git argument $probe, so the option set is not derived from COMMAND_OPTIONS"
    fi
  done
  ok "documented flags: the derived option set excludes the helper's internal git arguments"

  # `--from-tag` belongs to classify and not to reconcile; derive both facts rather
  # than restating them, so the table and this guard cannot disagree.
  accepted_options_for classify | grep -qx -- '--from-tag' \
    || fail "documented flags: COMMAND_OPTIONS no longer gives classify --from-tag"
  if accepted_options_for reconcile | grep -qx -- '--from-tag'; then
    fail "documented flags: COMMAND_OPTIONS gives reconcile --from-tag; reconcile must derive from the merged tree"
  fi

  for doc in $UPGRADE_DOCS; do
    [ -f "$doc" ] || fail "documented flags: $doc is missing"
    used=""
    # Every line that INVOKES the helper. Both documents bootstrap it into a
    # `$MDOCS_HELPER` variable first, so matching the filename instead would pick up
    # the `git rev-parse --git-dir` on the extraction line.
    while IFS= read -r line; do
      [ -n "$line" ] || continue
      cmd="$(printf '%s' "$line" | sed -n 's/.*node "\$MDOCS_HELPER" *\([a-z][a-z-]*\).*/\1/p')"
      [ -n "$cmd" ] || fail "documented flags: $(basename "$doc") invokes the helper with no subcommand: $line"
      accepted="$(accepted_options_for "$cmd")"
      # `|| true`: an invocation with no options is normal (`reconcile` takes none
      # here), and a grep that matches nothing exits 1, which `set -e` would turn
      # into a silent abort of the whole run.
      flags="$(printf '%s' "$line" | grep -o -- '--[a-z-]*' || true)"
      for flag in $flags; do
        printf '%s\n' "$accepted" | grep -qx -- "$flag" \
          || fail "documented flags: $(basename "$doc") tells the user to pass $flag to \`$cmd\`, which its option table does not accept"
      done
      used="$used $cmd:$(printf '%s' "$flags" | paste -sd ',' -)"
    done <<EOF
$(grep -- 'node "$MDOCS_HELPER"' "$doc")
EOF
    [ -n "$used" ] || fail "documented flags: $(basename "$doc") has no helper invocation to check"
    case "$used" in
      *"classify:"*"--from-tag"*) ;;
      *) fail "documented flags: $(basename "$doc") no longer passes --from-tag to classify, so the first-upgrade bootstrap it documents cannot derive the path set" ;;
    esac
  done
  ok "documented flags: both upgrade documents pass only options the invoked command accepts, and both still pass --from-tag to classify"

  # The same derivation for the divergence report: both documents invoke it, and
  # `--target` is the option the whole step depends on, so a rename that left the
  # prose behind would print a usage error at the one moment it is read.
  accepted_options_for report "$DIVERGENCE_HELPER_SRC" | grep -qx -- '--target' \
    || fail "documented flags: the divergence helper's COMMAND_OPTIONS no longer gives report --target"
  for doc in $UPGRADE_DOCS; do
    used=""
    while IFS= read -r line; do
      [ -n "$line" ] || continue
      cmd="$(printf '%s' "$line" | sed -n 's/.*node "\$DIVERGENCE_HELPER" *\([a-z][a-z-]*\).*/\1/p')"
      [ -n "$cmd" ] || fail "documented flags: $(basename "$doc") invokes the divergence helper with no subcommand: $line"
      accepted="$(accepted_options_for "$cmd" "$DIVERGENCE_HELPER_SRC")"
      flags="$(printf '%s' "$line" | grep -o -- '--[a-z-]*' || true)"
      for flag in $flags; do
        printf '%s\n' "$accepted" | grep -qx -- "$flag" \
          || fail "documented flags: $(basename "$doc") tells the user to pass $flag to \`$cmd\`, which the divergence helper's option table does not accept"
      done
      used="$used $cmd:$(printf '%s' "$flags" | paste -sd ',' -)"
    done <<EOF
$(grep -- 'node "$DIVERGENCE_HELPER"' "$doc")
EOF
    [ -n "$used" ] || fail "documented flags: $(basename "$doc") never invokes the divergence report, so the pre-merge step ADR 010 (e) requires is undocumented there"
    case "$used" in
      *"report:"*"--target"*) ;;
      *) fail "documented flags: $(basename "$doc") does not pass --target to the divergence report, so it cannot name the release being merged" ;;
    esac
  done
  ok "documented flags: both upgrade documents invoke the divergence report with --target and no option it rejects"
}

# The framework-owned roots the report walks are a statement the adopter-facing
# documents also make. Derive it from the helper rather than trusting the prose: a
# root added to the helper without a document update leaves an adopter reading a list
# that is missing the tree their edit is in.
case_divergence_roots_documented() {
  local doc root
  [ "$(printf '%s\n' "$FRAMEWORK_OWNED_ROOTS" | wc -l | tr -d ' ')" -ge 2 ] \
    || fail "divergence roots: fewer than two roots were derived, so this check proves nothing"
  for doc in $UPGRADE_DOCS; do
    [ -f "$doc" ] || fail "divergence roots: $doc is missing"
    # Non-vacuity: the pattern must be able to fail. A root nothing declares must not
    # be found by the same grep that finds the real ones.
    if grep -Fq '`no-such-framework-root/`' "$doc"; then
      fail "divergence roots: $(basename "$doc") matches a root that does not exist, so the probe below is meaningless"
    fi
    for root in $FRAMEWORK_OWNED_ROOTS; do
      grep -Fq "\`$root/\`" "$doc" \
        || fail "divergence roots: $(basename "$doc") does not name the framework-owned root \`$root/\` the report walks"
    done
  done
  ok "divergence roots: both upgrade documents name every root the helper reports"
}

# The parser must enforce what the table declares, not merely describe it.
case_reconcile_rejects_from_tag() { # workdir
  local work="$1" inst
  inst="$work/instance"
  mkdir -p "$work"
  init_repo "$inst"
  lay_instance_skeleton "$inst"
  write_instance_agents_md "$inst/AGENTS.md" no-reference
  git -C "$inst" add -A
  git -C "$inst" commit -q -m "Example instance"

  run_mdocs "$inst" reconcile --from-tag fw-v2
  [ "$HELPER_STATUS" -eq 2 ] \
    || fail "reconcile options: reconcile --from-tag exited $HELPER_STATUS (expected 2); stdout: '$HELPER_OUT'; stderr: '$HELPER_ERR'"
  printf '%s' "$HELPER_ERR" | grep -qi 'merged' \
    || fail "reconcile options: the rejection does not explain that reconcile derives from the merged tree: $HELPER_ERR"
  ok "reconcile options: reconcile --from-tag exits 2 and explains the merged-tree derivation"

  run_mdocs "$inst" classify --from-tag no-such-tag
  [ "$HELPER_STATUS" -eq 3 ] \
    || fail "reconcile options: classify --from-tag on an unknown tag exited $HELPER_STATUS (expected 3); stderr: '$HELPER_ERR'"
  ok "reconcile options: classify --from-tag on an unknown tag exits 3, not a silent empty set"
}

# ---------------------------------------------------------------------------
# Runners
# ---------------------------------------------------------------------------

run_all_cases() {
  echo "── case 0: reconcile usage contract ──"
  case_usage_errors "$TMP/case0"
  echo ""
  echo "── case 1: stripped instance, shared history ──"
  case_stripped_shared_history "$TMP/case1"
  echo ""
  echo "── case 2: stripped instance, unrelated history, first framework merge ──"
  case_stripped_unrelated_history "$TMP/case2"
  echo ""
  echo "── case 3: installed instance, adopter dev-plugin state preserved ──"
  case_installed_preserved "$TMP/case3"
  echo ""
  echo "── case 4: mixed — dev-plugin tree present, reference absent ──"
  case_mixed_tree_without_reference "$TMP/case4"
  echo ""
  echo "── case 5: mixed — active reference, dev-plugin tree absent ──"
  case_mixed_reference_without_tree "$TMP/case5"
  echo ""
  echo "── case 6: maintainer docs — stripped instance, shared history ──"
  case_mdocs_stripped_shared_history "$TMP/case6"
  echo ""
  echo "── case 7: maintainer docs — stripped instance, unrelated history, first merge ──"
  case_mdocs_stripped_unrelated_history "$TMP/case7"
  echo ""
  echo "── case 8: maintainer docs — fully owned instance, protected ──"
  case_mdocs_owned_preserved "$TMP/case8"
  echo ""
  echo "── case 9: maintainer docs — declaration relocated across the upgrade (per path, no stop) ──"
  case_mdocs_declaration_relocated "$TMP/case9"
  echo ""
  echo "── case 10: maintainer docs — owned but unclaimed (must stop); unconfigured driver (must restore) ──"
  case_mdocs_owned_unprotected "$TMP/case10"
  echo ""
  echo "── case 11: maintainer docs — first upgrade to the release that introduces the strip list ──"
  case_mdocs_first_upgrade_from_tag "$TMP/case11"
  echo ""
  echo "── case 12: FRAMEWORK-VERSION survives the merge, bumps only after verification ──"
  case_framework_version_survives_merge "$TMP/case12"
  echo ""
  echo "── case 12c: an instance that had NO FRAMEWORK-VERSION does not gain one ──"
  case_framework_version_absent_stays_absent "$TMP/case12c"
  echo ""
  echo "── case 13: helper version skew — the bootstrap runs the target tag's helper ──"
  case_helper_bootstrap_version_skew "$TMP/case13"
  echo ""
  echo "── case 14: maintainer docs — the instance kept the framework's copy verbatim (ours == base) ──"
  case_mdocs_owned_ours_equals_base "$TMP/case14"
  echo ""
  echo "── case 15a/15b: divergence report — planted divergence, both values, no writes ──"
  case_divergence_report "$TMP/case15a"
  echo ""
  echo "── case 15c: divergence report — an instance with no framework-owned edit ──"
  case_divergence_clean "$TMP/case15c"
  echo ""
  echo "── case 15d: divergence report — unrelated histories claim no divergence ──"
  case_divergence_unrelated_history "$TMP/case15d"
  echo ""
  echo "── case 15e: divergence report — the TOML key view matches the deploy-time parser ──"
  case_divergence_toml_key_view
  echo ""
  echo "── case 15f: divergence report — a converged path is settled, not a conflict ──"
  case_divergence_converged "$TMP/case15f"
  echo ""
  echo "── option contract: the divergence report refuses rather than guessing ──"
  case_divergence_usage "$TMP/case15-usage"
  echo ""
  echo "── option contract: reconcile rejects --from-tag ──"
  case_reconcile_rejects_from_tag "$TMP/case-options"
  echo ""
  echo "── documented bootstrap: the docs' helper options are options the parser accepts ──"
  case_documented_flags_exist
  echo ""
  echo "── documented roots: the docs name every framework-owned root the report walks ──"
  case_divergence_roots_documented
  echo ""
  echo "✅ upgrade-state check passed: dev-plugin state (stripped / installed / mixed exit 3), maintainer-doc state (per-path owned / stripped, ours==base restore, unclaimed-path stop, tag-derived first upgrade), the FRAMEWORK-VERSION bump contract, present and absent, the tag-first helper bootstrap, and the pre-merge divergence report (both values, no writes, clean, unrelated-history, and converged shapes) hold on every fixture above."
}

# Run one case with its load-bearing step skipped, in a subshell whose EXIT trap is
# cleared (the parent owns $TMP cleanup). The case MUST fail. `SKIP_RECONCILE` is the
# toggle every case reads: `reconcile` for the three state helpers, the report itself
# for the report-only divergence helper, which has no reconcile.
expect_case_to_fail() { # fn workdir label
  echo "── selftest: $3 with its load-bearing step SKIPPED (must FAIL) ──"
  local status=0
  ( trap - EXIT; SKIP_RECONCILE=1; "$1" "$2" ) || status=$?
  if [ "$status" -eq 0 ]; then
    echo "❌ SELFTEST FAILED: $3 PASSED with that step skipped — the case cannot detect the regression it guards (vacuous test)." >&2
    exit 1
  fi
  echo "✓ selftest: $3 fails without it (exit $status) — the case is non-vacuous"
  echo ""
}

run_selftest() {
  echo "Selftest: proving the reconcile-dependent cases are non-vacuous."
  echo "Expect ❌ lines below — they are the deliberately-broken runs being caught."
  echo ""
  expect_case_to_fail case_stripped_shared_history "$TMP/selftest-case1" "case 1 (stripped, shared history)"
  expect_case_to_fail case_stripped_unrelated_history "$TMP/selftest-case2" "case 2 (stripped, unrelated history)"
  expect_case_to_fail case_mdocs_stripped_shared_history "$TMP/selftest-case6" "case 6 (maintainer docs, stripped, shared history)"
  expect_case_to_fail case_mdocs_stripped_unrelated_history "$TMP/selftest-case7" "case 7 (maintainer docs, stripped, unrelated history)"
  expect_case_to_fail case_mdocs_owned_preserved "$TMP/selftest-case8" "case 8 (maintainer docs, fully owned)"
  expect_case_to_fail case_mdocs_declaration_relocated "$TMP/selftest-case9" "case 9 (maintainer docs, declaration relocated)"
  expect_case_to_fail case_mdocs_owned_unprotected "$TMP/selftest-case10" "case 10 (maintainer docs, owned but unclaimed / driver unconfigured)"
  expect_case_to_fail case_mdocs_first_upgrade_from_tag "$TMP/selftest-case11" "case 11 (maintainer docs, first upgrade from tag)"
  expect_case_to_fail case_framework_version_survives_merge "$TMP/selftest-case12" "case 12 (FRAMEWORK-VERSION survives the merge)"
  expect_case_to_fail case_framework_version_absent_stays_absent "$TMP/selftest-case12c" "case 12c (absent FRAMEWORK-VERSION stays absent)"
  expect_case_to_fail case_helper_bootstrap_version_skew "$TMP/selftest-case13" "case 13 (helper version skew)"
  expect_case_to_fail case_mdocs_owned_ours_equals_base "$TMP/selftest-case14" "case 14 (maintainer docs, ours == base)"
  expect_case_to_fail case_divergence_report "$TMP/selftest-case15a" "case 15a (divergence report, planted divergence)"
  # 15f asserts mostly ABSENCES (no conflict claim, no empty differing region), and an
  # empty report satisfies every absence trivially. Running it here proves the case
  # still rests on what the report must SAY, so it cannot decay into a test that a
  # helper printing nothing at all would pass.
  expect_case_to_fail case_divergence_converged "$TMP/selftest-case15f" "case 15f (divergence report, converged path)"
  echo "✅ SELFTEST OK: cases 1, 2, 6, 7, 8, 9, 10, 11, 12, 12c, 13, 14, 15a and 15f all fail when their load-bearing step is skipped."
}

main() {
  case "${1:-}" in
    --selftest) run_selftest ;;
    "")         run_all_cases ;;
    *)          echo "usage: bash scripts/upgrade/check-upgrade-state.sh [--selftest]" >&2; exit 2 ;;
  esac
}

main "${1:-}"
