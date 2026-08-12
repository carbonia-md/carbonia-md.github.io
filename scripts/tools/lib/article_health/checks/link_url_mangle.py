"""link-url-mangle — catch prettier-mangled & at-risk image-caption link URLs.

Two patterns, both rooted in one prettier behaviour:

  HARD — a markdown link destination contains a literal `*` (e.g. a Wikimedia
         Commons `File:...*2025-12-02.jpg` URL). `*` is never valid in a real URL
         (it would be `%2A`); its presence means prettier rewrote an emphasis `_`
         into `*`. The link is broken (404). Restore the `_` AND de-link the
         caption (see WARN below).

  WARN — a markdown link to a percent-encoded (non-ASCII) Wikimedia Commons URL
         whose filename ends in `_<digits>` (e.g. `_05.jpg`, `_2025-12-02.jpg`,
         `_13.jpg`) sits INSIDE an italic caption line (`_..._`). This has not
         mangled yet but WILL on the next `prettier --write`: prettier pairs
         the URL's trailing `_NN` with the caption's closing `_` italic
         delimiter and flips the span to `*`. Pure-ASCII Commons URLs are safe
         (CommonMark intraword-underscore rule); only percent-encoded non-ASCII
         filenames trigger it. Mitigation: move the clickable link OUT of the
         `_..._` caption, keep plain-text attribution in the caption, put the
         `[link](url)` in the article's Image Sources section (not italic, so
         prettier leaves it alone). `<...>` angle-bracket wrapping does NOT help
         inside italic.

Trigger: a hero caption's percent-encoded Commons URL got silently mangled to
`*05.jpg` by pre-commit prettier; a later audit found already-broken files plus
many at-risk. The breakage is silent (build green, link 404 only on click).
"""

from __future__ import annotations

import re
from typing import Any, Iterator

from ..types import FileTarget, Severity, Violation

CHECK_NAME = "link-url-mangle"
DIMENSION = "structure"
DEFAULT_SEVERITY = Severity.HARD
EDITORIAL_REF = "docs/playbook/ARTICLE-PLAYBOOK.md §4.7 Image Sources + docs/playbook/REWRITE-PIPELINE.md Stage 4 Quality-checklist gate"

# HARD: a markdown image link whose destination contains a literal `*` (mangled).
# `\S*\*\S*` lets the URL include balanced internal parens (houtong `(cropped*2022).jpg`).
_MANGLED = re.compile(r"\]\(<?(https?://\S*\*\S*?)>?\)")

# WARN at-risk: percent-encoded Commons URL ending in `_<digits>` before the
# image extension, sitting in an italic caption line.
_ATRISK_URL = re.compile(
    r"\]\(<?https?://commons\.wikimedia\.org[^\s)]*%[0-9A-Fa-f]{2}"
    r"[^\s)]*_[0-9][0-9-]*\.(?:jpg|JPG|jpeg|png|webp)>?\)"
)


def _is_italic_caption(line: str) -> bool:
    s = line.strip()
    # Caption convention: a paragraph wrapped in single underscores `_…_`.
    return len(s) >= 2 and s.startswith("_") and (s.endswith("_") or s.endswith("*") or s.endswith("\\_"))


def check(target: FileTarget, config: dict[str, Any]) -> Iterator[Violation]:
    text = target.text
    if not text:
        return

    for line_no, line in enumerate(text.split("\n"), start=1):
        # HARD — already mangled (`*` in a link URL).
        # Scope to the actual bug mechanism: a literal `*` in a link URL is a
        # prettier-mangle only when the link sits in an italic caption, OR the URL is a
        # wiki(m|p)edia URL (Commons filenames never contain a literal `*` — it'd be
        # %2A). A `*` in a non-wiki footnote query string (1111.com.tw `sa0=50000*`,
        # ly.gov.tw `NO%3DE01961*`) is legitimate — don't false-positive (2026-06-21).
        m = _MANGLED.search(line)
        if m and (
            _is_italic_caption(line)
            or "wikimedia.org" in m.group(1)
            or "wikipedia.org" in m.group(1)
        ):
            yield Violation(
                check=CHECK_NAME,
                severity=Severity.HARD,
                message=(
                    f"Link URL contains `*` (prettier mangled `_NN` to `*NN` inside italic caption, link is 404): "
                    f"...{m.group(1)[-48:]}. Fix: restore `*` to `_` in URL, move link out of `_italic_` caption (put in image-sources section)."
                ),
                line=line_no,
                snippet=line.strip()[:90],
                editorial_ref=EDITORIAL_REF,
                fix_suggestion=(
                    "Keep plain-text attribution in caption (`Photo: X / Wikimedia Commons, CC BY-SA 4.0`), "
                    "put clickable link in `## Image Sources` section (not italic, prettier won't touch it). `<...>` inside italic does not help."
                ),
            )
            continue

        # WARN — at-risk: percent-encoded Commons URL with trailing `_NN` inside an italic caption.
        if _is_italic_caption(line) and _ATRISK_URL.search(line):
            yield Violation(
                check=CHECK_NAME,
                severity=Severity.WARN,
                message=(
                    "Italic caption contains percent-encoded Commons URL with `_NN.jpg`, "
                    "next prettier run will mangle to `*NN` (link 404). Move link out of caption now."
                ),
                line=line_no,
                snippet=line.strip()[:90],
                editorial_ref=EDITORIAL_REF,
                fix_suggestion=(
                    "Move `[...](commons-url)` to `## Image Sources` section, keep only plain-text attribution in caption."
                ),
            )
