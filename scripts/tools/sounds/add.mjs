#!/usr/bin/env node
// add.mjs -- `npm run sounds:add`.
//
// Converts and places audio into public/media/sounds/<slug>.mp3 and appends a
// schema-valid recording entry to the named category in the manifest. Strictly
// additive: an entry whose slug already exists is a nonzero exit, never a silent
// update. The writer splices text into the manifest; it never parses-then-
// reserializes the whole document, so hand-edited YAML (comments, key order,
// multi-line descriptions) is preserved byte-for-byte outside the inserted entry.
//
// Every published file is written through ffmpeg with the strip arguments from
// scripts/lib/mp3-tags.mjs, including mp3 input -- a phone recording carries its
// capture coordinates, timestamp, and device identity in the container, and a
// byte-for-byte copy would publish all of it. mp3 input is therefore re-muxed
// (`-c:a copy`, so the audio frames are unchanged) rather than copied, which makes
// ffmpeg an unconditional prerequisite of this script. `npm run sounds:check`
// enforces the same rule on files that arrive by hand.
//
// Usage:
//   node scripts/tools/sounds/add.mjs <audio-path> [<audio-path>...]
//     --title <title>
//     --location <location>
//     --credit <credit>
//     --category <category-id>
//     [--description <description>]
//     [--icon <icon>]
//     [--contributor <contributor>]
//     [--contributor-url <url>]
//     [--date <ISO date>]
//     [--slug <slug>]           (override auto-derived slug)
//     [--root <repo-root>]     (default: repository root)
//
// Multiple audio paths produce one entry per path with the same metadata (except
// slug, which is derived per file). For batch adds with different metadata, run
// the command once per recording.
//
// This file lives under scripts/, which both machine gates scan: its source is
// pure ASCII and carries no denylisted place term.

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { MANIFEST_PATH } from '../../../src/lib/sounds.ts';
import { FFMPEG_STRIP_ARGS } from '../../lib/mp3-tags.mjs';

const SCRIPT_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = { files: [], root: SCRIPT_ROOT };

  const named = [
    'title', 'location', 'credit', 'category', 'category-icon', 'description',
    'icon', 'contributor', 'contributor-url', 'date', 'slug', 'root',
  ];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (!named.includes(key)) {
        console.error(`FAIL: unknown option --${key}`);
        process.exit(2);
      }
      const value = args[++i];
      if (value === undefined) {
        console.error(`FAIL: --${key} requires a value`);
        process.exit(2);
      }
      if (key === 'contributor-url') {
        opts.contributorUrl = value;
      } else if (key === 'category-icon') {
        opts.categoryIcon = value;
      } else {
        opts[key] = value;
      }
    } else {
      opts.files.push(arg);
    }
  }

  return opts;
}

function slugify(filename) {
  const name = basename(filename, extname(filename));
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function ffmpegAvailable() {
  try {
    execSync('ffmpeg -version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// Re-encode non-mp3 input. FFMPEG_STRIP_ARGS is what keeps the input's capture
// metadata out of the output; without it ffmpeg copies every input tag across.
function convertToMp3(inputPath, outputPath) {
  execFileSync(
    'ffmpeg',
    ['-i', inputPath, '-y', ...FFMPEG_STRIP_ARGS, '-q:a', '2', outputPath],
    { stdio: 'pipe' },
  );
}

// Re-mux mp3 input. `-c:a copy` passes the audio frames through untouched, so this
// is lossless; only the container's tags are dropped.
function remuxMp3(inputPath, outputPath) {
  execFileSync(
    'ffmpeg',
    ['-i', inputPath, '-y', ...FFMPEG_STRIP_ARGS, '-c:a', 'copy', outputPath],
    { stdio: 'pipe' },
  );
}

function yamlQuote(value) {
  return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function buildYamlEntry(opts) {
  const lines = [];
  lines.push(`      - title: ${yamlQuote(opts.title)}`);
  lines.push(`        location: ${yamlQuote(opts.location)}`);
  lines.push(`        credit: ${yamlQuote(opts.credit)}`);
  lines.push(`        file: /media/sounds/${opts.outputFilename}`);
  if (opts.description) lines.push(`        description: ${yamlQuote(opts.description)}`);
  if (opts.icon) lines.push(`        icon: ${yamlQuote(opts.icon)}`);
  if (opts.contributor) lines.push(`        contributor: ${yamlQuote(opts.contributor)}`);
  if (opts.contributorUrl) lines.push(`        contributorUrl: ${yamlQuote(opts.contributorUrl)}`);
  if (opts.date) lines.push(`        date: ${yamlQuote(opts.date)}`);
  return lines.join('\n');
}

function createEmptyManifest(categoryId, categoryIcon) {
  return `---
categories:
  - id: ${yamlQuote(categoryId)}
    icon: ${yamlQuote(categoryIcon)}
    title: ${yamlQuote(categoryId)}
    sounds:
---

# Soundscape manifest
`;
}

function findCategorySoundsInsertPoint(raw, categoryId) {
  // Find the category's `sounds:` key and locate where to append.
  // Strategy: find `- id: <categoryId>` then find its `sounds:` line, then
  // find the end of the sounds list (next line that is at a lower indent
  // level than a sounds entry, or end of frontmatter `---`).

  const lines = raw.split('\n');
  let inCategory = false;
  let soundsLineIdx = -1;
  let insertIdx = -1;
  let categoryIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect category start: `  - id: <categoryId>`
    const catMatch = line.match(/^(\s*)- id:\s*(.+)$/);
    if (catMatch) {
      const id = catMatch[2].trim().replace(/^["']|["']$/g, '');
      if (id === categoryId) {
        inCategory = true;
        categoryIndent = catMatch[1].length;
        continue;
      } else if (inCategory) {
        // Moved to a different category; the insert point is here.
        insertIdx = i;
        break;
      }
    }

    if (!inCategory) continue;

    // Detect `sounds:` within this category
    const soundsMatch = line.match(/^(\s*)sounds:/);
    if (soundsMatch && soundsLineIdx === -1) {
      soundsLineIdx = i;
      // Check if sounds list is empty (no entries follow at deeper indent)
      const entryIndent = soundsMatch[1].length + 2; // `- ` under sounds
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j];
        // End of frontmatter
        if (nextLine.match(/^---\s*$/)) {
          insertIdx = j;
          break;
        }
        // Another key at category level or a new category item
        if (nextLine.trim() !== '' && !nextLine.match(/^\s*#/)) {
          const nextIndent = nextLine.match(/^(\s*)/)[1].length;
          if (nextIndent <= soundsMatch[1].length && nextLine.trim() !== '') {
            insertIdx = j;
            break;
          }
          // An entry within sounds (starts with `- ` at the right indent)
          if (nextLine.match(/^\s*- /) && nextIndent >= entryIndent) {
            // Keep going, looking for the end of entries
            j++;
            continue;
          }
          // A continuation line of an entry
          if (nextIndent > soundsMatch[1].length) {
            j++;
            continue;
          }
          insertIdx = j;
          break;
        }
        j++;
      }
      if (insertIdx === -1) {
        insertIdx = j; // End of file / frontmatter
      }
      break;
    }
  }

  if (soundsLineIdx === -1) {
    return { found: false, categoryFound: inCategory };
  }

  return { found: true, insertIdx, soundsLineIdx };
}

function spliceEntry(raw, categoryId, yamlEntry) {
  // B3 fix: replace inline empty list `sounds: []` with block form before splicing
  const inlineEmptyRe = new RegExp(`^(\\s*sounds:\\s*)\\[\\]\\s*$`, 'gm');
  let prepared = raw;
  const lines0 = raw.split('\n');
  // Only replace the `sounds: []` that belongs to the target category
  let inCat = false;
  for (let i = 0; i < lines0.length; i++) {
    const catMatch = lines0[i].match(/^(\s*)- id:\s*(.+)$/);
    if (catMatch) {
      inCat = catMatch[2].trim().replace(/^["']|["']$/g, '') === categoryId;
    }
    if (inCat && /^\s*sounds:\s*\[\]\s*$/.test(lines0[i])) {
      lines0[i] = lines0[i].replace(/\[\]\s*$/, '');
      prepared = lines0.join('\n');
      break;
    }
  }

  const result = findCategorySoundsInsertPoint(prepared, categoryId);

  if (!result.found && !result.categoryFound) {
    return { success: false, error: `category "${categoryId}" not found in the manifest.` };
  }

  if (!result.found) {
    return { success: false, error: `category "${categoryId}" has no \`sounds:\` key.` };
  }

  const lines = prepared.split('\n');
  lines.splice(result.insertIdx, 0, yamlEntry);
  return { success: true, content: lines.join('\n') };
}

// -- Main --

const opts = parseArgs(process.argv);

if (opts.files.length === 0) {
  console.error('FAIL: no audio file(s) specified.');
  console.error('Usage: npm run sounds:add -- <audio-path> --title <title> --location <location> --credit <credit> --category <category-id>');
  process.exit(2);
}

for (const required of ['title', 'location', 'credit', 'category']) {
  if (!opts[required]) {
    console.error(`FAIL: --${required} is required.`);
    process.exit(2);
  }
}

const root = resolve(opts.root);
const manifestPath = join(root, MANIFEST_PATH);
const soundsDir = join(root, 'public', 'media', 'sounds');

// ffmpeg is an unconditional prerequisite: mp3 input is re-muxed rather than
// copied, because copying would publish the recording's capture metadata. Checked
// once, before anything is written, so a missing ffmpeg cannot leave a half-done
// ingest behind.
if (!ffmpegAvailable()) {
  console.error(
    'FAIL: ffmpeg is not on PATH.\n' +
      '  Every recording is written through ffmpeg so its capture metadata (GPS,\n' +
      '  timestamp, device make and model, OS version) is stripped before publishing.\n' +
      '  mp3 input is re-muxed losslessly rather than copied, so this applies to it too.\n' +
      '  Install ffmpeg:\n' +
      '    macOS:  brew install ffmpeg\n' +
      '    Ubuntu: sudo apt install ffmpeg',
  );
  process.exit(1);
}

mkdirSync(soundsDir, { recursive: true });

for (const inputFile of opts.files) {
  const inputPath = resolve(inputFile);
  if (!existsSync(inputPath)) {
    console.error(`FAIL: input file does not exist: ${inputFile}`);
    process.exit(1);
  }

  const slug = opts.slug || slugify(inputFile);

  // B6 fix: validate slug contains no path traversal or separators
  if (/[\/\\]/.test(slug) || slug.includes('..') || slug === '' || slug === '.') {
    console.error(
      `FAIL: slug "${slug}" is invalid (must not contain path separators or ".." segments).`,
    );
    process.exit(1);
  }

  const outputFilename = `${slug}.mp3`;
  const outputPath = join(soundsDir, outputFilename);

  // DoD 3: strictly additive -- refuse if slug already exists (file OR manifest)
  if (existsSync(outputPath)) {
    console.error(
      `FAIL: "${outputFilename}" already exists at ${outputPath}.\n` +
        `  The manifest at ${MANIFEST_PATH} may already have an entry for this slug.\n` +
        '  This script is strictly additive and will not overwrite. ' +
        'To update, edit the manifest by hand.',
    );
    process.exit(1);
  }

  // B4 fix: also check the manifest for an existing reference to this file
  const publicPath = `/media/sounds/${outputFilename}`;
  if (existsSync(manifestPath)) {
    const currentManifest = readFileSync(manifestPath, 'utf8');
    if (currentManifest.includes(publicPath)) {
      console.error(
        `FAIL: the manifest at ${MANIFEST_PATH} already references "${publicPath}".\n` +
          '  This script is strictly additive and will not create a duplicate entry. ' +
          'To update, edit the manifest by hand.',
      );
      process.exit(1);
    }
  }

  // Re-encoding is conditional on the extension; stripping metadata is not. mp3
  // input takes the lossless re-mux path, everything else is converted, and both
  // carry FFMPEG_STRIP_ARGS.
  const ext = extname(inputFile).toLowerCase();
  try {
    if (ext === '.mp3') {
      remuxMp3(inputPath, outputPath);
      console.log(`re-muxed, metadata stripped: ${inputFile} -> ${outputPath}`);
    } else {
      convertToMp3(inputPath, outputPath);
      console.log(`converted, metadata stripped: ${inputFile} -> ${outputPath}`);
    }
  } catch (err) {
    // ffmpeg may have created the output before failing. Remove it: leaving a
    // partial file behind would make the next run refuse the slug as an existing
    // recording, and the strictly-additive rule is about entries that were really
    // published, not about wreckage from a failed one.
    rmSync(outputPath, { force: true });
    const detail = (err.stderr || '').toString().trim().split('\n').slice(-3).join('\n  ');
    console.error(
      `FAIL: ffmpeg could not process "${inputFile}".\n` +
        (detail ? `  ${detail}\n` : '') +
        '  Nothing was published and nothing was appended to the manifest.',
    );
    process.exit(1);
  }

  // Read or create manifest
  let manifestRaw;
  if (existsSync(manifestPath)) {
    manifestRaw = readFileSync(manifestPath, 'utf8');
  } else {
    const catIcon = opts.categoryIcon || opts.icon || '\u{1F3B5}';
    mkdirSync(join(root, 'knowledge', 'sounds'), { recursive: true });
    manifestRaw = createEmptyManifest(opts.category, catIcon);
    console.log(`created: ${MANIFEST_PATH}`);
  }

  const yamlEntry = buildYamlEntry({
    title: opts.title,
    location: opts.location,
    credit: opts.credit,
    outputFilename,
    description: opts.description,
    icon: opts.icon,
    contributor: opts.contributor,
    contributorUrl: opts.contributorUrl,
    date: opts.date,
  });

  const result = spliceEntry(manifestRaw, opts.category, yamlEntry);
  if (!result.success) {
    console.error(`FAIL: ${result.error}`);
    process.exit(1);
  }

  writeFileSync(manifestPath, result.content);
  console.log(`appended: entry for "${opts.title}" to category "${opts.category}" in ${MANIFEST_PATH}`);
}
