// mp3-tags.mjs -- the single definition of "a published soundscape asset carries
// no metadata", shared by the writer and the gate.
//
// Consumer phones write capture GPS, timestamp, device make/model, and OS version
// into the recording's container; ffmpeg copies input metadata to the output by
// default and Astro copies public/ into dist/ byte-for-byte, so without an explicit
// strip every published clip carries its own coordinates. The soundscape page reads
// title, location, and credit from the manifest and NEVER from the audio file, so a
// tag on a published asset buys nothing and risks everything.
//
// That asymmetry is why the rule here is absolute rather than a denylist of
// identifying frames: ANY metadata tag on a published asset is a finding. An
// absolute rule is decidable, has no field list to drift, and cannot be defeated by
// a frame name nobody thought of.
//
//   - FFMPEG_STRIP_ARGS is what the writer passes so its output has no tag at all.
//   - scanMp3Tags() is what the gate uses to reject a file that has one anyway,
//     which is the half that covers hand-placed files.
//
// The two live together so the writer cannot drift from the gate that judges it.
//
// Tag forms detected (the three sidecar containers an mp3 can carry, plus a
// wrong-container check):
//
//   ID3v2  -- 'ID3' at offset 0. Where every observed phone leak lives.
//   ID3v1  -- a trailing 128-byte block starting 'TAG'.
//   APE    -- an APEv1/v2 'APETAGEX' footer at the end of the file.
//   container -- the bytes carry a recognized non-mp3 container signature, which
//                is how an unmodified .m4a or .wav renamed to .mp3 would smuggle a
//                full metadata atom past an ID3-only scan.
//
// Frame identifiers are reported to make a finding actionable, never to decide it:
// a tag whose frames this file cannot parse (an extended header, an exotic
// unsynchronisation scheme) is still a finding, with a less specific detail string.
//
// This file lives under scripts/, which both machine gates scan: its source is
// pure ASCII and carries no denylisted place term.

// ffmpeg arguments that produce an mp3 with no metadata tag of any kind:
//   -map_metadata -1   drop every input tag rather than copying it to the output
//   -map_chapters -1   drop chapter markers, which carry their own titles
//   -id3v2_version 0   suppress the ID3v2 tag ffmpeg writes on its own; without
//                      this the muxer still emits a TSSE encoder frame, so the
//                      output has a tag even when the input had none
export const FFMPEG_STRIP_ARGS = [
  '-map_metadata', '-1',
  '-map_chapters', '-1',
  '-id3v2_version', '0',
];

// Human-readable summary of what the strip removes, for error messages.
export const STRIPPED_SUMMARY =
  'capture coordinates, capture timestamp, device make and model, OS version, ' +
  'and every other container tag';

const MAX_REPORTED_FRAMES = 12;

function syncsafe(buf, offset) {
  return (
    ((buf[offset] & 0x7f) << 21) |
    ((buf[offset + 1] & 0x7f) << 14) |
    ((buf[offset + 2] & 0x7f) << 7) |
    (buf[offset + 3] & 0x7f)
  );
}

function uint32(buf, offset) {
  return buf.readUInt32BE(offset);
}

function uint24(buf, offset) {
  return (buf[offset] << 16) | (buf[offset + 1] << 8) | buf[offset + 2];
}

// Description of a TXXX/TXX frame: one encoding byte, then a null-terminated
// description, then the value. The description is what carries the vendor key
// (`com.apple.quicktime.location.ISO6709` and friends), so it is the useful half.
function txxxDescription(payload) {
  if (payload.length < 2) return null;
  const encoding = payload[0];
  const body = payload.subarray(1);
  if (encoding === 0x01 || encoding === 0x02) {
    // UTF-16: terminated by a 0x0000 pair on an even boundary.
    for (let i = 0; i + 1 < body.length; i += 2) {
      if (body[i] === 0 && body[i + 1] === 0) {
        return body.subarray(0, i).toString('utf16le').replace(/^\uFEFF/, '');
      }
    }
    return null;
  }
  const end = body.indexOf(0);
  if (end === -1) return null;
  return body.subarray(0, end).toString('latin1');
}

// Frame identifiers present in an ID3v2 tag, best-effort. An unparseable frame
// area ends the walk; it never changes the verdict, only the detail string.
function id3v2Frames(buf, major, tagStart, tagEnd) {
  const frames = [];
  const idLength = major === 2 ? 3 : 4;
  const sizeLength = major === 2 ? 3 : 4;
  let pos = tagStart;

  while (pos + idLength + sizeLength <= tagEnd && frames.length < MAX_REPORTED_FRAMES) {
    const id = buf.subarray(pos, pos + idLength).toString('latin1');
    if (!/^[A-Z0-9]+$/.test(id)) break; // padding or an area this walk cannot read
    const sizeOffset = pos + idLength;
    let size;
    if (major === 2) size = uint24(buf, sizeOffset);
    else if (major === 4) size = syncsafe(buf, sizeOffset);
    else size = uint32(buf, sizeOffset);
    if (size <= 0) break;

    const headerLength = major === 2 ? 6 : 10;
    const payloadStart = pos + headerLength;
    const payloadEnd = payloadStart + size;
    if (payloadEnd > tagEnd) break;

    if (id === 'TXXX' || id === 'TXX') {
      const description = txxxDescription(buf.subarray(payloadStart, payloadEnd));
      frames.push(description ? `${id}:${description}` : id);
    } else {
      frames.push(id);
    }
    pos = payloadEnd;
  }

  return frames;
}

function scanId3v2(buf) {
  if (buf.length < 10) return null;
  if (buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return null; // 'ID3'

  const major = buf[3];
  const flags = buf[5];
  const size = syncsafe(buf, 6);
  const tagEnd = Math.min(10 + size, buf.length);
  const hasExtendedHeader = (flags & 0x40) !== 0;

  const frames = hasExtendedHeader ? [] : id3v2Frames(buf, major, 10, tagEnd);
  const detail = frames.length > 0
    ? `frames: ${frames.join(', ')}`
    : 'frame identifiers not readable from this tag';

  return { form: `ID3v2.${major}`, detail };
}

function scanId3v1(buf) {
  if (buf.length < 128) return null;
  const tail = buf.subarray(buf.length - 128);
  if (tail[0] !== 0x54 || tail[1] !== 0x41 || tail[2] !== 0x47) return null; // 'TAG'
  return { form: 'ID3v1', detail: 'trailing 128-byte TAG block' };
}

function scanApe(buf) {
  // The APE footer is the last 32 bytes of the tag, which sits either at the very
  // end of the file or immediately before an ID3v1 block.
  const candidates = [buf.length - 32, buf.length - 128 - 32];
  for (const offset of candidates) {
    if (offset < 0) continue;
    if (buf.subarray(offset, offset + 8).toString('latin1') === 'APETAGEX') {
      const version = buf.readUInt32LE(offset + 8);
      return {
        form: version >= 2000 ? 'APEv2' : 'APEv1',
        detail: 'APETAGEX footer',
      };
    }
  }
  return null;
}

// Containers that are recognizably NOT mp3, matched by their own signature.
//
// This identifies wrong containers positively rather than requiring an MPEG frame
// sync at a computed offset. A negative test would reject an odd-but-valid mp3
// that carries padding before its first frame, and a false positive here breaks an
// adopter's build over a file that leaks nothing. The cost is that a container
// with no signature below goes unrecognized; the containers a phone or an editor
// actually produces are all here.
const FOREIGN_CONTAINERS = [
  { name: 'RIFF/WAVE (.wav)', offset: 0, magic: 'RIFF' },
  { name: 'ISO base media (.m4a/.mp4/.mov)', offset: 4, magic: 'ftyp' },
  { name: 'Ogg (.ogg/.opus)', offset: 0, magic: 'OggS' },
  { name: 'FLAC (.flac)', offset: 0, magic: 'fLaC' },
  { name: 'AIFF (.aiff)', offset: 0, magic: 'FORM' },
  { name: 'Matroska/WebM (.mkv/.webm)', offset: 0, magic: '\x1a\x45\xdf\xa3' },
];

function scanContainer(buf) {
  for (const candidate of FOREIGN_CONTAINERS) {
    const end = candidate.offset + candidate.magic.length;
    if (buf.length < end) continue;
    if (buf.subarray(candidate.offset, end).toString('latin1') === candidate.magic) {
      return {
        form: 'container',
        detail:
          `not an mp3 -- the bytes are ${candidate.name}, whose own metadata this ` +
          'scan cannot read',
      };
    }
  }
  return null;
}

/**
 * Scan an mp3's bytes for metadata tags and for a wrong container.
 *
 * @param {Buffer} buf full file contents
 * @returns {{form: string, detail: string}[]} findings; empty means clean
 */
export function scanMp3Tags(buf) {
  const findings = [];

  const id3v2 = scanId3v2(buf);
  if (id3v2) findings.push({ form: id3v2.form, detail: id3v2.detail });

  const id3v1 = scanId3v1(buf);
  if (id3v1) findings.push(id3v1);

  const ape = scanApe(buf);
  if (ape) findings.push(ape);

  const container = scanContainer(buf);
  if (container) findings.push(container);

  return findings;
}
