"""article_health.loader — file → FileTarget conversion.

Single canonical place for:
  - YAML frontmatter parsing
  - body extraction
  - protected-region detection (code / URL / HTML attr)
  - category / slug derivation from path
  - article eligibility (is_article_path — the tool's target contract)

Plugins should never re-parse the file — they consume FileTarget.
"""

from __future__ import annotations
import re
from pathlib import Path
from typing import Any

from .types import FileTarget


# Target contract: the tool runs on knowledge/{Category}/{slug}.md only.


def is_article_path(path: Path | str) -> bool:
    """True iff `path` is an article this tool checks.

    The contract is exactly: a `.md` file inside a category directory of a
    `knowledge/` tree, whose basename does not start with `_`
    (leading-underscore files are section hubs, not standalone articles).

    A `.md` file sitting DIRECTLY at `knowledge/` is a workflow queue a human
    edits -- `INBOX.md`, `SNIPPET-INBOX.md` -- never an article. It has no
    frontmatter and no category by design, so running the article checks over it
    reports a hard violation for a file that is behaving correctly, and the
    pre-commit hook then refuses the edit. `scripts/core/sync.sh` skips the same
    files for the same reason: the projection layer and this linter agree on what
    a root-level `knowledge/` file is.

    Matching is on path SEGMENTS, so both absolute and repo-relative paths are
    handled consistently, and `knowledge/{lang}/{Category}/*.md` qualifies too.
    Eligibility is enforced once at the CLI boundary; checks assume eligible
    input.
    """
    p = str(path).replace("\\", "/")
    if not p.endswith(".md"):
        return False
    parts = Path(p).parts
    if "knowledge" not in parts:
        return False
    # At least `knowledge/<dir>/<file>.md`: one directory between the tree root
    # and the file.
    if len(parts) - parts.index("knowledge") < 3:
        return False
    return not Path(p).name.startswith("_")

# Protected region patterns
_RE_FENCED_CODE = re.compile(r"```[\s\S]*?```", re.MULTILINE)
_RE_INLINE_CODE = re.compile(r"`[^`\n]+`")
# Link URL: `](...)` — exclude `)` AND newlines so a malformed link with a
# fullwidth close-paren instead of a halfwidth `)` doesn't eat across lines into
# the next link. A past incident showed `[^)]+` running until the far-away next
# halfwidth `)`, swallowing several lines and corrupting protected_regions.
_RE_MD_LINK_URL = re.compile(r"\]\([^)\n]+\)")
_RE_HTML_TAG = re.compile(r"<[^>\n]+>")
# Frontmatter delimiter
_RE_FRONTMATTER = re.compile(
    r"^---\s*\n(?P<yaml>.*?)\n---\s*\n(?P<body>.*)\Z",
    re.DOTALL,
)


def _parse_frontmatter_minimal(yaml_text: str) -> dict[str, Any]:
    """Lightweight YAML frontmatter parser — handles the subset this project uses.

    Not a full YAML parser. Falls back to PyYAML if installed, else uses
    a simple key: value parser for top-level scalar / list-on-one-line cases.
    Caller can pass already-parsed dict via FileTarget directly if richer
    parsing is needed.

    Supported:
      key: 'string'          → str
      key: "string"          → str
      key: bare-string       → str
      key: 2026-05-04        → str (date)
      key: true/false        → bool
      key: 12                → int
      key: ['a', 'b']        → list[str] (only single-line lists)
      key: [a, b, c]         → list[str]

    Caller-side note: for our use cases (title/category/lang/slug/tags),
    this minimal parser is sufficient. Tests guard the surface area.
    """
    try:
        import yaml  # type: ignore[import-untyped]

        return yaml.safe_load(yaml_text) or {}
    except ImportError:
        pass

    out: dict[str, Any] = {}
    lines = yaml_text.splitlines()
    i = 0
    while i < len(lines):
        raw_line = lines[i]
        line = raw_line.rstrip()
        i += 1
        if not line or line.startswith("#"):
            continue
        m = re.match(r"^([A-Za-z][\w-]*):\s*(.*)$", line)
        if not m:
            continue
        key, val = m.group(1), m.group(2).strip()
        if not val:
            # Empty top-level value — peek at the first non-blank continuation
            # line to classify the block shape:
            #   1. block sequence:            key:\n  - item\n  - item
            #   2. multiline flow array:      key:\n  [\n 'a',\n 'b',\n  ]  (prettier-wrapped)
            #   3. nested mapping (1 level):  key:\n  child: value
            j = i
            while j < len(lines) and not lines[j].strip():
                j += 1
            first = lines[j].strip() if j < len(lines) else ""

            # 1. Block sequence
            if first.startswith("- "):
                seq: list[str] = []
                i = j
                while i < len(lines):
                    s = lines[i].strip()
                    if not s:
                        i += 1
                        continue
                    item_m = re.match(r"^-\s+(.*)$", s)
                    if not item_m:
                        break
                    item = item_m.group(1).strip().strip("'\"")
                    if item:
                        seq.append(item)
                    i += 1
                out[key] = seq
                continue

            # 2. Multiline flow array (accumulate until the closing `]`)
            if first.startswith("["):
                buf = ""
                i = j
                while i < len(lines):
                    buf += lines[i].strip()
                    i += 1
                    if "]" in buf:
                        break
                inner = buf[buf.find("[") + 1 : buf.rfind("]")].strip()
                if not inner:
                    out[key] = []
                else:
                    parts = [p.strip().strip("'\"") for p in inner.split(",")]
                    out[key] = [p for p in parts if p]
                continue

            # 3. Nested mapping: indented `child: value`.
            nested: dict[str, Any] = {}
            while i < len(lines):
                peek = lines[i]
                peek_stripped = peek.rstrip()
                if not peek_stripped:
                    i += 1
                    continue
                child_m = re.match(
                    r"^\s+([A-Za-z_][\w-]*):\s*(.*)$", peek_stripped
                )
                if not child_m:
                    break
                ckey = child_m.group(1)
                cval = child_m.group(2).strip()
                if (cval.startswith("'") and cval.endswith("'")) or (
                    cval.startswith('"') and cval.endswith('"')
                ):
                    cval = cval[1:-1]
                nested[ckey] = cval
                i += 1
            out[key] = nested if nested else ""
            continue
        # List: [a, b, c] or ['a', 'b']
        if val.startswith("[") and val.endswith("]"):
            inner = val[1:-1].strip()
            if not inner:
                out[key] = []
            else:
                items = [
                    s.strip().strip("'\"")
                    for s in re.split(r",(?![^\[\]]*\])", inner)
                ]
                out[key] = [s for s in items if s]
            continue
        # Quoted string
        if (val.startswith("'") and val.endswith("'")) or (
            val.startswith('"') and val.endswith('"')
        ):
            out[key] = val[1:-1]
            continue
        # Bool
        if val == "true":
            out[key] = True
            continue
        if val == "false":
            out[key] = False
            continue
        # Int
        if val.isdigit():
            out[key] = int(val)
            continue
        # Bare string (date, plain text)
        out[key] = val
    return out


def _detect_protected_regions(body: str) -> list[tuple[int, int, str]]:
    """Find regions where punctuation/text rules should NOT apply.

    Order matters — fenced code first (greedy multi-line), then inline patterns.
    Returns sorted, non-overlapping list of (start, end, kind).
    """
    regions: list[tuple[int, int, str]] = []
    masked = list(body)
    placeholder = "\x00"  # avoid re-matching inside

    def _add_and_mask(pattern: re.Pattern, kind: str) -> None:
        for m in pattern.finditer("".join(masked)):
            regions.append((m.start(), m.end(), kind))
            for i in range(m.start(), m.end()):
                if i < len(masked):
                    masked[i] = placeholder

    # Fenced code blocks: greedy ```...```
    _add_and_mask(_RE_FENCED_CODE, "fenced-code")
    # Inline code spans: `...` (single line)
    _add_and_mask(_RE_INLINE_CODE, "inline-code")
    # Markdown link URLs: ](url) — protects URL only, not anchor text
    _add_and_mask(_RE_MD_LINK_URL, "link-url")
    # HTML tags: <...> (single line)
    _add_and_mask(_RE_HTML_TAG, "html-tag")

    return sorted(regions, key=lambda r: r[0])


def _derive_meta_from_path(path: Path) -> tuple[str, str]:
    """Returns (category, slug) from a knowledge/{Category}/{slug}.md path."""
    parts = path.parts
    try:
        idx = parts.index("knowledge")
    except ValueError:
        return ("", path.stem)
    rest = parts[idx + 1 :]
    category = rest[0] if rest else ""
    return (category, path.stem)


def load_target(path: Path | str) -> FileTarget:
    """Read file, parse frontmatter, prep protected regions, return FileTarget.

    `body` is padded with leading blank lines equal to the frontmatter line
    count, so any line number computed from `body` matches the original file's
    line number. This keeps every plugin's reported line numbers correct
    without each plugin needing to track a frontmatter offset.
    """
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    fm: dict[str, Any] = {}
    fm_raw = ""
    body = text
    body_text_offset = 0
    pad_lines = 0
    m = _RE_FRONTMATTER.match(text)
    if m:
        fm_raw = m.group("yaml")
        fm = _parse_frontmatter_minimal(fm_raw)
        body_text_offset = m.start("body")
        # Count newlines in the frontmatter section (including the two ---
        # delimiter lines) so body's first content line aligns with the
        # original file line number.
        frontmatter_span = text[:body_text_offset]
        pad_lines = frontmatter_span.count("\n")
        body = ("\n" * pad_lines) + m.group("body")
    category, slug = _derive_meta_from_path(p)
    regions = _detect_protected_regions(body)
    return FileTarget(
        path=p,
        text=text,
        frontmatter=fm,
        frontmatter_raw=fm_raw,
        body=body,
        body_text_offset=body_text_offset,
        body_pad_lines=pad_lines,
        category=category,
        slug=slug,
        protected_regions=regions,
    )
