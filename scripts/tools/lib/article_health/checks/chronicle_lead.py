"""chronicle_lead — chronicle-style subheading detection (ARTICLE-PLAYBOOK §4.3 Subheadings).

Most patterns are language-agnostic (ISO date formats); this check also covers
English-specific patterns (Month Year, Year: Title).

Rule:
    H2 subheadings must NOT be chronicle-style ("May 2016", "2020: Album
    Title", "2020.5.6") — these turn the article into a Wikipedia-style
    timeline instead of a scene / conflict / object-led structure.

Detected patterns (WARN, soft-launch):
    ## May 2016: the fire started      <- chronicle event with month
    ## 2020: Album Title                <- year + colon + title
    ## 2020.5.6                         <- date format
    ## 2020/5/6                         <- date format
    ## 2020-05-06                       <- ISO date

Allowed patterns (legitimate timeline / historical scope):
    ## 1949-1987 Martial Law Era         <- year range + description (historical)
    ## The 1990s                         <- decade reference
    ## Postwar Period                    <- named period (no specific year)

Scope:
    Runs on knowledge/{Category}/*.md articles; non-articles are filtered at
    the CLI boundary (loader.is_article_path).

Canonical:
  - docs/playbook/ARTICLE-PLAYBOOK.md §4.3 Subheadings
"""

from __future__ import annotations
import re
from typing import Any, Iterator

from ..types import FileTarget, Severity, Violation


CHECK_NAME = "chronicle-lead"
DIMENSION = "subheading"
DEFAULT_SEVERITY = Severity.WARN
EDITORIAL_REF = "docs/playbook/ARTICLE-PLAYBOOK.md §4.3 Subheadings: No Date-Led Timeline Headers"


_MONTHS = (
    r"January|February|March|April|May|June|July|August|September|"
    r"October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec"
)

# ── HARD: chronicle subheading patterns ──────────────────────────────────────

# Month Year — most common AI failure mode (event date lead)
# e.g. ## May 2016: the fire started
_RE_MONTH_YEAR = re.compile(rf"^##\s+(?:{_MONTHS})\s+\d{{4}}", re.IGNORECASE)

# Year Month (reversed order) — e.g. ## 2016 May
_RE_YEAR_MONTH = re.compile(rf"^##\s+\d{{4}}\s+(?:{_MONTHS})", re.IGNORECASE)

# YYYY: Title / YYYY "Event" — year-prefixed event lead
# e.g. ## 2018: the award nomination
_RE_YEAR_EVENT = re.compile(r"^##\s+\d{4}\s*[:“\"]")

# YYYY.MM.DD / YYYY/MM/DD / YYYY-MM-DD — date format
# e.g. ## 2020.5.6 / ## 2020/5/6 / ## 2020-05-06
_RE_DATE_FORMAT = re.compile(r"^##\s+\d{4}[/.\-]\s*\d{1,2}[/.\-]\s*\d{1,2}")


# ── Allowed patterns (regex to detect legitimate timeline scope, returns True
#    to skip HARD violation) ────────────────────────────────────────────────────

# Year range: ## 1949-1987 ... / ## 1949–1987 ... / ## 1949 — 1987 ...
_RE_YEAR_RANGE = re.compile(r"^##\s+\d{4}\s*[—–\-]\s*\d{4}")

# Decade: ## The 1990s / ## 1990s
_RE_DECADE = re.compile(r"^##\s+(?:The\s+)?\d{4}s\b", re.IGNORECASE)


def _is_legitimate_chronicle(line: str) -> bool:
    """Return True if subheading is a legitimate timeline scope (skip HARD)."""
    return bool(
        _RE_YEAR_RANGE.match(line)
        or _RE_DECADE.match(line)
    )


def _detect_chronicle_violation(line: str) -> str | None:
    """Return violation pattern name if line is a chronicle subheading, else None."""
    if _is_legitimate_chronicle(line):
        return None
    if _RE_MONTH_YEAR.match(line):
        return "month-year"
    if _RE_YEAR_MONTH.match(line):
        return "year-month"
    if _RE_YEAR_EVENT.match(line):
        return "year-event"
    if _RE_DATE_FORMAT.match(line):
        return "date-format"
    return None


def check(target: FileTarget, config: dict[str, Any]) -> Iterator[Violation]:
    """Detect chronicle-style H2 subheadings (ARTICLE-PLAYBOOK §4.3 Subheadings).

    HARD violation: any subheading matching chronicle date patterns.
    """
    text = target.text
    if not text:
        return

    for line_no, line in enumerate(text.split("\n"), start=1):
        stripped = line.rstrip()
        if not stripped.startswith("## "):
            continue
        kind = _detect_chronicle_violation(stripped)
        if not kind:
            continue
        yield Violation(
            check=CHECK_NAME,
            severity=DEFAULT_SEVERITY,
            message=(
                f"Chronicle-style subheading: "
                f'"{stripped[:60]}" = Wikipedia-style timeline, use a scene / image / '
                "conflict / object / core-tension lead instead"
            ),
            line=line_no,
            snippet=stripped[:80],
            editorial_ref=EDITORIAL_REF,
            fix_suggestion=(
                'Examples: "The party ended" (scene) / "The dog named Spud" (object) / '
                '"The uncredited founder" (core tension). Year ranges like '
                '"1949-1987 Martial Law Era" are fine.'
            ),
        )
