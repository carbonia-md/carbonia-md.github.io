"""image_health — article image references + frontmatter coherence + count gate.

REWRITE-PIPELINE Stage 4 hard gate.

Dimensions:
  1. inline `![alt](path)` references — `path` must exist on disk
  2. frontmatter `image:` — file must exist
  3. external hot-link detection — http/https URLs not under
     `/article-images/` or `https://upload.wikimedia.org/...`
     (canonical CC sources allowed)
  4. ## Image Sources section presence (when CC images used)
  5. **image count gate (added 2026-05-11)** —
     depth article ideal: hero + 1-2 scene-mid = 2-3 images, min_images=3 default
     soft-launch WARN (legacy heal), rewrite-stage-4 profile severity_override
     escalates to HARD. Triggered when Stage 4 narrative rhythm instrumentation
     was missing from article-health.

Severity: HARD for missing files / hot-links, WARN for missing Image Sources section,
configurable WARN/HARD for min-count gate via options.
"""

from __future__ import annotations
import re
from pathlib import Path
from typing import Any, Iterator

from ..types import FileTarget, Severity, Violation


CHECK_NAME = "image-health"
DIMENSION = "media"
DEFAULT_SEVERITY = Severity.HARD
EDITORIAL_REF = "docs/playbook/REWRITE-PIPELINE.md Stage 1 Research + Stage 4 Quality-checklist gate"

# Defaults — overridable via profile options
DEFAULT_MIN_IMAGES = 3
# Soft-launch WARN for both 0-image and 1-2-image cases (mirrors word-count
# pattern: legacy articles below threshold don't hard-block pre-commit, avoids
# blocking typo fixes; rewrite-stage-4 profile severity_override escalates HARD).
DEFAULT_MIN_IMAGES_SEVERITY = "warn"  # rewrite-stage-4 promotes to "hard"
DEFAULT_ZERO_IMAGES_SEVERITY = "warn"  # rewrite-stage-4 promotes to "hard"

# Media completeness floor + length-scaling: the media floor scales with word
# count. effective_min = max(min_images, round(words / words_per_media)).
# length_scaled default off; rewrite-stage-4 profile override on.
DEFAULT_LENGTH_SCALED = False
DEFAULT_WORDS_PER_MEDIA = 400

# Markdown image syntax: ![alt](src)
_RE_INLINE_IMAGE = re.compile(r"!\[([^\]]*)\]\(([^)\n]+)\)")
# Count video iframes toward the media threshold (images+videos count together).
_RE_IFRAME = re.compile(r"<iframe[\s>]", re.IGNORECASE)
_RE_IMAGE_SOURCES_H2 = re.compile(r"^##\s*Image Sources", re.MULTILINE)
_RE_WORD = re.compile(r"[A-Za-z0-9'-]+")
# length-scaling counts prose words, excluding the references section (footnotes
# would inflate the count and demand excessive media).
_RE_REF_SECTION = re.compile(r"^##\s*(?:References|Further Reading)", re.MULTILINE)
# Caption render check: HTML block (</div> / </iframe>) immediately followed by markdown italic
# caption (_..._) without blank line -> remark/markdown won't render italic (underscores become
# literal chars). 2026-06-07 directive. Working pattern: blank line between </div> and _caption_.
_RE_CAPTION_NO_BLANK = re.compile(r"</(?:div|iframe)>[ \t]*\n_")


def _is_local_path(src: str) -> bool:
    """Local image: starts with / or article-images/ or no scheme."""
    return not src.startswith(("http://", "https://"))


def _is_allowed_external(src: str) -> bool:
    """Allow Wikimedia / commons (canonical CC sources)."""
    allowed_prefixes = (
        "https://upload.wikimedia.org/",
        "https://commons.wikimedia.org/",
    )
    return src.startswith(allowed_prefixes)


def _parse_severity(value: Any, fallback: Severity) -> Severity:
    if isinstance(value, Severity):
        return value
    if not value:
        return fallback
    try:
        return Severity(str(value).lower())
    except ValueError:
        return fallback


def check(target: FileTarget, config: dict[str, Any]) -> Iterator[Violation]:
    body = target.body
    repo_root = Path.cwd()
    public_root = repo_root / "public"
    options = config or {}

    # ── Pre-compute counts (used for stats INFO + min gate) ──────────────────
    inline_matches = list(_RE_INLINE_IMAGE.finditer(body))
    inline_count = len(inline_matches)
    fm_image = target.frontmatter.get("image")
    has_fm_image = isinstance(fm_image, str) and fm_image.strip() != ""
    total_images = inline_count + (1 if has_fm_image else 0)

    # ── 0. Stats INFO (always emit so users see count) ────────────────────────
    yield Violation(
        check=CHECK_NAME,
        severity=Severity.INFO,
        message=(
            f"Image stats: {inline_count} inline + "
            f"{1 if has_fm_image else 0} hero (frontmatter) = "
            f"{total_images} total"
        ),
        editorial_ref=EDITORIAL_REF,
    )

    # ── 1. inline image references — broken-path / hot-link HARD gate ────────
    for m in inline_matches:
        alt, src = m.group(1), m.group(2).strip()
        line_no = body.count("\n", 0, m.start()) + 1
        if not _is_local_path(src):
            if not _is_allowed_external(src):
                yield Violation(
                    check=CHECK_NAME,
                    severity=Severity.HARD,
                    message=(
                        "External image hot-link — cache to public/article-images/"
                        " and use src=`/article-images/...`"
                    ),
                    line=line_no,
                    snippet=src[:80],
                    editorial_ref=EDITORIAL_REF,
                )
            continue
        # Local: validate file exists (relative to public/ for absolute paths)
        if src.startswith("/"):
            local = public_root / src.lstrip("/")
        else:
            local = target.path.parent / src
        if not local.exists():
            yield Violation(
                check=CHECK_NAME,
                severity=Severity.HARD,
                message=f"Image file not found: {src}",
                line=line_no,
                snippet=src[:80],
                editorial_ref=EDITORIAL_REF,
            )

    # ── 2. frontmatter image — file existence HARD gate ──────────────────────
    if has_fm_image:
        src = fm_image.strip()
        if _is_local_path(src):
            local = public_root / src.lstrip("/")
            if not local.exists():
                yield Violation(
                    check=CHECK_NAME,
                    severity=Severity.HARD,
                    message=f"Frontmatter image file not found: {src}",
                    snippet=src[:80],
                    editorial_ref=EDITORIAL_REF,
                )

    # ── 3. ## Image Sources section when CC attribution exists ─────────────────
    has_attribution = (
        target.frontmatter.get("imageCredit")
        or target.frontmatter.get("imageLicense")
        or target.frontmatter.get("imageSource")
    )
    if has_attribution and not _RE_IMAGE_SOURCES_H2.search(body):
        yield Violation(
            check=CHECK_NAME,
            severity=Severity.WARN,
            message=(
                "Frontmatter has imageCredit/imageLicense/imageSource but missing "
                "`## Image Sources` section (CC images require source citation)"
            ),
            editorial_ref=EDITORIAL_REF,
        )

    # ── 3.5 caption render: HTML block immediately followed by _caption_ without blank line ──
    for m in _RE_CAPTION_NO_BLANK.finditer(body):
        line_no = body.count("\n", 0, m.start()) + 1
        yield Violation(
            check=CHECK_NAME,
            severity=Severity.WARN,
            message=(
                "Video/HTML caption missing blank line: `</div>`/`</iframe>` followed by "
                "`_caption_` without blank line — markdown won't render italic."
            ),
            line=line_no,
            snippet="</div>↵_caption_  (should be </div>↵↵_caption_)",
            editorial_ref="docs/playbook/REWRITE-PIPELINE.md Stage 4 Quality-checklist gate",
            fix_suggestion="Add a blank line between </div> and _caption_.",
        )

    # ── 4. Min image count gate (depth article media rhythm) ──────────────────
    # Per REWRITE-PIPELINE Stage 4 — depth article ideal hero + 1-2 scene-mid
    # = 2-3 images. default min_images=3, soft-launch WARN, rewrite-stage-4 HARD.
    min_images = int(options.get("min_images", DEFAULT_MIN_IMAGES))
    # length-scaled media floor (v6.8): longer articles need more media.
    # effective_min = max(min_images, round(words / words_per_media)). base
    # min_images is the short-depth floor; length-scale pulls longer articles higher.
    if options.get("length_scaled", DEFAULT_LENGTH_SCALED):
        ref_m = _RE_REF_SECTION.search(body)
        prose_body = body[: ref_m.start()] if ref_m else body
        length_unit = len(_RE_WORD.findall(prose_body))
        per = int(options.get("words_per_media", DEFAULT_WORDS_PER_MEDIA)) or DEFAULT_WORDS_PER_MEDIA
        min_images = max(min_images, round(length_unit / per))
    # 2026-06-04 directive: images+videos valued together. Threshold counts "media"
    # (images+videos), not just images. But retains >=1 static image floor (OG card /
    # poster needs a static image; videos can't derive one).
    iframe_count = len(_RE_IFRAME.findall(body))
    media_total = total_images + iframe_count
    if media_total >= min_images and total_images == 0:
        yield Violation(
            check=CHECK_NAME,
            severity=_parse_severity(
                options.get("min_images_severity"),
                Severity(DEFAULT_MIN_IMAGES_SEVERITY),
            ),
            message=(
                f"No static images: {iframe_count} videos but 0 images — "
                "add at least 1 hero image (OG card / poster needs a static image)"
            ),
            fix_suggestion="Add 1 hero image (frontmatter image:); videos still count toward media total.",
            editorial_ref=EDITORIAL_REF,
        )
    elif media_total < min_images:
        if media_total == 0:
            sev = _parse_severity(
                options.get("zero_images_severity"),
                Severity(DEFAULT_ZERO_IMAGES_SEVERITY),
            )
            msg_detail = (
                f"0 media — depth article needs at least hero + scene-mid / video = "
                f"{min_images} (per REWRITE-PIPELINE Stage 4)"
            )
        else:
            sev = _parse_severity(
                options.get("min_images_severity"),
                Severity(DEFAULT_MIN_IMAGES_SEVERITY),
            )
            msg_detail = (
                f"Insufficient media: images {total_images} + videos {iframe_count} = {media_total} "
                f"< {min_images} minimum (depth article needs hero + 1-2 scene-mid / "
                f"video, per REWRITE-PIPELINE Stage 4)"
            )
        yield Violation(
            check=CHECK_NAME,
            severity=sev,
            message=msg_detail,
            fix_suggestion=(
                "Follow REWRITE-PIPELINE Stage 1 Research media research: "
                "(1) cache PD/CC images to public/article-images/{category}/ "
                "(2) keep hero 0.9-2.0 / inline 0.75-2.5 aspect ratios "
                "(3) Stage 4 insert into article (hero + scene-mid rhythm) "
                "(4) ## Image Sources section with CC license + photographer. "
                "No PD/CC available → fair use editorial commentary scope "
                "(per REWRITE-PIPELINE Stage 1 Research)"
            ),
            editorial_ref=EDITORIAL_REF,
        )
