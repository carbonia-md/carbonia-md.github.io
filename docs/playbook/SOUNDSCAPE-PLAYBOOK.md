# Soundscape Playbook

How to add a recording to the `/soundscape` page. Hand-editing the manifest is a
first-class path throughout; the script handles the mechanical half (conversion,
file placement, and entry appending) and nothing else.

## Prerequisites

- **ffmpeg** on PATH, for every input format including mp3. Non-mp3 input (wav,
  m4a, ogg, flac) is converted; mp3 input is re-muxed rather than copied, so that
  its capture metadata is stripped too (see [Capture metadata](#capture-metadata)).
  Without ffmpeg the script refuses to publish anything.
  - macOS: `brew install ffmpeg`
  - Ubuntu: `sudo apt install ffmpeg`
- **Node 22+** (the project's engine requirement).

## Workflow

### 1. Record

Capture the audio. Any format works; ffmpeg converts to mp3 on ingest. Aim for
30-90 seconds of ambient sound that represents the location.

### 2. Convert and add

```
npm run sounds:add -- <audio-file> \
  --title "Morning birdsong at the trailhead" \
  --location "Main trailhead, east side" \
  --credit "Your Name" \
  --category nature \
  --description "Dawn chorus recorded from the bench beside the parking area." \
  --date 2026-01-15
```

The script:
- Derives a slug from the filename (override with `--slug`).
- Writes the mp3 into `public/media/sounds/<slug>.mp3` through ffmpeg, stripping
  the recording's capture metadata.
- Appends a YAML entry to the named category's `sounds:` list in the manifest.
- Creates `knowledge/sounds/_manifest.md` if it does not exist.

**Slug derivation:** the input filename, lowercased, with non-alphanumeric runs
replaced by a single hyphen, and leading/trailing hyphens stripped. For example,
`Bell Buoy (offshore).wav` becomes `bell-buoy-offshore`. Override with `--slug`
when the default is unclear.

**Multiple files:** pass several audio paths in one invocation when they share
the same metadata (same title, location, credit, category). Each gets its own
slug derived from its filename. For recordings with different metadata, run the
command once per recording.

### 3. Verify

```
npm run sounds:check
```

This gate validates the manifest against the filesystem. It exits nonzero on
missing fields, unresolved files, path escapes, duplicate category ids, or a
published file that still carries a metadata tag. Orphan files (anything under
`public/media/sounds/` that no manifest entry references) are reported as
warnings.

### 4. Build

```
npm run build
```

The `sounds:check` gate runs as part of `postbuild`, so a successful build proves
the manifest is consistent with `public/media/sounds/`.

### 5. Commit

Stage the new mp3, the updated manifest, and any other touched files:

```
git add public/media/sounds/<slug>.mp3 knowledge/sounds/_manifest.md
git commit -m "soundscape: add <title>"
```

## Capture metadata

A recording made on a phone carries far more than audio. Consumer devices write
the capture coordinates (usually to within about ten metres), the capture
timestamp, the device make and model, and the OS version into the file's
container. Publishing the file publishes all of it: anyone can download the
asset and read those fields. A recording made near home publishes where home is.

**Ingest strips it.** `npm run sounds:add` writes every published file through
ffmpeg with metadata mapping disabled, so none of the input's tags reach
`public/media/sounds/`. This is why ffmpeg is required even for mp3 input: an mp3
is re-muxed (audio frames copied unchanged, so nothing is re-encoded and nothing
is lost) rather than copied byte-for-byte. There is no opt-out flag. The
`location` field in the manifest is the place description readers see, written in
your own words and at the precision you choose.

**Hand-placed files are gated.** Placing a file into `public/media/sounds/`
yourself and writing its manifest entry by hand is a supported path, and it
bypasses the script entirely, so `npm run sounds:check` enforces the same rule
from the other side: a published recording carries **no metadata tag of any
kind**, not merely no location tag. The gate reads every file under
`public/media/sounds/`, whatever its extension — what publishes a file is the
directory it sits in, not its name — and rejects any tag it finds. It names the
file and the tag form, and adds the offending frame identifiers when the tag has
a frame area it can read (an ID3v1 trailer and an APE footer have none to name).
It also prints the command to strip the file:

```
ffmpeg -i <file>.mp3 -map_metadata -1 -map_chapters -1 -id3v2_version 0 -c:a copy <stripped>.mp3
```

The rule is absolute rather than a list of sensitive fields because the page
never reads the audio file's tags: title, location, credit, and date all come
from the manifest. A tag on a published asset buys nothing, so there is no reason
to keep one and no benign case to carve out.

**It is not retroactive.** Files committed before this ingest behavior shipped
keep whatever their recording device wrote. Re-run `npm run sounds:add` on the
original recording, or strip the committed file in place with the command above,
and commit the result. `npm run sounds:check` tells you which files are affected.

## Hand-editing the manifest

The manifest at `knowledge/sounds/_manifest.md` is plain YAML frontmatter. You
can always edit it directly to:

- Reorder entries within a category.
- Edit metadata (title, description, credit, date).
- Move an entry between categories.
- Remove an entry (delete the YAML block and optionally the mp3).
- Add a new category (with `id`, `icon`, `title`, and an empty `sounds: []`).
- Add or edit wishlist entries.

The script will not touch anything outside the entry it appends. Comments, key
order, multi-line descriptions, and blank lines are preserved byte-for-byte.

## The `credit` field

Every recording carries a `credit` field. Under the content license this
attribution is reused whenever the recording is embedded, excerpted, or
redistributed. Write it as you want to be credited: your name, handle, or
organization. Synthesized demo clips credit themselves as such rather than
claiming a place.

## What the script will and will not do

**Will:**
- Convert or re-mux the audio file, stripping its capture metadata either way.
- Append an entry to the named category.
- Create the manifest from scratch when absent.

**Will not:**
- Update an existing entry (edit by hand).
- Delete an entry or its file (delete by hand).
- Reorder entries (reorder by hand).
- Reserialize or reformat the manifest.
- Touch anything outside the appended entry.
