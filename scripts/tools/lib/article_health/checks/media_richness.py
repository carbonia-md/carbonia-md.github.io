"""media_richness — depth article media-asset threshold (image hard gate + iframe soft signal).

Ported from the source corpus. Image count is a WARN-level gate (escalates under
stricter profiles); iframe count is INFO-only signal (encouraged, not
enforced — matches the source corpus's softened-gate history).

Detected:
    - HTML `<iframe ...>` tags in body (count occurrences, ignoring code blocks)
    - Inline `![alt](path)` images
    - Frontmatter `image:` (1 hero)
    Total iframe + total images counted separately.

Runs on knowledge/{Category}/*.md articles; non-articles are filtered at the
CLI boundary (loader.is_article_path).

Threshold:
    - default: min_iframes=1 (INFO only), min_images=3 (WARN)
    - Note: as of this port, 0/18 this project articles have any images —
      this gate currently flags the whole corpus uniformly until images are
      adopted. Kept WARN per explicit decision rather than downgrading.

Canonical:
    - docs/playbook/ARTICLE-PLAYBOOK.md §8 Numeric Thresholds
"""

from __future__ import annotations
import re
from typing import Any, Iterator

from ..types import FileTarget, Severity, Violation


CHECK_NAME = "media-richness"
DIMENSION = "media-quality"
DEFAULT_SEVERITY = Severity.WARN
EDITORIAL_REF = "docs/playbook/ARTICLE-PLAYBOOK.md §8 Numeric Thresholds"

DEFAULT_MIN_IFRAMES = 1
DEFAULT_MIN_IMAGES = 3

# Length-scaled count target (INFO advisory) + multimodal nudge. Density
# band (floor/ceiling) is owned by paragraph-rhythm; this plugin owns the
# count target (denominator-free) + multimodal (image AND video) nudge.
DEFAULT_WORDS_PER_MEDIA = 400
# Topics that typically have official video footage available (nudge to add
# one when 0 iframes found, per ARTICLE-PLAYBOOK §8 Numeric Thresholds).
VIDEO_RICH_CATEGORIES = {"Nature & Marine Life"}

# `<iframe` followed by whitespace or `>` — accommodates `<iframe src=...>` and
# `<iframe>` and `<iframe\nsrc=...>`. Case-sensitive (HTML iframe spec lowercase).
_RE_IFRAME = re.compile(r"<iframe[\s>]", re.IGNORECASE)
_RE_INLINE_IMAGE = re.compile(r"!\[([^\]]*)\]\(([^)\n]+)\)")
# Strip fenced code blocks before counting iframes (avoid example snippets in docs).
_RE_CODE_BLOCK = re.compile(r"```.*?```", re.DOTALL)
_RE_WORD = re.compile(r"[A-Za-z0-9'-]+")


def check(target: FileTarget, config: dict[str, Any]) -> Iterator[Violation]:
    options = config or {}
    min_iframes = int(options.get("min_iframes", DEFAULT_MIN_IFRAMES))
    min_images = int(options.get("min_images", DEFAULT_MIN_IMAGES))

    body = target.body if target.body else target.text
    if not body:
        return

    # Strip fenced code blocks so iframe examples in docs don't false-positive.
    body_clean = _RE_CODE_BLOCK.sub("", body)

    iframe_count = len(_RE_IFRAME.findall(body_clean))

    inline_images = len(_RE_INLINE_IMAGE.findall(body_clean))
    fm_image = target.frontmatter.get("image")
    has_fm_image = isinstance(fm_image, str) and fm_image.strip() != ""
    total_images = inline_images + (1 if has_fm_image else 0)

    # ── INFO stats line (always emit) ────────────────────────────────────────
    yield Violation(
        check=CHECK_NAME,
        severity=Severity.INFO,
        message=(
            f"Media stats: {iframe_count} iframe + {total_images} image "
            f"(threshold image >= {min_images} WARN / iframe >= {min_iframes} info-only)"
        ),
        editorial_ref=EDITORIAL_REF,
    )

    # ── Threshold (image=WARN gate / iframe=INFO signal-only) ────────────────
    iframe_short = iframe_count < min_iframes
    image_short = total_images < min_images

    if iframe_short:
        yield Violation(
            check=CHECK_NAME,
            severity=Severity.INFO,
            message=(
                f"iframe {iframe_count} < {min_iframes} (missing video asset, soft "
                "signal — ideal multimodal presentation pairs video, doesn't block ship)"
            ),
            line=None,
            snippet=None,
            editorial_ref=EDITORIAL_REF,
            fix_suggestion="Find a YouTube/Vimeo video to embed as an iframe",
        )

    if image_short:
        yield Violation(
            check=CHECK_NAME,
            severity=DEFAULT_SEVERITY,
            message=f"Not enough images: image {total_images} < {min_images}",
            line=1,
            snippet="",
            editorial_ref=EDITORIAL_REF,
            fix_suggestion=(
                "(1) Add PD/CC images to public/article-images/"
                " (2) follow §media weaving baseline (hero + >=1 inline scene-mid image)"
            ),
        )

    # ── Length-scaled count target (INFO) ────────────────────────────────────
    # Depth article only — short articles don't get a count target. INFO
    # advisory; the density floor (a harder signal) is owned by paragraph-rhythm.
    total_media = total_images + iframe_count
    words = len(_RE_WORD.findall(body_clean))
    DEPTH_WORD_THRESHOLD = 800
    if words >= DEPTH_WORD_THRESHOLD:
        count_target = max(3, round(words / DEFAULT_WORDS_PER_MEDIA))
        if total_media < count_target:
            yield Violation(
                check=CHECK_NAME,
                severity=Severity.INFO,
                message=(
                    f"Media count advisory: image+video {total_media} < {count_target} "
                    f"(depth {words} words, ~1 media per {DEFAULT_WORDS_PER_MEDIA} words)."
                ),
                line=None,
                snippet=f"media={total_media} target={count_target} words={words}",
                editorial_ref=EDITORIAL_REF,
                fix_suggestion="Add a scene-mid image or an official video iframe",
            )

    # ── Multimodal video floor (WARN) ────────────────────────────────────────
    # Nature/Marine topics usually have official video footage available;
    # 0 iframes on a depth article in this category is worth a nudge.
    category = target.frontmatter.get("category") if target.frontmatter else None
    if (
        words >= DEPTH_WORD_THRESHOLD
        and iframe_count == 0
        and isinstance(category, str)
        and category.strip() in VIDEO_RICH_CATEGORIES
    ):
        yield Violation(
            check=CHECK_NAME,
            severity=Severity.WARN,
            message=(
                f"Missing video asset: {category} topics usually have official video "
                "footage available, currently 0 iframes."
            ),
            line=None,
            snippet=f"category={category} iframe=0",
            editorial_ref=EDITORIAL_REF,
            fix_suggestion="Find official-channel footage to embed as an iframe",
        )
