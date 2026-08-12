#!/usr/bin/env bash
#
# check-genericity.sh — the genericity gate.
#
# Fails if any place-specific string leaks into framework-owned code (src/,
# scripts/, tests/, workers/, or .agents/skills/). Place identity must flow ONLY through
# place.config.ts, knowledge/, and public/media/ — never hardcoded in code trees
# (ADR 002, SPEC §Negative requirements, §G risk 2). This is the structural
# mitigation for the trap that motivated the whole rebuild.
#
# Scan scope, instance mode: src/, scripts/, tests/, workers/, .agents/skills/;
# test fixtures are code, Worker source is code, and framework skills are
# agent-executed prose that is code for doctrine purposes — the whole-project
# doctrine, STRATEGIC-DIRECTION 2026-07-11 (b), task 5.6. The English-only gate
# (check-english-only.mjs) currently enumerates the same five roots, but each gate
# derives and states its own list: they are never merged into one claim, so either
# can gain a root without the other (scripts/ci/check-scan-root-docs.mjs gates both
# statements against their own script).
# place.config.ts (repo root), knowledge/, public/media/, and docs/
# hold place identity legitimately and are outside the scan roots by
# construction; the denylist file itself is inside scripts/ and is excluded
# explicitly (it necessarily contains the forbidden terms).
#
# Usage: bash scripts/ci/check-genericity.sh   (run from anywhere; exit 1 on hit)

set -euo pipefail

# Unset CDPATH: with it set, `cd` echoes the resolved dir into the command
# substitution and corrupts ROOT.
unset CDPATH
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." >/dev/null 2>&1 && pwd)"
DENYLIST="$ROOT/scripts/ci/genericity-denylist.txt"
# Instance-owned additions (written by `npm run init` with the adopter's place
# name, LB-27). Read ADDITIVELY: the framework denylist above stays
# framework-owned, so upgrades never conflict with local terms.
LOCAL_DENYLIST="$ROOT/scripts/ci/genericity-denylist.local.txt"

if [ ! -f "$DENYLIST" ]; then
  echo "genericity: denylist not found at $DENYLIST" >&2
  exit 2
fi

DENYLIST_FILES=("$DENYLIST")
[ -f "$LOCAL_DENYLIST" ] && DENYLIST_FILES+=("$LOCAL_DENYLIST")

# Build an alternation pattern from the denylists (drop comments/blank lines,
# join with |). Avoids `mapfile` so the script runs on macOS bash 3.2 as well as
# CI; grep -h suppresses filename prefixes when reading multiple files.
PATTERN="$(grep -vhE '^[[:space:]]*(#|$)' "${DENYLIST_FILES[@]}" | paste -sd '|' -)"
if [ -z "$PATTERN" ]; then
  echo "genericity: denylist is empty — nothing to check" >&2
  exit 0
fi

# Template mode vs instance mode (LB-26). The `.sekai-template` marker at the repo
# root means this checkout IS the sekai-kb template, which ships zero real-place
# content — so the denylist scan runs over the WHOLE tree, not just code trees.
# `npm run init` deletes the marker on adoption, reverting to instance mode
# (code trees only), where knowledge/ + place.config.ts legitimately carry the
# adopter's place identity.
if [ -f "$ROOT/.sekai-template" ]; then
  SCAN_ROOTS=("$ROOT")
  MODE="template (whole tree)"
else
  # Scan roots (skip any that don't exist yet).
  SCAN_ROOTS=()
  [ -d "$ROOT/src" ] && SCAN_ROOTS+=("$ROOT/src")
  [ -d "$ROOT/scripts" ] && SCAN_ROOTS+=("$ROOT/scripts")
  [ -d "$ROOT/tests" ] && SCAN_ROOTS+=("$ROOT/tests")
  [ -d "$ROOT/workers" ] && SCAN_ROOTS+=("$ROOT/workers")
  [ -d "$ROOT/.agents/skills" ] && SCAN_ROOTS+=("$ROOT/.agents/skills")
  MODE="instance (src/, scripts/, tests/, workers/, .agents/skills/)"
  if [ "${#SCAN_ROOTS[@]}" -eq 0 ]; then
    echo "✓ genericity gate passed — no src/, scripts/, tests/, workers/, or .agents/skills/ to scan"
    exit 0
  fi
fi

# Build the file list with `find` (prune dirs, then grep the survivors), rather
# than `grep -r --exclude-dir`. `--exclude-dir` matches on the directory BASENAME
# on both GNU and BSD grep, which can silently exempt an unrelated directory with
# the same name. The two exclusion classes are therefore matched differently:
#  - Vendor/tool caches (node_modules, .git, dist, .astro, .venv, __pycache__):
#    pruned by basename — no legitimate framework dir ever carries these names,
#    anywhere in the tree. .git is critical in template mode — commit messages
#    carry the pre-cut place name.
#  - The derived, gitignored projections of knowledge/ (src/content via sync.sh,
#    src/data via prebuild JSON, public/kb via build-kb-index): pruned by PATH,
#    so a same-basename directory elsewhere is still scanned.
#  - The denylist files (they necessarily contain the forbidden terms), the
#    template marker, and the derived worker artifacts are dropped by filename:
#    workers/*/wrangler.generated.toml (written by npm run worker-config — it
#    carries the instance's own origin and worker names by design) and
#    workers/chat/vectors.json (written by npm run embeddings:build — it carries
#    every article's title, url, and body text). Both are gitignored, and a
#    committed one would evade this skip only by being tracked, which
#    scripts/ci/check-worker-config.mjs fails on.
# grep -I skips binary files. -print0/xargs -0 handle any spaces in paths.
HITS="$(find "${SCAN_ROOTS[@]}" \
  \( -type d \( \
       -name node_modules -o -name .git -o -name dist -o -name .astro \
       -o -name .venv -o -name __pycache__ \
       -o -path '*/src/content' -o -path '*/src/data' -o -path '*/public/kb' \
     \) -prune \) \
  -o \( -type f \
       ! -name genericity-denylist.txt \
       ! -name genericity-denylist.local.txt \
       ! -name .sekai-template \
       ! -name wrangler.generated.toml \
       ! -name vectors.json \
       -print0 \) \
  | xargs -0 grep -HniIE "$PATTERN" 2>/dev/null || true)"

if [ -n "$HITS" ]; then
  echo "❌ genericity gate FAILED [$MODE] — denylisted place strings found:" >&2
  echo "$HITS" >&2
  echo >&2
  echo "Place identity belongs in place.config.ts / knowledge/ / public/media/, not framework-owned code." >&2
  exit 1
fi

echo "✓ genericity gate passed [$MODE] — no denylisted terms"
