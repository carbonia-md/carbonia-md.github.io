"""image_alt — inline image alt-text quality.

Complements image-health (count gate + file existence); this plugin gates
alt text **quality**.

Dimensions:
  1. Empty alt — `![](src)` missing alt entirely
  2. Generic alt — alt is a low-signal generic term
  3. Filename alt — alt is just a filename

Severity: WARN (soft launch; rewrite-stage-4 profile promotes to HARD).

Skip:
  - Hub pages (knowledge/{Category}/_*.md)
  - Image Sources sections (alt there is a descriptive caption)
"""

from __future__ import annotations
import os
import re
from typing import Any, Iterator

from ..types import FileTarget, Severity, Violation


CHECK_NAME = "image-alt"
DIMENSION = "media-quality"
DEFAULT_SEVERITY = Severity.WARN
EDITORIAL_REF = "docs/playbook/ARTICLE-PLAYBOOK.md §5 SEO Metadata + docs/playbook/REWRITE-PIPELINE.md Stage 4 Quality-checklist gate"

_RE_IMAGE = re.compile(r"!\[([^\]]*)\]\(([^)\n]+)\)")

# Generic / low-signal alt patterns (compared after lowercasing)
_GENERIC_ALT_PATTERNS = {
    "image", "photo", "picture", "img", "screenshot", "banner", "hero", "thumbnail",
}

# Filename patterns: ends with image extension
_RE_FILENAME_ALT = re.compile(
    r".+\.(jpg|jpeg|png|gif|webp|svg|avif|heic)$",
    re.IGNORECASE,
)


def _is_in_image_sources_section(body: str, image_pos: int) -> bool:
    """Skip alt check inside Image Sources section (alt there is descriptive caption)."""
    section_start = body.rfind("## Image Sources", 0, image_pos)
    if section_start < 0:
        return False
    next_h2 = body.find("\n## ", section_start + 1)
    if next_h2 < 0:
        next_h2 = len(body)
    return section_start < image_pos < next_h2


def _classify_alt(alt: str) -> str | None:
    """Return classification or None if alt looks OK.

    Categories:
      - "empty" — alt is blank
      - "generic" — alt is a low-signal generic term
      - "filename" — alt is just a filename
    """
    alt_stripped = alt.strip()
    if not alt_stripped:
        return "empty"

    alt_lower = alt_stripped.lower()
    if alt_lower in _GENERIC_ALT_PATTERNS:
        return "generic"

    if _RE_FILENAME_ALT.match(alt_stripped):
        return "filename"

    # Very short alt (< 4 chars after stripping punctuation) — likely uninformative
    cleaned = re.sub(r"[.,\s]", "", alt_stripped)
    if len(cleaned) < 4:
        return "generic"

    return None


def check(target: FileTarget, config: dict[str, Any]) -> Iterator[Violation]:
    """Detect inline image alt-text quality issues."""
    body = target.body or target.text
    if not body:
        return

    issues = {"empty": 0, "generic": 0, "filename": 0}
    samples = {"empty": [], "generic": [], "filename": []}

    for match in _RE_IMAGE.finditer(body):
        # Skip if inside Image Sources section
        if _is_in_image_sources_section(body, match.start()):
            continue

        alt = match.group(1)
        src = match.group(2)

        # Skip external icons / very tiny embedded (heuristic: skip if src looks
        # like an inline svg or data URI which often don't need alt)
        if src.startswith(("data:", "javascript:")):
            continue

        kind = _classify_alt(alt)
        if kind:
            issues[kind] += 1
            if len(samples[kind]) < 3:
                line_no = body.count("\n", 0, match.start()) + 1 + target.body_pad_lines
                snippet = match.group(0)[:80]
                samples[kind].append((line_no, snippet))

    total = sum(issues.values())
    if total == 0:
        return

    # Emit per-kind violations with samples
    for kind, count in issues.items():
        if count == 0:
            continue
        for line_no, snippet in samples[kind]:
            kind_msg = {
                "empty": "Image missing alt text — `![](...)` is unfriendly to screen readers and SEO",
                "generic": "Alt text too generic — 'image' / 'photo' etc. carry no semantic value",
                "filename": "Alt text is just a filename — describe the image content, not the file name",
            }[kind]
            yield Violation(
                check=CHECK_NAME,
                severity=DEFAULT_SEVERITY,
                message=kind_msg,
                line=line_no,
                snippet=snippet,
                editorial_ref=EDITORIAL_REF,
                fix_suggestion=(
                    "Write a sentence describing the image content: subject + scene + action, "
                    "or object + distinguishing feature. "
                    "Example: `![La Tour tower rising from the cliff at Victoria Beach](...)`  "
                    "Not: `![image](...)` / `![beach.jpg](...)`"
                ),
            )
