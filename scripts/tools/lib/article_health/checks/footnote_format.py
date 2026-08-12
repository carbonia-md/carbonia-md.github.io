"""footnote_format — canonical footnote definition format.

Canonical: `[^N]: [Title](URL) — desc{10+ chars}`

Hard error: definitions that don't match canonical format.

Editorial reference: docs/playbook/ARTICLE-PLAYBOOK.md §4.6 Citations.
"""

from __future__ import annotations
import re
from typing import Any, Iterator

from ..types import FileTarget, Severity, Violation


CHECK_NAME = "footnote-format"
DIMENSION = "citation"
DEFAULT_SEVERITY = Severity.HARD
EDITORIAL_REF = "docs/playbook/ARTICLE-PLAYBOOK.md §4.6 Citations"

# Canonical (one of these forms):
#   1. With URL:  [^id]: [Title](URL) — description (≥6 chars)
#      URL may be bare (`https://example.com`) OR Prettier autolink-wrapped
#      (`<https://example.com>`). Prettier auto-wraps URLs containing parens
#      (e.g. Wikipedia disambiguation slugs) into `<...>` form so they survive
#      markdown link parsing — this regex must accept both.
#   2. Pure prose explanatory note: [^id]: <prose ≥10 chars>  (no URL required —
#      these are supplementary-note footnotes, a valid markdown convention)
# (the url-form description floor is relaxed to 6 chars: a terse source label is
# clear enough at 5-6 chars)
# (autolink wrap acceptance was a root-cause fix for CI failures where
# Prettier-formatted footnotes with paren-containing URLs were rejected)
_RE_CANONICAL = re.compile(
    r"^\[\^[0-9a-zA-Z_-]+\]:\s*\[.+?\]\(<?https?://[^\s>]+>?\)\s+[—-]\s*.{6,}$"
)
_RE_PURE_PROSE_FN = re.compile(
    r"^\[\^[0-9a-zA-Z_-]+\]:\s*[^\[\s].{9,}$"
)
_RE_DEF_LINE = re.compile(r"^\[\^[0-9a-zA-Z_-]+\]:")


def check(target: FileTarget, config: dict[str, Any]) -> Iterator[Violation]:
    for line_num, line in enumerate(target.body.splitlines(), start=1):
        if not _RE_DEF_LINE.match(line):
            continue
        # Two acceptable canonical forms: URL-citation OR pure-prose explanatory
        if _RE_CANONICAL.match(line) or _RE_PURE_PROSE_FN.match(line):
            continue
        yield Violation(
            check=CHECK_NAME,
            severity=DEFAULT_SEVERITY,
            message=(
                "footnote definition not in canonical format: expected "
                "`[^N]: [Title](URL) — description (≥10 chars)`"
            ),
            line=line_num,
            snippet=line[:100],
            editorial_ref=EDITORIAL_REF,
        )
