"""quote_fidelity — verbatim quote fidelity + superlative-claim list (REWRITE-PIPELINE Stage 3 Fact-check).

Ported from the source corpus. QF1 (verbatim quote check against a `researchReport`
SSOT) requires a citation convention this project hasn't adopted yet:
0/18 articles use footnotes ([^n]) or set frontmatter `researchReport`. QF1
is dormant until that convention exists — kept in the port (matches the
"full port" decision) but it will not fire on the current corpus. QF2
(superlative-claim list) doesn't depend on footnotes and can fire today.

Detects two rules:
    QF1 (WARN, soft-launch): direct quotes in body text ("..." with >= 12
        words, followed within 12 chars by a [^n] footnote = a quote with
        a sourcing promise) are verbatim-compared against the research
        report referenced by frontmatter `researchReport` (the SSOT quote
        bank). Mismatches mean the writer may have paraphrased or
        truncated — re-check against the source.
    QF2 (INFO): lists superlative claims in the body (first / only /
        earliest / first-ever, etc.) as a priority re-verification list —
        doesn't block the gate, pure surfacing.

Boundaries:
    - No frontmatter `researchReport` -> QF1 skips (one INFO note), QF2 still runs.
    - Quote without a [^n] footnote (scare quote / slogan) -> not treated as
      a direct quote, QF1 skips it.
    - Runs on knowledge/{Category}/*.md articles; non-articles are filtered at
      the CLI boundary (loader.is_article_path).

Canonical:
  - docs/playbook/ARTICLE-PLAYBOOK.md §4.8 Quote Fidelity
"""

from __future__ import annotations

import os
import re
from typing import Any, Iterator

from ..types import FileTarget, Severity, Violation


CHECK_NAME = "quote-fidelity"
DIMENSION = "factcheck"
DEFAULT_SEVERITY = Severity.WARN
EDITORIAL_REF = "docs/playbook/ARTICLE-PLAYBOOK.md §4.8 Quote Fidelity"

# Direct quote: ".." with >= 12 words, [^n] footnote within 12 chars after the close quote.
_QUOTE_RX = re.compile(r'"([^"]{12,})"(?P<tail>[^"]{0,12}?)\[\^\d+\]')
# Superlative claims (high writer-drift area)
_SUPERLATIVE_RX = re.compile(
    r"\b(the\s+only|the\s+first(?:\s+ever)?|earliest|first-ever|"
    r"the\s+oldest|the\s+largest|the\s+last\s+remaining)\b",
    re.IGNORECASE,
)
_ELLIPSIS_SPLIT_RX = re.compile(r"\.\.\.|…")
_MIN_SEGMENT_WORDS = 4
_MAX_SUPERLATIVE_REPORTED = 12


_TRAILING_PUNCT_RX = re.compile(r"[.,!?;:…\s]+$")


def _normalize(text: str) -> str:
    """Normalize before verbatim comparison: strip whitespace / markdown emphasis markers."""
    return re.sub(r"[\s*_]+", " ", text).strip().lower()


def _strip_edge_punct(seg: str) -> str:
    """Strip leading/trailing punctuation from a quote segment — punctuation
    placement inside/outside quotes is a transcription habit, not a verbatim drift."""
    return _TRAILING_PUNCT_RX.sub("", seg).strip()


def _resolve_report_path(target: FileTarget) -> str | None:
    rr = target.frontmatter.get("researchReport")
    if not rr or not isinstance(rr, str):
        return None
    if os.path.exists(rr):
        return rr
    # fallback: walk up toward the repo root, trying the frontmatter-relative path at each level
    d = os.path.dirname(os.path.abspath(str(target.path)))
    for _ in range(6):
        cand = os.path.join(d, rr)
        if os.path.exists(cand):
            return cand
        d = os.path.dirname(d)
    return None


def check(target: FileTarget, config: dict[str, Any]) -> Iterator[Violation]:
    """QF1 verbatim quote fidelity (against researchReport SSOT) + QF2 superlative-claim list."""
    body = target.body_without_protected()
    if not body.strip():
        return
    # Footnote definition lines ([^n]: ...) often legitimately compress quotes —
    # exclude them from QF1/QF2 scanning (blank them out, keep line numbers).
    body = "\n".join(
        ("" if re.match(r"\s*\[\^\d+\]:", ln) else ln) for ln in body.split("\n")
    )

    # ── QF1: verbatim quote fidelity ─────────────────────────────────────────
    report_path = _resolve_report_path(target)
    report_norm: str | None = None
    if report_path:
        try:
            with open(report_path, encoding="utf-8") as fh:
                report_norm = _normalize(fh.read())
        except OSError:
            report_norm = None

    quotes = list(_QUOTE_RX.finditer(body))
    if quotes and report_norm is None:
        rr = target.frontmatter.get("researchReport")
        yield Violation(
            check=CHECK_NAME,
            severity=Severity.INFO,
            message=(
                f"Found {len(quotes)} footnoted direct quote(s), but "
                + (
                    f"couldn't read the research report ({rr})"
                    if rr
                    else "frontmatter has no researchReport"
                )
                + " — QF1 verbatim check skipped. Manually verify against the source."
            ),
            line=1,
            snippet="",
            editorial_ref=EDITORIAL_REF,
            fix_suggestion="Add frontmatter `researchReport:` pointing at the source research report.",
        )
    elif report_norm is not None:
        for m in quotes:
            quote = m.group(1)
            segments = [
                _strip_edge_punct(s)
                for s in _ELLIPSIS_SPLIT_RX.split(quote)
                if len(re.findall(r"[A-Za-z0-9'-]+", s)) >= _MIN_SEGMENT_WORDS
            ]
            if not segments:
                continue
            missing = [s for s in segments if _normalize(s) not in report_norm]
            if not missing:
                continue
            line_no = body.count("\n", 0, m.start()) + 1
            yield Violation(
                check=CHECK_NAME,
                severity=DEFAULT_SEVERITY,
                message=(
                    f"Quote doesn't match the research report verbatim: \"{missing[0][:48]}…\" — "
                    "writer may have paraphrased / truncated (a quote is a verbatim promise). "
                    "Check against the source, or the line isn't in the report at all."
                ),
                line=line_no,
                snippet=f'"{quote[:60]}…"' if len(quote) > 60 else f'"{quote}"',
                editorial_ref=EDITORIAL_REF,
                fix_suggestion=(
                    "Pick one: (1) restore the exact source wording (2) drop the quote marks "
                    "and paraphrase instead (3) it's a newly verified quote -> add it to the "
                    "research report's source bank first."
                ),
            )

    # ── QF2: superlative-claim list (INFO, priority re-verification list) ──
    reported = 0
    for m in _SUPERLATIVE_RX.finditer(body):
        if reported >= _MAX_SUPERLATIVE_REPORTED:
            break
        line_no = body.count("\n", 0, m.start()) + 1
        line_text = body.split("\n")[line_no - 1].strip()
        yield Violation(
            check=CHECK_NAME,
            severity=Severity.INFO,
            message=(
                f'Superlative claim "{m.group(0)}" — high writer-drift area, '
                "prioritize re-verification (needs >=2 sources; soften wording if single-sourced)."
            ),
            line=line_no,
            snippet=line_text[:90],
            editorial_ref=EDITORIAL_REF,
            fix_suggestion="Can't verify a second source -> soften (\"the only\" -> \"one of the few\").",
        )
        reported += 1
