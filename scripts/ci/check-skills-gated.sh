#!/usr/bin/env bash
#
# check-skills-gated.sh — self-test for the non-obvious instance-mode scan roots.
#
# Proves that BOTH machine gates (check-genericity.sh and check-english-only.mjs)
# scan .agents/skills/ AND workers/ in INSTANCE mode (task 5.6 DoD-3; LB-69 DoD-8).
# Neither root is source code in the ordinary sense: a framework skill is
# agent-executed prose and a Worker is deployed separately from the site build.
# Both are code for the genericity + English-only doctrine, so a place string or
# CJK codepoint leaking into either must fail CI the same way it does in src/.
#
# Why instance mode specifically: the `.sekai-template` marker switches both
# gates to a whole-tree scan that would catch a planted string regardless of
# SCAN_ROOTS. This test hides the marker so the failure it observes can only come
# from each directory being an explicit instance-mode scan root — which is the
# behavior an adopter (marker removed by `npm run init`) relies on.
#
# Deriving the roots from the scripts is a different assertion, and
# check-scan-root-docs.mjs already makes it: it fails when a root leaves SCAN_ROOTS
# or when the prose disagrees with it. What it cannot show is that a root in the
# array is actually reached by the scan — a pruned path or a mis-built find
# expression would keep the array honest and the scan blind. That is what these
# plants prove.
#
# The plants live inside real framework directories (.agents/skills/sekai-kb/, the
# router; workers/feedback/, the feedback Worker) instead of unrelated scratch
# roots, so the test exercises the trees the gates actually protect.
#
# Portable to macOS bash 3.2 and CI bash 5 (no mapfile; CDPATH unset; the CJK
# byte is written via octal so this script's own source stays pure ASCII and
# passes the gate it tests).
#
# Usage: bash scripts/ci/check-skills-gated.sh   (run from anywhere; exit 1 on
# a gate that fails to catch the plant, exit 0 when both catch it)

set -euo pipefail

unset CDPATH
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." >/dev/null 2>&1 && pwd)"
cd "$ROOT"

DENYLIST="$ROOT/scripts/ci/genericity-denylist.txt"
GEN_GATE="$ROOT/scripts/ci/check-genericity.sh"
CJK_GATE="$ROOT/scripts/ci/check-english-only.mjs"
SKILLS_ROOT="$ROOT/.agents/skills"
LEGACY_SKILLS_ROOT="$ROOT/.agent/skills"
WORKERS_ROOT="$ROOT/workers"
MARKER="$ROOT/.sekai-template"
MARKER_BAK="$ROOT/.sekai-template.selftest-bak"
# Plant inside real framework directories, not fresh uniquely named roots. Each
# entry is "<label>|<file to plant>"; bash 3.2 has no associative arrays.
PLANT_SITES="\
.agents/skills/sekai-kb/|$SKILLS_ROOT/sekai-kb/__gate_selftest__.md
workers/feedback/|$WORKERS_ROOT/feedback/__gate_selftest__.md"

if [ ! -d "$SKILLS_ROOT" ]; then
  echo "skills-gate self-test: Codex discovery root .agents/skills is missing" >&2
  exit 1
fi
if [ -e "$LEGACY_SKILLS_ROOT" ]; then
  echo "skills-gate self-test: legacy undiscoverable root .agent/skills still exists" >&2
  exit 1
fi
if [ ! -d "$WORKERS_ROOT/feedback" ]; then
  echo "skills-gate self-test: workers/feedback is missing — nothing to plant in" >&2
  exit 1
fi

# First real denylist term (skip comments/blank lines). Derived at runtime, never
# hardcoded, so this script's own source carries no forbidden place string.
PLANT_TERM="$(grep -vE '^[[:space:]]*(#|$)' "$DENYLIST" | head -1 | tr -d '[:space:]')"
if [ -z "$PLANT_TERM" ]; then
  echo "skills-gate self-test: denylist has no term to plant with — cannot run" >&2
  exit 2
fi

restore() {
  echo "$PLANT_SITES" | while IFS='|' read -r _label scratch; do
    [ -n "$scratch" ] && rm -f "$scratch"
  done
  [ -f "$MARKER_BAK" ] && mv "$MARKER_BAK" "$MARKER"
  return 0
}
trap restore EXIT

# Force INSTANCE mode by hiding the template marker (restored on exit).
[ -f "$MARKER" ] && mv "$MARKER" "$MARKER_BAK"

# Baseline: on a clean instance tree (no scratch), both gates must PASS. Guards
# against a pre-existing hit masking the real assertion below.
if ! bash "$GEN_GATE" >/dev/null 2>&1; then
  echo "skills-gate self-test: genericity gate fails on a clean instance tree — cannot trust the test" >&2
  exit 1
fi
if ! node "$CJK_GATE" >/dev/null 2>&1; then
  echo "skills-gate self-test: english-only gate fails on a clean instance tree — cannot trust the test" >&2
  exit 1
fi

# One root at a time, so a gate that catches the plant in one root cannot mask a
# blind spot in the other. A here-string (not a pipe) keeps the loop in this shell,
# so `exit 1` below really ends the script.
CHECKED=""
while IFS='|' read -r LABEL SCRATCH; do
  [ -n "$SCRATCH" ] || continue

  # Plant a denylisted place string and a CJK codepoint (U+4E2D, UTF-8 bytes
  # 0xE4 0xB8 0xAD, written via octal so this script's source stays pure ASCII).
  {
    printf 'name: gate-selftest scratch — %s\n' "$PLANT_TERM"
    printf 'cjk: \344\270\255\n'
  } > "$SCRATCH"

  # The genericity gate must now FAIL (place string under $LABEL).
  if bash "$GEN_GATE" >/dev/null 2>&1; then
    echo "❌ skills-gate self-test: genericity gate did NOT catch '$PLANT_TERM' in $LABEL (instance mode)" >&2
    exit 1
  fi

  # The english-only gate must now FAIL (CJK codepoint under $LABEL).
  if node "$CJK_GATE" >/dev/null 2>&1; then
    echo "❌ skills-gate self-test: english-only gate did NOT catch a CJK codepoint in $LABEL (instance mode)" >&2
    exit 1
  fi

  # Remove this plant before the next root, so the next iteration's failure can
  # only come from its own plant.
  rm -f "$SCRATCH"
  if ! bash "$GEN_GATE" >/dev/null 2>&1 || ! node "$CJK_GATE" >/dev/null 2>&1; then
    echo "skills-gate self-test: a gate still fails after removing the plant in $LABEL" >&2
    exit 1
  fi

  CHECKED="$CHECKED $LABEL"
done <<< "$PLANT_SITES"

echo "✓ skills-gate self-test passed — both gates scan$CHECKED in instance mode ('$PLANT_TERM' + CJK caught in each)"
