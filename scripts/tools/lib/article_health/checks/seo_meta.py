"""seo_meta — frontmatter title + description SEO health.

Uses standard English SEO length conventions (char counts). The brand token in
dimension 3 is resolved from place.config.ts (see lib.article_health.place), so
this check carries no instance name.

Dimensions:
  1. Title length — Google SERP truncates at ~600px (~60 chars)
     - too_short: < 10 chars (too weak to carry a keyword)
     - too_long: > 60 chars (SERP truncation)
  2. Description length — Google snippet truncates at ~155-160 chars
     - too_short: < 50 chars (snippet whitespace = not sharp enough)
     - too_long: > 160 chars (truncated mid-meaning)
  3. Template description — description starts with brand filler
     (the instance brand token / "This article" etc.) = wasted snippet real estate
  4. Description = title duplication — wastes SERP space

Severity: WARN — soft launch.

Skip:
  - Hub pages (knowledge/{Category}/_*.md)
  - About category — meta/site pages, not knowledge articles

Canonical:
  - docs/playbook/ARTICLE-PLAYBOOK.md §5 SEO Metadata
"""

from __future__ import annotations
import re
from typing import Any, Iterator

from ..place import brand_prefix_pattern
from ..types import FileTarget, Severity, Violation


CHECK_NAME = "seo-meta"
DIMENSION = "seo"
DEFAULT_SEVERITY = Severity.WARN
EDITORIAL_REF = "docs/playbook/ARTICLE-PLAYBOOK.md §5 SEO Metadata (title <=60 chars, description 50-160 chars)"

# Thresholds — measured in char count, standard English SEO conventions.
TITLE_MIN_CHARS = 10
TITLE_MAX_CHARS = 60
DESC_MIN_CHARS = 50
DESC_MAX_CHARS = 160

# Brand prefix patterns (description starting with these wastes the snippet open).
# The instance brand token is resolved from place.config.ts at call time; the
# generic "This article ..." filler is place-agnostic and always applies.
def _brand_prefix_patterns() -> list[str]:
    pats = [r"^This\s+article\s+(is|covers)\s*"]
    brand = brand_prefix_pattern()
    if brand:
        pats.insert(0, brand)
    return pats


def _char_count(s: str) -> int:
    return len(s)


def _looks_like_brand_prefix(desc: str) -> str | None:
    """Return matched brand pattern if desc starts with brand-y filler."""
    for pat in _brand_prefix_patterns():
        m = re.match(pat, desc)
        if m:
            return m.group(0).strip()
    return None


def check(target: FileTarget, config: dict[str, Any]) -> Iterator[Violation]:
    """Detect SEO metadata length + template issues."""
    if target.category == "About":
        return

    fm = target.frontmatter or {}
    title = (fm.get("title") or "").strip()
    description = (fm.get("description") or "").strip()

    # ── INFO stats line (always emit — per word_count plugin pattern) ───────
    t_chars = _char_count(title) if title else 0
    d_chars = _char_count(description) if description else 0
    yield Violation(
        check=CHECK_NAME,
        severity=Severity.INFO,
        message=f"frontmatter SEO: title={t_chars} chars, description={d_chars} chars (target 50-160 chars)",
        editorial_ref=EDITORIAL_REF,
    )

    # ── Title checks ──────────────────────────────────────────────────────────
    if title:
        if t_chars < TITLE_MIN_CHARS:
            yield Violation(
                check=CHECK_NAME,
                severity=DEFAULT_SEVERITY,
                message=f"title too short — {t_chars} chars, possible placeholder or frontmatter typo",
                line=1,
                snippet=title[:80],
                editorial_ref=EDITORIAL_REF,
                fix_suggestion="Title should at least identify the topic. Check frontmatter for typos / missing value.",
            )
        elif t_chars > TITLE_MAX_CHARS:
            yield Violation(
                check=CHECK_NAME,
                severity=DEFAULT_SEVERITY,
                message=f"title too long — {t_chars} chars, Google SERP truncates at ~60 chars",
                line=1,
                snippet=title[:80],
                editorial_ref=EDITORIAL_REF,
                fix_suggestion="Front-load the core keyword in the first ~60 chars; the tail can get truncated.",
            )

    # ── Description checks ────────────────────────────────────────────────────
    if description:
        if d_chars < DESC_MIN_CHARS:
            yield Violation(
                check=CHECK_NAME,
                severity=DEFAULT_SEVERITY,
                message=f"description too short — {d_chars} chars < {DESC_MIN_CHARS}-char floor",
                line=1,
                snippet=description[:100],
                editorial_ref=EDITORIAL_REF,
                fix_suggestion="Description is the SERP snippet. Too short leaves whitespace and no hook.",
            )
        elif d_chars > DESC_MAX_CHARS:
            yield Violation(
                check=CHECK_NAME,
                severity=DEFAULT_SEVERITY,
                message=f"description too long — {d_chars} chars > {DESC_MAX_CHARS}-char cap",
                line=1,
                snippet=description[:120] + "…",
                editorial_ref=EDITORIAL_REF,
                fix_suggestion="Google snippet truncates at ~160 chars, losing the ending. Tighten it.",
            )

        # Brand-prefix waste
        brand_match = _looks_like_brand_prefix(description)
        if brand_match:
            yield Violation(
                check=CHECK_NAME,
                severity=DEFAULT_SEVERITY,
                message=f"description opens with brand filler \"{brand_match}\" — wastes the snippet open",
                line=1,
                snippet=description[:80],
                editorial_ref=EDITORIAL_REF,
                fix_suggestion="Open with a concrete detail / number / hook, not a meta self-description.",
            )

        # Title-vs-description duplication
        if title and description and (title in description or description in title):
            yield Violation(
                check=CHECK_NAME,
                severity=DEFAULT_SEVERITY,
                message="description duplicates title — wastes SERP space",
                line=1,
                snippet=description[:100],
                editorial_ref=EDITORIAL_REF,
                fix_suggestion="Title is the hook, description should add what the title didn't say.",
            )
