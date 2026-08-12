"""article_health.types — Shared data types.

Each check plugin yields `Violation`s; runner aggregates into `CheckResult`s
and ultimately `HealthReport`.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any


class Severity(str, Enum):
    """Violation severity level.

    HARD: auto-blocks commit / PR / build.
    WARN: listed but non-blocking.
    INFO: purely informational (for dashboard, not shown in pre-commit).
    """

    HARD = "hard"
    WARN = "warn"
    INFO = "info"

    def __lt__(self, other: 'Severity') -> bool:
        order = {Severity.INFO: 0, Severity.WARN: 1, Severity.HARD: 2}
        return order[self] < order[other]


@dataclass
class FileTarget:
    """A single article being checked.

    Loader does this once per file scan:
      - YAML frontmatter parsing (cached)
      - body markdown content (frontmatter stripped)
      - protected region masking (fenced code / inline code / link URL / HTML attr)

    Plugins receive this object, avoiding redundant parse/split per check.
    """

    path: Path
    text: str  # full file content (frontmatter + body)
    frontmatter: dict[str, Any] = field(default_factory=dict)
    frontmatter_raw: str = ""  # raw YAML text between --- delimiters
    # body is PADDED with leading blank lines equal to frontmatter line count
    # so any line N in body matches line N in the original file. For write-
    # back paths, use `body_text_offset` (char offset of where real body
    # content starts in `text`) and slice body from that point.
    body: str = ""
    body_text_offset: int = 0  # char offset in `text` where body starts
    body_pad_lines: int = 0  # how many blank lines were prepended to align line numbers
    category: str = ""  # About / History / Geography / ...
    slug: str = ""  # filename without .md

    # Protected text segments — list of (start, end, kind) tuples in body coords.
    # kind = "fenced-code" / "inline-code" / "link-url" / "html-tag"
    protected_regions: list[tuple[int, int, str]] = field(default_factory=list)

    def body_without_protected(self) -> str:
        """Body with protected regions blanked out (preserves char positions)."""
        if not self.protected_regions:
            return self.body
        chars = list(self.body)
        for start, end, _ in self.protected_regions:
            for i in range(start, min(end, len(chars))):
                chars[i] = " "
        return "".join(chars)


@dataclass
class Violation:
    """Single violation instance."""

    check: str  # check name (e.g. "footnote-format")
    severity: Severity
    message: str
    line: int | None = None  # 1-indexed
    col: int | None = None  # 1-indexed
    snippet: str | None = None  # surrounding context
    fix_suggestion: str | None = None  # what would --fix do
    editorial_ref: str | None = None  # canonical doc reference


@dataclass
class CheckResult:
    """Result of running a single check on one file."""

    check: str
    passed: bool  # True if no HARD violations
    violations: list[Violation] = field(default_factory=list)
    skipped: bool = False
    skip_reason: str | None = None

    @property
    def hard_count(self) -> int:
        return sum(1 for v in self.violations if v.severity == Severity.HARD)

    @property
    def warn_count(self) -> int:
        return sum(1 for v in self.violations if v.severity == Severity.WARN)

    @property
    def info_count(self) -> int:
        return sum(1 for v in self.violations if v.severity == Severity.INFO)


@dataclass
class HealthReport:
    """One file × N checks aggregate report."""

    target: FileTarget
    results: list[CheckResult] = field(default_factory=list)

    @property
    def hard_count(self) -> int:
        return sum(r.hard_count for r in self.results)

    @property
    def warn_count(self) -> int:
        return sum(r.warn_count for r in self.results)

    @property
    def info_count(self) -> int:
        return sum(r.info_count for r in self.results)

    @property
    def passed(self) -> bool:
        return self.hard_count == 0

    @property
    def all_violations(self) -> list[Violation]:
        return [v for r in self.results for v in r.violations]

    def as_dict(self) -> dict[str, Any]:
        """JSON-serializable representation."""
        return {
            "file": str(self.target.path),
            "category": self.target.category,
            "slug": self.target.slug,
            "summary": {
                "hard": self.hard_count,
                "warn": self.warn_count,
                "info": self.info_count,
                "passed": self.passed,
            },
            "results": [
                {
                    "check": r.check,
                    "passed": r.passed,
                    "skipped": r.skipped,
                    "skip_reason": r.skip_reason,
                    "violations": [
                        {
                            "severity": v.severity.value,
                            "message": v.message,
                            "line": v.line,
                            "col": v.col,
                            "snippet": v.snippet,
                            "fix_suggestion": v.fix_suggestion,
                            "editorial_ref": v.editorial_ref,
                        }
                        for v in r.violations
                    ],
                }
                for r in self.results
            ],
        }
