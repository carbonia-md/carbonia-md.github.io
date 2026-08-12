#!/usr/bin/env bash
#
# check-sounds-selftest.sh -- non-vacuity proof for the soundscape manifest
# gate (scripts/ci/check-sounds.mjs).
#
# A guard that only ever asserts the green path proves nothing. This test plants
# each of the gate's failing classes into a temp copy and requires the gate
# to FAIL each time, then asserts the gate PASSES on the shipped tree, and
# asserts the orphan case exits zero while naming the orphan on stdout.
#
#   1. MISSING FIELD  -- a recording with a required field removed.
#   2. UNRESOLVED FILE -- a `file` whose mp3 does not exist under public/.
#   3. PATH ESCAPE    -- a `file` containing a `..` segment.
#   4. DUPLICATE ID   -- two categories sharing the same `id`.
#   5. ORPHAN (pass)  -- an mp3 under public/media/sounds/ unreferenced; gate
#                        must exit 0 but name the orphan on stdout.
#
# Classes 6-9 are the published-metadata class. The gate's rule is that a
# published recording carries NO metadata tag of any kind, so proving it on one
# tag form would leave the other forms as an untested claim; each container an
# mp3 can carry a tag in gets its own planted case, and the wrong-container case
# covers a recording renamed to .mp3 rather than converted.
#
#   6. ID3v2 TAG      -- the form every observed phone leak arrives in.
#   7. ID3v1 TAG      -- a trailing 128-byte TAG block.
#   8. APE TAG        -- an APETAGEX footer.
#   9. WRONG CONTAINER -- bytes that are not an MPEG audio stream at all.
#  10. EXTENSION EVASION -- the same leaks under names an extension filter would
#                        miss (`.MP3`, `.m4a`). Astro publishes a file because of
#                        where it sits, not what it is called, so the walk must
#                        not filter on the name; this case is what keeps that
#                        true.
#
# Every planted tag is fabricated in this script; no real recording and no real
# coordinate is ever committed as a fixture.
#
# Portable to macOS bash 3.2 and CI bash 5 (no mapfile; CDPATH unset). This
# script's source is pure ASCII and carries no denylisted place term.
#
# Usage: bash scripts/ci/check-sounds-selftest.sh

set -euo pipefail

unset CDPATH
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." >/dev/null 2>&1 && pwd)"
cd "$ROOT"

GUARD="$ROOT/scripts/ci/check-sounds.mjs"

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sounds-selftest.XXXXXX")"
cleanup() {
  rm -rf "$WORK_DIR"
  return 0
}
trap cleanup EXIT

OUT="$WORK_DIR/guard-output.txt"
PASS=0
FAIL=0

run_guard() {
  node --experimental-strip-types "$GUARD" --root "$1" >"$OUT" 2>&1
}

# Build a minimal valid fixture: one category, one recording, one mp3.
build_fixture() {
  local dir="$1"
  mkdir -p "$dir/knowledge/sounds"
  mkdir -p "$dir/public/media/sounds"
  # A real mp3 header is not required; the gate only checks existence.
  printf '\xff\xfb' >"$dir/public/media/sounds/test-clip.mp3"
  cat >"$dir/knowledge/sounds/_manifest.md" <<'MANIFEST'
---
categories:
  - id: nature
    icon: "\U0001F333"
    title: Nature
    sounds:
      - title: Test clip
        location: Test location
        credit: Test credit
        file: /media/sounds/test-clip.mp3
---
MANIFEST
}

# Overwrite a fixture's mp3 with one carrying a fabricated metadata tag.
#
# The builder is inline node rather than printf arithmetic because ID3 length
# fields are syncsafe integers derived from the frame text: computing them here
# keeps the fixture valid when someone edits the fabricated strings, and a
# hand-miscounted length would weaken the case into a false pass. It shares no
# code with the gate, so the fixture is independent of what it tests.
plant_tag() {
  node - "$1" "$2" <<'BUILDER'
const { writeFileSync } = require('node:fs');

const [form, target] = process.argv.slice(2);

// A short run of plausible MPEG audio: frame sync, then padding.
const audio = Buffer.alloc(512, 0);
audio[0] = 0xff;
audio[1] = 0xfb;
audio[2] = 0x90;

const syncsafe = (n) =>
  Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);

const builders = {
  // An ID3v2.4 tag with one TXXX frame, shaped like the capture-location frame a
  // phone writes. The vendor key and the coordinates are both invented.
  id3v2() {
    const description = 'com.example.device.location.ISO6709';
    const value = '+00.0000-000.0000+000.000/';
    const payload = Buffer.concat([
      Buffer.from([0x03]), // UTF-8
      Buffer.from(description, 'latin1'),
      Buffer.from([0x00]),
      Buffer.from(value, 'latin1'),
    ]);
    const frame = Buffer.concat([
      Buffer.from('TXXX', 'latin1'),
      syncsafe(payload.length),
      Buffer.from([0x00, 0x00]), // frame flags
      payload,
    ]);
    const header = Buffer.concat([
      Buffer.from('ID3', 'latin1'),
      Buffer.from([0x04, 0x00, 0x00]), // version 2.4.0, no flags
      syncsafe(frame.length),
    ]);
    return Buffer.concat([header, frame, audio]);
  },

  id3v1() {
    const tag = Buffer.alloc(128, 0);
    tag.write('TAG', 0, 'latin1');
    tag.write('Fabricated title', 3, 'latin1');
    return Buffer.concat([audio, tag]);
  },

  ape() {
    const footer = Buffer.alloc(32, 0);
    footer.write('APETAGEX', 0, 'latin1');
    footer.writeUInt32LE(2000, 8); // APEv2
    return Buffer.concat([audio, footer]);
  },

  // What a .wav renamed to .mp3 actually looks like: a RIFF header, no frame sync.
  container() {
    const riff = Buffer.alloc(64, 0);
    riff.write('RIFF', 0, 'latin1');
    riff.write('WAVE', 8, 'latin1');
    return riff;
  },
};

if (!builders[form]) {
  console.error(`plant_tag: unknown form "${form}"`);
  process.exit(2);
}
writeFileSync(target, builders[form]());
BUILDER
}

# Plant one metadata form and require the gate to fail while naming it.
# $1 = form, $2 = case label, $3 = grep pattern the failure must contain.
check_metadata_class() {
  local form="$1" label="$2" pattern="$3"
  echo -n "$label: "
  local fixture="$WORK_DIR/metadata-$form"
  build_fixture "$fixture"
  plant_tag "$form" "$fixture/public/media/sounds/test-clip.mp3"
  if run_guard "$fixture"; then
    echo "FAILED -- gate did not catch the planted $form tag"
    cat "$OUT"
    FAIL=$((FAIL + 1))
    return 0
  fi
  if ! grep -q "test-clip.mp3" "$OUT"; then
    echo "FAILED -- gate exited nonzero but did not name the offending file"
    cat "$OUT"
    FAIL=$((FAIL + 1))
    return 0
  fi
  if grep -qi "$pattern" "$OUT"; then
    echo "OK (caught)"
    PASS=$((PASS + 1))
  else
    echo "FAILED -- gate exited nonzero but did not name the finding ($pattern)"
    cat "$OUT"
    FAIL=$((FAIL + 1))
  fi
}

# -- Baseline: the shipped tree must pass --
echo -n "baseline (shipped tree): "
if run_guard "$ROOT"; then
  echo "OK"
  PASS=$((PASS + 1))
else
  echo "FAILED -- the gate rejects the shipped tree (exit $?)"
  cat "$OUT"
  exit 1
fi

# -- Class 1: missing required field --
echo -n "class 1 (missing field): "
FIXTURE="$WORK_DIR/class1"
build_fixture "$FIXTURE"
# Remove the `credit` field from the recording
sed 's/        credit: Test credit//' "$FIXTURE/knowledge/sounds/_manifest.md" \
  >"$WORK_DIR/tmp_manifest" && mv "$WORK_DIR/tmp_manifest" "$FIXTURE/knowledge/sounds/_manifest.md"
if run_guard "$FIXTURE"; then
  echo "FAILED -- gate did not catch missing required field"
  cat "$OUT"
  FAIL=$((FAIL + 1))
else
  if grep -qi "missing" "$OUT"; then
    echo "OK (caught)"
    PASS=$((PASS + 1))
  else
    echo "FAILED -- gate exited nonzero but did not mention 'missing'"
    cat "$OUT"
    FAIL=$((FAIL + 1))
  fi
fi

# -- Class 2: unresolved file --
echo -n "class 2 (unresolved file): "
FIXTURE="$WORK_DIR/class2"
build_fixture "$FIXTURE"
rm "$FIXTURE/public/media/sounds/test-clip.mp3"
if run_guard "$FIXTURE"; then
  echo "FAILED -- gate did not catch unresolved file"
  cat "$OUT"
  FAIL=$((FAIL + 1))
else
  if grep -qi "does not exist" "$OUT"; then
    echo "OK (caught)"
    PASS=$((PASS + 1))
  else
    echo "FAILED -- gate exited nonzero but did not mention file absence"
    cat "$OUT"
    FAIL=$((FAIL + 1))
  fi
fi

# -- Class 3: path escape --
echo -n "class 3 (path escape): "
FIXTURE="$WORK_DIR/class3"
build_fixture "$FIXTURE"
sed 's|file: /media/sounds/test-clip.mp3|file: /media/sounds/../../etc/passwd|' \
  "$FIXTURE/knowledge/sounds/_manifest.md" \
  >"$WORK_DIR/tmp_manifest" && mv "$WORK_DIR/tmp_manifest" "$FIXTURE/knowledge/sounds/_manifest.md"
if run_guard "$FIXTURE"; then
  echo "FAILED -- gate did not catch path escape"
  cat "$OUT"
  FAIL=$((FAIL + 1))
else
  if grep -qi "safe" "$OUT" || grep -qi "\.\." "$OUT"; then
    echo "OK (caught)"
    PASS=$((PASS + 1))
  else
    echo "FAILED -- gate exited nonzero but did not mention path safety"
    cat "$OUT"
    FAIL=$((FAIL + 1))
  fi
fi

# -- Class 4: duplicate category id --
echo -n "class 4 (duplicate id): "
FIXTURE="$WORK_DIR/class4"
build_fixture "$FIXTURE"
cat >"$FIXTURE/knowledge/sounds/_manifest.md" <<'MANIFEST'
---
categories:
  - id: nature
    icon: "\U0001F333"
    title: Nature
    sounds:
      - title: Test clip
        location: Test location
        credit: Test credit
        file: /media/sounds/test-clip.mp3
  - id: nature
    icon: "\U0001F333"
    title: Nature duplicate
    sounds: []
---
MANIFEST
if run_guard "$FIXTURE"; then
  echo "FAILED -- gate did not catch duplicate id"
  cat "$OUT"
  FAIL=$((FAIL + 1))
else
  if grep -qi "duplicate\|repeats" "$OUT"; then
    echo "OK (caught)"
    PASS=$((PASS + 1))
  else
    echo "FAILED -- gate exited nonzero but did not mention duplicate"
    cat "$OUT"
    FAIL=$((FAIL + 1))
  fi
fi

# -- Class 5: orphan (must pass, naming the orphan) --
echo -n "class 5 (orphan, pass): "
FIXTURE="$WORK_DIR/class5"
build_fixture "$FIXTURE"
printf '\xff\xfb' >"$FIXTURE/public/media/sounds/unreferenced-orphan.mp3"
if run_guard "$FIXTURE"; then
  if grep -q "unreferenced-orphan" "$OUT"; then
    echo "OK (passed, orphan named)"
    PASS=$((PASS + 1))
  else
    echo "FAILED -- gate passed but did not name the orphan"
    cat "$OUT"
    FAIL=$((FAIL + 1))
  fi
else
  echo "FAILED -- gate exited nonzero on an orphan (should be warning only)"
  cat "$OUT"
  FAIL=$((FAIL + 1))
fi

# -- Classes 6-9: published metadata, one case per tag container --
#
# The ID3v2 pattern is the planted frame's own description rather than the tag
# form, because the gate must name the offending field and not merely report that
# something was found.
check_metadata_class id3v2 "class 6 (ID3v2 tag)" "com.example.device.location.ISO6709"
check_metadata_class id3v1 "class 7 (ID3v1 tag)" "ID3v1"
check_metadata_class ape "class 8 (APE tag)" "APEv2"
check_metadata_class container "class 9 (wrong container)" "not an mp3"

# -- Class 10: extension evasion --
#
# Both planted files are unreferenced, so the manifest checks say nothing about
# them; the only thing that can catch either is the published-file walk. An
# extension filter that matched `.mp3` case-sensitively would exit 0 here while
# reporting that it had scanned one file.
echo -n "class 10 (extension evasion): "
FIXTURE="$WORK_DIR/class10"
build_fixture "$FIXTURE"
plant_tag id3v2 "$FIXTURE/public/media/sounds/leak.MP3"
plant_tag container "$FIXTURE/public/media/sounds/leak.m4a"
if run_guard "$FIXTURE"; then
  echo "FAILED -- gate did not catch a leak under a non-matching extension"
  cat "$OUT"
  FAIL=$((FAIL + 1))
elif ! grep -q "leak.MP3" "$OUT"; then
  echo "FAILED -- gate exited nonzero but did not name leak.MP3"
  cat "$OUT"
  FAIL=$((FAIL + 1))
elif ! grep -q "leak.m4a" "$OUT"; then
  echo "FAILED -- gate exited nonzero but did not name leak.m4a"
  cat "$OUT"
  FAIL=$((FAIL + 1))
else
  echo "OK (caught)"
  PASS=$((PASS + 1))
fi

# -- Summary --
echo ""
if [ "$FAIL" -gt 0 ]; then
  echo "sounds:selftest FAILED: $FAIL class(es) not caught ($PASS passed)"
  exit 1
fi
echo "sounds:selftest OK: all $PASS classes caught/verified."
