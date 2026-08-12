"""frontmatter_title — title format checks.

Canonical: docs/playbook/ARTICLE-PLAYBOOK.md §5 SEO Metadata + §6 Voice

Yields multiple violations (different severities) from a single check:
  - WARN: vague / puffery adjective in title
  - WARN: title length — raw chars > 60 (SERP truncation)
  - HARD: missing subcategory (non-About articles)
"""

from __future__ import annotations
import re
from typing import Any, Iterator

from ..types import FileTarget, Severity, Violation


CHECK_NAME = "frontmatter-title"
DIMENSION = "frontmatter"
DEFAULT_SEVERITY = Severity.WARN  # most checks are warn; HARD ones override per-violation
EDITORIAL_REF = "docs/playbook/ARTICLE-PLAYBOOK.md §5 SEO Metadata"

# Vague / puffery adjectives (ARTICLE-PLAYBOOK §6 Voice — conservative subset)
TITLE_VAGUE_ADJECTIVES_EN: list[str] = [
    "iconic",
    "legendary",
    "world-class",
    "must-see",
    "hidden gem",
    "ultimate",
]

_EN_VAGUE_RE = re.compile(
    r"\b(?:" + "|".join(re.escape(a) for a in TITLE_VAGUE_ADJECTIVES_EN) + r")\b",
    re.IGNORECASE,
)

TITLE_MAX_CHARS = 60


def check(target: FileTarget, config: dict[str, Any]) -> Iterator[Violation]:
    title = target.frontmatter.get("title")
    if not isinstance(title, str) or not title.strip():
        return

    # 1. Vague / puffery adjectives (WARN)
    for m in _EN_VAGUE_RE.finditer(title):
        yield Violation(
            check=CHECK_NAME,
            severity=Severity.WARN,
            message=(
                f"Title contains puffery adjective '{m.group(0)}'"
                " (ARTICLE-PLAYBOOK §6 Voice — avoid brochure-style tells in titles)"
            ),
            snippet=title,
            editorial_ref="docs/playbook/ARTICLE-PLAYBOOK.md §6 Voice",
        )

    # 2. Length (WARN) — raw chars > 60 (SERP truncation)
    if len(title) > TITLE_MAX_CHARS:
        yield Violation(
            check=CHECK_NAME,
            severity=Severity.WARN,
            message=(
                f"Title too long ({len(title)} chars > {TITLE_MAX_CHARS})"
                " — Google SERP truncates around 60 characters"
            ),
            snippet=title,
            editorial_ref="docs/playbook/ARTICLE-PLAYBOOK.md §5 SEO Metadata",
        )

    # 3. Subcategory required (HARD) — non-About articles must declare
    # subcategory per docs/playbook/ARTICLE-PLAYBOOK.md §7.2 Structure check.
    sub = target.frontmatter.get("subcategory")
    if target.category != "About" and (not isinstance(sub, str) or not sub.strip()):
        yield Violation(
            check=CHECK_NAME,
            severity=Severity.HARD,
            message=(
                f"Missing 'subcategory' in frontmatter"
                f" — {target.category} articles require a subcategory per docs/playbook/ARTICLE-PLAYBOOK.md §7.2 Structure check"
            ),
            snippet=str(sub) if sub is not None else "(missing)",
            editorial_ref="docs/playbook/ARTICLE-PLAYBOOK.md §7.2 Structure check",
        )
