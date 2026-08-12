#!/usr/bin/env bash
#
# check-worker-config-selftest.sh -- non-vacuity proof for the worker config
# gate (scripts/ci/check-worker-config.mjs) and behavioral proof for the config
# generator (scripts/deploy/gen-worker-config.mjs).
#
# A guard that only ever asserts the green path proves nothing: it would pass
# just as happily with an empty file list or an unreachable comparison. This
# test plants eleven defect classes -- every kind of deployment identity that
# must never be committed, plus the worker the guard has never heard of, the
# template that lost a whole block, the derived artifacts that must never be
# tracked, and the four ways the runbook can stop telling the truth about a
# shipped default -- and requires the guard to FAIL each time:
#
#   1. ORIGIN        -- a real https origin in [vars] ALLOWED_ORIGIN. The
#                       template ships it empty; a real one is a deploy config
#                       committed as a template.
#   2. WORKER NAME   -- a place-named `name` in place of the framework
#                       placeholder. This is what a hand-edited deploy leaves
#                       behind, and it carries the instance's identity.
#   3. DATABASE NAME -- a place-named `database_name`, the same defect one key
#                       deeper, inside [[d1_databases]].
#   4. NEW WORKER    -- a worker directory the guard carries no expectation for.
#                       Coverage that a later phase's worker inherits by
#                       omission is no coverage: a new worker must be registered
#                       deliberately, so an unregistered one fails closed.
#   5. DROPPED D1    -- the [[d1_databases]] block deleted outright. Every check
#                       above is per-key, so a template with no block has no
#                       offending key to find; the generator then emits a deploy
#                       config with no database binding and the deployed worker
#                       hits `env.DB.prepare` with `env.DB` undefined. Absence
#                       must fail as loudly as a wrong value.
#   6. TRACKED DERIVED  -- a generated worker config and a generated embedding
#                       index committed to git. Both are gitignored AND skipped
#                       by name in the two machine gates, so a tracked one is
#                       invisible to every other check in this repository: this
#                       guard is the only thing standing between it and a
#                       release. The fixture is a real git repository, because
#                       the check reads `git ls-files`.
#   7. DROPPED AI       -- the chat worker's [ai] binding deleted outright. A
#                       deployed worker without it cannot call env.AI.run.
#   8. STALE DEFAULT -- docs/runbook/DEPLOY.md documenting a shipped constant
#                       the template no longer carries. The runbook is where an
#                       operator reads the value before tuning it, and a wrong
#                       number there reads exactly like a right one.
#   9. UNDOCUMENTED  -- a shipped default with no row in the runbook table. The
#                       same contract from the other end: a constant nobody can
#                       look up is a constant nobody can tune back.
#  10. DROPPED ANCHOR-- the <!-- worker-vars: --> comment removed. It is what
#                       ties a table to this gate, so deleting it must fail
#                       rather than quietly exempt the table.
#  11. DROPPED OVERRIDE -- the ", override `workers.<key>`" clause removed from a
#                       Source cell whose var an instance may retune. The runbook
#                       is where an operator is told to measure a value; a table
#                       that states the default and not where the answer goes
#                       sends them back to editing a framework-owned file.
#
# Classes 8-11 need a fixture carrying the runbook as well as workers/; the
# copies used by 1-7 have no docs/ tree, which also exercises the guard's
# skip-when-absent path.
#
# The classes after those cover the other half of the same contract: the
# GENERATOR (scripts/deploy/gen-worker-config.mjs) writing the deploy-time
# tuning vars an instance may override from place.config.ts. Nine more, plus the
# second worker's two (35-36, described after them):
#
#  12. UNSET       -- a place.config.ts setting none of the override keys must
#                     generate a config byte-identical to the one recorded in
#                     scripts/ci/fixtures/worker-config-<worker>-unset.toml, which
#                     was produced before that worker's keys were registered. That
#                     is what makes the absent-safe claim checkable rather than
#                     asserted: a stray formatting change, a reordered key, or
#                     an override that fires when its key is unset all fail here.
#  13. SET         -- all three keys set to non-default values must reach the
#                     generated [vars] block quoted the way the template writes
#                     them, and must change NOTHING else: exactly three lines
#                     differ from the recorded unset output.
#  14-19. REJECTED -- a non-numeric value, a floor outside 0..1, each rate limit
#                     below 1, a fractional count, and a non-finite number must
#                     fail generation by name. The worker parses these vars
#                     leniently and falls back to its own defaults, so a value it
#                     cannot use would otherwise deploy clean and behave as if the
#                     instance had configured nothing. Every one of these asserts
#                     the message names the offending VALUE as well as the key:
#                     19 exists because Infinity is the one input where the
#                     obvious way to render it (JSON.stringify) silently reports
#                     "null" instead, naming a value the config does not contain.
#  20. DROPPED VAR -- a key set in place.config.ts whose [vars] entry the template
#                     no longer carries. Generation must SUCCEED, warn naming the
#                     key, the value, and the var, and leave the var out of the
#                     generated config. An instance reaches this only by
#                     upgrading, and stopping generation there would leave it
#                     unable to deploy any worker over one stale key; the fatal
#                     half of the contract is check-worker-config.mjs, which
#                     fails at CI time on the same mismatch.
#
# Classes 12 and 13 above are stated per WORKER, not once for whichever one was
# registered first, and classes 35-36 are the second worker's half:
#
#  35. UNSET (feedback)  -- the absent-safe claim for the registry's second entry,
#                     against its own fixture recorded before its keys existed.
#  36. SET (feedback)    -- both registered keys reach that worker's [vars] with
#                     their exact values and change exactly two lines. The two
#                     workers ship identically NAMED vars, so this is also what
#                     proves the generator resolves an override by worker rather
#                     than by var name: the fixture sets different values on both
#                     workers at once, and a name-keyed lookup would write chat's
#                     into feedback's config.
#
# The validation classes 14-19 are NOT duplicated per worker. They exercise
# overrideVarValue(), which the generator reaches through one registry-driven loop
# (`for (const [varName, spec] of Object.entries(WORKER_VAR_OVERRIDES[dir] ?? {}))`)
# with the configKey and kind read from the registry row -- no worker name appears
# in that path, and class 36 proves the feedback rows reach it. A per-worker copy
# of each would assert the same function against the same `kind` values.
#
# The gate is MODE-GATED (ADR 010), so every GATE class above (1-11) is a
# TEMPLATE-mode class: each of those fixture copies is marked with a
# .sekai-template file, which is what the framework's own tree carries. (The
# generator classes 12-20 read no marker; that path has one behavior.) Classes
# 21-34 below are the instance-mode half --
# the same tree with no marker, standing in for an adopter's repository, where a
# framework gate may fail the build only for something that harms a party other
# than the person editing. There the identity classes must still exit 1 and the
# tuning classes must exit 0 WITH a warning. They are numbered after the generator
# classes rather than beside their template-mode twins so that no existing class
# number moves; nothing but this comment depends on the order.
#
#  21. MODE            -- the .sekai-template probe is resolved against --root, not
#                         against the guard's own location. If it were not, every
#                         instance-mode class below would silently exercise template
#                         mode and prove nothing, which is the one failure this
#                         suite could not otherwise detect: the assertions would all
#                         still pass.
#  22-29. FATAL        -- worker name, database_name, database_id, ALLOWED_ORIGIN, a
#                         dropped [[d1_databases]] block, an unparseable config, an
#                         unregistered worker directory, and a tracked derived
#                         artifact must exit 1 in an adopter's tree too. Identity is
#                         account-scoped and CORS is a security boundary: those
#                         collide with, or expose, someone other than the editor.
#                         27 and 24 have no template-mode twin above, so each
#                         asserts both modes itself.
#  30-31. WARN         -- a retuned [vars] constant registered in
#                         WORKER_VAR_OVERRIDES, and a [vars] key the adopter added
#                         that no registration covers, must exit 0 AND name the file,
#                         the key, both values, and the upgrade cost. Exit code alone
#                         would pass on a gate that had silently dropped the check,
#                         which is the vacuous-guard failure this whole file exists
#                         to prevent.
#  32. ANNOTATION      -- under GITHUB_ACTIONS the same warning is emitted as
#                         `::warning file=<path>::<message>`, so it reaches the run
#                         summary and the pull request rather than a log nobody
#                         opens. The line is echoed to this test's own stdout as
#                         well: the framework repository is always in template mode,
#                         so a CI run of this suite is the only place the annotation
#                         can actually be seen.
#  33. RUNBOOK         -- a drifted docs/runbook/DEPLOY.md default warns in an
#                         adopter's tree, where both the runbook and the template are
#                         their own files, and stays fatal in the framework's, which
#                         is what ships the table.
#  34. DELETED ORIGIN  -- ALLOWED_ORIGIN reached through the MISSING-key branch
#                         rather than the changed-value one of class 25. The two are
#                         separate branches in the gate, so class 25 leaves this one
#                         unguarded: with it absent, widening the tuning relaxation
#                         one branch too far would let an adopter delete their CORS
#                         boundary with a warning only, and every other class here
#                         would stay green. Fatal in both modes, so both are
#                         asserted.
#
# Unlike its sibling check-scan-root-docs-selftest.sh, this test never mutates
# the repository: each class gets a fresh copy of the committed workers/ tree in
# a temp directory and the guard is pointed at it with --root. Before each plant
# the guard must PASS on the unmutated copy, so a copy that is somehow already
# dirty cannot masquerade as a caught regression, and a substitution that
# silently no-ops fails this test loudly rather than leaving the guard nothing
# to catch.
#
# Nothing below hardcodes a worker directory: the template planted into is
# whichever committed wrangler.toml sorts first, and the path the guard's output
# must name is derived from it.
#
# Portable to macOS bash 3.2 and CI bash 5 (no mapfile; CDPATH unset; sed writes
# through a temp file rather than using the non-portable -i). This script's own
# source is pure ASCII and carries no denylisted place term -- it lives under
# scripts/, which both gates scan; the planted place names are invented.
#
# Usage: bash scripts/ci/check-worker-config-selftest.sh   (run from anywhere;
# exit 1 when the guard fails to catch a planted defect, classifies one into the
# wrong mode, or the generator mishandles an override; exit 0 when all
# thirty-six classes hold)

set -euo pipefail

unset CDPATH
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." >/dev/null 2>&1 && pwd)"
cd "$ROOT"

GUARD="$ROOT/scripts/ci/check-worker-config.mjs"
GENERATOR="$ROOT/scripts/deploy/gen-worker-config.mjs"

# Where one worker's generated config lands under a fixture root, and the
# recorded config the generator produced for it from the fixture place.config.ts
# below with none of the tuning keys set. There is one fixture per worker with
# registered overrides, and each was recorded from the generator as it stood
# BEFORE that worker's keys were registered -- which is the only thing that makes
# the UNSET classes regression tests rather than restatements of current behavior.
#
# Both are functions of the worker rather than constants, so the generator classes
# below run per worker instead of being pinned to whichever one was registered
# first. That is what lets the registry gain an entry without this suite proving
# the mechanism for only the original member.
generated_rel() { echo "workers/$1/wrangler.generated.toml"; }
expected_unset() { echo "$ROOT/scripts/ci/fixtures/worker-config-$1-unset.toml"; }

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/worker-config-selftest.XXXXXX")"
cleanup() {
  rm -rf "$WORK_DIR"
  return 0
}
trap cleanup EXIT

OUT="$WORK_DIR/guard-output.txt"

# The committed template this test plants its defects into, and the
# repository-relative path the guard is required to name when it complains.
TEMPLATE="$(find "$ROOT/workers" -type f -name 'wrangler.toml' | LC_ALL=C sort | sed -n '1p')"
if [ -z "$TEMPLATE" ]; then
  echo "worker config self-test: no committed wrangler.toml under workers/ -- the tree" >&2
  echo "  this test plants into has moved; re-point the self-test." >&2
  exit 1
fi
REL="${TEMPLATE#$ROOT/}"

# Run the guard, capturing stdout+stderr. An empty root means: no --root, i.e.
# the repository the guard lives in.
run_guard() {
  where="$1"
  if [ -z "$where" ]; then
    node "$GUARD" > "$OUT" 2>&1
  else
    node "$GUARD" --root "$where" > "$OUT" 2>&1
  fi
}

# A fresh copy of the committed workers/ tree, echoed as a root the guard can be
# pointed at. Any wrangler.generated.toml a local `npm run worker-config` left
# behind is dropped, so the fixture equals a clean checkout on every machine.
fresh_copy() {
  label="$1"
  copy="$WORK_DIR/$label"
  mkdir -p "$copy"
  cp -R "$ROOT/workers" "$copy/workers"
  find "$copy/workers" -type f -name 'wrangler.generated.toml' -exec rm -f {} +
  echo "$copy"
}

# The same fixture plus the runbook, for the classes that plant into the
# documented defaults rather than into a template.
RUNBOOK_REL="docs/runbook/DEPLOY.md"
fresh_copy_with_runbook() {
  label="$1"
  copy="$(fresh_copy "$label")"
  mkdir -p "$copy/$(dirname "$RUNBOOK_REL")"
  cp "$ROOT/$RUNBOOK_REL" "$copy/$RUNBOOK_REL"
  echo "$copy"
}

# A copy in TEMPLATE mode. `fresh_copy` above produces an INSTANCE-mode fixture --
# the marker is a real file in the framework's tree and `cp -R "$ROOT/workers"`
# does not bring it along -- so the mode of every fixture is stated here, at the
# fixture, rather than left to what a copy happens to inherit.
TEMPLATE_MARKER=".sekai-template"
fresh_copy_template() {
  copy="$(fresh_copy "$1")"
  : > "$copy/$TEMPLATE_MARKER"
  echo "$copy"
}
fresh_copy_with_runbook_template() {
  copy="$(fresh_copy_with_runbook "$1")"
  : > "$copy/$TEMPLATE_MARKER"
  echo "$copy"
}

# Rewrite the copied runbook with `filter` applied to it (sed or grep), and fail
# loudly when that changes nothing: text this test plants against that has moved
# would otherwise hand the guard a compliant file to pass on.
plant_runbook() {
  copy="$1"; what="$2"; shift 2
  target="$copy/$RUNBOOK_REL"
  "$@" < "$target" > "$WORK_DIR/plant.tmp" || true
  if cmp -s "$WORK_DIR/plant.tmp" "$target"; then
    echo "worker config self-test: planting [$what] changed nothing in $RUNBOOK_REL --" >&2
    echo "  the text this test plants against has moved; re-point the self-test." >&2
    exit 1
  fi
  cp "$WORK_DIR/plant.tmp" "$target"
}

assert_guard_passes() {
  where="$1"; label="$2"
  if ! run_guard "$where"; then
    echo "worker config self-test: the guard fails on a clean tree ($label) -- cannot" >&2
    echo "  trust the assertions below." >&2
    cat "$OUT" >&2
    exit 1
  fi
  if ! grep -q '^OK:' "$OUT"; then
    echo "worker config self-test: the guard passed on a clean tree ($label) without an" >&2
    echo "  OK: summary line:" >&2
    cat "$OUT" >&2
    exit 1
  fi
}

# The guard must FAIL, say so, and name the file it is complaining about. The
# third argument overrides which path that is; it defaults to the planted
# template.
assert_guard_catches() {
  where="$1"; what="$2"; expect="${3:-$REL}"
  if run_guard "$where"; then
    echo "FAIL: worker config self-test -- the guard did NOT catch $what" >&2
    cat "$OUT" >&2
    exit 1
  fi
  if ! grep -q '^FAIL:' "$OUT"; then
    echo "FAIL: worker config self-test -- the guard exited nonzero on $what without a" >&2
    echo "  FAIL: line:" >&2
    cat "$OUT" >&2
    exit 1
  fi
  if ! grep -q "$expect" "$OUT"; then
    echo "FAIL: worker config self-test -- the guard caught $what but its output never" >&2
    echo "  names $expect:" >&2
    cat "$OUT" >&2
    exit 1
  fi
}

# The guard must PASS (exit 0) and WARN about $what, naming every remaining
# argument. Both halves are asserted: an exit-code-only check would pass just as
# happily on a gate that had stopped looking at the file, and a warning nobody can
# read is the same as no warning at all.
assert_guard_warns() {
  where="$1"; what="$2"; shift 2
  if ! run_guard "$where"; then
    echo "FAIL: worker config self-test -- the guard FAILED the build on $what. In an" >&2
    echo "  adopter's tree this is a divergence that costs only the person who made it," >&2
    echo "  so it must warn and exit 0 (ADR 010)." >&2
    cat "$OUT" >&2
    exit 1
  fi
  if ! grep -q '^WARN:' "$OUT"; then
    echo "FAIL: worker config self-test -- the guard exited 0 on $what without a WARN:" >&2
    echo "  line. A silently ignored divergence is indistinguishable from a dropped check:" >&2
    cat "$OUT" >&2
    exit 1
  fi
  for want in "$@"; do
    if ! grep -qF -- "$want" "$OUT"; then
      echo "FAIL: worker config self-test -- the guard warned about $what but its output" >&2
      echo "  never names $want:" >&2
      cat "$OUT" >&2
      exit 1
    fi
  done
}

# The mode the guard reports for a root. This is what makes DoD 5 checkable: the
# guard prints its mode on both the OK: and the FAIL: line, so a --root probe that
# resolved against the guard's own location instead would be visible here rather
# than silently turning every instance-mode class below into a template-mode one.
assert_guard_mode() {
  where="$1"; want="$2"
  run_guard "$where" || true
  if ! grep -qF -- "($want mode)" "$OUT"; then
    echo "FAIL: worker config self-test -- the guard does not report \"$want mode\" for" >&2
    echo "  $where. The .sekai-template probe must resolve against --root:" >&2
    cat "$OUT" >&2
    exit 1
  fi
}

# Commit $WORK_DIR/plant.tmp over the copied template. An edit that changes
# nothing means the shipped file no longer carries the text this test plants
# against, which must fail loudly instead of handing the guard a compliant file
# to pass on.
commit_plant() {
  target="$1"; what="$2"
  if cmp -s "$WORK_DIR/plant.tmp" "$target"; then
    echo "worker config self-test: planting [$what] changed nothing in $REL -- the text" >&2
    echo "  this test plants against has moved; re-point the self-test." >&2
    exit 1
  fi
  cp "$WORK_DIR/plant.tmp" "$target"
}

# Replace a literal line in the copied template (portable: sed -i differs
# between BSD and GNU, so write through a temp file).
plant() {
  copy="$1"; from="$2"; to="$3"
  target="$copy/$REL"
  sed "s|$from|$to|" "$target" > "$WORK_DIR/plant.tmp"
  commit_plant "$target" "$from"
}

# Insert $3 immediately after the first line equal to $2 in the copied template.
# awk rather than `sed 's/x/x\ny/'`: a newline in a sed replacement is written
# differently on BSD and GNU sed, and this file runs on both.
insert_after() {
  copy="$1"; after="$2"; line="$3"
  target="$copy/$REL"
  awk -v after="$after" -v line="$line" '
    { print }
    $0 == after && done != 1 { print line; done = 1 }
  ' "$target" > "$WORK_DIR/plant.tmp"
  commit_plant "$target" "$after"
}

# Delete the first line equal to $2 from the copied template. Deleting a key is a
# different defect from changing one -- the gate reaches each on its own branch --
# so a class that plants a deletion cannot be written with `plant` above.
drop_line() {
  copy="$1"; line="$2"
  target="$copy/$REL"
  awk -v line="$line" '
    $0 == line && dropped != 1 { dropped = 1; next }
    { print }
  ' "$target" > "$WORK_DIR/plant.tmp"
  commit_plant "$target" "$line"
}

# Delete a whole [[table]] block from the copied template: the header line and
# every line after it up to the next table header or end of file.
drop_table() {
  copy="$1"; header="$2"
  target="$copy/$REL"
  awk -v header="$header" '
    $0 == header { skip = 1; next }
    skip == 1 && substr($0, 1, 1) == "[" { skip = 0 }
    skip == 1 { next }
    { print }
  ' "$target" > "$WORK_DIR/plant.tmp"
  commit_plant "$target" "$header"
}

assert_guard_passes "" "the shipped tree"

# 1. ORIGIN: a real deploy origin committed in [vars]. The generated config is
# where place.domain belongs; the template ships ALLOWED_ORIGIN empty.
COPY="$(fresh_copy_template origin)"
assert_guard_passes "$COPY" "an unmutated copy of the shipped workers/ tree"
plant "$COPY" 'ALLOWED_ORIGIN = ""' 'ALLOWED_ORIGIN = "https://kb.harborbend.example"'
assert_guard_catches "$COPY" "a real origin committed in [vars]"

# 2. WORKER NAME: a place-named `name` where the framework placeholder belongs.
COPY="$(fresh_copy_template worker-name)"
assert_guard_passes "$COPY" "an unmutated copy of the shipped workers/ tree"
plant "$COPY" '^name = "REPLACE_VIA_NPM_RUN_WORKER_CONFIG"' 'name = "harborbend-feedback"'
assert_guard_catches "$COPY" "a place-named worker name"

# 3. DATABASE NAME: the same identity leak one key deeper, in [[d1_databases]].
COPY="$(fresh_copy_template database-name)"
assert_guard_passes "$COPY" "an unmutated copy of the shipped workers/ tree"
plant "$COPY" '^database_name = "REPLACE_VIA_NPM_RUN_WORKER_CONFIG"' 'database_name = "harborbend-feedback"'
assert_guard_catches "$COPY" "a place-named database_name"

# 4. NEW WORKER: a second worker directory, byte-identical to the compliant
# template, that the guard carries no expectation for. Copied rather than
# written from a heredoc so it is compliant by construction: the only thing
# wrong with it is that nobody registered it.
COPY="$(fresh_copy_template new-worker)"
assert_guard_passes "$COPY" "an unmutated copy of the shipped workers/ tree"
NEW_WORKER="$COPY/workers/selftest-unregistered"
mkdir -p "$NEW_WORKER"
cp "$COPY/$REL" "$NEW_WORKER/wrangler.toml"
assert_guard_catches "$COPY" "a worker directory with no registered expectation" \
  "workers/selftest-unregistered/wrangler.toml"

# 5. DROPPED D1: the whole [[d1_databases]] block removed. No key is wrong
# because no key is left, so only a registered block count catches it.
COPY="$(fresh_copy_template dropped-d1)"
assert_guard_passes "$COPY" "an unmutated copy of the shipped workers/ tree"
drop_table "$COPY" '[[d1_databases]]'
assert_guard_catches "$COPY" "a deleted [[d1_databases]] block"

# 6. TRACKED DERIVED: both generated artifacts committed. The check reads
# `git ls-files`, so the fixture must be a real repository -- staged is enough,
# no commit needed. The copies above are not repositories, which is exactly why
# this class needs its own fixture rather than riding along with one of them.
COPY="$(fresh_copy_template tracked-derived)"
git -C "$COPY" init -q
assert_guard_passes "$COPY" "a git repository with no derived artifact tracked"
FEEDBACK_WORKER="$(dirname "$COPY/$REL")"
printf 'name = "planted"\n' > "$FEEDBACK_WORKER/wrangler.generated.toml"
mkdir -p "$COPY/workers/chat"
printf '{"schema":"rag-v1","count":0}\n' > "$COPY/workers/chat/vectors.json"
git -C "$COPY" add -A
assert_guard_catches "$COPY" "a tracked generated worker config" \
  "$(basename "$FEEDBACK_WORKER")/wrangler.generated.toml"
assert_guard_catches "$COPY" "a tracked generated embedding index" \
  "workers/chat/vectors.json"

# 7. DROPPED AI: the registered chat worker must keep the Workers AI binding.
COPY="$(fresh_copy_template dropped-ai)"
assert_guard_passes "$COPY" "an unmutated copy of the shipped workers/ tree"
drop_table "$COPY" '[ai]'
assert_guard_catches "$COPY" "a deleted [ai] block"

# 8. STALE DEFAULT: the runbook documenting a constant the template does not
# ship. Nothing else in this repository compares the two.
COPY="$(fresh_copy_with_runbook_template stale-default)"
assert_guard_passes "$COPY" "an unmutated copy carrying the runbook"
plant_runbook "$COPY" 'a retuned default' \
  sed 's|template (`0.46`)|template (`0.9`)|'
assert_guard_catches "$COPY" "a documented default the template does not ship" "$RUNBOOK_REL"

# 9. UNDOCUMENTED: a shipped default with no row to read it from.
COPY="$(fresh_copy_with_runbook_template undocumented-default)"
assert_guard_passes "$COPY" "an unmutated copy carrying the runbook"
plant_runbook "$COPY" 'a deleted default row' grep -v 'RELEVANCE_FLOOR'
assert_guard_catches "$COPY" "a shipped default the runbook documents nowhere" "$RUNBOOK_REL"

# 10. DROPPED ANCHOR: the comment that ties a table to this gate, removed.
COPY="$(fresh_copy_with_runbook_template dropped-anchor)"
assert_guard_passes "$COPY" "an unmutated copy carrying the runbook"
plant_runbook "$COPY" 'a deleted table anchor' grep -v 'worker-vars: chat'
assert_guard_catches "$COPY" "a deleted worker-vars anchor" "$RUNBOOK_REL"

# 11. DROPPED OVERRIDE: the Source cell still states the right default, but no
# longer says where a retuned value goes. Only the override cross-check catches
# it; every value comparison above still passes.
COPY="$(fresh_copy_with_runbook_template dropped-override)"
assert_guard_passes "$COPY" "an unmutated copy carrying the runbook"
plant_runbook "$COPY" 'a deleted override key' \
  sed 's|template (`0.46`), override `workers.chatRelevanceFloor`|template (`0.46`)|'
assert_guard_catches "$COPY" "a Source cell that no longer names its override key" "$RUNBOOK_REL"

# -- The generator's override path ------------------------------------------
#
# Everything above points the GATE at a mutated tree. Everything below runs the
# GENERATOR against a fixture place.config.ts and reads what it wrote.

# A fixture root: the committed workers/ tree plus a place.config.ts whose
# `workers` block is exactly the lines passed as $2 (empty for none). The place
# name and domain are invented -- this file lives under scripts/, which both
# machine gates scan.
fresh_copy_with_place_config() {
  label="$1"; workers_body="$2"
  copy="$(fresh_copy "$label")"
  {
    echo 'const config = {'
    echo "  place: { name: 'Selftest Place', domain: 'selftest.example' },"
    echo '  categories: [],'
    echo '  workers: {'
    if [ -n "$workers_body" ]; then printf '%s\n' "$workers_body"; fi
    echo '  },'
    echo '};'
    echo 'export default config;'
  } > "$copy/place.config.ts"
  echo "$copy"
}

# Node needs the type-stripping flag to import a .ts config, the same way the
# `npm run worker-config` script passes it.
run_generator() {
  where="$1"
  node --experimental-strip-types "$GENERATOR" --root "$where" > "$OUT" 2>&1
}

assert_generator_succeeds() {
  where="$1"; label="$2"
  if ! run_generator "$where"; then
    echo "worker config self-test: the generator failed on $label -- cannot trust the" >&2
    echo "  assertions that read its output:" >&2
    cat "$OUT" >&2
    exit 1
  fi
}

# The generator must FAIL and name both the offending place.config.ts key and
# the value it rejected. Naming only one leaves an operator guessing which of
# three keys they mistyped.
assert_generator_rejects() {
  where="$1"; what="$2"; want_key="$3"; want_value="$4"
  if run_generator "$where"; then
    echo "FAIL: worker config self-test -- the generator ACCEPTED $what. The worker falls" >&2
    echo "  back to its own default for a value it cannot parse, so this would deploy" >&2
    echo "  clean and behave as if nothing had been configured." >&2
    cat "$OUT" >&2
    exit 1
  fi
  for want in "$want_key" "$want_value"; do
    if ! grep -q -- "$want" "$OUT"; then
      echo "FAIL: worker config self-test -- the generator rejected $what but its output" >&2
      echo "  never names $want:" >&2
      cat "$OUT" >&2
      exit 1
    fi
  done
}

# The generator must SUCCEED and say every remaining argument. Used for the path
# where a value cannot be applied but generation must still finish: a silent drop
# and a hard stop are both wrong, so both the success and the words are asserted.
assert_generator_warns() {
  where="$1"; what="$2"; shift 2
  if ! run_generator "$where"; then
    echo "FAIL: worker config self-test -- the generator STOPPED on $what. It must warn," >&2
    echo "  drop the value, and finish: an instance reaches this by upgrading, and a stop" >&2
    echo "  leaves it unable to deploy any worker over one stale key." >&2
    cat "$OUT" >&2
    exit 1
  fi
  for want in "$@"; do
    if ! grep -q -- "$want" "$OUT"; then
      echo "FAIL: worker config self-test -- the generator continued past $what but its" >&2
      echo "  output never names $want:" >&2
      cat "$OUT" >&2
      exit 1
    fi
  done
}

assert_generated_var() {
  where="$1"; worker="$2"; key="$3"; want="$4"
  rel="$(generated_rel "$worker")"
  if ! grep -q "^$key = $want\$" "$where/$rel" 2>/dev/null; then
    echo "FAIL: worker config self-test -- $rel does not carry" >&2
    echo "  $key = $want. The override never reached the generated [vars] block:" >&2
    cat "$where/$rel" >&2
    exit 1
  fi
}

# UNSET, for one worker: with none of its tuning keys set, the generated config
# must equal the recorded pre-override output byte for byte. An override that
# fires on an unset key, or any incidental formatting drift, fails here rather
# than in someone's deploy.
assert_unset_byte_identical() {
  where="$1"; worker="$2"
  rel="$(generated_rel "$worker")"; fixture="$(expected_unset "$worker")"
  if [ ! -f "$fixture" ]; then
    echo "worker config self-test: no recorded pre-override config for \"$worker\" at" >&2
    echo "  $fixture. A worker registered in WORKER_VAR_OVERRIDES needs one, recorded" >&2
    echo "  before its keys were registered; without it the absent-safe claim is asserted" >&2
    echo "  rather than checked." >&2
    exit 1
  fi
  if ! cmp -s "$where/$rel" "$fixture"; then
    echo "FAIL: worker config self-test -- with no tuning key set, the generated $worker" >&2
    echo "  config is no longer byte-identical to the recorded pre-override output. Adding" >&2
    echo "  these keys must change nothing for an instance that sets none of them." >&2
    diff "$fixture" "$where/$rel" >&2 || true
    echo "  If the committed template legitimately changed, re-record the expectation:" >&2
    echo "    cp <a generated $worker config from this fixture> $fixture" >&2
    exit 1
  fi
}

# SET, for one worker: the generated config differs from that same recorded unset
# output on exactly $3 lines -- the overrides that were set, and nothing else.
assert_changed_lines() {
  where="$1"; worker="$2"; want="$3"
  rel="$(generated_rel "$worker")"; fixture="$(expected_unset "$worker")"
  changed="$(diff "$fixture" "$where/$rel" | grep -c '^>' || true)"
  if [ "$changed" != "$want" ]; then
    echo "FAIL: worker config self-test -- setting the $worker tuning keys changed $changed" >&2
    echo "  line(s) in its generated config; exactly $want must change." >&2
    diff "$fixture" "$where/$rel" >&2 || true
    exit 1
  fi
}

# 12. UNSET (chat): the absent-safe case, proven byte for byte against output
# recorded before these keys existed.
COPY="$(fresh_copy_with_place_config generate-unset "")"
assert_generator_succeeds "$COPY" "a place.config.ts setting no tuning overrides"
assert_unset_byte_identical "$COPY" chat

# 35. UNSET (feedback): the same claim for the registry's second entry, against a
# fixture recorded before the feedback keys were registered. The two workers share
# one generator loop, but "shared code, therefore correct for both" is the
# assumption this class exists to stop being an assumption: the loop reads
# `WORKER_VAR_OVERRIDES[dir]`, and a registration that named the wrong var or the
# wrong worker would leave chat's classes green and change this worker's output.
# The unset copy generates every worker at once, so this reads the same fixture
# root class 12 does rather than building a second one.
assert_unset_byte_identical "$COPY" feedback

# 13. SET (chat): all three reach [vars] with their exact values, quoted as TOML
# strings the way the template writes them, and nothing else moves.
COPY="$(fresh_copy_with_place_config generate-set "    chatRateLimitMax: 60,
    chatRateLimitWindowSeconds: 900,
    chatRelevanceFloor: 0.52,")"
assert_generator_succeeds "$COPY" "a place.config.ts setting all three tuning overrides"
assert_generated_var "$COPY" chat 'RATE_LIMIT_MAX' '"60"'
assert_generated_var "$COPY" chat 'RATE_LIMIT_WINDOW_SECONDS' '"900"'
assert_generated_var "$COPY" chat 'RELEVANCE_FLOOR' '"0.52"'
assert_changed_lines "$COPY" chat 3

# 36. SET (feedback): both registered keys reach the feedback worker's [vars] with
# their exact TOML-quoted values, and exactly two lines move. The count is what
# makes this more than a spot check: the two workers' templates carry identically
# NAMED vars (RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SECONDS), so a generator that
# resolved an override by var name instead of by worker would write chat's values
# here too -- passing every `assert_generated_var` above while changing more lines
# than were set. The chat keys are set to different values in the same fixture for
# exactly that reason.
COPY="$(fresh_copy_with_place_config generate-set-feedback "    chatRateLimitMax: 60,
    chatRateLimitWindowSeconds: 900,
    feedbackRateLimitMax: 25,
    feedbackRateLimitWindowSeconds: 1800,")"
assert_generator_succeeds "$COPY" "a place.config.ts setting both feedback tuning overrides"
assert_generated_var "$COPY" feedback 'RATE_LIMIT_MAX' '"25"'
assert_generated_var "$COPY" feedback 'RATE_LIMIT_WINDOW_SECONDS' '"1800"'
assert_changed_lines "$COPY" feedback 2

# 14. NON-NUMERIC: the declared type is a number; anything else is a typo that
# must not survive to a deploy.
COPY="$(fresh_copy_with_place_config generate-bad-type "    chatRateLimitMax: 'sixty',")"
assert_generator_rejects "$COPY" "a non-numeric override value" \
  'workers.chatRateLimitMax' 'sixty'

# 15. FLOOR OUT OF RANGE: it is compared against a cosine score, so a value
# above 1 is one no chunk can ever clear.
COPY="$(fresh_copy_with_place_config generate-bad-floor "    chatRelevanceFloor: 1.5,")"
assert_generator_rejects "$COPY" "a relevance floor outside 0..1" \
  'workers.chatRelevanceFloor' '1.5'

# 16. RATE LIMIT BELOW 1: not a smaller budget, a worker that rejects everyone.
COPY="$(fresh_copy_with_place_config generate-bad-max "    chatRateLimitMax: 0,")"
assert_generator_rejects "$COPY" "a rate-limit ceiling below 1" \
  'workers.chatRateLimitMax' '0'

# 17. WINDOW BELOW 1: the same, one key over.
COPY="$(fresh_copy_with_place_config generate-bad-window "    chatRateLimitWindowSeconds: 0,")"
assert_generator_rejects "$COPY" "a rate-limit window below 1 second" \
  'workers.chatRateLimitWindowSeconds' '0'

# 18. FRACTIONAL COUNT: in range and numeric, so every check above passes it. The
# worker floors it, which means "20.7" deploys a ceiling of 20 while
# place.config.ts states something else -- the exact silent divergence this
# validation layer exists to prevent, and the one branch of it that shipped with
# no class of its own.
COPY="$(fresh_copy_with_place_config generate-fractional-max "    chatRateLimitMax: 20.7,")"
assert_generator_rejects "$COPY" "a fractional rate-limit ceiling" \
  'workers.chatRateLimitMax' '20.7'

# 19. NON-FINITE: Infinity is a number and passes `typeof`, so only the finite
# check stops it. It is asserted separately because it is the one value whose
# report is easy to get wrong: JSON.stringify(Infinity) is the string "null", so
# a message built that way names a value place.config.ts does not contain and
# sends the operator looking for a key they never set.
COPY="$(fresh_copy_with_place_config generate-non-finite "    chatRelevanceFloor: Infinity,")"
assert_generator_rejects "$COPY" "a non-finite override value" \
  'workers.chatRelevanceFloor' 'Infinity'

# 20. DROPPED VAR: the key is set and valid, but the template no longer carries
# the [vars] entry it overrides -- the shape of a framework release that removed
# a var an instance had tuned. Generation must finish, warn by name, and write a
# config without the var. Both failure modes are real: a silent drop deploys the
# framework default while place.config.ts says otherwise, and a hard stop blocks
# every other worker's config over one stale key.
COPY="$(fresh_copy_with_place_config generate-dropped-var "    chatRelevanceFloor: 0.52,")"
grep -v '^RELEVANCE_FLOOR' "$COPY/$REL" > "$WORK_DIR/plant.tmp"
commit_plant "$COPY/$REL" "RELEVANCE_FLOOR"
assert_generator_warns "$COPY" "a tuning key whose template var was removed" \
  'WARNING' 'workers.chatRelevanceFloor' '0.52' 'RELEVANCE_FLOOR' 'Generated without it'
CHAT_GENERATED="$(generated_rel chat)"
if grep -q '^RELEVANCE_FLOOR' "$COPY/$CHAT_GENERATED"; then
  echo "FAIL: worker config self-test -- the generator warned that it dropped the override" >&2
  echo "  but $CHAT_GENERATED carries RELEVANCE_FLOOR anyway:" >&2
  cat "$COPY/$CHAT_GENERATED" >&2
  exit 1
fi

# -- Instance mode -----------------------------------------------------------
#
# Everything above pointed the gate at a fixture carrying .sekai-template, i.e. the
# framework's own tree. Everything below removes it, which is the state of every
# adopted instance: the same guard, the same planted defects, a different verdict
# for the half of them that cost only the person who made the edit (ADR 010).

# 21. MODE: the marker probe resolves against --root. Asserted first and on its own,
# because a probe that resolved against the guard's own location would report
# template mode for every fixture below -- and every one of those classes would then
# pass while testing the wrong branch.
COPY="$(fresh_copy mode-instance)"
assert_guard_passes "$COPY" "a marker-less copy of the shipped workers/ tree"
assert_guard_mode "$COPY" "instance"
COPY="$(fresh_copy_template mode-template)"
assert_guard_passes "$COPY" "a copy carrying .sekai-template"
assert_guard_mode "$COPY" "template"

# 22. WORKER NAME: account-scoped. Two instances deploying the same script name
# collide inside one Cloudflare account, which is harm beyond the editor.
COPY="$(fresh_copy instance-worker-name)"
assert_guard_passes "$COPY" "an unmutated marker-less copy"
plant "$COPY" '^name = "REPLACE_VIA_NPM_RUN_WORKER_CONFIG"' 'name = "harborbend-feedback"'
assert_guard_catches "$COPY" "a place-named worker name in an instance"

# 23. DATABASE NAME: the same collision one key deeper.
COPY="$(fresh_copy instance-database-name)"
assert_guard_passes "$COPY" "an unmutated marker-less copy"
plant "$COPY" '^database_name = "REPLACE_VIA_NPM_RUN_WORKER_CONFIG"' 'database_name = "harborbend-feedback"'
assert_guard_catches "$COPY" "a place-named database_name in an instance"

# 24. DATABASE ID: an account-scoped identifier, and the one identity key with no
# template-mode class of its own above -- so this class asserts both modes.
COPY="$(fresh_copy instance-database-id)"
assert_guard_passes "$COPY" "an unmutated marker-less copy"
plant "$COPY" '^database_id = "REPLACE_VIA_NPM_RUN_WORKER_CONFIG"' 'database_id = "0f9c1a7e-planted"'
assert_guard_catches "$COPY" "a committed database_id in an instance"
COPY="$(fresh_copy_template template-database-id)"
assert_guard_passes "$COPY" "an unmutated copy carrying .sekai-template"
plant "$COPY" '^database_id = "REPLACE_VIA_NPM_RUN_WORKER_CONFIG"' 'database_id = "0f9c1a7e-planted"'
assert_guard_catches "$COPY" "a committed database_id in the template"

# 25. ALLOWED_ORIGIN: a [vars] key, and the ONE that stays fatal in instance mode.
# It is the workers' CORS boundary, so a committed one is a security decision made
# in a framework-owned file and shipped to whoever clones next -- not a tuning
# constant. If the [vars] relaxation below were written one line too wide, this is
# the class that catches it.
COPY="$(fresh_copy instance-origin)"
assert_guard_passes "$COPY" "an unmutated marker-less copy"
plant "$COPY" 'ALLOWED_ORIGIN = ""' 'ALLOWED_ORIGIN = "https://kb.harborbend.example"'
assert_guard_catches "$COPY" "a real origin committed in an instance"

# 26. DROPPED D1: the generator never adds a block, so the deployed worker would
# reach env.DB.prepare with env.DB undefined.
COPY="$(fresh_copy instance-dropped-d1)"
assert_guard_passes "$COPY" "an unmutated marker-less copy"
drop_table "$COPY" '[[d1_databases]]'
assert_guard_catches "$COPY" "a deleted [[d1_databases]] block in an instance"

# 27. UNPARSEABLE: a config this reader cannot parse is one nothing is checking --
# including nothing checking the identity keys above. Fatal in both modes for that
# reason, and neither mode had a class for it before, so both are asserted here.
COPY="$(fresh_copy instance-unparseable)"
assert_guard_passes "$COPY" "an unmutated marker-less copy"
insert_after "$COPY" 'main = "src/index.mjs"' 'this line is not a toml assignment'
assert_guard_catches "$COPY" "an unparseable config in an instance"
COPY="$(fresh_copy_template template-unparseable)"
assert_guard_passes "$COPY" "an unmutated copy carrying .sekai-template"
insert_after "$COPY" 'main = "src/index.mjs"' 'this line is not a toml assignment'
assert_guard_catches "$COPY" "an unparseable config in the template"

# 28. NEW WORKER: an unregistered worker directory is one whose `name` and
# `database_name` are checked by nothing at all, so exempting it by omission would
# reopen every identity class above.
COPY="$(fresh_copy instance-new-worker)"
assert_guard_passes "$COPY" "an unmutated marker-less copy"
NEW_WORKER="$COPY/workers/selftest-unregistered"
mkdir -p "$NEW_WORKER"
cp "$COPY/$REL" "$NEW_WORKER/wrangler.toml"
assert_guard_catches "$COPY" "an unregistered worker directory in an instance" \
  "workers/selftest-unregistered/wrangler.toml"

# 29. TRACKED DERIVED: both artifacts are gitignored and skipped by name in the two
# machine gates, so an instance that commits one has nothing else looking at it.
COPY="$(fresh_copy instance-tracked-derived)"
git -C "$COPY" init -q
assert_guard_passes "$COPY" "a marker-less git repository with no derived artifact tracked"
INSTANCE_WORKER="$(dirname "$COPY/$REL")"
printf 'name = "planted"\n' > "$INSTANCE_WORKER/wrangler.generated.toml"
mkdir -p "$COPY/workers/chat"
printf '{"schema":"rag-v1","count":0}\n' > "$COPY/workers/chat/vectors.json"
git -C "$COPY" add -A
assert_guard_catches "$COPY" "a tracked generated worker config in an instance" \
  "$(basename "$INSTANCE_WORKER")/wrangler.generated.toml"
assert_guard_catches "$COPY" "a tracked generated embedding index in an instance" \
  "workers/chat/vectors.json"

# 30. RETUNED TUNING VAR: the class this whole change exists for. A relevance floor
# an instance measured against its own corpus is theirs to set, so the build stays
# green -- and the warning has to carry enough to act on: the file, the key, both
# values, the upgrade cost, and the place.config.ts key that records the same value
# without ever conflicting.
COPY="$(fresh_copy instance-retuned-var)"
assert_guard_passes "$COPY" "an unmutated marker-less copy"
plant "$COPY" 'RELEVANCE_FLOOR = "0.46"' 'RELEVANCE_FLOOR = "0.52"'
assert_guard_warns "$COPY" "a retuned [vars] constant in an instance" \
  "$REL" 'RELEVANCE_FLOOR' '"0.52"' '"0.46"' '/sekai-upgrade' 'workers.chatRelevanceFloor'

# 31. ADOPTER-ADDED VAR: a [vars] key no registration covers. ADR 010 (d): in an
# adopter's tree that is the edit right this change grants, not a defect. There is
# no framework constant to name, so the warning says so rather than inventing one.
COPY="$(fresh_copy instance-added-var)"
assert_guard_passes "$COPY" "an unmutated marker-less copy"
insert_after "$COPY" 'RELEVANCE_FLOOR = "0.46"' 'ADOPTER_TUNING_KNOB = "1"'
assert_guard_warns "$COPY" "a [vars] key the adopter added" \
  "$REL" 'ADOPTER_TUNING_KNOB' 'no such key' '/sekai-upgrade'

# 32. ANNOTATION: under GITHUB_ACTIONS the same warning is also a workflow command,
# so it lands on the run summary and the pull request instead of only in a log. The
# framework repository is always in template mode, so this suite's own output is the
# only place a CI run can show one -- which is why the line is echoed below rather
# than only asserted.
COPY="$(fresh_copy instance-annotation)"
assert_guard_passes "$COPY" "an unmutated marker-less copy"
plant "$COPY" 'RELEVANCE_FLOOR = "0.46"' 'RELEVANCE_FLOOR = "0.52"'
if ! GITHUB_ACTIONS=true node "$GUARD" --root "$COPY" > "$OUT" 2>&1; then
  echo "FAIL: worker config self-test -- the guard failed the build on a retuned var" >&2
  echo "  under GITHUB_ACTIONS; the annotation must not change the verdict." >&2
  cat "$OUT" >&2
  exit 1
fi
if ! grep -q "^::warning file=$REL::" "$OUT"; then
  echo "FAIL: worker config self-test -- the guard warned about a retuned var but emitted" >&2
  echo "  no \"::warning file=$REL::\" annotation under GITHUB_ACTIONS. Without it the" >&2
  echo "  divergence reaches the log and nothing else:" >&2
  cat "$OUT" >&2
  exit 1
fi
# A workflow command must be one line: a raw newline would truncate the annotation
# at the first one and leave the rest as stray log text.
if [ "$(grep -c "^::warning file=$REL::" "$OUT")" != "1" ]; then
  echo "FAIL: worker config self-test -- expected exactly one annotation line for $REL:" >&2
  cat "$OUT" >&2
  exit 1
fi
echo "worker config self-test: the instance-mode annotation this suite asserts, echoed"
echo "  so a CI run of the template (always template mode) still shows one:"
grep "^::warning file=$REL::" "$OUT"

# 33. RUNBOOK DRIFT: docs/runbook/ is framework-owned, and in an adopter's tree both
# it and the template are their files. The framework is what ships the table to
# every adopter, so template mode stays fatal (class 8 above).
COPY="$(fresh_copy_with_runbook instance-stale-default)"
assert_guard_passes "$COPY" "an unmutated marker-less copy carrying the runbook"
plant_runbook "$COPY" 'a retuned default' \
  sed 's|template (`0.46`)|template (`0.9`)|'
assert_guard_warns "$COPY" "a drifted runbook default in an instance" \
  "$RUNBOOK_REL" '/sekai-upgrade'

# 34. DELETED ALLOWED_ORIGIN: the same security boundary as class 25, reached
# through the missing-key branch instead of the changed-value one. They are separate
# branches in the gate, and the relaxation that lets a [vars] key warn was written on
# both -- so without this class, widening the missing-key one by a line would let an
# adopter delete their CORS boundary with a warning only and leave this suite green.
# Deleting the key is not a way to pass either: the generator rewrites only keys the
# template already carries, so the deployed worker gets whatever its compiled-in
# fallback is rather than the origin the instance meant to allow. Fatal in both
# modes, and neither had a class for the deletion, so both are asserted here.
COPY="$(fresh_copy instance-deleted-origin)"
assert_guard_passes "$COPY" "an unmutated marker-less copy"
drop_line "$COPY" 'ALLOWED_ORIGIN = ""'
assert_guard_catches "$COPY" "a deleted ALLOWED_ORIGIN in an instance"
COPY="$(fresh_copy_template template-deleted-origin)"
assert_guard_passes "$COPY" "an unmutated copy carrying .sekai-template"
drop_line "$COPY" 'ALLOWED_ORIGIN = ""'
assert_guard_catches "$COPY" "a deleted ALLOWED_ORIGIN in the template"

echo "OK: worker config self-test passed -- in template mode the guard catches committed identity, unregistered workers, missing D1 or AI bindings, tracked derived artifacts, an unparseable config, and a runbook that has drifted from the shipped defaults; in instance mode it still fails on all of the identity and structural classes and warns, with both values and the upgrade cost, on the divergences that cost only the adopter; the generator carries the template through unchanged when no tuning key is set, writes each key that is set, resolves each override by worker rather than by var name across both registered workers, rejects a value the worker could not use, and warns rather than stops when a set key's template var is gone"
