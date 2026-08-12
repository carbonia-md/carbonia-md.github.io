"""wikilink_target — verify [[X]] / [[X|Y]] targets resolve to real articles.

HARD pre-commit gate.

Resolution rule: target name must equal the basename (without .md) of an
existing source-language article under `knowledge/{Category}/`.
"""

from __future__ import annotations
import os
import re
from pathlib import Path
from typing import Any, Iterator

from ..types import FileTarget, Severity, Violation


CHECK_NAME = "wikilink-target"
DIMENSION = "structure"
DEFAULT_SEVERITY = Severity.HARD
EDITORIAL_REF = "docs/playbook/ARTICLE-PLAYBOOK.md §4.5 Further Reading + docs/playbook/REWRITE-PIPELINE.md Stage 4 Quality-checklist gate"

_RE_WIKILINK = re.compile(r"\[\[([^\]|\n]+?)(?:\|[^\]\n]+)?\]\]")
_RE_WIKILINK_FULL = re.compile(
    r"\[\[(?P<target>[^\]|\n]+?)(?:\|(?P<display>[^\]\n]+))?\]\]"
)

# Directories to scan for valid article slugs.
_KNOWLEDGE_ROOT = Path("knowledge")


def _existing_slugs() -> set[str]:
    """Cache: scan knowledge/ once per process for valid source-lang article slugs."""
    cached = getattr(_existing_slugs, "_cache", None)
    if cached is not None:
        return cached
    slugs: set[str] = set()
    if _KNOWLEDGE_ROOT.exists():
        for entry in _KNOWLEDGE_ROOT.iterdir():
            if not entry.is_dir():
                continue
            for md in entry.glob("*.md"):
                if md.name.startswith("_"):
                    continue
                slugs.add(md.stem)
    _existing_slugs._cache = slugs  # type: ignore[attr-defined]
    return slugs


def _reset_cache() -> None:
    """Test helper — invalidate the slug cache."""
    if hasattr(_existing_slugs, "_cache"):
        delattr(_existing_slugs, "_cache")


def check(target: FileTarget, config: dict[str, Any]) -> Iterator[Violation]:
    body = target.body
    slugs = _existing_slugs()
    seen_at: dict[str, int] = {}  # dedup per (target, line) so re-uses count once
    for m in _RE_WIKILINK.finditer(body):
        link = m.group(1).strip()
        if not link:
            continue
        if link in slugs:
            continue
        # Compute line number
        line = body.count("\n", 0, m.start()) + 1
        key = f"{link}@{line}"
        if key in seen_at:
            continue
        seen_at[key] = 1
        yield Violation(
            check=CHECK_NAME,
            severity=DEFAULT_SEVERITY,
            message=f"wikilink target does not exist: [[{link}]]",
            line=line,
            snippet=m.group(0)[:80],
            editorial_ref=EDITORIAL_REF,
        )


def fix(target: FileTarget, config: dict[str, Any]) -> int:
    """Auto-fix broken wikilinks — convert `[[X]]` → `X` (or `[[X|Y]]` → `Y`)
    when target slug doesn't exist. Resolved (valid) wikilinks are NOT touched.

    Per ARTICLE-PLAYBOOK §4.5 Further Reading: an unresolved target degrades to plain text. This
    is the safest transform — preserves visible text without introducing dead
    `/cat/slug` links that may not exist.

    Returns number of broken wikilinks rewritten. Respects config['dry_run'].
    """
    body = target.body
    slugs = _existing_slugs()
    if "[[" not in body:
        return 0

    changes = 0

    def _rewrite(m: re.Match) -> str:
        nonlocal changes
        target_name = m.group("target").strip()
        display = m.group("display")
        if target_name in slugs:
            return m.group(0)  # valid link — keep as-is
        # Broken: replace with display name (or target name if no display)
        text = display.strip() if display else target_name
        changes += 1
        return text

    new_body = _RE_WIKILINK_FULL.sub(_rewrite, body)
    if changes == 0:
        return 0
    if config.get("dry_run"):
        return changes
    # Strip body padding before write-back
    if target.body_pad_lines:
        new_body_unpadded = (
            new_body[target.body_pad_lines:]
            if new_body.startswith("\n" * target.body_pad_lines)
            else new_body
        )
    else:
        new_body_unpadded = new_body
    new_text = target.text[: target.body_text_offset] + new_body_unpadded
    target.path.write_text(new_text, encoding="utf-8")
    return changes
