#!/usr/bin/env bash
#
# check-init.sh — the init wizard's scripted self-check (LB-27 DoD 2/4/6).
#
# Tier 1 (always, non-destructive — runs on the COMMITTED tree via git archive):
#   1. Exports two scratch copies of HEAD and runs `--answers` init in each;
#      the two place.config.ts outputs must be byte-identical (cmp).
#   2. Runs the INTERACTIVE mode (piped stdin) on a third scratch copy with the
#      same answers; its place.config.ts must be byte-identical to the
#      `--answers` output. This is the DoD-2/§E contract (the two resolution
#      paths cannot drift), not just writer determinism.
#   3. Asserts every seeded artifact: VERSION, FRAMEWORK-VERSION, package identity,
#      the AGENTS.md header,
#      the CLAUDE.md @AGENTS.md shim, the README.md header, the instance-only
#      CHANGELOG.md, knowledge/{Category}/
#      dirs, INBOX.md, CNAME, the local genericity denylist, and the removed
#      .sekai-template marker.
#   3b. Asserts the ADR 008 maintainer-doc strip (ADR 009 form): dev_docs/ is
#      absent while docs/playbook/ and docs/runbook/ survive — then plants each
#      inverse against the same predicate and requires it to fail, so the absent
#      path cannot pass vacuously.
#   3b-ii. Asserts no file in the STRIPPED tree so much as names a stripped path.
#      The framework-docs gate proves this for the repository's own files, but it
#      exempts the wizard as a strip mechanism — and the wizard EMITS AGENTS.md and
#      README.md, whose template text is therefore unscanned. A stale line there
#      ships a dangling link to every adopter with nothing to catch it. Asserted
#      here because this is the only place a really-stripped tree exists.
#   3c. Asserts the demo-media strip: public/media/sounds/ and the soundscape
#      manifest are absent, and no audio file survives anywhere under public/,
#      while public/ itself survives — then plants each inverse and requires the
#      same predicate to fail, for the same non-vacuity reason as 3b.
#   4. Plants the test place name in src/ and asserts check-genericity.sh FAILS
#      (the local denylist is live); removes it and asserts the gate passes.
#
# Tier 2 (--build only — DESTRUCTIVE, runs init in THIS working tree, then
# `npm run build`): for CI and disposable clones only. The CI job passes
# --build; never pass it in a working tree you care about.
#
# Both tiers also run on ADOPTED INSTANCES (instances keep the init-check CI
# job, since they carry the wizard and receive framework upgrades). An adopted
# tree has no .sekai-template marker and has articles in knowledge/, so the
# wizard's re-run guard (index.mjs) would refuse it. The self-check tests the
# wizard, not the checkout's adoption state: it replants the marker before
# every init it runs, and init removes it again (asserted in tier 1).
#
# The test place name is assembled by concatenation below so that this script
# never contains it as a literal substring — post-init, the name is on the
# instance's local denylist, and this script lives inside the scanned scripts/
# tree of the scratch copies.
#
# Portability: macOS bash 3.2 + CI bash 5 (no mapfile, CDPATH unset).

set -euo pipefail
unset CDPATH
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." >/dev/null 2>&1 && pwd)"

BUILD=false
[ "${1:-}" = "--build" ] && BUILD=true

# "Test" + "haven": never a literal substring of this file (see header).
NAME="Test$(printf 'haven')"
NAME_LC="$(printf '%s' "$NAME" | tr '[:upper:]' '[:lower:]')"
DOMAIN="kb.example.org"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# The answers fixture is generated OUTSIDE the tree (same never-a-literal
# reason). Categories use an explicit array to exercise the custom path.
ANSWERS="$TMP/answers.json"
cat > "$ANSWERS" <<EOF
{
  "place": {
    "name": "$NAME",
    "tagline": "Knowledge base for $NAME, the init self-check place.",
    "domain": "$DOMAIN",
    "locale": "en"
  },
  "categories": [
    { "slug": "history", "title": "History", "icon": "X", "description": "The record" },
    { "slug": "harbor", "title": "Harbor", "icon": "X", "description": "The waterfront" },
    { "slug": "nature", "title": "Nature", "icon": "X", "description": "The land" },
    { "slug": "food", "title": "Food", "icon": "X", "description": "The table" },
    { "slug": "events", "title": "Events", "icon": "X", "description": "The calendar" }
  ],
  "map": { "center": [35.1, -120.65], "zoom": 12 },
  "features": { "soundscape": false, "social": true },
  "links": {
    "repo": "https://github.com/example/kb",
    "email": "kb@example.org",
    "social": { "twitter": "@example" }
  }
}
EOF

fail() {
  echo "❌ init-check FAILED: $1" >&2
  exit 1
}

# CLAUDE.md is a byte-level contract. Do not use command substitution here:
# shells strip trailing newlines, which would make `@AGENTS.md\n\n` look valid.
EXPECTED_CLAUDE_MD="$TMP/expected-CLAUDE.md"
printf '@AGENTS.md\n' > "$EXPECTED_CLAUDE_MD"

claude_shim_is_exact() {
  cmp -s "$1" "$EXPECTED_CLAUDE_MD"
}

assert_rejected_claude_shim() {
  if claude_shim_is_exact "$1"; then
    fail "CLAUDE.md byte comparator accepted invalid fixture: $2"
  fi
}

# ── ADR 008: framework maintainer docs are stripped, adopter doc trees survive ──
#
# Kept as a predicate (silent, exit status only) so the SAME code path can be run
# against planted inverse fixtures below. An assertion that cannot fail is not
# evidence, and a stripped-tree check is exactly the shape that passes vacuously.
MAINTAINER_DOCS="dev_docs"
ADOPTER_DOC_TREES="docs/playbook docs/runbook"

docs_correctly_stripped() {
  local tree="$1" rel
  for rel in $MAINTAINER_DOCS; do
    [ ! -e "$tree/$rel" ] || return 1
  done
  for rel in $ADOPTER_DOC_TREES; do
    [ -d "$tree/$rel" ] || return 1
  done
  return 0
}

# Plant a maintainer doc back into a fixture tree: a file for a .md path, a
# directory carrying a file otherwise (the predicate tests existence either way).
plant_maintainer_doc() {
  local tree="$1" rel="$2"
  case "$rel" in
    *.md) mkdir -p "$(dirname "$tree/$rel")"; printf 'planted\n' > "$tree/$rel" ;;
    *)    mkdir -p "$tree/$rel"; printf 'planted\n' > "$tree/$rel/planted.md" ;;
  esac
}

# ── ADR 009: what the wizard RENDERS may not name a stripped path ──
#
# This closes one specific hole, and it is worth being precise about which, because
# the obvious broader version of this check is wrong.
#
# check-framework-docs.mjs already proves that no surviving file links into a stripped
# path, and it carries the exemptions that claim needs: the strip mechanisms must name
# the paths in order to strip them, `.gitattributes` must name them in order to protect
# an instance's own documents there, and registered enumeration spans are masked. A scan
# here that ignored those exemptions would re-litigate a contract that already has a
# correct implementation, and would fail on files that are right.
#
# The genuine gap is REGENERATED_AT_ADOPTION. That gate exempts AGENTS.md, CLAUDE.md,
# README.md, and CHANGELOG.md because whatever the framework's copy says, the adopter's
# copy is freshly rendered by the wizard — and the wizard's template text lives inside
# writer.mjs, which the same gate exempts as a strip mechanism. So the framework copy is
# exempt for being regenerated, the template is exempt for being a mechanism, and the
# RENDERED result is the one artifact nobody checks. A stale path in a template reaches
# every adopter with nothing to catch it.
#
# The stripped tree is the only place that rendered text exists as a file, which is why
# the assertion lives here. Same predicate shape as above: silent, exit status only, so
# the planted inverse below can run it and require failure.
#
# This list mirrors check-framework-docs.mjs's REGENERATED_AT_ADOPTION. A file added to
# the wizard's renderers must be added here too: an unlisted rendered file is scanned by
# neither.
WIZARD_RENDERED_FILES="AGENTS.md CLAUDE.md README.md CHANGELOG.md"

stripped_tree_has_no_dangling_ref() {
  local tree="$1" rel file hits
  for rel in $MAINTAINER_DOCS; do
    for file in $WIZARD_RENDERED_FILES; do
      [ -f "$tree/$file" ] || continue
      hits="$(grep -lIF "$rel" "$tree/$file" 2>/dev/null || true)"
      [ -z "$hits" ] || {
        DANGLING_REF_HITS="$hits"
        DANGLING_REF_PATH="$rel"
        return 1
      }
    done
  done
  return 0
}

# ── Demo media: the synthesized soundscape clips are stripped at adoption ──
#
# Same predicate shape, and the same reason, as docs_correctly_stripped above: an
# assertion over absent paths passes on any tree at all, so the planted inverses
# below are what make it evidence. An adopted instance must start with no audio and
# no manifest — which is exactly the absent-manifest case /soundscape renders its
# empty state for.
DEMO_MEDIA="public/media/sounds"
SOUND_MANIFEST="knowledge/sounds/_manifest.md"
AUDIO_EXTS="mp3 m4a aac ogg opus wav flac"

# Any audio file anywhere under public/, so a demo clip that merely MOVED is still
# caught. Prints matches; callers use the exit status.
find_audio_under_public() {
  local tree="$1" ext args=()
  [ -d "$tree/public" ] || return 0
  for ext in $AUDIO_EXTS; do
    args+=(-o -iname "*.$ext")
  done
  # Drop the leading -o so the expression starts with a real predicate.
  find "$tree/public" -type f \( "${args[@]:1}" \) -print
}

demo_media_correctly_stripped() {
  local tree="$1"
  [ ! -e "$tree/$DEMO_MEDIA" ] || return 1
  [ ! -e "$tree/$SOUND_MANIFEST" ] || return 1
  [ -d "$tree/public" ] || return 1
  [ -z "$(find_audio_under_public "$tree")" ] || return 1
  return 0
}

# Plant one demo-media inverse: a real (empty) file at the given path, parents made.
plant_file() {
  local tree="$1" rel="$2"
  mkdir -p "$(dirname "$tree/$rel")"
  printf 'planted\n' > "$tree/$rel"
}

snapshot() {
  mkdir -p "$1"
  git -C "$ROOT" archive HEAD | tar -x -C "$1"
  # Replant the marker (see header): on an adopted instance, HEAD has no
  # .sekai-template and the re-run guard would refuse the scratch init.
  touch "$1/.sekai-template"
}

echo "── tier 1: double init on scratch copies of HEAD ──"
snapshot "$TMP/run1"
snapshot "$TMP/run2"
# Recorded BEFORE init: on the framework template HEAD carries the maintainer docs,
# so the strip assertion below has something real to prove. An adopted instance's
# HEAD carries none of them (the wizard removed them at adoption), where the planted
# inverse fixtures are the whole non-vacuity argument.
PRE_INIT_HAS_MAINTAINER_DOCS=false
if [ -e "$TMP/run1/$(set -- $MAINTAINER_DOCS; echo "$1")" ]; then
  PRE_INIT_HAS_MAINTAINER_DOCS=true
fi
# Same record for the demo media (see the demo-media block below): the framework
# template's HEAD ships the synthesized clips, so the strip assertion has something
# real to prove there. An adopted instance's HEAD carries none.
PRE_INIT_HAS_DEMO_AUDIO=false
if [ -n "$(find_audio_under_public "$TMP/run1")" ]; then
  PRE_INIT_HAS_DEMO_AUDIO=true
fi
node "$TMP/run1/scripts/init/index.mjs" --answers "$ANSWERS" >/dev/null
node "$TMP/run2/scripts/init/index.mjs" --answers "$ANSWERS" >/dev/null

# DoD-2 (determinism): byte-identical place.config.ts across --answers runs.
cmp "$TMP/run1/place.config.ts" "$TMP/run2/place.config.ts" \
  || fail "place.config.ts differs between two --answers runs (not byte-identical)"
echo "✓ two --answers runs produce byte-identical place.config.ts"
# The emitted config must typecheck against the interface emitted directly above
# it. Nothing in this repository runs a typechecker -- `npm run build` strips
# types through esbuild, and the tier-2 build below is that same build -- so an
# excess property in the object literal is invisible to every other assertion
# here. It is not hypothetical: the wizard shipped `og:` into both the `features`
# and `workers` literals while its own copy of the interface declared neither.
# This runs the gate's --generated mode against a REAL wizard run, which is the
# half of that contract a static comparison of the two sources cannot reach.
node --experimental-strip-types \
  "$TMP/run1/scripts/ci/check-place-config-interface.mjs" \
  --generated "$TMP/run1/place.config.ts" \
  || fail "the generated place.config.ts sets a property its own interface does not declare"
echo "✓ the generated place.config.ts declares every property it sets"
cmp "$TMP/run1/CHANGELOG.md" "$TMP/run2/CHANGELOG.md" \
  || fail "CHANGELOG.md differs between two --answers runs (not byte-identical)"
echo "✓ two --answers runs produce byte-identical instance changelogs"
cmp "$TMP/run1/package.json" "$TMP/run2/package.json" \
  || fail "package.json differs between two --answers runs (not byte-identical)"
cmp "$TMP/run1/package-lock.json" "$TMP/run2/package-lock.json" \
  || fail "package-lock.json differs between two --answers runs (not byte-identical)"
cmp "$TMP/run1/VERSION" "$TMP/run2/VERSION" \
  || fail "VERSION differs between two --answers runs (not byte-identical)"
cmp "$TMP/run1/FRAMEWORK-VERSION" "$TMP/run2/FRAMEWORK-VERSION" \
  || fail "FRAMEWORK-VERSION differs between two --answers runs (not byte-identical)"
echo "✓ two --answers runs produce byte-identical package and version artifacts"

# DoD-2 (cross-mode, the §E acceptance): the INTERACTIVE path with the same
# answers must produce the same bytes as --answers. resolveInteractive/parseText
# and resolveFromJson/coerce are parallel per-kind implementations — this is
# where drift would enter. Lines below mirror answers.json in prompt order;
# blank lines take the same defaults the JSON path takes for missing keys.
INPUT="$TMP/interactive-input.txt"
{
  printf '%s\n' "$NAME"                                            # place.name
  printf '%s\n' "Knowledge base for $NAME, the init self-check place."
  printf '%s\n' "$DOMAIN"                                          # place.domain
  printf '\n'                                                      # locale -> en
  printf '4\n'                                                     # categories: custom
  printf 'history\nHistory\nX\nThe record\n'
  printf 'harbor\nHarbor\nX\nThe waterfront\n'
  printf 'nature\nNature\nX\nThe land\n'
  printf 'food\nFood\nX\nThe table\n'
  printf 'events\nEvents\nX\nThe calendar\n'
  printf '\n'                                                      # blank slug: done
  printf '35.1,-120.65\n'                                          # map.center
  printf '12\n'                                                    # map.zoom
  printf '\n'                                                      # maxBounds -> default
  printf '\n\n\n'                                                  # graph/map/dashboard -> defaults
  printf 'n\n'                                                     # soundscape (explicit, as in JSON)
  printf '\n\n'                                                    # feedback/chat -> defaults
  printf 'y\n'                                                     # social (explicit, as in JSON)
  printf '\n'                                                      # analytics -> default
  printf '\n'                                                      # og -> default
  printf 'https://github.com/example/kb\n'                         # links.repo
  printf 'kb@example.org\n'                                        # links.email
  printf '@example\n'                                              # twitter
  printf '\n\n'                                                    # threads/instagram -> none
  printf '\n'                                                      # workers.feedback -> blank
  printf '\n'                                                      # workers.chat -> blank
  printf '\n'                                                      # workers.og -> blank
} > "$INPUT"
snapshot "$TMP/run3"
node "$TMP/run3/scripts/init/index.mjs" < "$INPUT" >/dev/null
cmp "$TMP/run3/place.config.ts" "$TMP/run1/place.config.ts" \
  || fail "interactive-mode place.config.ts differs from --answers output (cross-mode drift)"
echo "✓ interactive mode with the same answers is byte-identical to --answers"

# DoD-6: seeded artifacts exist.
R="$TMP/run1"
[ -f "$R/VERSION" ] || fail "VERSION not written"
[ "$(cat "$R/VERSION")" = "v0.0.0" ] || fail "VERSION is not initialized to v0.0.0"
[ -f "$R/FRAMEWORK-VERSION" ] || fail "FRAMEWORK-VERSION not written"
[ -s "$R/FRAMEWORK-VERSION" ] || fail "FRAMEWORK-VERSION is empty"
cmp "$R/FRAMEWORK-VERSION" "$ROOT/FRAMEWORK-VERSION" \
  || fail "FRAMEWORK-VERSION does not match the checked-out framework release"
grep -Fxq 'CHANGELOG.md merge=ours' "$R/.gitattributes" \
  || fail "CHANGELOG.md is not instance-owned in .gitattributes"
grep -Fxq 'FRAMEWORK-VERSION merge=ours' "$R/.gitattributes" \
  || fail "FRAMEWORK-VERSION is not instance-owned in .gitattributes"
grep -Fxq 'VERSION merge=ours' "$R/.gitattributes" \
  || fail "VERSION is not instance-owned in .gitattributes"
node - "$R/package.json" "$R/package-lock.json" "$NAME_LC" "$NAME" <<'NODE'
const fs = require('node:fs');
const [pkgPath, lockPath, expectedPackageName, expectedPlaceName] = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
if (pkg.name !== expectedPackageName) throw new Error(`unexpected package name: ${pkg.name}`);
if (pkg.private !== true) throw new Error('package is not private');
if (pkg.version !== '0.0.0') throw new Error(`unexpected adopter package version: ${pkg.version}`);
if (pkg.description !== `AI-native open knowledge base for ${expectedPlaceName}.`) {
  throw new Error(`unexpected package description: ${pkg.description}`);
}
if (lock.name !== pkg.name || lock.packages?.['']?.name !== pkg.name) {
  throw new Error('package-lock root names do not match package.json');
}
if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) {
  throw new Error('package-lock root versions do not match package.json');
}
NODE
# AGENTS.md is the instance's agent-instruction SSOT; its header is the place name.
head -1 "$R/AGENTS.md" | grep -q "^# $NAME$" \
  || fail "AGENTS.md header is not '# $NAME'"
# CLAUDE.md is a pure one-line @AGENTS.md shim — all instructions live in AGENTS.md.
claude_shim_is_exact "$R/CLAUDE.md" \
  || fail "CLAUDE.md is not byte-identical to '@AGENTS.md\\n'"

# Regression fixtures prove the byte comparator rejects differences that shell
# command substitution would hide, plus content before or after the shim.
printf '@AGENTS.md\n\n' > "$TMP/claude-trailing-blank.md"
printf '@AGENTS.md' > "$TMP/claude-missing-newline.md"
printf '@AGENTS.md\nAdditional instructions.\n' > "$TMP/claude-added-prose.md"
printf '@AGENT.md\n' > "$TMP/claude-changed-byte.md"
assert_rejected_claude_shim "$TMP/claude-trailing-blank.md" "trailing blank line"
assert_rejected_claude_shim "$TMP/claude-missing-newline.md" "missing final newline"
assert_rejected_claude_shim "$TMP/claude-added-prose.md" "added prose"
assert_rejected_claude_shim "$TMP/claude-changed-byte.md" "changed byte"

# The adopted AGENTS.md must retain the framework's support boundaries. Check
# both headings and contract-bearing text so empty placeholder sections fail.
grep -Fxq "## Language support boundary" "$R/AGENTS.md" \
  || fail "AGENTS.md missing '## Language support boundary'"
grep -Fq "Latin-script content" "$R/AGENTS.md" \
  || fail "AGENTS.md language boundary omits Latin-script support"
grep -Fq "CJK content is unsupported" "$R/AGENTS.md" \
  || fail "AGENTS.md language boundary omits unsupported CJK content"
grep -Fq 'place.locale' "$R/AGENTS.md" \
  || fail "AGENTS.md language boundary omits place.locale"
grep -Fq 'place.languages[]' "$R/AGENTS.md" \
  || fail "AGENTS.md language boundary omits place.languages[]"
grep -Fxq "## Semiont probe" "$R/AGENTS.md" \
  || fail "AGENTS.md missing '## Semiont probe'"
grep -Fq 'semiont/config.json' "$R/AGENTS.md" \
  || fail "AGENTS.md semiont probe omits semiont/config.json"
grep -Fq "no-op gracefully when it is absent" "$R/AGENTS.md" \
  || fail "AGENTS.md semiont probe omits absent-file behavior"
head -1 "$R/README.md" | grep -q "^# $NAME$" \
  || fail "README.md header is not '# $NAME' (template README left on the instance)"
head -1 "$R/CHANGELOG.md" | grep -q "^# $NAME changelog$" \
  || fail "CHANGELOG.md header is not '# $NAME changelog'"
grep -Fq "This file contains instance work" "$R/CHANGELOG.md" \
  || fail "CHANGELOG.md does not declare instance-only scope"
if grep -Fq "Release discipline (read before cutting a release)" "$R/CHANGELOG.md"; then
  fail "framework release changelog survived init"
fi
for cat_dir in History Harbor Nature Food Events; do
  [ -d "$R/knowledge/$cat_dir" ] || fail "knowledge/$cat_dir/ not seeded"
done
[ -f "$R/knowledge/INBOX.md" ] || fail "knowledge/INBOX.md not written"
# The writer's contract is "no articles survive" (rmSync + reseed), so assert
# it wholesale rather than naming demo files that could be renamed later.
LEFTOVER_MD="$(find "$R/knowledge" -type f -name '*.md' ! -name 'INBOX.md')"
[ -z "$LEFTOVER_MD" ] || fail "demo content survived init: $LEFTOVER_MD"
grep -q "^$DOMAIN$" "$R/CNAME" || fail "CNAME does not contain $DOMAIN"
[ ! -f "$R/.sekai-template" ] || fail ".sekai-template marker not removed"
grep -q "^$NAME_LC$" "$R/scripts/ci/genericity-denylist.local.txt" \
  || fail "local denylist does not contain $NAME_LC"
# Dev-plugin encapsulation: a fresh instance ships zero dev-plugin state — the
# .agent-toolkit/ tree is removed by the wizard, and the wizard-regenerated AGENTS.md
# carries none of the framework's dev-plugin sentinel block or reference line.
# Non-vacuous only because the committed tree (git archive HEAD, snapshotted above)
# carries .agent-toolkit/ and, in its AGENTS.md, the dev-plugin block.
[ ! -d "$R/.agent-toolkit" ] || fail ".agent-toolkit/ not stripped from adopted instance"
if grep -q "@.agent-toolkit/dev.md" "$R/AGENTS.md"; then
  fail "AGENTS.md carries a dev-plugin reference line (should be absent on an instance)"
fi
if grep -Fq "<!-- dev-plugin:" "$R/AGENTS.md"; then
  fail "AGENTS.md carries the dev-plugin sentinel block (should be absent on an instance)"
fi
if grep -Fxq "## Template mode" "$R/AGENTS.md"; then
  fail "AGENTS.md carries template-only '## Template mode'"
fi

# ADR 008/009: the framework maintainer tree is gone and both adopter doc trees
# survive, asserted against the tree the wizard really stripped.
docs_correctly_stripped "$R" \
  || fail "maintainer docs survived init, or an adopter doc tree was removed (expected absent: $MAINTAINER_DOCS; expected present: $ADOPTER_DOC_TREES)"

# Planted inverse: the predicate above must REJECT each way the strip can go wrong.
# Without this, an assertion over an absent path would pass on any tree at all,
# including one where the wizard silently stopped removing it.
DOCS_FIXTURE="$TMP/docs-strip-fixture"
mkdir -p "$DOCS_FIXTURE"
cp -R "$R/docs" "$DOCS_FIXTURE/docs"
docs_correctly_stripped "$DOCS_FIXTURE" \
  || fail "the docs fixture copied from the stripped instance is not itself correctly stripped"

for rel in $MAINTAINER_DOCS; do
  plant_maintainer_doc "$DOCS_FIXTURE" "$rel"
  if docs_correctly_stripped "$DOCS_FIXTURE"; then
    fail "strip assertion accepted a tree still carrying $rel"
  fi
  rm -rf "${DOCS_FIXTURE:?}/$rel"
  docs_correctly_stripped "$DOCS_FIXTURE" \
    || fail "removing the planted $rel did not restore the fixture baseline"
done

for rel in $ADOPTER_DOC_TREES; do
  mv "$DOCS_FIXTURE/$rel" "$DOCS_FIXTURE/$rel.withheld"
  if docs_correctly_stripped "$DOCS_FIXTURE"; then
    fail "strip assertion accepted a tree missing the adopter doc tree $rel"
  fi
  mv "$DOCS_FIXTURE/$rel.withheld" "$DOCS_FIXTURE/$rel"
done

if [ "$PRE_INIT_HAS_MAINTAINER_DOCS" = true ]; then
  echo "✓ maintainer docs stripped, adopter doc trees kept (non-vacuous: HEAD carried them; the planted inverses fail the same predicate)"
else
  echo "✓ maintainer docs stripped, adopter doc trees kept (HEAD carried none — this checkout is an adopted instance; the planted inverses are the non-vacuity proof)"
fi

# ADR 009: the files the wizard RENDERS may not name a stripped path. This closes the
# one gap the framework-docs gate structurally cannot cover: those files are exempt
# there for being regenerated, and the templates that produce them are exempt for being
# a strip mechanism, so the rendered result is checked by neither.
DANGLING_REF_HITS=""
DANGLING_REF_PATH=""
stripped_tree_has_no_dangling_ref "$R" || fail "a file the wizard rendered into the
  stripped instance names the removed path '$DANGLING_REF_PATH'. An adopter would follow
  a reference to a file they do not have. The text comes from a wizard template
  (renderAgentsMd, CLAUDE_MD_SHIM, renderReadme, renderChangelog) — drop the line there;
  the framework-docs gate cannot see inside the wizard.
  files:
$DANGLING_REF_HITS"

# Planted inverse: the scan must REJECT a rendered file that names a stripped path.
# Without it this assertion passes on any tree where the grep found nothing for any
# reason at all — including a scan pointed at files that no longer exist. The plant goes
# into a rendered file specifically, because that is the only class this scan covers:
# planting elsewhere would pass and prove the scan is looking in the wrong place.
DANGLING_FIXTURE_FILE="$R/$(set -- $WIZARD_RENDERED_FILES; echo "$1")"
cp "$DANGLING_FIXTURE_FILE" "$DANGLING_FIXTURE_FILE.orig"
printf 'See %s for the architecture.\n' "$(set -- $MAINTAINER_DOCS; echo "$1")" \
  >> "$DANGLING_FIXTURE_FILE"
if stripped_tree_has_no_dangling_ref "$R"; then
  mv "$DANGLING_FIXTURE_FILE.orig" "$DANGLING_FIXTURE_FILE"
  fail "the dangling-reference scan accepted a rendered file naming a removed path"
fi
mv "$DANGLING_FIXTURE_FILE.orig" "$DANGLING_FIXTURE_FILE"
stripped_tree_has_no_dangling_ref "$R" \
  || fail "removing the planted dangling reference did not restore the baseline"
echo "✓ every file the wizard renders is free of stripped paths (planted inverse fails the same scan)"

# Demo media: no audio and no soundscape manifest survive adoption, while public/
# itself does. The manifest goes with the knowledge/ reseed; the clips are removed
# by the wizard's DEMO_MEDIA pass.
demo_media_correctly_stripped "$R" \
  || fail "demo audio or the soundscape manifest survived init, or public/ was removed (expected absent: $DEMO_MEDIA, $SOUND_MANIFEST, and any $AUDIO_EXTS file under public/; expected present: public/)"

# Planted inverse: the predicate must REJECT every way this strip can go wrong —
# the demo directory left in place, a clip moved elsewhere under public/, the
# manifest left in knowledge/, and public/ itself removed.
MEDIA_FIXTURE="$TMP/demo-media-fixture"
mkdir -p "$MEDIA_FIXTURE"
cp -R "$R/public" "$MEDIA_FIXTURE/public"
mkdir -p "$MEDIA_FIXTURE/knowledge"
demo_media_correctly_stripped "$MEDIA_FIXTURE" \
  || fail "the public/ fixture copied from the stripped instance is not itself correctly stripped"

# Each case is "<path to plant>|<path to remove to restore the baseline>": planting
# a file also creates its parent directories, and the predicate rejects the demo
# directory itself, so restoring means removing what the plant created, not just
# the file. Space-free paths, so word-splitting the pair list is safe on bash 3.2.
for pair in \
  "$DEMO_MEDIA/planted.mp3|$DEMO_MEDIA" \
  "public/planted-elsewhere.wav|public/planted-elsewhere.wav" \
  "$SOUND_MANIFEST|knowledge/sounds"; do
  rel="${pair%%|*}"
  undo="${pair#*|}"
  plant_file "$MEDIA_FIXTURE" "$rel"
  if demo_media_correctly_stripped "$MEDIA_FIXTURE"; then
    fail "demo-media strip assertion accepted a tree still carrying $rel"
  fi
  rm -rf "${MEDIA_FIXTURE:?}/$undo"
  demo_media_correctly_stripped "$MEDIA_FIXTURE" \
    || fail "removing the planted $rel did not restore the demo-media fixture baseline"
done

mv "$MEDIA_FIXTURE/public" "$MEDIA_FIXTURE/public.withheld"
if demo_media_correctly_stripped "$MEDIA_FIXTURE"; then
  fail "demo-media strip assertion accepted a tree with no public/ at all"
fi
mv "$MEDIA_FIXTURE/public.withheld" "$MEDIA_FIXTURE/public"

if [ "$PRE_INIT_HAS_DEMO_AUDIO" = true ]; then
  echo "✓ demo audio + soundscape manifest stripped, public/ kept (non-vacuous: HEAD carried the clips; the planted inverses fail the same predicate)"
else
  echo "✓ demo audio + soundscape manifest stripped, public/ kept (HEAD carried none — this checkout is an adopted instance; the planted inverses are the non-vacuity proof)"
fi

echo "✓ seeded artifacts present (VERSION, FRAMEWORK-VERSION, adopter package identity, instance CHANGELOG.md, complete instance AGENTS.md, byte-exact CLAUDE.md shim, README.md header, category dirs, INBOX.md, CNAME, local denylist, marker removed, .agent-toolkit/ removed + template/dev-plugin AGENTS.md content absent)"

# DoD-4: a planted place-name string in src/ fails the gate; framework denylist
# untouched.
cmp "$R/scripts/ci/genericity-denylist.txt" "$ROOT/scripts/ci/genericity-denylist.txt" \
  || fail "framework denylist was modified by init"
PLANT="$R/src/planted-init-check.ts"
printf "export const leaked = '%s';\n" "$NAME" > "$PLANT"
if bash "$R/scripts/ci/check-genericity.sh" >/dev/null 2>&1; then
  fail "gate PASSED with a planted place-name string in src/ (local denylist not live)"
fi
rm "$PLANT"
bash "$R/scripts/ci/check-genericity.sh" >/dev/null 2>&1 \
  || fail "gate fails on the clean post-init tree"
echo "✓ planted place-name string in src/ fails the gate; clean tree passes"

if [ "$BUILD" = false ]; then
  echo "✅ init-check passed (tier 1). Pass --build on a DISPOSABLE clone/CI to add the in-place init + build tier."
  exit 0
fi

echo "── tier 2 (--build): in-place init + full build in $ROOT ──"
# Same replant as snapshot(): the CI checkout of an adopted instance has no
# marker and the in-place init would hit the re-run guard. This checkout is
# disposable (see header); init removes the marker.
touch "$ROOT/.sekai-template"
node "$ROOT/scripts/init/index.mjs" --answers "$ANSWERS"
bash "$ROOT/scripts/ci/check-genericity.sh" \
  || fail "post-init genericity gate failed in instance mode"
(cd "$ROOT" && npm run build) || fail "npm run build failed on the initialized instance"
echo "✅ init-check passed (tier 1 + build tier): init → diff → gate → build all green."
