#!/usr/bin/env bash
#
# check-scan-root-docs-selftest.sh -- non-vacuity proof for the scan-root docs
# gate (scripts/ci/check-scan-root-docs.mjs).
#
# A guard that only ever asserts the green path proves nothing: it would pass
# just as happily with an empty registry or an unreachable comparison. This test
# mutates the repository three ways and requires the guard to FAIL each time,
# then restores every file it touched:
#
#   1. DOC drift    -- drop a root from a documented list. The statement no
#                      longer enumerates its gate's roots.
#   2. SCRIPT drift -- add a root to check-english-only.mjs's SCAN_ROOTS. Every
#                      English-only statement is now short one root, which is the
#                      direction that actually happens (a new tree is added and
#                      the prose is not updated).
#   3. ANCHOR loss  -- reword a registered statement so its anchor no longer
#                      matches. An unfindable statement must fail, never pass
#                      silently, because that is how a stale one hides.
#
# Between mutations the guard must pass on the restored tree, so a mutation that
# fails to apply cannot masquerade as a caught regression.
#
# Portable to macOS bash 3.2 and CI bash 5 (no mapfile; CDPATH unset; sed writes
# through a temp file rather than using the non-portable -i). This script's own
# source is pure ASCII and carries no denylisted place term -- it lives under
# scripts/, which both gates scan.
#
# Usage: bash scripts/ci/check-scan-root-docs-selftest.sh   (run from anywhere;
# exit 1 when the guard fails to catch a planted drift, exit 0 when it catches
# all three)

set -euo pipefail

unset CDPATH
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." >/dev/null 2>&1 && pwd)"
cd "$ROOT"

GUARD="$ROOT/scripts/ci/check-scan-root-docs.mjs"
RUNBOOK="$ROOT/docs/runbook/DEPLOY.md"
CJK_GATE="$ROOT/scripts/ci/check-english-only.mjs"

BAK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/scan-root-selftest.XXXXXX")"
cp "$RUNBOOK" "$BAK_DIR/DEPLOY.md"
cp "$CJK_GATE" "$BAK_DIR/check-english-only.mjs"

restore() {
  cp "$BAK_DIR/DEPLOY.md" "$RUNBOOK"
  cp "$BAK_DIR/check-english-only.mjs" "$CJK_GATE"
  rm -rf "$BAK_DIR"
  return 0
}
trap restore EXIT

OUT="$BAK_DIR/guard-output.txt"

# Replace the first occurrence of a literal string in a file (portable: sed -i
# differs between BSD and GNU, so write through a temp file).
substitute_once() {
  file="$1"; from="$2"; to="$3"
  sed "s|$from|$to|" "$file" > "$BAK_DIR/edit.tmp"
  cp "$BAK_DIR/edit.tmp" "$file"
  if cmp -s "$BAK_DIR/edit.tmp" "$BAK_DIR/$(basename "$file")"; then
    echo "scan-root docs self-test: mutation did not change $file -- the text this" >&2
    echo "  test plants against has moved; re-point the self-test." >&2
    exit 1
  fi
}

assert_guard_passes() {
  if ! node "$GUARD" >/dev/null 2>&1; then
    echo "scan-root docs self-test: the guard fails on a clean tree ($1) -- cannot" >&2
    echo "  trust the assertions below." >&2
    node "$GUARD" >&2 || true
    exit 1
  fi
}

# The guard must FAIL, and its output must name the file it is complaining about.
assert_guard_catches() {
  what="$1"; expect_file="$2"
  if node "$GUARD" > "$OUT" 2>&1; then
    echo "FAIL: scan-root docs self-test -- the guard did NOT catch $what" >&2
    cat "$OUT" >&2
    exit 1
  fi
  if ! grep -q "$expect_file" "$OUT"; then
    echo "FAIL: scan-root docs self-test -- the guard caught $what but its output" >&2
    echo "  never names $expect_file:" >&2
    cat "$OUT" >&2
    exit 1
  fi
}

assert_guard_passes "baseline"

# 1. DOC drift: drop workers/ from a documented root list in the runbook. Both
# gates enumerate workers/ today, so this plants the drift in whichever list the
# substitution reaches first; the guard must name the file either way.
substitute_once "$RUNBOOK" '`tests/`, `workers/`,' '`tests/`,'
assert_guard_catches "a root dropped from a documented list" "docs/runbook/DEPLOY.md"
restore_partial_runbook() { cp "$BAK_DIR/DEPLOY.md" "$RUNBOOK"; }
restore_partial_runbook
assert_guard_passes "after restoring the runbook"

# 2. SCRIPT drift: add a root to check-english-only.mjs's SCAN_ROOTS. Nothing in
# the guard knows the root names, so this proves the expectation is derived.
substitute_once "$CJK_GATE" "const SCAN_ROOTS = \['src'" "const SCAN_ROOTS = ['selftest-root', 'src'"
assert_guard_catches "a root added to the script's SCAN_ROOTS" "selftest-root"
cp "$BAK_DIR/check-english-only.mjs" "$CJK_GATE"
assert_guard_passes "after restoring the script"

# 3. ANCHOR loss: reword a registered statement so its anchor stops matching.
substitute_once "$RUNBOOK" 'English-only gate scans' 'English-only gate covers'
assert_guard_catches "a reworded (unfindable) statement" "docs/runbook/DEPLOY.md"
if ! grep -q "anchor NOT FOUND" "$OUT"; then
  echo "FAIL: scan-root docs self-test -- a reworded statement failed for the wrong" >&2
  echo "  reason (expected an anchor NOT FOUND diagnostic):" >&2
  cat "$OUT" >&2
  exit 1
fi
restore_partial_runbook
assert_guard_passes "after restoring the reworded statement"

echo "OK: scan-root docs self-test passed -- the guard catches doc drift, script SCAN_ROOTS drift, and a lost anchor"
