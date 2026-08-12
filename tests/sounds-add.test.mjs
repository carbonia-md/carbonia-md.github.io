// sounds-add.test.mjs -- contract tests for the soundscape ingest surface:
// scripts/tools/sounds/add.mjs, scripts/ci/check-sounds.mjs, and the tag
// scanner they share, scripts/lib/mp3-tags.mjs.
//
// Two task DoD sets live here, so every describe names the task it answers to:
//
//   LB-79 DoD 3: strictly additive (refuse duplicate slug, manifest unchanged)
//   LB-79 DoD 4: byte-for-byte preservation of surrounding content
//   LB-79 DoD 5: ffmpeg prerequisite named in the failure, non-mp3 converted
//   LB-80 DoD 1: the conversion path strips embedded capture metadata
//   LB-80 DoD 2: the mp3 path re-muxes instead of copying, and strips it too
//   LB-80 DoD 3: sounds:check fails on a committed asset that still carries a tag
//
// LB-80 retired one LB-79 assertion. mp3 input used to be copied byte-for-byte,
// which republished whatever the source container held -- capture coordinates,
// capture timestamp, device make and model, OS version. Every recording now goes
// through ffmpeg, so ffmpeg is an unconditional prerequisite and an mp3 output is
// no longer byte-identical to its input. Cleanliness, not identity, is the
// contract that replaced it.
//
// Fixtures are generated at test time with ffmpeg and carry fabricated tag values
// only. No field recording is committed, and the coordinate below is out of range
// on both axes, so it names no place on Earth.
//
// ffmpeg is a hard prerequisite of this suite, not an optional one. A missing
// binary fails loudly rather than skipping: a suite that quietly passes when it
// did not run is not a guard
// (.agent-toolkit/rules/dod-guard-suite-must-run-in-ci.md).
//
// Run: node --experimental-strip-types --test tests/sounds-add.test.mjs
//
// This file lives under tests/, which both machine gates scan: its source is
// pure ASCII and carries no denylisted place term.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FFMPEG_STRIP_ARGS, STRIPPED_SUMMARY, scanMp3Tags } from '../scripts/lib/mp3-tags.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ADD_SCRIPT = join(ROOT, 'scripts', 'tools', 'sounds', 'add.mjs');
const CHECK_SCRIPT = join(ROOT, 'scripts', 'ci', 'check-sounds.mjs');
const NODE = process.execPath;

// Fabricated capture metadata. A consumer phone writes this class of tag into the
// container; these values are invented. The coordinate is out of range on both
// axes (latitude > 90, longitude > 180), so it cannot be anywhere real.
const FAKE_MODEL = 'Testcorp Handset 9';
const FAKE_GPS = '+99.9999+199.9999/';
const FAKE_OS = 'FakeOS 42.0';

const MADE = [];

after(() => {
  for (const dir of MADE) rmSync(dir, { recursive: true, force: true });
});

function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'sounds-add-test-'));
  MADE.push(dir);
  mkdirSync(join(dir, 'knowledge', 'sounds'), { recursive: true });
  mkdirSync(join(dir, 'public', 'media', 'sounds'), { recursive: true });
  return dir;
}

function writeManifest(dir, source) {
  writeFileSync(join(dir, 'knowledge', 'sounds', '_manifest.md'), source);
  return source;
}

function readManifest(dir) {
  return readFileSync(join(dir, 'knowledge', 'sounds', '_manifest.md'), 'utf8');
}

/** Site-root-absolute published path of a slug, on disk. */
function publishedPath(dir, name) {
  return join(dir, 'public', 'media', 'sounds', name);
}

function runAdd(fixture, args, options = {}) {
  const cmd = `"${NODE}" --experimental-strip-types "${ADD_SCRIPT}" ${args} --root "${fixture}"`;
  try {
    const stdout = execSync(cmd, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options,
    });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (err) {
    return { exitCode: err.status, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

function runCheck(fixture) {
  const cmd = `"${NODE}" --experimental-strip-types "${CHECK_SCRIPT}" --root "${fixture}"`;
  try {
    const stdout = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (err) {
    return { exitCode: err.status, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

/**
 * Runs ffmpeg for fixture generation. Absence of the binary, and any ffmpeg
 * error, both throw here and fail the test that asked for the fixture. This
 * suite never skips on a missing ffmpeg: CI installs it, and a silent skip
 * would let the metadata leak this file exists to catch ship unnoticed.
 */
function ffmpeg(args) {
  try {
    execSync(`ffmpeg -loglevel error ${args}`, { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    const detail = err.stderr ? String(err.stderr).trim() : String(err.message);
    throw new Error(
      'ffmpeg fixture generation failed. This suite requires ffmpeg on PATH and does not ' +
        `skip without it.\n  ffmpeg ${args}\n  ${detail}`,
    );
  }
}

/** 0.3s of silence as a wav. The starting point for every generated fixture. */
function makeSilentWav(dir, name) {
  const file = join(dir, name);
  ffmpeg(`-f lavfi -i anullsrc=r=44100:cl=mono -t 0.3 -y "${file}"`);
  return file;
}

/**
 * A non-mp3 capture carrying the tag set a phone writes. `use_metadata_tags`
 * is what lets the arbitrary vendor keys through into the mov container.
 */
function makeTaggedCapture(dir, name) {
  const wav = makeSilentWav(dir, `${name}.source.wav`);
  const file = join(dir, name);
  ffmpeg(
    `-i "${wav}" -metadata "com.apple.quicktime.model=${FAKE_MODEL}" ` +
      `-metadata "com.apple.quicktime.location.ISO6709=${FAKE_GPS}" ` +
      `-metadata "com.apple.quicktime.software=${FAKE_OS}" ` +
      `-movflags use_metadata_tags -y "${file}"`,
  );
  return file;
}

/** An mp3 carrying the same fabricated capture tags, as ID3v2 frames. */
function makeTaggedMp3(dir, name, extraArgs = '') {
  const wav = makeSilentWav(dir, `${name}.source.wav`);
  const file = join(dir, name);
  ffmpeg(
    `-i "${wav}" -metadata "com.apple.quicktime.model=${FAKE_MODEL}" ` +
      `-metadata "com.apple.quicktime.location.ISO6709=${FAKE_GPS}" ` +
      `${extraArgs} -y "${file}"`,
  );
  return file;
}

/** An mp3 with no tag of any kind, built through the exported strip args. */
function makeStrippedMp3(dir, name) {
  const tagged = makeTaggedMp3(dir, `${name}.tagged.mp3`);
  const file = join(dir, name);
  ffmpeg(`-i "${tagged}" ${FFMPEG_STRIP_ARGS.join(' ')} -c:a copy -y "${file}"`);
  return file;
}

function tagsOf(file) {
  return scanMp3Tags(readFileSync(file));
}

function assertNoTags(file, label) {
  const findings = tagsOf(file);
  assert.deepEqual(
    findings,
    [],
    `${label} must carry no metadata tag, got ${JSON.stringify(findings)}`,
  );
}

/** No fabricated capture value survives anywhere in the published bytes. */
function assertNoCaptureStrings(file, label) {
  const bytes = readFileSync(file);
  for (const value of [FAKE_MODEL, FAKE_GPS, FAKE_OS]) {
    assert.equal(bytes.includes(value), false, `${label} still contains "${value}"`);
  }
}

/** A directory containing nothing, used as the whole PATH to hide ffmpeg. */
function makeEmptyPathDir() {
  const dir = mkdtempSync(join(tmpdir(), 'sounds-add-nopath-'));
  MADE.push(dir);
  return dir;
}

/* ---------------------------------------------------- hand-built tag fixtures */

/** An ID3v1 tag is a 128-byte trailer starting with the literal `TAG`. */
function appendId3v1(buf, title) {
  const tag = Buffer.alloc(128);
  tag.write('TAG', 0, 'latin1');
  tag.write(title.slice(0, 30), 3, 'latin1');
  return Buffer.concat([buf, tag]);
}

/** One APE tag item: value size, item flags, NUL-terminated key, value. */
function apeItem(key, value) {
  const encoded = Buffer.from(value, 'utf8');
  const head = Buffer.alloc(8);
  head.writeUInt32LE(encoded.length, 0);
  head.writeUInt32LE(0, 4);
  return Buffer.concat([head, Buffer.from(key, 'latin1'), Buffer.from([0]), encoded]);
}

/**
 * A 32-byte APE header or footer block: preamble, version, tag size (items plus
 * this footer), item count, flags, and eight reserved zero bytes.
 */
function apeBlock(version, tagSize, itemCount, flags) {
  const block = Buffer.alloc(32);
  block.write('APETAGEX', 0, 'latin1');
  block.writeUInt32LE(version, 8);
  block.writeUInt32LE(tagSize, 12);
  block.writeUInt32LE(itemCount, 16);
  block.writeUInt32LE(flags, 20);
  return block;
}

const APE_HAS_HEADER = 0x80000000;
const APE_IS_HEADER = 0x20000000;

/** APEv2 writes a header and a footer; APEv1 writes a footer only. */
function appendApeTag(buf, version) {
  const item = apeItem('Comment', 'fabricated');
  const size = item.length + 32;
  if (version === 1000) {
    return Buffer.concat([buf, item, apeBlock(1000, size, 1, 0)]);
  }
  return Buffer.concat([
    buf,
    apeBlock(2000, size, 1, (APE_HAS_HEADER | APE_IS_HEADER) >>> 0),
    item,
    apeBlock(2000, size, 1, APE_HAS_HEADER >>> 0),
  ]);
}

/* ------------------------------------------------------------------ LB-79 DoD 3 */

describe('LB-79 DoD 3: strictly additive', () => {
  test('refuses duplicate slug with nonzero exit', () => {
    const dir = makeFixture();
    // A pre-existing published file, never fed to the script: a stand-in is enough.
    writeFileSync(publishedPath(dir, 'existing-clip.mp3'), Buffer.from([0xff, 0xfb]));

    const manifest = writeManifest(
      dir,
      `---
categories:
  - id: nature
    icon: ""
    title: Nature
    sounds:
      - title: Existing
        location: Loc
        credit: Cred
        file: /media/sounds/existing-clip.mp3
---
`,
    );

    // Real audio, so the refusal is proven to be about the slug and not about an
    // input ffmpeg could not read.
    const input = makeStrippedMp3(dir, 'input.mp3');

    const result = runAdd(
      dir,
      `"${input}" --title "Dup" --location "Dup" --credit "Dup" --category nature --slug existing-clip`,
    );

    assert.notEqual(result.exitCode, 0, 'should exit nonzero');
    assert.match(result.stderr, /already exists/i);

    assert.equal(readManifest(dir), manifest, 'manifest must be byte-identical after refused run');
  });
});

/* ------------------------------------------------------------------ LB-79 DoD 4 */

describe('LB-79 DoD 4: hand-editability preserved byte-for-byte', () => {
  test('preserves YAML comments, non-alpha key order, and multi-line description', () => {
    const dir = makeFixture();
    writeFileSync(publishedPath(dir, 'existing.mp3'), Buffer.from([0xff, 0xfb]));

    const manifest = writeManifest(
      dir,
      `---
# This comment must survive
categories:
  - id: harbor
    title: Harbor  # inline comment
    icon: "\\u2693"
    sounds:
      - file: /media/sounds/existing.mp3
        title: Existing clip
        credit: Someone
        location: >-
          The harbor dock, between
          the fishing boats and the fuel pier
        description: >-
          A multi-line description that spans
          several lines and should be
          preserved exactly as written.
---

Body notes with special chars: & < > "quotes"
`,
    );

    const input = makeStrippedMp3(dir, 'new-clip.mp3');

    const result = runAdd(
      dir,
      `"${input}" --title "New clip" --location "New loc" --credit "New cred" --category harbor`,
    );
    assert.equal(result.exitCode, 0, `expected exit 0, got ${result.exitCode}: ${result.stderr}`);

    const after = readManifest(dir);
    const insertedEntry =
      '      - title: "New clip"\n' +
      '        location: "New loc"\n' +
      '        credit: "New cred"\n' +
      '        file: /media/sounds/new-clip.mp3';

    assert.ok(after.includes(insertedEntry), 'should contain the new entry');

    // Remove the inserted lines and compare
    const stripped = after.replace(insertedEntry + '\n', '');
    assert.equal(stripped, manifest, 'everything outside the inserted entry must be byte-identical');
  });
});

/* ------------------------------------------------------------------ LB-79 DoD 5 */

describe('LB-79 DoD 5: ffmpeg prerequisite explicit, non-mp3 converted', () => {
  test('non-mp3 input is converted through ffmpeg', () => {
    const dir = makeFixture();
    writeManifest(
      dir,
      `---
categories:
  - id: nature
    icon: ""
    title: Nature
    sounds: []
---
`,
    );

    const input = makeSilentWav(dir, 'convert-test.wav');

    const result = runAdd(
      dir,
      `"${input}" --title "Conv" --location "Loc" --credit "Cred" --category nature`,
    );
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(existsSync(publishedPath(dir, 'convert-test.mp3')), 'converted mp3 should exist');
  });

  test('ffmpeg absent with non-mp3 input is nonzero exit naming install command', () => {
    const dir = makeFixture();
    writeManifest(
      dir,
      `---
categories:
  - id: nature
    icon: ""
    title: Nature
    sounds: []
---
`,
    );

    const input = join(dir, 'needs-convert.wav');
    writeFileSync(input, Buffer.from([0x52, 0x49, 0x46, 0x46])); // RIFF header start

    // PATH is an empty directory, so ffmpeg is unreachable wherever it is
    // installed. Node itself is invoked by absolute path.
    const result = runAdd(
      dir,
      `"${input}" --title "X" --location "X" --credit "X" --category nature`,
      { env: { ...process.env, PATH: makeEmptyPathDir() } },
    );

    assert.notEqual(result.exitCode, 0, 'should exit nonzero when ffmpeg is missing');
    assert.match(result.stderr, /ffmpeg/i, 'should mention ffmpeg');
    assert.match(
      result.stderr,
      /brew install ffmpeg/i,
      'should name the macOS install command',
    );
    assert.match(
      result.stderr,
      /apt install ffmpeg/i,
      'should name the Ubuntu install command',
    );
  });
});

/* ------------------------------------------------------------------ LB-80 DoD 1 */

describe('LB-80 DoD 1: the conversion path strips capture metadata', () => {
  test('a capture carrying GPS, model, and OS tags converts to an mp3 with no tag at all', () => {
    const dir = makeFixture();
    writeManifest(
      dir,
      `---
categories:
  - id: nature
    icon: ""
    title: Nature
    sounds: []
---
`,
    );

    const input = makeTaggedCapture(dir, 'capture.m4a');

    // Control: a default ffmpeg conversion of this same fixture republishes every
    // capture tag. Without this, a fixture that silently lost its tags before the
    // script ran would make the assertion below pass for the wrong reason.
    const leaked = join(dir, 'control-leak.mp3');
    ffmpeg(`-i "${input}" -y "${leaked}"`);
    const leakedFindings = tagsOf(leaked);
    assert.ok(
      leakedFindings.length > 0 &&
        leakedFindings.some((f) => f.detail.includes('com.apple.quicktime.model')),
      `fixture is not actually tagged; default conversion produced ${JSON.stringify(leakedFindings)}`,
    );

    const result = runAdd(
      dir,
      `"${input}" --title "Conv" --location "Loc" --credit "Cred" --category nature`,
    );
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /metadata stripped/, 'success line should say metadata stripped');

    const placed = publishedPath(dir, 'capture.mp3');
    assert.ok(existsSync(placed), 'converted mp3 should exist');
    assertNoTags(placed, 'the converted recording');
    assertNoCaptureStrings(placed, 'the converted recording');
  });
});

/* ------------------------------------------------------------------ LB-80 DoD 2 */

describe('LB-80 DoD 2: the mp3 path re-muxes and strips instead of copying', () => {
  test('a tagged mp3 is published with no tag, and is no longer byte-identical to its input', () => {
    const dir = makeFixture();
    writeManifest(
      dir,
      `---
categories:
  - id: nature
    icon: ""
    title: Nature
    sounds: []
---
`,
    );

    const input = makeTaggedMp3(dir, 'passthrough.mp3');
    const inputBytes = readFileSync(input);

    // Control: the fixture really does carry the capture tags on the way in.
    const inputFindings = tagsOf(input);
    assert.ok(
      inputFindings.length > 0 &&
        inputFindings.some((f) => f.detail.includes('com.apple.quicktime.model')),
      `fixture mp3 is not actually tagged: ${JSON.stringify(inputFindings)}`,
    );

    const result = runAdd(
      dir,
      `"${input}" --title "Pass" --location "Loc" --credit "Cred" --category nature`,
    );
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /metadata stripped/, 'success line should say metadata stripped');

    const placed = publishedPath(dir, 'passthrough.mp3');
    assert.ok(existsSync(placed), 'the mp3 should be published');
    assertNoTags(placed, 'the published mp3');
    assertNoCaptureStrings(placed, 'the published mp3');

    const placedBytes = readFileSync(placed);
    assert.notDeepEqual(
      placedBytes,
      inputBytes,
      'a tagged mp3 must not be copied byte-for-byte any more',
    );
    assert.ok(placedBytes.length > 0, 'the published mp3 must still carry its audio');

    assert.match(
      readManifest(dir),
      /file: \/media\/sounds\/passthrough\.mp3/,
      'the manifest entry should still be appended',
    );
  });

  test('ffmpeg absent refuses mp3 input too, before anything is written', () => {
    const dir = makeFixture();
    const manifest = writeManifest(
      dir,
      `---
categories:
  - id: nature
    icon: ""
    title: Nature
    sounds: []
---
`,
    );

    const input = makeTaggedMp3(dir, 'unreachable.mp3');

    const result = runAdd(
      dir,
      `"${input}" --title "X" --location "X" --credit "X" --category nature`,
      { env: { ...process.env, PATH: makeEmptyPathDir() } },
    );

    assert.notEqual(result.exitCode, 0, 'mp3 input must not bypass the ffmpeg prerequisite');
    assert.match(result.stderr, /ffmpeg/i, 'should mention ffmpeg');
    assert.match(result.stderr, /brew install ffmpeg/i, 'should name the macOS install command');
    assert.match(result.stderr, /apt install ffmpeg/i, 'should name the Ubuntu install command');

    assert.equal(
      existsSync(publishedPath(dir, 'unreachable.mp3')),
      false,
      'nothing may be published when the prerequisite check fails',
    );
    assert.equal(readManifest(dir), manifest, 'manifest must be byte-identical after the refusal');
  });
});

/* ------------------------------------------------------------------ LB-80 DoD 3 */

describe('LB-80 DoD 3: sounds:check fails on a committed asset that still carries a tag', () => {
  const manifestFor = (files) =>
    `---
categories:
  - id: nature
    icon: "*"
    title: Nature
    sounds:
${files
  .map(
    (name) =>
      `      - title: Clip ${name}\n        location: Loc\n        credit: Cred\n` +
      `        file: /media/sounds/${name}`,
  )
  .join('\n')}
---
`;

  test('a tagged published asset fails, naming the repository-relative path and the field', () => {
    const dir = makeFixture();
    writeManifest(dir, manifestFor(['tagged-clip.mp3']));

    const tagged = makeTaggedMp3(dir, 'source-tagged.mp3');
    writeFileSync(publishedPath(dir, 'tagged-clip.mp3'), readFileSync(tagged));

    const result = runCheck(dir);

    assert.equal(result.exitCode, 1, `expected exit 1, got ${result.exitCode}: ${result.stdout}`);
    assert.match(
      result.stderr,
      /public\/media\/sounds\/tagged-clip\.mp3/,
      'the error must name the repository-relative path of the offending file',
    );
    assert.match(
      result.stderr,
      /com\.apple\.quicktime\.model/,
      'the error must name the offending field',
    );
  });

  test('a hand-placed tagged asset at any depth fails even though nothing references it', () => {
    const dir = makeFixture();
    writeManifest(dir, manifestFor(['clean-clip.mp3']));

    const clean = makeStrippedMp3(dir, 'source-clean.mp3');
    writeFileSync(publishedPath(dir, 'clean-clip.mp3'), readFileSync(clean));

    // Dropped in by hand, referenced by no entry: an orphan is only a warning, so
    // the tag is what has to fail the gate.
    mkdirSync(join(dir, 'public', 'media', 'sounds', 'nested'), { recursive: true });
    const tagged = makeTaggedMp3(dir, 'source-nested.mp3');
    writeFileSync(publishedPath(dir, join('nested', 'deep-clip.mp3')), readFileSync(tagged));

    const result = runCheck(dir);

    assert.equal(result.exitCode, 1, `expected exit 1, got ${result.exitCode}: ${result.stdout}`);
    assert.match(
      result.stderr,
      /public\/media\/sounds\/nested\/deep-clip\.mp3/,
      'the scan must reach any depth under public/media/sounds/',
    );
  });

  test('the same tree passes once every asset is stripped', () => {
    const dir = makeFixture();
    writeManifest(dir, manifestFor(['clean-clip.mp3']));

    const clean = makeStrippedMp3(dir, 'source-clean.mp3');
    writeFileSync(publishedPath(dir, 'clean-clip.mp3'), readFileSync(clean));

    const result = runCheck(dir);

    assert.equal(
      result.exitCode,
      0,
      `expected exit 0 on a stripped tree, got ${result.exitCode}: ${result.stderr}`,
    );
  });
});

/* ------------------------------------------- LB-80: the shared scanner contract */

describe('LB-80: scanMp3Tags reports every tag form and allowlists none', () => {
  test('a stripped mp3 produces no findings', () => {
    const dir = makeFixture();
    assertNoTags(makeStrippedMp3(dir, 'clean.mp3'), 'a stripped mp3');
  });

  test('FFMPEG_STRIP_ARGS produce an mp3 with no tag of any kind', () => {
    const dir = makeFixture();
    const tagged = makeTaggedMp3(dir, 'tagged.mp3');
    assert.ok(Array.isArray(FFMPEG_STRIP_ARGS) && FFMPEG_STRIP_ARGS.length > 0);
    assert.ok(
      FFMPEG_STRIP_ARGS.every((arg) => typeof arg === 'string'),
      'every strip argument must be a string, so it can be spread into a spawn',
    );

    const out = join(dir, 'stripped-by-exported-args.mp3');
    ffmpeg(`-i "${tagged}" ${FFMPEG_STRIP_ARGS.join(' ')} -c:a copy -y "${out}"`);
    assertNoTags(out, 'an mp3 written with the exported strip args');
  });

  test('an ID3v2.4 tag is reported by version and names its frames, TXXX by description', () => {
    const dir = makeFixture();
    const findings = tagsOf(makeTaggedMp3(dir, 'id3v24.mp3', '-id3v2_version 4'));

    assert.equal(findings.length, 1, JSON.stringify(findings));
    assert.equal(findings[0].form, 'ID3v2.4');
    assert.match(findings[0].detail, /^frames: /);
    assert.match(findings[0].detail, /TXXX:com\.apple\.quicktime\.model/);
    assert.match(findings[0].detail, /TXXX:com\.apple\.quicktime\.location\.ISO6709/);
  });

  test('an ID3v2.3 tag reports its own major version', () => {
    const dir = makeFixture();
    const findings = tagsOf(makeTaggedMp3(dir, 'id3v23.mp3', '-id3v2_version 3'));

    assert.equal(findings.length, 1, JSON.stringify(findings));
    assert.equal(findings[0].form, 'ID3v2.3');
    assert.match(findings[0].detail, /TXXX:com\.apple\.quicktime\.model/);
  });

  test('an encoder-only tag is a finding too: there is no benign-frame allowlist', () => {
    const dir = makeFixture();
    // No -metadata at all: ffmpeg still writes its own TSSE encoder frame.
    const wav = makeSilentWav(dir, 'encoder-only.wav');
    const out = join(dir, 'encoder-only.mp3');
    ffmpeg(`-i "${wav}" -y "${out}"`);

    const findings = tagsOf(out);
    assert.equal(findings.length, 1, JSON.stringify(findings));
    assert.match(findings[0].form, /^ID3v2\./);
    assert.match(findings[0].detail, /TSSE/);
  });

  test('a trailing ID3v1 tag is reported', () => {
    const dir = makeFixture();
    const clean = readFileSync(makeStrippedMp3(dir, 'v1-base.mp3'));
    const file = join(dir, 'id3v1.mp3');
    writeFileSync(file, appendId3v1(clean, 'Fixture capture'));

    const findings = tagsOf(file);
    assert.equal(findings.length, 1, JSON.stringify(findings));
    assert.equal(findings[0].form, 'ID3v1');
  });

  test('an APEv2 tag is reported', () => {
    const dir = makeFixture();
    const clean = readFileSync(makeStrippedMp3(dir, 'ape2-base.mp3'));
    const file = join(dir, 'apev2.mp3');
    writeFileSync(file, appendApeTag(clean, 2000));

    const findings = tagsOf(file);
    assert.equal(findings.length, 1, JSON.stringify(findings));
    assert.equal(findings[0].form, 'APEv2');
  });

  test('an APEv1 tag is reported', () => {
    const dir = makeFixture();
    const clean = readFileSync(makeStrippedMp3(dir, 'ape1-base.mp3'));
    const file = join(dir, 'apev1.mp3');
    writeFileSync(file, appendApeTag(clean, 1000));

    const findings = tagsOf(file);
    assert.equal(findings.length, 1, JSON.stringify(findings));
    assert.equal(findings[0].form, 'APEv1');
  });

  test('a non-mpeg container renamed to .mp3 is reported as a container finding', () => {
    const dir = makeFixture();
    const wav = makeSilentWav(dir, 'not-really.wav');
    const file = join(dir, 'not-really.mp3');
    writeFileSync(file, readFileSync(wav));

    const findings = tagsOf(file);
    assert.equal(findings.length, 1, JSON.stringify(findings));
    assert.equal(findings[0].form, 'container');
  });

  test('STRIPPED_SUMMARY is a non-empty ASCII summary', () => {
    assert.equal(typeof STRIPPED_SUMMARY, 'string');
    assert.ok(STRIPPED_SUMMARY.trim().length > 0, 'summary must not be empty');
    assert.match(STRIPPED_SUMMARY, /^[\x20-\x7e]+$/, 'summary must be printable ASCII');
  });
});
