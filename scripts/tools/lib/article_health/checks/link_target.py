"""link-target — verify markdown link path is well-formed and resolves.

Two-phase validation of internal markdown links `[text](/path/)`:

  Phase 1 — CASING: `/History/...` is broken because Astro routes lowercase the
            category segment (CATEGORY_MAPPING in `[category]/[slug].astro` uses
            lowercase keys). Auto-fixable.

  Phase 2 — EXISTENCE: `/history/non-existent-slug/` is broken even with correct
            casing. Cross-checks against the actual filesystem
            (`knowledge/{Category}/{slug}.md`). Not auto-fixable (which slug did
            the author mean? human must decide).

Source-layer counterpart of the post-build dist link scan. Catching at source
means pre-commit / pre-PR gates fire instead of waiting for the full build.
"""

from __future__ import annotations
import re
from pathlib import Path
from typing import Any, Iterator

from ..types import FileTarget, Severity, Violation


CHECK_NAME = "link-target"
DIMENSION = "structure"
# Phase 1 (casing) is HARD inside check(); Phase 2 (existence) is WARN by
# default so pre-commit doesn't block parallel work that touches articles with
# long-accumulated broken slugs. release-pr profile sets fail_on="warn" so CI
# still catches existence issues.
DEFAULT_SEVERITY = Severity.HARD
EDITORIAL_REF = "src/pages/[category]/[slug].astro category routing + knowledge/ article existence"

_KNOWLEDGE_ROOT = Path("knowledge")
_NON_ARTICLE_ROOTS = {"api", "og-images", "assets", "_astro"}

# Phase 1: capitalized category in link path.
_RE_CASING = re.compile(r"(\]\(/)([A-Z][a-zA-Z-]*)(/[^)]*\))")

# Phase 2: any internal absolute link, for existence check.
# Captures the path part (without anchor/query) for lookup.
_RE_INTERNAL = re.compile(r"\]\((/[^)\s#?]+)(?:[#?][^)]*)?\)")


def _existing_link_targets() -> set[str]:
    """Set of valid internal link paths `/{category-lower}/{slug}` (no trailing
    slash, no anchor).

    Cached per-process — call `_reset_cache()` in tests when filesystem changes.
    """
    cached = getattr(_existing_link_targets, "_cache", None)
    if cached is not None:
        return cached
    paths: set[str] = set()
    if _KNOWLEDGE_ROOT.exists():
        for entry in _KNOWLEDGE_ROOT.iterdir():
            if not entry.is_dir() or entry.name.startswith("_"):
                continue
            cat_lower = entry.name.lower()
            for md in entry.glob("*.md"):
                if md.name.startswith("_"):
                    continue
                paths.add(f"/{cat_lower}/{md.stem}")
    _existing_link_targets._cache = paths  # type: ignore[attr-defined]
    return paths


def _reset_cache() -> None:
    """Test helper — invalidate the path cache."""
    if hasattr(_existing_link_targets, "_cache"):
        delattr(_existing_link_targets, "_cache")


def _line_col(text: str, pos: int) -> tuple[int, int]:
    line = text.count("\n", 0, pos) + 1
    line_start = text.rfind("\n", 0, pos) + 1
    col = pos - line_start + 1
    return line, col


def _snippet(body: str, pos: int, end: int) -> str:
    line_start = body.rfind("\n", 0, pos) + 1
    line_end = body.find("\n", end)
    if line_end == -1:
        line_end = len(body)
    return body[line_start:line_end].strip()[:120]


def _looks_like_article_path(path: str) -> bool:
    """Path matches the `/cat/slug` shape — worth resolving.

    Skips `/about/`, `/dashboard/`, `/contribute/`, etc. (static pages handled by
    other gates) and weird shapes like `/api/...`.
    """
    parts = path.strip("/").split("/")
    return len(parts) == 2 and parts[0] not in _NON_ARTICLE_ROOTS


def check(target: FileTarget, config: dict[str, Any]) -> Iterator[Violation]:
    body = target.body
    valid = _existing_link_targets()

    # Phase 1: casing violations — HARD (auto-fixable, obvious)
    casing_positions: set[int] = set()
    for m in _RE_CASING.finditer(body):
        casing_positions.add(m.start())
        category = m.group(2)
        line, col = _line_col(body, m.start())
        yield Violation(
            check=CHECK_NAME,
            severity=Severity.HARD,
            message=f"link path category must be lowercase: /{category}/ → /{category.lower()}/",
            line=line,
            col=col,
            snippet=_snippet(body, m.start(), m.end()),
            fix_suggestion=f"{m.group(1)}{category.lower()}{m.group(3)}",
            editorial_ref=EDITORIAL_REF,
        )

    # Phase 2: existence violations — WARN (not auto-fixable, judgment call)
    for m in _RE_INTERNAL.finditer(body):
        if m.start() in casing_positions:
            continue  # already flagged by Phase 1; skip until casing is fixed
        path = m.group(1).rstrip("/")
        if not _looks_like_article_path(path):
            continue
        # Canonicalize: lowercase the category segment for lookup
        # (after Phase 1 fix all categories will be lowercase, but be defensive).
        parts = path.strip("/").split("/")
        parts[0] = parts[0].lower()
        canonical = "/" + "/".join(parts)
        if canonical in valid:
            continue
        line, col = _line_col(body, m.start())
        yield Violation(
            check=CHECK_NAME,
            severity=Severity.WARN,
            message=f"link target does not exist: {path}",
            line=line,
            col=col,
            snippet=_snippet(body, m.start(), m.end()),
            fix_suggestion=None,  # human decides which slug
            editorial_ref=EDITORIAL_REF,
        )


def fix(target: FileTarget, config: dict[str, Any]) -> bool:
    """Phase 1 only: lowercase the category segment of every matching link.

    Operates on `target.text` directly (full file). Safe because the regex only
    matches markdown link syntax `](/Cap/...)` which won't appear inside YAML
    frontmatter as a real link target.

    Phase 2 (existence) is NOT auto-fixed — the slug ambiguity needs a human.

    Returns True if file was modified.
    """
    new_text = _RE_CASING.sub(
        lambda m: f"{m.group(1)}{m.group(2).lower()}{m.group(3)}",
        target.text,
    )
    if new_text == target.text:
        return False
    target.path.write_text(new_text, encoding="utf-8")
    return True
