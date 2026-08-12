"""paragraph_rhythm — paragraph breathing rhythm + media density band (floor + ceiling).

Counts English words per paragraph / per section.

IMPORTANT — uncalibrated thresholds: this project has no corpus of known-good
and known-bad long-form articles to calibrate against — its longest article is
~773 words, well under this gate's 800-word activation floor, so none of this
plugin's checks fire on the current corpus. The word-count thresholds below are
reasonable placeholders, not data-calibrated. Recalibrate once real depth
articles (800+ words) exist and some turn out atomized / media-poor in
practice.

Rules:
  - **R1 paragraph median words < 40**: WARN — atomization drift signal
  - **R2 H2 prose paragraph count > 8**: WARN — H2 section over-fragmented
  - **R3-FLOOR media density < 0.8 / 1k words**: WARN — media-poor / not
    enough multimodal presentation
  - **R3-WARN media density > 1.2 / 1k words**: WARN — visual density on
    the high side
  - **R3-HARD media density > 1.5 / 1k words AND paragraph median < 40**:
    HARD — combined visual-reliance + atomization signal

Runs on knowledge/{Category}/*.md articles; non-articles are filtered at the
CLI boundary (loader.is_article_path).

Canonical:
  - docs/playbook/ARTICLE-PLAYBOOK.md §8 Numeric Thresholds
"""

from __future__ import annotations
import re
from statistics import median
from typing import Any, Iterator

from ..types import FileTarget, Severity, Violation


CHECK_NAME = "paragraph-rhythm"
DIMENSION = "depth"
DEFAULT_SEVERITY = Severity.WARN
EDITORIAL_REF = "docs/playbook/ARTICLE-PLAYBOOK.md §8 Numeric Thresholds"

# Thresholds — see module docstring: placeholders pending a real corpus.
PARA_MEDIAN_WARN = 40  # words — below this = atomization signal
H2_PARA_MAX = 8  # per-H2 prose paragraph soft cap
PARA_WALL_MAX = 180  # words — single paragraph longer than this = a "wall"
MEDIA_DENSITY_FLOOR = 0.8  # < floor = media-poor
IFRAME_DENSITY_WARN = 1.2  # > warn = visual density on the high side
IFRAME_DENSITY_HARD = 1.5  # > hard + median<40 = atomization drift
# tw-* visual modules count toward media count. Data modules are article
# content, not decoration: full count toward FLOOR (media-poor); discounted
# up to this cap toward the atomization ceiling so viz-rich data-panorama
# articles aren't penalized for legitimately having many chart modules.
TW_MODULE_CEILING_DISCOUNT_CAP = 13
# Media density band only applies to depth articles; short pages / galleries
# (prose-light, module-heavy) would have a distorted density.
MEDIA_BAND_MIN_WORDS = 1200


_RE_WORD = re.compile(r"[A-Za-z0-9'-]+")
_RE_H2 = re.compile(r"^##\s+(?!#)", re.MULTILINE)  # H2 only, not H3+
_RE_IFRAME = re.compile(r"<iframe\s", re.IGNORECASE)
_RE_IMAGE_MD = re.compile(r"!\[[^\]]*\]\([^\)]+\)")
_RE_HERO_IMAGE_FRONTMATTER = re.compile(r"^image:\s*['\"]?/", re.MULTILINE)
# tw-* fenced viz modules (src/styles/article-modules.css) — counted toward media density
_RE_TW_MODULE = re.compile(r"(?m)^```tw-[a-z]+")
# Frontmatter delimiters
_RE_FRONTMATTER = re.compile(r"^---\s*\n.*?\n---\s*\n", re.DOTALL)
# Code fences
_RE_CODE_FENCE = re.compile(r"```.*?```", re.DOTALL)
# Footnote def lines
_RE_FOOTNOTE_DEF = re.compile(r"^\[\^[^\]]+\]:.*$", re.MULTILINE)


def _strip_for_prose_analysis(text: str) -> str:
    """Strip frontmatter, code fences, footnote definitions to get pure body."""
    text = _RE_FRONTMATTER.sub("", text)
    text = _RE_CODE_FENCE.sub("", text)
    text = _RE_FOOTNOTE_DEF.sub("", text)
    return text


def _count_words(s: str) -> int:
    return len(_RE_WORD.findall(s))


def _extract_h2_sections(body: str) -> list[tuple[str, str]]:
    """Return list of (h2_title, h2_body) tuples."""
    parts = re.split(r"^(##\s+(?!#)[^\n]+)\n", body, flags=re.MULTILINE)
    # parts[0] = pre-H2 lead; then alternating (title, body)
    sections = []
    for i in range(1, len(parts) - 1, 2):
        title = parts[i].strip().lstrip("#").strip()
        section_body = parts[i + 1] if i + 1 < len(parts) else ""
        sections.append((title, section_body))
    return sections


def _split_paragraphs(section_body: str) -> list[str]:
    """Split section body into prose paragraphs.

    Skip:
      - empty lines (used as paragraph delimiters)
      - blockquote-only paragraphs (start with `>` — usually callout meta)
      - bullet-list paragraphs (start with `- ` or `* ` or a numbered-list marker)
      - HTML-only paragraphs (iframe div wrappers)
      - heading-like lines (`##`, `###`)
      - italic caption lines `_..._`
    """
    raw_paragraphs = re.split(r"\n\s*\n", section_body)
    paragraphs = []
    for p in raw_paragraphs:
        p_stripped = p.strip()
        if not p_stripped:
            continue
        first_line = p_stripped.split("\n", 1)[0].strip()
        # Skip blockquote callouts
        if first_line.startswith(">"):
            continue
        # Skip bullet / numbered list
        if re.match(r"^(?:[-*]\s|\d+\.\s)", first_line):
            continue
        # Skip headings (H3+)
        if first_line.startswith("#"):
            continue
        # Skip HTML / iframe wrappers
        if first_line.startswith("<") or first_line.startswith("</"):
            continue
        # Skip italic-only caption lines (e.g. _photo credit_)
        if (
            first_line.startswith("_")
            and first_line.endswith("_")
            and len(first_line) < 200
        ):
            continue
        # Skip image markdown
        if first_line.startswith("!["):
            continue
        # Skip if entirely just inline markdown (very short)
        word_count = _count_words(p_stripped)
        if word_count < 5:  # too short to count as prose paragraph
            continue
        paragraphs.append(p_stripped)
    return paragraphs


def check(target: FileTarget, config: dict[str, Any]) -> Iterator[Violation]:
    """Detect atomization drift signals."""
    text = target.text
    body = _strip_for_prose_analysis(text)
    total_words = _count_words(body)

    # Only check depth articles (>= 800 words — short articles have different rhythm)
    if total_words < 800:
        return

    # Collect prose paragraphs across all H2 sections
    sections = _extract_h2_sections(body)
    all_paragraphs_words: list[int] = []
    per_section_counts: list[tuple[str, int]] = []  # (title, paragraph_count)
    walls: list[tuple[int, str]] = []  # R4: single paragraph too long (a "wall") — (words, snippet)

    # Also include pre-H2 lead paragraphs
    if sections:
        # Use part before first H2 as "lead"
        first_h2_match = re.search(r"^##\s+(?!#)", body, flags=re.MULTILINE)
        if first_h2_match:
            lead_body = body[: first_h2_match.start()]
            lead_paragraphs = _split_paragraphs(lead_body)
            for p in lead_paragraphs:
                words = _count_words(p)
                if words >= 5:
                    all_paragraphs_words.append(words)
                if words > PARA_WALL_MAX:
                    walls.append((words, p.strip().replace("\n", " ")[:26]))
            if lead_paragraphs:
                per_section_counts.append(("[lead]", len(lead_paragraphs)))

    for title, section_body in sections:
        paragraphs = _split_paragraphs(section_body)
        per_section_counts.append((title, len(paragraphs)))
        for p in paragraphs:
            words = _count_words(p)
            if words >= 5:
                all_paragraphs_words.append(words)
            if words > PARA_WALL_MAX:
                walls.append((words, p.strip().replace("\n", " ")[:26]))

    if not all_paragraphs_words:
        return

    para_median = int(median(all_paragraphs_words))
    para_count = len(all_paragraphs_words)

    # ── R1: paragraph median word count ──
    if para_median < PARA_MEDIAN_WARN:
        yield Violation(
            check=CHECK_NAME,
            severity=Severity.WARN,
            message=(
                f"Paragraph atomization (drift R1): "
                f"paragraph median {para_median} words < {PARA_MEDIAN_WARN}-word threshold. "
                f"{para_count} paragraphs / {total_words} words total."
            ),
            line=1,
            snippet=f"para_median={para_median} para_count={para_count}",
            editorial_ref=EDITORIAL_REF,
            fix_suggestion=(
                "Merge paragraphs: one fact per paragraph -> one point per paragraph "
                "(with causal chain + detail + scene). Or: keep prose paragraphs per "
                "H2 section <= 8 (per ARTICLE-PLAYBOOK §8 Numeric Thresholds)."
            ),
        )

    # ── R2: per-H2 prose paragraph count > 8 ──
    over_h2 = [(t, c) for t, c in per_section_counts if c > H2_PARA_MAX]
    if over_h2:
        names = ", ".join(f"§{t}({c})" for t, c in over_h2[:3])
        more = f" +{len(over_h2) - 3} more H2" if len(over_h2) > 3 else ""
        yield Violation(
            check=CHECK_NAME,
            severity=Severity.WARN,
            message=(
                f"H2 over-fragmented (drift R2): "
                f"{len(over_h2)} H2 section(s) exceed {H2_PARA_MAX} prose paragraphs: {names}{more}."
            ),
            line=1,
            snippet=f"over_h2_count={len(over_h2)}",
            editorial_ref=EDITORIAL_REF,
            fix_suggestion=(
                "Over-fragmented H2 may mean (a) it should split into two sections "
                "(b) too many paragraphs should be merged (c) structural footer / "
                "callout content shouldn't count as prose paragraphs."
            ),
        )

    # ── R4: single-paragraph wall ──
    # R1 catches "too short / atomized"; R4 catches the opposite end "too long / a wall".
    if walls:
        walls.sort(reverse=True)
        names = "; ".join(f"{c} words \"{s}…\"" for c, s in walls[:3])
        more = f" + {len(walls) - 3} more" if len(walls) > 3 else ""
        yield Violation(
            check=CHECK_NAME,
            severity=Severity.WARN,
            message=(
                f"Paragraph too long = a wall (R4): {len(walls)} paragraph(s) > "
                f"{PARA_WALL_MAX} words — {names}{more}."
            ),
            line=1,
            snippet=f"walls={len(walls)} max={walls[0][0]}",
            editorial_ref=EDITORIAL_REF,
            fix_suggestion=(
                "Split the long paragraph at a natural turn (topic shift / causal "
                "step / before a quote); each half should still be >= "
                f"{PARA_MEDIAN_WARN} words (don't atomize into R1)."
            ),
        )

    # ── R3: media density band / 1k words ──
    # Band only applies to depth articles; short pages / galleries / showcases
    # (prose-light) would have a distorted density — skip.
    if total_words < MEDIA_BAND_MIN_WORDS:
        return
    iframe_count = len(_RE_IFRAME.findall(text))
    image_count = len(_RE_IMAGE_MD.findall(text))
    # Hero image from frontmatter counts as 1 if present
    has_hero = bool(_RE_HERO_IMAGE_FRONTMATTER.search(text))
    tw_module_count = len(_RE_TW_MODULE.findall(text))
    # Full visual count (incl. tw-* modules) — used for FLOOR (media-poor) judgment.
    visual_count = iframe_count + image_count + (1 if has_hero else 0) + tw_module_count
    density = (visual_count * 1000) / total_words if total_words > 0 else 0
    # Atomization ceiling uses the count after discounting tw-* modules — data
    # modules aren't atomization, give viz-rich articles headroom.
    ceiling_visual = visual_count - min(tw_module_count, TW_MODULE_CEILING_DISCOUNT_CAP)
    ceiling_density = (ceiling_visual * 1000) / total_words if total_words > 0 else 0

    # ── R3-FLOOR: media-poor (band floor) ──
    if density < MEDIA_DENSITY_FLOOR:
        yield Violation(
            check=CHECK_NAME,
            severity=Severity.WARN,
            message=(
                f"Media-poor (band floor R3-FLOOR): "
                f"{visual_count} visual / {total_words} words = {density:.2f}/1k < "
                f"{MEDIA_DENSITY_FLOOR}/1k floor."
            ),
            line=1,
            snippet=f"density={density:.2f} media={visual_count}",
            editorial_ref=EDITORIAL_REF,
            fix_suggestion=(
                "(a) Add hero + scene-mid image to reach ~1 per 1k words "
                "(b) For nature/marine topics, add an official video iframe"
            ),
        )
    # HARD only when BOTH high visual density AND atomized paragraphs.
    elif ceiling_density >= IFRAME_DENSITY_HARD and para_median < PARA_MEDIAN_WARN:
        yield Violation(
            check=CHECK_NAME,
            severity=Severity.HARD,
            message=(
                f"Combined atomization drift HARD: "
                f"density {ceiling_density:.2f}/1k (after discounting "
                f"{min(tw_module_count, TW_MODULE_CEILING_DISCOUNT_CAP)} tw-* modules) "
                f"> {IFRAME_DENSITY_HARD} AND paragraph median {para_median} < {PARA_MEDIAN_WARN}. "
                f"Visual reliance + paragraph atomization combined signal."
            ),
            line=1,
            snippet=f"ceiling_density={ceiling_density:.2f} para_median={para_median}",
            editorial_ref=EDITORIAL_REF,
            fix_suggestion=(
                "(a) Merge paragraphs to restore prose rhythm to median 75-90 words "
                "(b) Cut iframes to <= 1.0/1k words "
                "(c) Satisfying at least one of these is required to ship"
            ),
        )
    elif ceiling_density >= IFRAME_DENSITY_WARN:
        yield Violation(
            check=CHECK_NAME,
            severity=Severity.WARN,
            message=(
                f"Visual density on the high side (band ceiling R3-WARN): "
                f"{visual_count} visual ({tw_module_count} tw-* modules discounted "
                f"{min(tw_module_count, TW_MODULE_CEILING_DISCOUNT_CAP)}) / {total_words} words = "
                f"{ceiling_density:.2f}/1k > {IFRAME_DENSITY_WARN}/1k suggested ceiling."
            ),
            line=1,
            snippet=f"ceiling_density={ceiling_density:.2f} visual={visual_count}",
            editorial_ref=EDITORIAL_REF,
            fix_suggestion=(
                "Consider: (a) let prose paragraphs carry the rhythm instead of "
                "outsourcing to iframes (b) keep 3-5 representative iframes, drop "
                f"the rest (c) > 1.5/1k with paragraph median < {PARA_MEDIAN_WARN} = atomization HARD"
            ),
        )
