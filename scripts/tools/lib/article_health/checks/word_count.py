"""word_count — minimum English word-count gate for depth articles.

This project's editorial style is a short locals-guide format, not long-form
journalism, so the threshold is calibrated against the actual corpus (18
articles, 277-773 words): 250 words sits just below the current floor so it
catches genuine stubs without flagging the existing corpus.

Detected:
    Body text word count (whitespace-tokenized, excluding frontmatter /
    fenced code / inline code / image markdown / footnote definitions /
    footnote references / HTML tags).

Runs on knowledge/{Category}/*.md articles; non-articles are filtered at the
CLI boundary (loader.is_article_path).

Threshold:
    - default: 250 words
    - WARN (soft-launch — promote to HARD later if the corpus grows and a
      stricter depth bar is wanted)
"""

from __future__ import annotations
import re
from typing import Any, Iterator

from ..types import FileTarget, Severity, Violation


CHECK_NAME = "word-count"
DIMENSION = "depth"
DEFAULT_SEVERITY = Severity.WARN
EDITORIAL_REF = "docs/playbook/ARTICLE-PLAYBOOK.md §1 Length + §8 Numeric Thresholds"

DEFAULT_MIN_WORDS = 250


# ── Body text scrubbing ──────────────────────────────────────────────────────

_RE_CODE_BLOCK = re.compile(r"```.*?```", re.DOTALL)
_RE_INLINE_CODE = re.compile(r"`[^`]*`")
_RE_IMAGE = re.compile(r"!\[[^\]]*\]\([^\)]+\)")
# Footnote reference [^N] — keep but don't count
_RE_FOOTNOTE_REF = re.compile(r"\[\^[^\]]+\]")
# Footnote definition lines [^N]: ... (whole line)
_RE_FOOTNOTE_DEF_LINE = re.compile(r"^\[\^[^\]]+\]:.*$", re.MULTILINE)
_RE_HTML_TAG = re.compile(r"<[^>]+>")
_RE_WORD = re.compile(r"[A-Za-z0-9'-]+")


def _count_words_in_body(body: str) -> int:
    """Count words in body, scrubbing structural / metadata regions."""
    text = body
    text = _RE_CODE_BLOCK.sub("", text)
    text = _RE_INLINE_CODE.sub("", text)
    text = _RE_IMAGE.sub("", text)
    text = _RE_FOOTNOTE_DEF_LINE.sub("", text)
    text = _RE_FOOTNOTE_REF.sub("", text)
    text = _RE_HTML_TAG.sub("", text)
    return len(_RE_WORD.findall(text))


def check(target: FileTarget, config: dict[str, Any]) -> Iterator[Violation]:
    """Detect short articles failing the depth threshold.

    Always emits 1 INFO line with the word count (so users see stats even
    when the article passes the threshold). Below threshold yields a
    WARN/HARD violation per profile severity.
    """
    min_words = int((config or {}).get("min_words", DEFAULT_MIN_WORDS))

    # Use FileTarget.body if loader split frontmatter; fallback to manual split
    body = target.body if target.body else target.text
    if not body and target.text and target.text.startswith("---"):
        end = target.text.find("---", 3)
        if end > 0:
            body = target.text[end + 3:]
        else:
            body = target.text

    if not body:
        return

    words = _count_words_in_body(body)

    # ── INFO stats line (always emit, regardless of pass/fail) ──────────────
    pct = (words / min_words) * 100 if min_words > 0 else 0
    yield Violation(
        check=CHECK_NAME,
        severity=Severity.INFO,
        message=f"Word count: {words} words ({pct:.0f}% of {min_words}-word threshold)",
        editorial_ref=EDITORIAL_REF,
    )

    if words >= min_words:
        return

    deficit = min_words - words
    yield Violation(
        check=CHECK_NAME,
        severity=DEFAULT_SEVERITY,
        message=(
            f"Article too short (depth threshold): {words} words < {min_words}-word threshold"
            f" (short by {deficit} words = {deficit / min_words * 100:.0f}%)"
        ),
        line=1,
        snippet="",
        editorial_ref=EDITORIAL_REF,
        fix_suggestion=(
            f"Currently {words} words, needs {deficit} more to reach {min_words}."
        ),
    )
