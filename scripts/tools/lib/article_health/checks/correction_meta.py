"""correction_meta — errata-as-prose detection (REWRITE-PIPELINE Stage 3 Fact-check).

Detects "correction anxiety" patterns: sentences that exist solely to correct
a previous version's mistake rather than stating facts positively. These leak
into AI-rewritten articles when old body + old callout are in session context.

Self-check: "If the article were right the first time, would this sentence
exist? If it only exists to respond to a past error or clarify a confusion, delete."

DEFAULT WARN (dual-use patterns + legacy soft-launch).
"""

from __future__ import annotations
import re
from typing import Any, Iterator

from ..types import FileTarget, Severity, Violation


CHECK_NAME = "correction-meta"
DIMENSION = "editorial-voice"
DEFAULT_SEVERITY = Severity.WARN
EDITORIAL_REF = "docs/playbook/REWRITE-PIPELINE.md Stage 3 Fact-check"


# ── Errata / correction-anxiety patterns ─────────────────────────────────────
_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\boften\s+(?:mistaken|confused|misattributed|misremembered)\b", re.IGNORECASE),
     "often-mistaken frame"),
    (re.compile(r"\bcontrary\s+to\s+(?:popular|common)\s+belief\b", re.IGNORECASE),
     "contrary-to-belief frame"),
    (re.compile(r"\bnot\s+to\s+be\s+confused\s+with\b", re.IGNORECASE),
     "not-to-be-confused frame"),
    (re.compile(r"\bdespite\s+(?:the\s+)?common\s+(?:belief|misconception)\b", re.IGNORECASE),
     "despite-misconception frame"),
    (re.compile(r"\bis\s+(?:often|sometimes)\s+wrongly\b", re.IGNORECASE),
     "often-wrongly frame"),
    (re.compile(r"\ba\s+common\s+misconception\b", re.IGNORECASE),
     "common-misconception frame"),
    (re.compile(r"\bpeople\s+often\s+(?:think|assume|believe)\b", re.IGNORECASE),
     "people-often-think frame"),
]


def check(target: FileTarget, config: dict[str, Any]) -> Iterator[Violation]:
    """Detect errata-as-prose (correction anxiety) — REWRITE-PIPELINE Stage 3 Fact-check backstop.

    Scans body with protected regions (code / link-url / html) masked so URLs
    and code never false-match. Line numbers align with file (body is padded).
    """
    masked = target.body_without_protected()
    if not masked.strip():
        return

    for line_no, line in enumerate(masked.split("\n"), start=1):
        if not line.strip():
            continue
        for rx, label in _PATTERNS:
            m = rx.search(line)
            if not m:
                continue
            yield Violation(
                check=CHECK_NAME,
                severity=DEFAULT_SEVERITY,
                message=(
                    f"Correction-anxiety pattern ({label}): '{m.group(0)[:30]}' — "
                    f"self-check: if the article were right the first time, "
                    f"would this sentence exist?"
                ),
                line=line_no,
                snippet=line.strip()[:90],
                editorial_ref=EDITORIAL_REF,
                fix_suggestion=(
                    "Rewrite as a positive statement (state the correct fact directly, "
                    "don't frame it as correcting someone else's mistake)."
                ),
            )
            break  # one violation per line is enough signal
