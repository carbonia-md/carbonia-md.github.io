"""prose_health — consolidated prose quality checks (English, this project).

An English prose-quality scanner. The structural
dimensions (bullet density, year count, citation density, em-dash overuse,
template-H2, list-dump, thin sections, quality-decay) are language-agnostic and
carry over directly. The prose-tell dimensions are rewritten from the LB canon:

Canonical source:
  - docs/playbook/ARTICLE-PLAYBOOK.md §6 "Voice: A Local Friend, Not a Brochure"
    — the concrete lists: Not Wanted: Travel-Brochure Tells, the "Not Just X,
      It's Y" Pattern, Em Dash Discipline, Canned Endings. The principle behind
      the lists: false-contrast structures, em-dash chains, and generic travel
      adjectives doing work concrete detail should do.

prose-tell dimensions (ARTICLE-PLAYBOOK §6):
  - plastic phrases     → §6 "Travel-Brochure Tells" multi-word constructions
  - hollow words        → §6 generic brochure adjectives (stunning / scenic / …)
  - "Not Just X, It's Y" → §6 false-contrast pattern
  - AI metaphor tells   → delve / tapestry / testament to / beacon / …
  - AI ritual phrases   → in conclusion / at the end of the day / …
  - stock opening       → §6 "Whether you're a local or a first-time visitor"
  - canned ending       → §6 Canned Endings ("must-see stop on your itinerary")
  - em-dash overuse     → §6 Em Dash Discipline (single U+2014 —)

LB sourcing convention: articles cite via the `source:` frontmatter list (15/18
of the corpus), not `[^n]:` footnotes or inline body URLs the way the source corpus does.
The URL-count and citation-desert dimensions therefore count `source:` frontmatter
entries as citation evidence — without that they misfire on every LB article.

This is the English structural + prose-tell scorer; language-specific prose
dimensions that only applied to non-English source text are not part of it.

Total score budget: ≤ 3 = pass. A "score" violation is yielded with the running
total — the runner gates on it via profile.fail_on = "score-budget"
(rewrite-stage-3). prose-tell WARNs are advisory and do NOT count toward score,
so legacy articles surface drift without hard-failing the stage gate.
"""

from __future__ import annotations
import re
from typing import Any, Iterator

from ..types import FileTarget, Severity, Violation


CHECK_NAME = "prose-health"
DIMENSION = "prose-quality"
DEFAULT_SEVERITY = Severity.WARN
EDITORIAL_REF = "docs/playbook/ARTICLE-PLAYBOOK.md §6 Voice"


# ── Travel-brochure plastic phrases (ARTICLE-PLAYBOOK §6 "Travel-Brochure Tells") ────
# Multi-word constructions that could be glued onto any beach town and still
# parse. The single-adjective tells live in _RE_HOLLOW below.
_RE_PLASTIC = re.compile(
    r"\bhidden gem\b|\ba true gem\b|\bbest[- ]kept secret\b|"
    r"\bnestled\b|\bboasts\b|\boffers visitors\b|"
    r"\bmust[- ]see\b|\bmust[- ]visit\b|\bbucket[- ]list\b|"
    r"\bsomething for everyone\b|\bsomewhere for everyone\b|"
    r"\bwhether you(?:'re| are) a local\b|"
    r"\brich history\b|\bvibrant arts scene\b|\bunparalleled views\b|"
    r"\bno trip to .{0,40} is complete without\b",
    re.IGNORECASE,
)

# ── Hollow brochure adjectives (ARTICLE-PLAYBOOK §6 — single words doing a fact's job) ─
_RE_HOLLOW = re.compile(
    r"\b(?:stunning|breathtaking|picturesque|charming|idyllic|iconic|"
    r"scenic|gorgeous|beautiful|lovely|vibrant|pristine|quaint|serene|"
    r"majestic|enchanting|captivating|spectacular|magnificent|"
    r"unparalleled|world[- ]class)\b",
    re.IGNORECASE,
)

# ── Em-dash overuse (ARTICLE-PLAYBOOK §6 "Em Dash Discipline") ───────────────────────
# English em dash is the single U+2014 character.
# Normal punctuation, but AI prose reaches for it as a tic.
_RE_EMDASH = re.compile(r"—")

# ── "Not Just X, It's Y" false-contrast pattern (ARTICLE-PLAYBOOK §6) ───────────
# The English fingerprint the source corpus flags as "not-just-X" pattern. In nearly every case the
# "X" half is a strawman the reader never assumed; delete the setup, state Y.
_TIER1_PATTERNS = [
    re.compile(r"\bis ?n[o']t just\b", re.IGNORECASE),
    re.compile(r"\bare ?n[o']t just\b", re.IGNORECASE),
    re.compile(r"\bis ?n[o']t merely\b", re.IGNORECASE),
    re.compile(r"\bnot just a\b.{0,40}\bit'?s\b", re.IGNORECASE),
    re.compile(r"\bmore than (?:just )?a\b.{0,40}\bit'?s\b", re.IGNORECASE),
    re.compile(r"\bnot only\b.{0,40}\bbut also\b", re.IGNORECASE),
    re.compile(r"\bnot just\b.{0,30}[,—]\s*but\b", re.IGNORECASE),
]

# ── AI metaphor tells (English ← ARTICLE-PLAYBOOK §6) ──────────
_TIER2_WORDS = [
    "delve", "tapestry", "testament to", "beacon", "realm",
    "navigate the complexities", "weave", "weaving", "treasure trove",
    "kaleidoscope", "symphony of", "embodiment", "myriad", "plethora",
    "tucked away", "stands as a", "serves as a reminder",
]

# ── AI ritual phrases (English ← ARTICLE-PLAYBOOK §6) ──────────
_TIER3_PHRASES = [
    "in conclusion", "it's worth noting", "it is worth noting",
    "needless to say", "at the end of the day", "when it comes to",
    "in today's fast-paced world", "without a doubt", "it goes without saying",
    "last but not least", "in this day and age",
]

# ── Stock opening (ARTICLE-PLAYBOOK §6 — "Whether you're a local …" stock opener) ────
_RE_TEXTBOOK_OPENING = re.compile(
    r"^\s*(?:whether you(?:'re| are) a local"
    r"|nestled (?:in|on|along|between)"
    r"|located in the heart of"
    r"|tucked away)\b",
    re.IGNORECASE,
)

# ── Canned ending (ARTICLE-PLAYBOOK §6 "Canned Endings") ────────────────────────
_RE_FORMULAIC_ENDING = re.compile(
    r"\bmust[- ]see stop on your\b.{0,30}\bitinerary\b"
    r"|\bwill continue to (?:charm|delight|draw|attract|enchant)\b"
    r"|\bfor (?:generations|years) to come\b"
    r"|\bnext time you(?:'re| are) in town\b"
    r"|\bwhether you(?:'re| are) a local or just visiting\b"
    r"|\bno trip to\b.{0,40}\bis complete without\b"
    r"|\bbe sure to (?:stop by|check it out|visit)\b",
    re.IGNORECASE,
)

# ── Template H2 (generic filler section headings signalling AI structure) ─────
# Plain "History" / "Significance" appear legitimately in the LB corpus, so they
# are intentionally NOT flagged. Only the obviously-templated filler headings
# that don't occur in healthy LB articles are listed.
_RE_TEMPLATE_H2 = re.compile(
    r"^(?:introduction|overview|background|conclusion|summary|"
    r"future outlook|history and development|"
    r"significance and impact|challenges and opportunities|"
    r"current status|current situation)$",
    re.IGNORECASE,
)


def _count_year_mentions(body: str) -> int:
    """4-digit years in 1600-2099 range, excluding `date:` lines."""
    n = 0
    for line in body.splitlines():
        if "date:" in line:
            continue
        n += len(re.findall(r"\b(?:1[6-9]\d{2}|20[0-2]\d)\b", line))
    return n


def _count_urls(body: str) -> int:
    return body.count("http")


def _source_count(target: FileTarget) -> int:
    """Number of `source:` frontmatter citation entries.

    LB articles cite via a `source:` frontmatter list rather than `[^n]:`
    footnotes or inline body URLs, so this is the primary citation signal.
    """
    src = target.frontmatter.get("source")
    if src is None:
        return 0
    if isinstance(src, str):
        return 1 if src.strip() else 0
    if isinstance(src, (list, tuple)):
        return len([s for s in src if str(s).strip()])
    return 0


# Reference-apparatus + functional-close headings. Bullets under these are
# structural by design (one per source/image; the `## Practical Information`
# functional close per ARTICLE-PLAYBOOK §4.4 Practical Information is a sanctioned bullet list of parking /
# hours / access facts), not prose padding. Bullet-density / repeated-bullet /
# list-dump checks scan only the prose body and truncate at the first such
# heading. Without the functional-close exemption every place/business article
# false-flags as a back-half list dump.
_REF_APPARATUS_RE = re.compile(
    r"(?im)^#{2,3}\s*(further reading|references?|sources?|citations?|"
    r"image sources?|image credits?|photo credits?|see also|notes|"
    r"practical information|tickets and practical information)\b"
)


def _body_before_apparatus(body: str) -> str:
    """Prose = text before the first reference-apparatus heading."""
    m = _REF_APPARATUS_RE.search(body)
    return body[: m.start()] if m else body


def _count_repeated_bullets(body: str) -> int:
    """Max consecutive `- **` bullet block length (excludes ref apparatus)."""
    max_run = 0
    cur = 0
    for line in _body_before_apparatus(body).splitlines():
        if line.startswith("- **"):
            cur += 1
            if cur > max_run:
                max_run = cur
        else:
            cur = 0
    return max_run


def _count_bullet_lines(body: str) -> tuple[int, int]:
    """Returns (bullet_lines, total_lines). Bullet = `- **` style (excludes ref apparatus)."""
    prose = _body_before_apparatus(body)
    total = prose.count("\n") + 1
    bullets = sum(1 for line in prose.splitlines() if line.startswith("- **"))
    return bullets, total


def _detect_textbook_opening(body: str) -> bool:
    """First 2 non-empty non-heading lines after frontmatter."""
    seen_lines = 0
    for line in body.splitlines():
        if not line.strip():
            continue
        if line.startswith("#"):
            continue
        if _RE_TEXTBOOK_OPENING.search(line):
            return True
        seen_lines += 1
        if seen_lines >= 2:
            break
    return False


def _detect_formulaic_ending(body: str) -> bool:
    """Last 5 non-bullet non-heading non-link lines."""
    eligible = [
        line for line in body.splitlines()
        if line.strip()
        and not line.startswith("#")
        and not line.startswith("-")
        and "http" not in line
    ]
    tail = eligible[-5:] if eligible else []
    text = "\n".join(tail)
    return bool(_RE_FORMULAIC_ENDING.search(text))


def _count_template_h2(body: str) -> int:
    n = 0
    for line in body.splitlines():
        if line.startswith("## "):
            heading = line[3:].strip()
            if _RE_TEMPLATE_H2.match(heading):
                n += 1
    return n


def _count_footnote_defs(body: str) -> int:
    return sum(
        1
        for line in body.splitlines()
        if re.match(r"^\[\^[0-9a-zA-Z_-]+\]:", line)
    )


def _bullet_ratios_split(body: str) -> tuple[int, int, int, int]:
    """Front/back half bullet ratios. Returns (front_bullet, back_bullet,
    front_total, back_total) — total = non-empty lines, bullet =
    `- ` / `* ` / `N.`."""
    body = _body_before_apparatus(body)  # exclude functional-close bullet lists
    lines = body.splitlines()
    n = len(lines)
    if n == 0:
        return 0, 0, 0, 0
    split = (n * 6) // 10  # 60/40 split
    front_bullet = back_bullet = front_total = back_total = 0
    for i, line in enumerate(lines):
        if not line.strip():
            continue
        is_bullet = bool(re.match(r"^(?:[-*]\s|\d+\.\s)", line))
        if i < split:
            front_total += 1
            if is_bullet:
                front_bullet += 1
        else:
            back_total += 1
            if is_bullet:
                back_bullet += 1
    return front_bullet, back_bullet, front_total, back_total


def _count_thin_blocks(body: str) -> int:
    """H2 blocks with NO content (heading followed by nothing).

    Recalibrated for LB from the source corpus's `< 3 prose lines` floor. Two LB-format
    realities break that floor:
      1. Locals-guide sections are deliberately short (2-3 lines is the target,
         not a defect), so a ≥3-prose-line floor false-flags every article.
      2. Enumerable-fact sections (a vista list under `## The View`, a trail
         list under `## Connecting Trails`) are legitimate content even with
         zero prose lines — the bullets ARE the content.
    So a section counts as thin only when it has zero content of any kind
    (prose OR bullets OR a table/quote) under the heading — a true skeleton.
    ARTICLE-PLAYBOOK §8 sanctions relaxing source-corpus thresholds for short-form.

    Structural / functional-close sections (References / Further Reading /
    Image Sources / Practical Information) are exempted regardless.
    """
    structural_h2 = {
        "## references", "## further reading", "## sources",
        "## image sources", "## image credits", "## photo credits",
        "## see also", "## notes", "## practical information",
    }
    thin = 0
    in_block = False
    is_structural = False
    content = 0
    for line in body.splitlines():
        if line.startswith("## "):
            if in_block and not is_structural and content < 1:
                thin += 1
            in_block = True
            stripped = line.rstrip().lower()
            is_structural = stripped in structural_h2
            content = 0
        elif in_block:
            # Any non-empty, non-subheading line is content (prose, bullet,
            # table row, blockquote — all carry information in LB's format).
            if line.strip() and not line.startswith("#"):
                content += 1
    if in_block and not is_structural and content < 1:
        thin += 1
    return thin


def _prose_ratios_split(body: str) -> tuple[int, int, int, int]:
    """Front/back half prose ratios for QUALITY-DECAY detection."""
    lines = body.splitlines()
    n = len(lines)
    split = (n * 6) // 10
    fp = bp = fa = ba = 0
    for i, line in enumerate(lines):
        if i < split:
            fa += 1
            if line.strip() and not re.match(r"^(?:[#\-*|>]|\d+\.)", line):
                fp += 1
        else:
            ba += 1
            if line.strip() and not re.match(r"^(?:[#\-*|>]|\d+\.)", line):
                bp += 1
    return fp, bp, fa, ba


def _word_count(body: str) -> int:
    """Whitespace-tokenized word count after frontmatter."""
    return len(body.split())


def _line_at_offset(body: str, offset: int) -> int:
    """Return 1-indexed line number of given char offset in body.

    body is padded with leading blank lines to match original-file line
    numbers (per FileTarget.body_pad_lines), so the returned line equals
    the line number in the source .md file.
    """
    if offset < 0 or offset > len(body):
        return 1
    return body.count("\n", 0, offset) + 1


def _context_around(body: str, start: int, end: int, before: int = 24, after: int = 24) -> str:
    """Return the matched span with surrounding context, marking the match.

    Layout: `…<before>«MATCH»<after>…`
    Newlines collapsed so single-line snippets stay readable.
    """
    body_len = len(body)
    ctx_start = max(0, start - before)
    ctx_end = min(body_len, end + after)
    pre = body[ctx_start:start].replace("\n", " ")
    mid = body[start:end].replace("\n", " ")
    post = body[end:ctx_end].replace("\n", " ")
    leading = "…" if ctx_start > 0 else ""
    trailing = "…" if ctx_end < body_len else ""
    return f"{leading}{pre}«{mid}»{post}{trailing}"


def check(target: FileTarget, config: dict[str, Any]) -> Iterator[Violation]:
    """Yield prose-health violations + a final score-summary violation.

    Skips if file is too short (lines < 20).

    Frontmatter requirement: knowledge/ articles must have frontmatter. For
    docs/ canonical SSOT files (docs/playbook/*.md / pipeline files /
    cognitive layer), prose-health still applies — these don't have frontmatter
    but should be held to the same writing discipline.
    """
    body = target.body
    line_count = body.count("\n") + 1
    if line_count < 20:
        return
    # Frontmatter required only for knowledge/ articles.
    path_str = str(target.path)
    is_knowledge_article = "/knowledge/" in path_str or path_str.startswith("knowledge/")
    if is_knowledge_article and not target.frontmatter:
        return

    score = 0
    reasons: list[str] = []

    # Use body without protected regions for pattern detection so code
    # blocks / link URLs don't trigger false positives.
    text_for_patterns = target.body_without_protected()

    src_count = _source_count(target)
    # About-category docs are project meta/process documentation (the editorial
    # pipeline, the viz catalog, the project overview), not content articles
    # making external factual claims. They are self-sourcing, so the citation
    # penalties (no-sources, citation-desert) don't apply. Writing-discipline
    # dims (em-dash, bullets, brochure tells) still do.
    is_meta_doc = target.frontmatter.get("category") == "About"

    # ── 1. Bullet density ──
    bullets, total = _count_bullet_lines(body)
    if total > 0:
        ratio = bullets * 100 // total
        if ratio > 30:
            score += 3
            reasons.append(f"bullet density {ratio}%")
        elif ratio > 20:
            score += 1
            reasons.append(f"bullet density {ratio}%")

    # ── 2. Year count ──
    # Recalibrated for LB: the source corpus's ≥5-years bar assumed history/essay
    # articles. LB's nature/beach/trail guides are legitimately dateless
    # (tide timing, parking — not years). Only a totally date-free article
    # gets a mild nudge; the multi-tier history-article penalty is dropped.
    years = _count_year_mentions(body)
    if years == 0:
        score += 1
        reasons.append("no years cited")

    # ── 3. URL / source count ──
    # LB cites via the `source:` frontmatter list (not inline footnotes/URLs
    # like the source corpus), so frontmatter sources count as citation evidence.
    # Recalibrated: the source corpus's ≥3-sources bar assumed footnote-dense essays;
    # LB articles cite 1-2 authoritative sources by design, so only a fully
    # unsourced article is penalized.
    urls = _count_urls(body)
    effective_sources = urls + src_count
    if effective_sources == 0 and not is_meta_doc:
        score += 3
        reasons.append("no sources")

    # ── 4. Hollow brochure adjectives ──
    hollow_n = len(_RE_HOLLOW.findall(text_for_patterns))
    if hollow_n > 15:
        score += 3
        reasons.append(f"{hollow_n} hollow adjectives")
    elif hollow_n > 8:
        score += 2
        reasons.append(f"{hollow_n} hollow adjectives")
    elif hollow_n > 4:
        score += 1
        reasons.append(f"{hollow_n} hollow adjectives")

    # ── 6. lastHumanReview ──
    if target.frontmatter.get("lastHumanReview") is False:
        score += 1
        reasons.append("not human-reviewed")

    # ── 7. Repeated bullet blocks ──
    # Floor raised for LB: a 4-5 item enumerable list (trails, vistas, access
    # points) is normal locals-guide content, not a definition-list dump. Only
    # a long unbroken run signals a skeleton.
    max_run = _count_repeated_bullets(body)
    if max_run >= 9:
        score += 2
        reasons.append(f"{max_run} consecutive bullets")
    elif max_run >= 6:
        score += 1
        reasons.append(f"{max_run} consecutive bullets")

    # ── 8. Plastic phrases (brochure tells) ──
    plastic_matches = list(_RE_PLASTIC.finditer(text_for_patterns))
    plastic_n = len(plastic_matches)
    if plastic_n > 8:
        score += 4
        reasons.append(f"{plastic_n} brochure tells")
    elif plastic_n > 4:
        score += 3
        reasons.append(f"{plastic_n} brochure tells")
    elif plastic_n > 2:
        score += 2
        reasons.append(f"{plastic_n} brochure tells")
    elif plastic_n >= 1:
        score += 1
        reasons.append(f"{plastic_n} brochure tells")
    for m in plastic_matches[:10]:
        line_no = _line_at_offset(text_for_patterns, m.start())
        ctx = _context_around(text_for_patterns, m.start(), m.end())
        yield Violation(
            check=CHECK_NAME,
            severity=Severity.WARN,
            message=f"Brochure tell (§6 Travel-Brochure Tells): {ctx}",
            line=line_no,
            snippet=m.group(0)[:80],
            editorial_ref="docs/playbook/ARTICLE-PLAYBOOK.md §6 Not Wanted: Travel-Brochure Tells",
            fix_suggestion="Three-second swap test: cut it, or name the specific thing only true of this place.",
        )

    # ── 8b. Em-dash overuse ──
    dash_matches = list(_RE_EMDASH.finditer(text_for_patterns))
    dash_n = len(dash_matches)
    # Thresholds raised for LB: the em dash is normal English punctuation, so a
    # handful across a whole article is fine. Only genuine overuse — the AI tic
    # ARTICLE-PLAYBOOK §6 warns about — is penalized.
    if dash_n > 25:
        score += 3
        reasons.append(f"{dash_n} em dashes")
    elif dash_n > 15:
        score += 2
        reasons.append(f"{dash_n} em dashes")
    elif dash_n > 8:
        score += 1
        reasons.append(f"{dash_n} em dashes")
    if dash_n > 15:
        for m in dash_matches[:10]:
            line_no = _line_at_offset(text_for_patterns, m.start())
            ctx = _context_around(text_for_patterns, m.start(), m.end(), before=18, after=18)
            yield Violation(
                check=CHECK_NAME,
                severity=Severity.WARN,
                message=f"Em-dash overuse (§6 Em Dash Discipline, {dash_matches.index(m)+1}/{dash_n}): {ctx}",
                line=line_no,
                snippet="—",
                editorial_ref="docs/playbook/ARTICLE-PLAYBOOK.md §6 Em Dash Discipline",
                fix_suggestion="Ask whether each dash does something a period, semicolon, or parenthetical couldn't.",
            )

    # ── 9. Stock opening ──
    if _detect_textbook_opening(body):
        score += 2
        reasons.append("stock opening")

    # ── 10. Canned ending ──
    if _detect_formulaic_ending(body):
        score += 2
        reasons.append("canned ending")

    # ── 11. Template H2 ──
    template_h2 = _count_template_h2(body)
    if template_h2 >= 4:
        score += 3
        reasons.append(f"{template_h2} template H2s")
    elif template_h2 >= 3:
        score += 2
        reasons.append(f"{template_h2} template H2s")
    elif template_h2 >= 2:
        score += 1
        reasons.append(f"{template_h2} template H2s")

    # ── 12. LIST-DUMP (back-half bullet density disproportionate to front) ──
    # Gated on length: the front/back ratio is statistically meaningless on
    # short locals-guide articles (a single 6-item vista list spikes the
    # back-half ratio purely because the body is small), so it only applies
    # once each half has enough lines to compare. Deferred for short-form per
    # ARTICLE-PLAYBOOK §8; bullet density (#1) still guards genuine bullet-skeletons.
    front_b, back_b, front_t, back_t = _bullet_ratios_split(body)
    if front_t >= 12 and back_t >= 12:
        front_ratio = front_b * 100 // front_t
        back_ratio = back_b * 100 // back_t
        # Only the strong signal kept: back half both bullet-heavy (>40%)
        # AND disproportionate to the front (>2x). The bare ">30%" tier was
        # dropped — it fired on any article with a normal bulleted back
        # section (e.g. a closing list of access points), not a real dump.
        if back_ratio > 40 and back_ratio > front_ratio * 2:
            score += 3
            reasons.append(f"back-half list dump {back_ratio}%")

    # ── 13. THIN (H2 blocks with no content at all) ──
    thin = _count_thin_blocks(body)
    if thin >= 2:
        score += 2
        reasons.append(f"{thin} thin sections")
    elif thin >= 1:
        score += 1
        reasons.append(f"{thin} thin sections")

    # ── 14. QUALITY-DECAY (front prose ratio >> back prose ratio) ──
    fp, bp, fa, ba = _prose_ratios_split(body)
    if fa > 0 and ba > 0:
        front_pr = fp * 100 // fa
        back_pr = bp * 100 // ba
        if front_pr > 0:
            if back_pr < front_pr // 2:
                score += 3
                reasons.append(f"quality decay front {front_pr}% back {back_pr}%")
            elif back_pr < (front_pr * 7) // 10:
                score += 1
                reasons.append(f"quality decay front {front_pr}% back {back_pr}%")

    # ── 16. Citation desert ──
    # A citation = footnote def OR inline body URL OR `source:` frontmatter entry.
    fn_defs = _count_footnote_defs(body)
    word_count = _word_count(body)
    has_citation = fn_defs > 0 or urls > 0 or src_count > 0
    if not has_citation and not is_meta_doc:
        if word_count > 500:
            score += 4
            reasons.append("citation desert (no sources, long)")
        elif word_count > 200:
            score += 1
            reasons.append("no citations")

    # ════════════════════════════════════════════════════════════════
    # Prose-tell dimensions — all WARN, none count toward score budget
    # (surface drift without blocking the rewrite-stage-3 score gate).
    # ════════════════════════════════════════════════════════════════

    # ── "Not Just X, It's Y" false-contrast pattern ──
    tier1_total = 0
    for pat in _TIER1_PATTERNS:
        matches = list(pat.finditer(text_for_patterns))
        if matches:
            tier1_total += len(matches)
            for m in matches:
                line_no = _line_at_offset(text_for_patterns, m.start())
                ctx = _context_around(text_for_patterns, m.start(), m.end())
                yield Violation(
                    check=CHECK_NAME,
                    severity=Severity.WARN,
                    message=f"Not-Just-X-It's-Y false contrast (§6): {ctx}",
                    line=line_no,
                    snippet=m.group(0)[:80],
                    editorial_ref="docs/playbook/ARTICLE-PLAYBOOK.md §6 The \"Not Just X, It's Y\" Pattern",
                    fix_suggestion=(
                        "Is the 'X' half a strawman the reader never assumed? "
                        "Delete the setup and state 'Y' directly."
                    ),
                )

    # ── AI metaphor tells ──
    tier2_total = sum(
        len(re.findall(r"\b" + re.escape(w) + r"\b", text_for_patterns, re.IGNORECASE))
        for w in _TIER2_WORDS
    )
    if tier2_total >= 2:
        yield Violation(
            check=CHECK_NAME,
            severity=Severity.WARN,
            message=f"AI metaphor-tell density: {tier2_total} occurrence(s) (delve / tapestry / testament to / …)",
            editorial_ref="docs/playbook/ARTICLE-PLAYBOOK.md §6 Voice",
            fix_suggestion="Replace the metaphor with the concrete fact, name, or number it stands in for.",
        )

    # ── AI ritual phrases ──
    lower_text = text_for_patterns.lower()
    tier3_total = sum(lower_text.count(p) for p in _TIER3_PHRASES)
    if tier3_total >= 1:
        yield Violation(
            check=CHECK_NAME,
            severity=Severity.WARN,
            message=f"AI ritual phrase: {tier3_total} occurrence(s) (in conclusion / at the end of the day / …)",
            editorial_ref="docs/playbook/ARTICLE-PLAYBOOK.md §6 Voice",
            fix_suggestion="Cut the filler transition; start the sentence with the fact.",
        )

    # ── Final score summary as a single violation ──
    # The runner gates on score via profile.fail_on = "score-budget".
    if score > 0:
        yield Violation(
            check=CHECK_NAME,
            severity=Severity.WARN,
            message=f"prose-health score: {score} (≤ 3 = pass) — {'; '.join(reasons)}",
            editorial_ref=EDITORIAL_REF,
            fix_suggestion=str(score),  # used by score-budget gating
        )
