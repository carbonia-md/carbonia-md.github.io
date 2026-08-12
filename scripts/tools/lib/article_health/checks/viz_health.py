"""viz-health — visualization module credibility + AI readability gate (REWRITE Stage 4).

Two machine-checkable visualization-credibility items:

  A. Data visualization modules must cite source
     tw-bars / tw-waffle / tw-line / tw-heatmap etc. — each needs a source line
     (`Source: org, year` inside the fenced block renders as caption below the module).
     Missing = credibility gap + AI crawlers can't trace provenance.

  B. Forbid AI-blind deixis ("as shown above/below")
     GPTBot / PerplexityBot / ClaudeBot don't run JS, can't see charts. Deixis like
     "as shown above" is meaningless to AI crawlers; key figures must also appear in
     prose text.

DEFAULT WARN (soft-launch; legacy articles may contain violations, B-patterns
occasionally dual-use).
"""

from __future__ import annotations
import re
from typing import Any, Iterator

from ..types import FileTarget, Severity, Violation


CHECK_NAME = "viz-health"
DIMENSION = "visualization"
DEFAULT_SEVERITY = Severity.WARN
EDITORIAL_REF = "docs/playbook/REWRITE-PIPELINE.md Stage 4 Quality-checklist gate + docs/playbook/ARTICLE-PLAYBOOK.md §4.6 Citations"

# Data-relationship chart modules requiring source citation.
# tw-bar is LB's module name; keep both tw-bar and tw-bars for compat.
_DATA_MODULES = {
    "tw-bar",
    "tw-bars",
    "tw-waffle",
    "tw-line",
    "tw-heatmap",
    "tw-slope",
    "tw-dot",
    "tw-stack",
    "tw-pyramid",
    "tw-tiles",
    "tw-iso",
}

# fenced tw-* block: ```tw-xxx\n ...content... \n```
_FENCE_RE = re.compile(r"```(tw-[a-z]+)[^\n]*\n(.*?)```", re.DOTALL)

# Source label: Source: / Data source:
_SRC_RE = re.compile(
    r"(?:Data\s+source|Source)\s*:\s*\S", re.IGNORECASE
)

# AI-blind deixis — English patterns
_AIBLIND_EN_RE = re.compile(
    r"as\s+shown\s+(?:above|below)"
    r"|see\s+the\s+(?:chart|figure|graph|table|image|map)\s+(?:above|below)"
    r"|the\s+(?:chart|figure|graph)\s+above\s+shows"
    r"|pictured\s+(?:above|below)"
    r"|in\s+the\s+(?:chart|figure|table)\s+below",
    re.IGNORECASE,
)


def check(target: FileTarget, config: dict[str, Any]) -> Iterator[Violation]:
    body = target.body
    if not body.strip():
        return

    # ── A. Data visualization module missing source ──────────────────────
    for m in _FENCE_RE.finditer(body):
        lang = m.group(1)
        content = m.group(2)
        if lang in _DATA_MODULES and not _SRC_RE.search(content):
            line_no = body[: m.start()].count("\n") + 1
            yield Violation(
                check=CHECK_NAME,
                severity=DEFAULT_SEVERITY,
                message=(
                    f"Data visualization module `{lang}` missing source citation — "
                    f"add a `Source: org, year` line inside the fenced block "
                    f"(credibility + lets AI crawlers trace provenance)."
                ),
                line=line_no,
                snippet=f"```{lang} …",
                editorial_ref=EDITORIAL_REF,
                fix_suggestion=(
                    f"Add a `Source: ...` line inside the ```{lang}``` block; "
                    f"it renders as a source caption below the module."
                ),
            )

    # ── B. AI-blind deixis ───────────────────────────────────────────────
    masked = target.body_without_protected()
    for line_no, line in enumerate(masked.split("\n"), start=1):
        if not line.strip():
            continue
        hit = _AIBLIND_EN_RE.search(line)
        if not hit:
            continue
        yield Violation(
            check=CHECK_NAME,
            severity=DEFAULT_SEVERITY,
            message=(
                f"AI crawlers can't see charts: '{hit.group(0)}' is meaningless to "
                f"GPTBot/PerplexityBot/ClaudeBot (they don't render JS). "
                f"Key figures must also appear in prose text."
            ),
            line=line_no,
            snippet=line.strip()[:90],
            editorial_ref=EDITORIAL_REF,
            fix_suggestion=(
                "Replace deixis with concrete values or conclusions; "
                "reference data with 'see table below' and write the numbers "
                "in prose so LLMs can extract them."
            ),
        )
