#!/usr/bin/env node
// check-sounds.mjs -- `npm run sounds:check`.
//
// Validates the soundscape manifest against the schema exported by
// src/lib/sounds.ts and the filesystem under public/. Exits nonzero when a
// committed inconsistency would silently drop a recording at build time:
//
//   - a recording missing a required field
//   - a `file` that does not resolve under public/
//   - a `file` escaping public/ (leading-slash violation or `..` segment)
//   - a duplicate category `id`
//   - a published file that still carries a metadata tag, or is a recognized
//     non-mp3 container
//
// A file under public/media/sounds/ that no entry references is REPORTED on
// stdout and does NOT fail -- an adopter mid-session legitimately has one.
//
// The field lists are IMPORTED from the reader, never restated here. If the
// reader adds a field, this gate demands it without a second edit.
//
// The metadata scan is the half of the strip that covers hand-placed files.
// `npm run sounds:add` strips capture metadata on the way in, but the playbook
// blesses hand-placing a file into public/media/sounds/ and hand-writing its
// manifest entry, so the writer alone cannot close the class. The rule and the
// container reader both live in scripts/lib/mp3-tags.mjs, which the writer imports
// too -- the gate and the tool it judges cannot drift apart.
//
// This scan is pure JavaScript on purpose. CI has no ffmpeg, and this gate also
// runs from `postbuild:sounds` in every adopter's build, so it must never shell
// out to ffprobe to read a container.
//
// Usage: node scripts/ci/check-sounds.mjs [--root <path>]
//
// This file lives under scripts/, which both machine gates scan: its source is
// pure ASCII and carries no denylisted place term.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RECORDING_REQUIRED_FIELDS,
  RECORDING_OPTIONAL_FIELDS,
  CATEGORY_REQUIRED_FIELDS,
  CATEGORY_OPTIONAL_FIELDS,
  WISHLIST_REQUIRED_FIELDS,
  MANIFEST_PATH,
} from '../../src/lib/sounds.ts';

import { scanMp3Tags, FFMPEG_STRIP_ARGS } from '../lib/mp3-tags.mjs';

import matter from 'gray-matter';

const ROOT = (() => {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--root');
  if (idx !== -1 && args[idx + 1]) return resolve(args[idx + 1]);
  return fileURLToPath(new URL('../..', import.meta.url));
})();

const MANIFEST_ABS = join(ROOT, MANIFEST_PATH);
const PUBLIC_DIR = join(ROOT, 'public');
const SOUNDS_DIR = join(PUBLIC_DIR, 'media', 'sounds');

const errors = [];
const warnings = [];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSafePublicPath(file) {
  if (!file.startsWith('/')) return false;
  return !file.split(/[\\/]/).includes('..');
}

if (!existsSync(MANIFEST_ABS)) {
  console.log(`OK: no ${MANIFEST_PATH} -- soundscape is unconfigured; nothing to check.`);
  process.exit(0);
}

let raw;
try {
  raw = readFileSync(MANIFEST_ABS, 'utf8');
} catch (err) {
  console.error(`FAIL: cannot read ${MANIFEST_PATH}: ${err.message}`);
  process.exit(1);
}

let parsed;
try {
  parsed = matter(raw);
} catch (err) {
  console.error(`FAIL: ${MANIFEST_PATH} frontmatter parse error: ${err.message}`);
  process.exit(1);
}

const data = parsed.data || {};
const referencedFiles = new Set();

function checkRecording(entry, index, categoryId) {
  const at = categoryId
    ? `entry ${index} in category "${categoryId}"`
    : `entry ${index}`;

  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    errors.push(`${MANIFEST_PATH}: ${at} is not a mapping.`);
    return;
  }

  const missing = RECORDING_REQUIRED_FIELDS.filter((f) => !isNonEmptyString(entry[f]));
  if (missing.length > 0) {
    errors.push(
      `${MANIFEST_PATH}: ${at} is missing required field(s): ${missing.join(', ')}.`,
    );
    return;
  }

  const file = entry.file.trim();

  if (!isSafePublicPath(file)) {
    errors.push(
      `${MANIFEST_PATH}: ${at} declares file "${file}" which is not a safe ` +
        'site-root-absolute path (must start with "/" and contain no ".." segment).',
    );
    return;
  }

  const diskPath = join(PUBLIC_DIR, file);
  if (!existsSync(diskPath)) {
    errors.push(
      `${MANIFEST_PATH}: ${at} declares file "${file}" which does not exist under public/.`,
    );
    return;
  }

  referencedFiles.add(file);
}

function checkCategory(cat, index, seenIds) {
  if (typeof cat !== 'object' || cat === null || Array.isArray(cat)) {
    errors.push(`${MANIFEST_PATH}: category ${index} is not a mapping.`);
    return;
  }

  const missing = CATEGORY_REQUIRED_FIELDS.filter((f) => !isNonEmptyString(cat[f]));
  if (missing.length > 0) {
    errors.push(
      `${MANIFEST_PATH}: category ${index} is missing required field(s): ${missing.join(', ')}.`,
    );
    return;
  }

  const id = cat.id.trim();
  if (seenIds.has(id)) {
    errors.push(
      `${MANIFEST_PATH}: category ${index} repeats id "${id}" -- category ids must be unique.`,
    );
  }
  seenIds.add(id);

  const sounds = cat.sounds;
  if (sounds !== undefined && sounds !== null) {
    if (!Array.isArray(sounds)) {
      errors.push(
        `${MANIFEST_PATH}: category "${id}" has a non-list \`sounds\` field.`,
      );
    } else {
      sounds.forEach((entry, i) => checkRecording(entry, i, id));
    }
  }
}

const categories = data.categories;
if (Array.isArray(categories)) {
  const seenIds = new Set();
  categories.forEach((cat, i) => checkCategory(cat, i, seenIds));
} else if (categories !== undefined && categories !== null) {
  errors.push(`${MANIFEST_PATH}: \`categories\` must be a list.`);
} else {
  const sounds = data.sounds;
  if (sounds !== undefined && sounds !== null) {
    if (!Array.isArray(sounds)) {
      errors.push(`${MANIFEST_PATH}: \`sounds\` must be a list.`);
    } else {
      sounds.forEach((entry, i) => checkRecording(entry, i, null));
    }
  }
}

// Every file under public/media/sounds/, at any depth, whatever it is named. One
// walk feeds both the orphan report and the metadata scan, so a clip in a
// subdirectory cannot be visible to one and invisible to the other.
//
// The walk deliberately matches no extension. Astro copies this directory into
// dist/ byte-for-byte, so what makes a file published is its location, not its
// name: a `.MP3`, a `.m4a` left unconverted, or a file with no extension at all
// ships exactly as an `.mp3` does. An extension filter here -- of any spelling,
// case-sensitive or not -- would be a list of names to evade rather than a rule,
// which is the same reason scanMp3Tags() rejects any tag instead of a denylist of
// identifying frames. A non-audio file that strays in carries no tag and no
// foreign-container signature, so it passes the scan and is reported as an orphan.
function listPublishedFiles(dir, prefix = '') {
  const found = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      found.push(...listPublishedFiles(join(dir, entry.name), `${prefix}${entry.name}/`));
    } else if (entry.isFile()) {
      found.push(`${prefix}${entry.name}`);
    }
  }
  return found;
}

let metadataFindings = 0;
let scannedFiles = 0;

if (existsSync(SOUNDS_DIR)) {
  for (const relative of listPublishedFiles(SOUNDS_DIR)) {
    const publicPath = `/media/sounds/${relative}`;

    // Orphan detection: an mp3 no manifest entry references.
    if (!referencedFiles.has(publicPath)) {
      warnings.push(`orphan: ${publicPath} exists under public/ but no manifest entry references it.`);
    }

    // Metadata scan: a published recording carries no tag of any kind.
    let bytes;
    try {
      bytes = readFileSync(join(SOUNDS_DIR, relative));
    } catch (err) {
      errors.push(`public/media/sounds/${relative}: cannot read the file: ${err.message}`);
      continue;
    }
    scannedFiles += 1;
    for (const finding of scanMp3Tags(bytes)) {
      metadataFindings += 1;
      if (finding.form === 'container') {
        errors.push(
          `public/media/sounds/${relative}: ${finding.detail}. Renaming a recording to ` +
            '.mp3 does not convert it; run it through `npm run sounds:add`.',
        );
      } else {
        errors.push(
          `public/media/sounds/${relative}: carries an ${finding.form} metadata tag ` +
            `(${finding.detail}). A published recording carries no tag: phone containers ` +
            'hold capture coordinates, timestamp, and device identity, and the page reads ' +
            'every displayed field from the manifest instead.',
        );
      }
    }
  }
}

if (warnings.length > 0) {
  for (const w of warnings) console.log(w);
}

if (errors.length > 0) {
  console.error(
    `FAIL: soundscape check found ${errors.length} error(s) in ${MANIFEST_PATH} ` +
      'and public/media/sounds/:',
  );
  for (const e of errors) console.error(`  ${e}`);
  if (metadataFindings > 0) {
    // The remedy is derived from the same arguments the writer uses, so the
    // advice cannot drift from what `npm run sounds:add` actually does.
    console.error('');
    console.error('  To strip a file in place without re-encoding it:');
    console.error(
      `    ffmpeg -i <file>.mp3 ${FFMPEG_STRIP_ARGS.join(' ')} -c:a copy <stripped>.mp3`,
    );
    console.error('  Or re-run `npm run sounds:add` on the original recording.');
  }
  process.exit(1);
}

const entryCount = referencedFiles.size;
console.log(
  `OK: ${MANIFEST_PATH} is valid -- ${entryCount} recording(s) checked; ` +
    `${scannedFiles} published file(s) carry no metadata tag` +
    `${warnings.length > 0 ? `; ${warnings.length} orphan(s) reported` : ''}.`,
);
