"""frontmatter_format — canonical frontmatter formatter checks.

Complements `frontmatter-title`: this plugin checks YAML/frontmatter
structure and formatting, not title prose quality.

Rules mirror REWRITE-PIPELINE Stage 4:
  - articles need complete core fields
  - core fields should appear in canonical relative order
  - string scalar fields use single quotes
  - tags use Prettier-stable flow style: `tags: ['a', 'b']`, which may wrap
    into bracketed multiline YAML when the array is long

Severity model:
  - HARD: missing frontmatter, missing required field, invalid field type
  - WARN: formatter style/order issues. `rewrite-stage-4` promotes these
    WARNs to HARD via config so pipeline runs block on bad formatting without
    making every legacy touch in pre-commit impossible.

Auto-fix (--fix):
  Safe HARD violations that can be fixed deterministically:
  - Missing `category` → inferred from file path folder name
  - Missing `featured` → false
  - Missing `author` → the instance brand author from place.config.ts
  - Missing `lastVerified` → copies `date` field value
  - Missing `lastHumanReview` → false
  - `lastHumanReview` not boolean:
      date string (YYYY-MM-DD) → true  (a date implies prior human review)
      empty string / other → false
  - `category` value mismatch with path → corrected to path's folder name
  - `date` not YYYY-MM-DD → attempts to reformat common variants

  Safe WARN violations (formatter style) also auto-fixed since 2026-05-08:
  - List-mode tags (`tags:\n  - a\n  - b`) → flow array (`tags: ['a', 'b']`)
  - Out-of-order canonical fields → re-sorted per CANONICAL_ORDER
    (preserves comments and unknown/optional fields at end)
  - Single-line scalar fields missing single quotes
  - `date` / `lastVerified` wrapped in quotes → unquoted
  - Bool fields with quoted true/false → unquoted

  Together these turn frontmatter format conflicts from manual rebase work
  into a one-shot pre-commit auto-fix.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Iterator

from ..place import brand_author
from ..types import FileTarget, Severity, Violation


CHECK_NAME = "frontmatter-format"
DIMENSION = "frontmatter"
DEFAULT_SEVERITY = Severity.WARN
EDITORIAL_REF = "docs/playbook/REWRITE-PIPELINE.md Stage 4 Quality-checklist gate"

REQUIRED_FIELDS = [
    "title",
    "description",
    "date",
    "category",
    "tags",
    "subcategory",
    "author",
    "featured",
    "lastVerified",
    "lastHumanReview",
]

CANONICAL_ORDER = REQUIRED_FIELDS + [
    "researchReport",
    "image",
    "imageAlt",
    "imageCredit",
    "imageLicense",
    "imageSource",
]

SINGLE_QUOTED_SCALARS = {
    "title",
    "description",
    "category",
    "subcategory",
    "author",
}

DATE_FIELDS = {"date", "lastVerified"}
BOOL_FIELDS = {"featured", "lastHumanReview"}


def _line_for_key(lines: list[str], key: str) -> tuple[int, str] | None:
    pattern = re.compile(rf"^{re.escape(key)}\s*:")
    for idx, line in enumerate(lines, start=2):  # line 1 is opening ---
        if pattern.match(line):
            return idx, line
    return None


def _top_level_key(line: str) -> str | None:
    m = re.match(r"^([A-Za-z][\w-]*):", line)
    return m.group(1) if m else None


def _field_value(line: str) -> str:
    return line.split(":", 1)[1].strip()


def _is_single_quoted(value: str) -> bool:
    return len(value) >= 2 and value.startswith("'") and value.endswith("'")


def _is_iso_date(value: str) -> bool:
    return re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) is not None


def _line_snippet(lines: list[str], line_no: int | None) -> str | None:
    if line_no is None:
        return None
    idx = line_no - 2
    if 0 <= idx < len(lines):
        return lines[idx]
    return None


def _tags_uses_flow_array(lines: list[str], tags_line_idx: int, raw: str) -> bool:
    value = _field_value(raw)
    if value.startswith("["):
        return True

    if value:
        return False

    for next_line in lines[tags_line_idx:]:
        stripped = next_line.strip()
        if not stripped:
            continue
        return stripped.startswith("[")
    return False


def check(target: FileTarget, config: dict[str, Any]) -> Iterator[Violation]:
    if target.category == "About":
        return

    if not target.frontmatter_raw.strip():
        yield Violation(
            check=CHECK_NAME,
            severity=Severity.HARD,
            message="Missing frontmatter block (file must open with --- YAML --- wrapping metadata)",
            line=1,
            editorial_ref=EDITORIAL_REF,
        )
        return

    lines = target.frontmatter_raw.splitlines()
    key_lines: dict[str, tuple[int, str]] = {}
    duplicate_keys: dict[str, list[int]] = {}
    ordered_keys: list[tuple[str, int]] = []

    for idx, line in enumerate(lines, start=2):
        key = _top_level_key(line)
        if not key:
            continue
        ordered_keys.append((key, idx))
        if key in key_lines:
            duplicate_keys.setdefault(key, [key_lines[key][0]]).append(idx)
        else:
            key_lines[key] = (idx, line)

    # Required completeness + type checks
    for key in REQUIRED_FIELDS:
        if key not in target.frontmatter:
            yield Violation(
                check=CHECK_NAME,
                severity=Severity.HARD,
                message=f"frontmatter missing required field `{key}`",
                line=1,
                fix_suggestion=f"add `{key}` per Stage 4 canonical order",
                editorial_ref=EDITORIAL_REF,
            )

    for key, line_numbers in duplicate_keys.items():
        yield Violation(
            check=CHECK_NAME,
            severity=Severity.HARD,
            message=f"frontmatter field `{key}` appears more than once",
            line=line_numbers[1],
            snippet=", ".join(str(n) for n in line_numbers),
            fix_suggestion="keep one canonical field, remove the duplicates",
            editorial_ref=EDITORIAL_REF,
        )

    if "tags" in target.frontmatter and not all(
        isinstance(item, str) for item in target.frontmatter.get("tags", [])
    ):
        line = _line_for_key(lines, "tags")
        yield Violation(
            check=CHECK_NAME,
            severity=Severity.HARD,
            message="frontmatter `tags` must be an array of strings",
            line=line[0] if line else None,
            snippet=line[1] if line else None,
            fix_suggestion="use `tags: ['tag-one', 'tag-two']`",
            editorial_ref=EDITORIAL_REF,
        )
    elif "tags" in target.frontmatter and not isinstance(
        target.frontmatter.get("tags"), list
    ):
        line = _line_for_key(lines, "tags")
        yield Violation(
            check=CHECK_NAME,
            severity=Severity.HARD,
            message="frontmatter `tags` must be a YAML array, not a string",
            line=line[0] if line else None,
            snippet=line[1] if line else None,
            fix_suggestion="use `tags: ['tag-one', 'tag-two']`",
            editorial_ref=EDITORIAL_REF,
        )

    for key in BOOL_FIELDS:
        value = target.frontmatter.get(key)
        if key in target.frontmatter and not isinstance(value, bool):
            line = _line_for_key(lines, key)
            yield Violation(
                check=CHECK_NAME,
                severity=Severity.HARD,
                message=f"frontmatter `{key}` must be boolean true/false",
                line=line[0] if line else None,
                snippet=line[1] if line else None,
                editorial_ref=EDITORIAL_REF,
            )

    category_value = target.frontmatter.get("category")
    if isinstance(category_value, str) and category_value != target.category:
        line = _line_for_key(lines, "category")
        yield Violation(
            check=CHECK_NAME,
            severity=Severity.HARD,
            message=(
                f"frontmatter `category` ({category_value}) must match the path category"
                f" `{target.category}`"
            ),
            line=line[0] if line else None,
            snippet=line[1] if line else None,
            fix_suggestion=f"category: '{target.category}'",
            editorial_ref=EDITORIAL_REF,
        )

    # Canonical relative order. Unknown/optional fields are allowed, but the
    # canonical fields that do appear must keep REWRITE-PIPELINE order.
    canonical_positions = {key: i for i, key in enumerate(CANONICAL_ORDER)}
    filtered = [
        (key, line_no, canonical_positions[key])
        for key, line_no in ordered_keys
        if key in canonical_positions
    ]
    last_pos = -1
    last_key = ""
    for key, line_no, pos in filtered:
        if pos < last_pos:
            expected = " / ".join(CANONICAL_ORDER)
            yield Violation(
                check=CHECK_NAME,
                severity=DEFAULT_SEVERITY,
                message=(
                    f"frontmatter field order wrong: `{key}` appears after `{last_key}`"
                    " (violates Stage 4 canonical order)"
                ),
                line=line_no,
                snippet=_line_snippet(lines, line_no),
                fix_suggestion=f"core field order should be: {expected}",
                editorial_ref=EDITORIAL_REF,
            )
            break
        last_pos = pos
        last_key = key

    # Style checks: quote scalar strings, keep date/bool/path values unquoted,
    # and force tags into Prettier-stable flow array style.
    for key in SINGLE_QUOTED_SCALARS:
        line = _line_for_key(lines, key)
        if not line:
            continue
        line_no, raw = line
        value = _field_value(raw)
        if not _is_single_quoted(value):
            yield Violation(
                check=CHECK_NAME,
                severity=DEFAULT_SEVERITY,
                message=f"frontmatter `{key}` should use a single-quoted scalar",
                line=line_no,
                snippet=raw,
                fix_suggestion=f"{key}: '<value>'",
                editorial_ref=EDITORIAL_REF,
            )

    for key in DATE_FIELDS:
        line = _line_for_key(lines, key)
        if not line:
            continue
        line_no, raw = line
        value = _field_value(raw).strip("'\"")
        if not _is_iso_date(value):
            yield Violation(
                check=CHECK_NAME,
                severity=Severity.HARD,
                message=f"frontmatter `{key}` must be YYYY-MM-DD",
                line=line_no,
                snippet=raw,
                editorial_ref=EDITORIAL_REF,
            )
        elif _field_value(raw).startswith(("'", '"')):
            yield Violation(
                check=CHECK_NAME,
                severity=DEFAULT_SEVERITY,
                message=f"frontmatter `{key}` date should not be quoted",
                line=line_no,
                snippet=raw,
                fix_suggestion=f"{key}: {value}",
                editorial_ref=EDITORIAL_REF,
            )

    for key in BOOL_FIELDS:
        line = _line_for_key(lines, key)
        if not line:
            continue
        line_no, raw = line
        value = _field_value(raw)
        if value not in {"true", "false"}:
            yield Violation(
                check=CHECK_NAME,
                severity=DEFAULT_SEVERITY,
                message=f"frontmatter `{key}` should use unquoted true/false",
                line=line_no,
                snippet=raw,
                fix_suggestion=f"{key}: false",
                editorial_ref=EDITORIAL_REF,
            )

    tags_line = _line_for_key(lines, "tags")
    if tags_line:
        line_no, raw = tags_line
        if not _tags_uses_flow_array(lines, line_no - 1, raw):
            yield Violation(
                check=CHECK_NAME,
                severity=DEFAULT_SEVERITY,
                message="frontmatter `tags` should use a flow array (Prettier may wrap it)",
                line=line_no,
                snippet=raw,
                fix_suggestion="tags: ['tag-one', 'tag-two']",
                editorial_ref=EDITORIAL_REF,
            )
        elif re.search(r"[\[\],]\s*[^'\]\s,][^,\]]*", raw):
            # Best-effort style check: tags should be quoted strings in flow
            # arrays. YAML parser already handles correctness; this catches
            # unquoted tag style.
            yield Violation(
                check=CHECK_NAME,
                severity=DEFAULT_SEVERITY,
                message="frontmatter `tags` entries should each be single-quoted",
                line=line_no,
                snippet=raw,
                fix_suggestion="tags: ['tag-one', 'tag-two']",
                editorial_ref=EDITORIAL_REF,
            )


# ── Auto-fix helpers ──────────────────────────────────────────────────────────


def _insert_after_key(fm_text: str, anchor_key: str, new_line: str) -> str:
    """Insert `new_line` after the line that contains `anchor_key: ...`.

    If anchor_key is not found, appends to end of frontmatter text.
    Handles multiline YAML flow arrays on the anchor key line.
    Ensures the line before the insertion point ends with newline so the
    inserted line starts on its own line even when the anchor is the last
    line of the frontmatter block (which has no trailing newline per the
    regex capture in loader.py).
    """
    lines = fm_text.splitlines(keepends=True)
    insert_idx = len(lines)  # default: append at end
    i = 0
    while i < len(lines):
        if re.match(rf"^{re.escape(anchor_key)}\s*:", lines[i]):
            # Skip multiline flow arrays (tags: [\n  ...\n])
            j = i
            if "[" in lines[j] and "]" not in lines[j]:
                while j < len(lines) - 1 and "]" not in lines[j]:
                    j += 1
            insert_idx = j + 1
            break
        i += 1
    # Ensure the line before insertion ends with \n so the new line starts
    # on its own line (the last line of frontmatter_raw has no \n per loader).
    if insert_idx > 0 and not lines[insert_idx - 1].endswith("\n"):
        lines[insert_idx - 1] = lines[insert_idx - 1] + "\n"
    lines.insert(insert_idx, new_line if new_line.endswith("\n") else new_line + "\n")
    return "".join(lines)


def _replace_field_value(fm_text: str, key: str, new_value: str) -> str:
    """Replace `key: <anything>` with `key: new_value` (single-line fields only)."""
    return re.sub(
        rf"^({re.escape(key)}\s*:).*$",
        rf"\1 {new_value}",
        fm_text,
        flags=re.MULTILINE,
    )


def _parse_fm_blocks(fm_text: str) -> list[tuple[str, list[str]]]:
    """Parse frontmatter into list of (key, lines) blocks for reordering.

    Block ownership rules:
      - Comments and blank lines BEFORE a top-level key attach to that key
      - Continuation lines (multi-line values, list items, flow array bodies)
        attach to their parent key
      - Trailing comments after the last key form a final block with key=""

    Stable for round-trip: joining all blocks back produces the original text.
    """
    lines = fm_text.splitlines(keepends=True)
    blocks: list[tuple[str, list[str]]] = []
    pending: list[str] = []  # comments/blanks before next key
    current_key: str | None = None
    current_lines: list[str] = []

    for line in lines:
        stripped = line.lstrip()
        if not stripped or stripped.startswith("#"):
            pending.append(line)
            continue

        m = re.match(r"^([A-Za-z][\w-]*)\s*:", line)
        if m:
            # Flush previous block (without trailing pending comments —
            # those belong to the next block per "comments before key" rule)
            if current_key is not None:
                blocks.append((current_key, current_lines))
            current_key = m.group(1)
            current_lines = pending + [line]
            pending = []
        else:
            # Continuation line for current key
            if current_key is None:
                # Should not happen for well-formed frontmatter, but be safe
                pending.append(line)
            else:
                # Pending blank/comment lines that came before this continuation
                # belong to the current key (rare edge case: blank line in
                # middle of multi-line value)
                current_lines.extend(pending)
                pending = []
                current_lines.append(line)

    if current_key is not None:
        blocks.append((current_key, current_lines))
    if pending:
        # Trailing comments after last key — preserve as final orphan block
        blocks.append(("", pending))

    return blocks


def _reorder_canonical_fields(fm_text: str) -> tuple[str, bool]:
    """Reorder frontmatter fields per CANONICAL_ORDER.

    Returns (new_text, changed). `changed=False` if order was already canonical.

    Unknown/optional keys preserve their original relative order at the end.
    The trailing-comment orphan block (key="") always stays at the end.
    """
    blocks = _parse_fm_blocks(fm_text)
    canonical_idx = {key: i for i, key in enumerate(CANONICAL_ORDER)}

    # Detect whether canonical-ordered keys are already in canonical order
    canonical_indices = [canonical_idx[k] for k, _ in blocks if k in canonical_idx]
    if canonical_indices == sorted(canonical_indices):
        return fm_text, False

    canonical_blocks: list[tuple[int, str, list[str]]] = []
    other_blocks: list[tuple[str, list[str]]] = []
    orphan_blocks: list[tuple[str, list[str]]] = []

    for key, lines in blocks:
        if key == "":
            orphan_blocks.append((key, lines))
        elif key in canonical_idx:
            canonical_blocks.append((canonical_idx[key], key, lines))
        else:
            other_blocks.append((key, lines))

    # Sort canonical by the canonical position (stable since unique keys)
    canonical_blocks.sort(key=lambda x: x[0])

    new_blocks = (
        [(k, ls) for _, k, ls in canonical_blocks] + other_blocks + orphan_blocks
    )

    # Loader's regex strips the trailing `\n` before closing `---`, so the
    # ORIGINAL last block has no trailing `\n`. After reorder that block may
    # no longer be last, so we must restore `\n` to every non-final block to
    # avoid concatenation regressions like `lastHumanReview: falseimage: …`.
    rendered: list[str] = []
    for i, (_, lines) in enumerate(new_blocks):
        chunk = "".join(lines)
        if i < len(new_blocks) - 1 and not chunk.endswith("\n"):
            chunk += "\n"
        rendered.append(chunk)
    return "".join(rendered), True


def _convert_tags_to_flow(fm_text: str) -> tuple[str, bool]:
    """Convert list-mode tags to single-line flow array.

    Detects `tags:\\n  - a\\n  - b\\n` and replaces with `tags: ['a', 'b']\\n`.
    Leaves Prettier-wrapped flow arrays (`tags:\\n  [\\n    'a',\\n  ]\\n`)
    and existing single-line flow (`tags: [...]`) untouched.

    Returns (new_text, changed).
    """
    lines = fm_text.splitlines(keepends=True)
    new_lines: list[str] = []
    i = 0
    changed = False

    while i < len(lines):
        line = lines[i]
        stripped = line.rstrip("\n")
        # Match `tags:` with empty or whitespace-only value
        if re.match(r"^tags\s*:\s*$", stripped):
            # Look ahead for `  - item` lines
            j = i + 1
            items: list[str] = []
            while j < len(lines):
                nx = lines[j].rstrip("\n")
                m = re.match(r"^\s+-\s+(.+)$", nx)
                if not m:
                    break
                value = m.group(1).strip().strip("'\"")
                items.append(value)
                j += 1

            if items:
                # Use single quotes per SINGLE_QUOTED_SCALARS convention.
                # Items containing single quotes get wrapped in double quotes.
                quoted: list[str] = []
                for it in items:
                    if "'" in it:
                        quoted.append(f'"{it}"')
                    else:
                        quoted.append(f"'{it}'")
                new_lines.append(f"tags: [{', '.join(quoted)}]\n")
                i = j
                changed = True
                continue

        new_lines.append(line)
        i += 1

    return "".join(new_lines), changed


def _quote_flow_array_items(fm_text: str) -> tuple[str, bool]:
    """Add single quotes around unquoted items in single-line `tags: [a, b, c]`.

    Handles the `tags: [foo, bar]` → `tags: ['foo', 'bar']` case.
    Multi-line Prettier-wrapped arrays (`tags:\\n  [\\n    'a',\\n  ]`) are
    skipped — Prettier already quotes items in that style.

    Returns (new_text, changed).
    """
    pattern = re.compile(
        r"^(tags\s*:\s*\[)([^\]\n]*)(\][^\n]*)$",
        re.MULTILINE,
    )

    def _split_respecting_quotes(items_str: str) -> list[str]:
        parts: list[str] = []
        current = ""
        in_single = False
        in_double = False
        for ch in items_str:
            if ch == "'" and not in_double:
                in_single = not in_single
                current += ch
            elif ch == '"' and not in_single:
                in_double = not in_double
                current += ch
            elif ch == "," and not in_single and not in_double:
                if current.strip():
                    parts.append(current.strip())
                current = ""
            else:
                current += ch
        if current.strip():
            parts.append(current.strip())
        return parts

    changed_flag = [False]

    def _replace(match: re.Match[str]) -> str:
        prefix, items_str, suffix = match.group(1), match.group(2), match.group(3)
        items = _split_respecting_quotes(items_str)
        if not items:
            return match.group(0)

        quoted: list[str] = []
        any_changed = False
        for item in items:
            if item.startswith("'") and item.endswith("'") and len(item) >= 2:
                quoted.append(item)
            elif item.startswith('"') and item.endswith('"') and len(item) >= 2:
                # Convert "foo" → 'foo' (no escapes survive across this swap;
                # if the value has \ escapes we'd be unsafe — skip in that case)
                inner = item[1:-1]
                if "\\" in inner:
                    quoted.append(item)  # keep as-is
                else:
                    escaped = inner.replace("'", "''")
                    quoted.append(f"'{escaped}'")
                    any_changed = True
            else:
                escaped = item.replace("'", "''")
                quoted.append(f"'{escaped}'")
                any_changed = True

        if not any_changed:
            return match.group(0)
        changed_flag[0] = True
        return f"{prefix}{', '.join(quoted)}{suffix}"

    new_text = pattern.sub(_replace, fm_text)
    return new_text, changed_flag[0]


def _reformat_date(raw_value: str) -> str | None:
    """Try common date variants → YYYY-MM-DD. Returns None if unrecognisable.

    Also handles datetime objects (from PyYAML parsing) and ISO 8601 datetimes
    like `2026-03-24 23:00:00+00:00` or `2026-03-24T23:00:00Z`.
    """
    # PyYAML may parse a YAML timestamp into a datetime object
    if hasattr(raw_value, "strftime"):
        return raw_value.strftime("%Y-%m-%d")  # type: ignore[union-attr]
    v = str(raw_value).strip().strip("'\"")
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
        return v
    # YYYY-MM-DD HH:MM:SS... (datetime with optional timezone)
    m = re.match(r"(\d{4}-\d{2}-\d{2})[\sT]\d{2}:\d{2}", v)
    if m:
        return m.group(1)
    # YYYY/MM/DD
    m = re.fullmatch(r"(\d{4})/(\d{2})/(\d{2})", v)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    # MM/DD/YYYY
    m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", v)
    if m:
        return f"{m.group(3)}-{m.group(1).zfill(2)}-{m.group(2).zfill(2)}"
    return None


def fix(target: FileTarget, config: dict[str, Any]) -> int:
    """Auto-fix safe HARD violations in frontmatter.

    Returns the number of changes applied (0 = nothing changed).
    Writes the corrected file in place (unless config['dry_run'] is True).
    """
    if target.category == "About":
        return 0
    if not target.frontmatter_raw.strip():
        return 0  # missing frontmatter entirely — not safe to auto-create

    fm = target.frontmatter
    fm_text = target.frontmatter_raw  # mutable working copy (str)
    changes = 0
    dry_run = bool(config.get("dry_run", False))

    # ── 1. Fix `date` format ──────────────────────────────────────────────────
    # Check the RAW text value (not PyYAML-parsed), because PyYAML turns
    # "2026-03-24T23:00:00Z" into a datetime object whose .strftime gives
    # "2026-03-24" (looks fine) while the actual file still says "T23:00:00Z".
    raw_date = fm.get("date")
    if raw_date is not None:
        lines_fm = fm_text.splitlines()
        date_line = _line_for_key(lines_fm, "date")
        raw_text_val = _field_value(date_line[1]).strip("'\"") if date_line else ""
        if not _is_iso_date(raw_text_val):
            fixed = _reformat_date(raw_date)  # type: ignore[arg-type]
            if fixed:
                fm_text = _replace_field_value(fm_text, "date", fixed)
                fm = {**fm, "date": fixed}
                changes += 1

    # ── 2. Fix `category` value mismatch with path ───────────────────────────
    path_category = target.category  # derived from folder name (authoritative)
    current_category = fm.get("category")
    if (
        isinstance(current_category, str)
        and current_category != path_category
        and path_category
    ):
        fm_text = _replace_field_value(fm_text, "category", f"'{path_category}'")
        fm = {**fm, "category": path_category}
        changes += 1

    # ── 3. Fix bool fields not boolean ───────────────────────────────────────
    lhr = fm.get("lastHumanReview")
    if "lastHumanReview" in fm and not isinstance(lhr, bool):
        # Date string → true (a date means someone reviewed it)
        lhr_str = str(lhr).strip().strip("'\"")
        new_bool = "true" if _is_iso_date(lhr_str) and lhr_str else "false"
        fm_text = _replace_field_value(fm_text, "lastHumanReview", new_bool)
        fm = {**fm, "lastHumanReview": new_bool == "true"}
        changes += 1

    feat = fm.get("featured")
    if "featured" in fm and not isinstance(feat, bool):
        # Typo correction: "fales"→false, "treu"→true, unrecognised→false
        feat_str = str(feat).strip().lower().strip("'\"")
        new_bool = "true" if feat_str.startswith("t") else "false"
        fm_text = _replace_field_value(fm_text, "featured", new_bool)
        fm = {**fm, "featured": new_bool == "true"}
        changes += 1

    # ── 4. Add missing required fields ───────────────────────────────────────
    # Insertion order respects canonical order where possible.

    if "category" not in fm and path_category:
        # Insert after `date` (or before `tags` if date absent)
        anchor = "date" if "date" in fm else "title"
        fm_text = _insert_after_key(fm_text, anchor, f"category: '{path_category}'")
        fm = {**fm, "category": path_category}
        changes += 1

    author_default = brand_author()
    if "author" not in fm and author_default:
        anchor = "subcategory" if "subcategory" in fm else (
            "category" if "category" in fm else "tags"
        )
        fm_text = _insert_after_key(fm_text, anchor, f"author: '{author_default}'")
        fm = {**fm, "author": author_default}
        changes += 1

    if "featured" not in fm:
        anchor = "author" if "author" in fm else "subcategory"
        fm_text = _insert_after_key(fm_text, anchor, "featured: false")
        fm = {**fm, "featured": False}
        changes += 1

    if "lastVerified" not in fm:
        date_val = fm.get("date", "")
        if date_val:
            val = _reformat_date(date_val) or str(date_val).strip().strip("'\"")
        else:
            val = "2026-01-01"
        anchor = "featured" if "featured" in fm else "author"
        fm_text = _insert_after_key(fm_text, anchor, f"lastVerified: {val}")
        fm = {**fm, "lastVerified": val}
        changes += 1

    if "lastHumanReview" not in fm:
        anchor = "lastVerified" if "lastVerified" in fm else "featured"
        fm_text = _insert_after_key(fm_text, anchor, "lastHumanReview: false")
        fm = {**fm, "lastHumanReview": False}
        changes += 1

    # ── 5. Quote single-line scalar fields that need single quotes ───────────
    lines_now = fm_text.splitlines()
    for key in SINGLE_QUOTED_SCALARS:
        line = _line_for_key(lines_now, key)
        if not line:
            continue
        line_no, raw = line
        value = _field_value(raw)
        if not value:
            continue
        # Skip if value spans multiple lines (block scalar) — too risky to fix.
        if value in ("|", ">", "|-", ">-", "|+", ">+"):
            continue
        if not _is_single_quoted(value):
            # Convert double-quoted → single-quoted, but only if value has no
            # YAML double-quote-only escape sequences (\n, \t, \", \\, etc.).
            # If escapes are present, leaving as double-quoted is safer.
            if value.startswith('"') and value.endswith('"') and len(value) >= 2:
                inner = value[1:-1]
                if "\\" in inner:
                    continue  # has escape sequences — keep double-quoted
                # Inner already has any literal `"` as `\"` (impossible w/o `\`)
                # so plain `"…"` → `'…'` with single-quote doubling.
                escaped = inner.replace("'", "''")
                fm_text = _replace_field_value(fm_text, key, f"'{escaped}'")
                changes += 1
                lines_now = fm_text.splitlines()
                continue
            # Unquoted scalar (e.g. `category: Society`) → quote it
            escaped = value.replace("'", "''")
            fm_text = _replace_field_value(fm_text, key, f"'{escaped}'")
            changes += 1
            lines_now = fm_text.splitlines()  # refresh cache

    # ── 6. Unquote dates and bools that have stray quotes ────────────────────
    for key in DATE_FIELDS:
        line = _line_for_key(lines_now, key)
        if not line:
            continue
        _, raw = line
        value = _field_value(raw)
        if value.startswith(("'", '"')) and value.endswith(("'", '"')):
            inner = value[1:-1]
            if _is_iso_date(inner):
                fm_text = _replace_field_value(fm_text, key, inner)
                changes += 1
                lines_now = fm_text.splitlines()

    for key in BOOL_FIELDS:
        line = _line_for_key(lines_now, key)
        if not line:
            continue
        _, raw = line
        value = _field_value(raw)
        if value.startswith(("'", '"')) and value.endswith(("'", '"')):
            inner = value[1:-1].lower()
            if inner in {"true", "false"}:
                fm_text = _replace_field_value(fm_text, key, inner)
                changes += 1
                lines_now = fm_text.splitlines()

    # ── 7. Convert list-mode tags to flow array ──────────────────────────────
    fm_text_after_flow, flow_changed = _convert_tags_to_flow(fm_text)
    if flow_changed:
        fm_text = fm_text_after_flow
        changes += 1

    # ── 8. Quote unquoted items in single-line tags flow array ───────────────
    fm_text_after_quote, quote_changed = _quote_flow_array_items(fm_text)
    if quote_changed:
        fm_text = fm_text_after_quote
        changes += 1

    # ── 9. Reorder fields per canonical order (LAST step — runs after all
    # inserts/conversions so it sees the final field set) ─────────────────────
    fm_text_after_reorder, reorder_changed = _reorder_canonical_fields(fm_text)
    if reorder_changed:
        fm_text = fm_text_after_reorder
        changes += 1

    if not changes:
        return 0

    if dry_run:
        return changes

    # Match loader convention: frontmatter content has no trailing `\n`. If
    # reorder/conversion added one, strip before reassembly so we don't end up
    # with `…\n\n---\n` (blank line before closing fence).
    fm_text = fm_text.rstrip("\n")
    new_text = "---\n" + fm_text + "\n---\n" + target.text[target.body_text_offset:]
    Path(target.path).write_text(new_text, encoding="utf-8")
    return changes
