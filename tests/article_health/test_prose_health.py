"""Tests for the prose_health plugin.

Structural dimensions are language-agnostic; prose-tell dimensions are sourced
from ARTICLE-PLAYBOOK §6 (brochure tells, the "Not Just X, It's Y" pattern, canned
endings, AI metaphor/ritual phrases). Thresholds are calibrated for the short
locals-guide format.
"""

import textwrap
from pathlib import Path

import pytest

from lib.article_health import registry
from lib.article_health.checks import prose_health
from lib.article_health.loader import load_target
from lib.article_health.types import Severity


def _make_article(
    tmp_path: Path,
    body: str,
    title: str = "Test Article",
    category: str = "Beaches",
    last_human_review: bool = True,
    with_source: bool = True,
    extra_frontmatter: str = "",
) -> Path:
    fm = (
        f"title: '{title}'\n"
        f"description: 'A description with a 2026 anchor and 1000 number.'\n"
        f"date: 2026-05-04\n"
        f"tags: ['test']\n"
        f"category: {category}\n"
        f"lastHumanReview: {'true' if last_human_review else 'false'}\n"
    )
    if with_source:
        fm += "source:\n  - https://example.com\n"
    fm += extra_frontmatter
    d = tmp_path / "knowledge" / category
    d.mkdir(parents=True, exist_ok=True)
    f = d / "test.md"
    f.write_text(f"---\n{fm}---\n\n{body}\n", encoding="utf-8")
    return f


def _check(tmp_path: Path, body: str, **kwargs) -> list:
    f = _make_article(tmp_path, body, **kwargs)
    target = load_target(f)
    return list(prose_health.check(target, {}))


def _score(violations) -> int:
    """Extract numeric score from the score-summary violation."""
    for v in violations:
        if v.fix_suggestion and v.fix_suggestion.isdigit():
            return int(v.fix_suggestion)
    return 0


# ════════════════════════════════════════════════════════════════════════
# Skip cases
# ════════════════════════════════════════════════════════════════════════


def test_short_file_skipped(tmp_path):
    """File < 20 lines is skipped (legacy quality-scan early-exit semantics)."""
    f = tmp_path / "knowledge" / "Beaches" / "stub.md"
    f.parent.mkdir(parents=True)
    f.write_text("---\ntitle: x\n---\n\nshort content\n", encoding="utf-8")
    target = load_target(f)
    violations = list(prose_health.check(target, {}))
    assert violations == []


def test_no_frontmatter_skipped(tmp_path):
    f = tmp_path / "knowledge" / "Beaches" / "x.md"
    f.parent.mkdir(parents=True)
    f.write_text("\n".join(["plain text"] * 30), encoding="utf-8")
    target = load_target(f)
    violations = list(prose_health.check(target, {}))
    assert violations == []


# ════════════════════════════════════════════════════════════════════════
# Structural dimension parity (recalibrated for LB short-form)
# ════════════════════════════════════════════════════════════════════════


def test_zero_years_mild_penalty(tmp_path):
    """A fully dateless article gets a mild +1 nudge."""
    body = "\n".join(["A paragraph of prose with no year mentioned at all."] * 22)
    score_no_year = _score(_check(tmp_path, body))
    body_dated = "\n".join(["A paragraph from 1926 about the 1993 fire and 2024 today."] * 22)
    score_dated = _score(_check(tmp_path, body_dated))
    # Zero years adds exactly +1 over a dated body.
    assert score_no_year == score_dated + 1


def test_no_sources_scores_3(tmp_path):
    """No source frontmatter AND no inline URL → +3 (no sources)."""
    body = "\n".join(["Plain prose from 1926 with no link anywhere here."] * 25)
    score = _score(_check(tmp_path, body, with_source=False))
    assert score >= 3


def test_source_frontmatter_satisfies_citation(tmp_path):
    """LB's `source:` frontmatter counts as citation — no desert penalty."""
    body = "\n".join(["Long prose paragraph from 1926 and 1994 and 2024."] * 50)
    score = _score(_check(tmp_path, body, with_source=True))
    # 50 long lines > 500 words but source: present → no citation-desert +4.
    assert score < 4, f"source frontmatter should avoid citation desert, got {score}"


def test_hollow_adjectives_high_count(tmp_path):
    body = (
        "This stunning, breathtaking, picturesque, charming, idyllic, scenic, "
        "gorgeous, beautiful, lovely, vibrant view is truly majestic."
    )
    body_multi = "\n".join([body] * 25)
    body_multi += "\n\nProse from 1926 confirmed in 1994 [link](https://e.com)."
    violations = _check(tmp_path, body_multi)
    score = _score(violations)
    assert score >= 1, f"hollow adjectives should trigger score, got {score}"


def test_brochure_tell_detection(tmp_path):
    body = textwrap.dedent(
        """\
        Nestled along the coast, this hidden gem is a must-see destination.
        Whether you're a local or a first-time visitor, it offers something for everyone.
        This best-kept secret boasts unparalleled views and a rich history.

        See https://example.com about the 1986 founding.

        ## The Beach
        Some prose.
        More prose.
        Even more prose.

        Final line about 1994.
        """
    )
    violations = _check(tmp_path, body)
    score = _score(violations)
    tells = [v for v in violations if "Brochure tell" in (v.message or "")]
    assert len(tells) >= 4, f"expected multiple brochure tells, got {len(tells)}"
    assert score >= 2


def test_emdash_overuse(tmp_path):
    body = "This — sentence — has — far — too — many — em — dashes — used — here —.\n" * 2
    body += "\n".join(["A normal prose paragraph from 1926 content."] * 20)
    body += "\n\n[link](https://e.com)"
    score = _score(_check(tmp_path, body))
    # 22 em dashes > 15 → +2 dash penalty.
    assert score >= 2


def test_few_emdashes_not_penalized(tmp_path):
    """Up to 8 em dashes across a whole article is normal English — no penalty."""
    body = "A sentence — with one dash.\n" * 4  # 4 em dashes
    body += "\n".join(["Plain prose from 1926 and 1994 content here."] * 20)
    body += "\n\n[link](https://e.com)"
    score = _score(_check(tmp_path, body))
    dash_warn = [v for v in _check(tmp_path, body) if "Em-dash" in (v.message or "")]
    assert dash_warn == [], "≤8 em dashes should not be flagged"


def test_stock_opening_scores_2(tmp_path):
    body = "Whether you're a local or a first-time visitor, this cove is special.\n"
    body += "\n".join(["Continuing prose from 1926 onward."] * 25)
    body += "\n\n[link](https://e.com)"
    score = _score(_check(tmp_path, body))
    assert score >= 2  # stock opening = +2


def test_canned_ending_scores_2(tmp_path):
    body = "\n".join(["Main prose paragraph from 1926 content."] * 22)
    body += "\n\nThis spot will continue to delight visitors for generations to come."
    body += "\n\n[link](https://e.com)"
    score = _score(_check(tmp_path, body))
    assert score >= 2


def test_template_h2_count(tmp_path):
    body = textwrap.dedent(
        """\
        Intro prose from 1926.

        ## Introduction

        text

        ## Overview

        text

        ## Background

        text

        ## Conclusion

        text
        """
    )
    body += "\n".join(["More prose from 2024."] * 12)
    body += "\n\n[link](https://e.com)"
    score = _score(_check(tmp_path, body))
    assert score >= 3  # 4 template H2s = +3


def test_history_heading_not_flagged_as_template(tmp_path):
    """Plain `## History` is legitimate in the LB corpus — not a template H2."""
    body = textwrap.dedent(
        """\
        Intro prose from 1926.

        ## History

        Some real history prose.
        More history.

        ## The View

        Vista description.
        """
    )
    body += "\n".join(["More prose from 2024."] * 14)
    body += "\n\n[link](https://e.com)"
    assert prose_health._count_template_h2(body) == 0


def test_citation_desert_long_no_source(tmp_path):
    body = "\n".join(["A long prose paragraph from 1926 with content here."] * 50)
    score = _score(_check(tmp_path, body, with_source=False))
    # word count > 500, no footnote/url/source → +4 (extreme citation desert)
    assert score >= 4


def test_meta_doc_exempt_from_citation_penalty(tmp_path):
    """About-category meta docs are self-sourcing — no citation penalties."""
    body = "\n".join(["Process documentation prose with no external source."] * 50)
    score = _score(_check(tmp_path, body, category="About", with_source=False))
    # No "no sources" +3 and no citation-desert +4 for a meta doc.
    assert score <= 1, f"meta doc should not be penalized for no sources, got {score}"


def test_last_human_review_false_scores_1(tmp_path):
    body = textwrap.dedent(
        """\
        Normal prose from 1926 and 2024 [link](https://example.com).

        ## Section

        prose one
        prose two
        prose three
        """
    )
    body += "\n".join(["More content"] * 15)
    score_with_review = _score(_check(tmp_path, body, last_human_review=True))
    score_without = _score(_check(tmp_path, body, last_human_review=False))
    assert score_without >= score_with_review + 1


# ════════════════════════════════════════════════════════════════════════
# Prose-tell dimensions (ARTICLE-PLAYBOOK §6)
# ════════════════════════════════════════════════════════════════════════


def test_not_just_x_pattern_detected(tmp_path):
    """"isn't just X, it's Y" false-contrast should be flagged per occurrence."""
    body = "This isn't just a beach, it's an experience worth having.\n" * 5
    body += "\n".join(["Continuing prose from 1926."] * 20)
    body += "\n\n[link](https://e.com)"
    violations = _check(tmp_path, body)
    tells = [v for v in violations if "false contrast" in (v.message or "")]
    assert len(tells) >= 5


def test_not_only_but_also_detected(tmp_path):
    body = "The museum is not only a gallery but also a community hub here.\n" * 5
    body += "\n".join(["Continuing prose from 1926."] * 20)
    body += "\n\n[link](https://e.com)"
    violations = _check(tmp_path, body)
    tells = [v for v in violations if "false contrast" in (v.message or "")]
    assert len(tells) >= 5


def test_not_just_no_false_positive_on_plain_text(tmp_path):
    """Plain prose without the construction shouldn't trigger the pattern."""
    body = "He walked along the sand and watched the waves roll in slowly.\n"
    body += "\n".join(["Plain prose from 1926 and 1994 content."] * 25)
    body += "\n\n[link](https://e.com)"
    violations = _check(tmp_path, body)
    tells = [v for v in violations if "false contrast" in (v.message or "")]
    assert tells == []


def test_meta_doc_no_frontmatter_still_checked(tmp_path):
    """docs/ canonical files (no frontmatter) should still trigger prose-health."""
    docs_dir = tmp_path / "docs" / "editorial"
    docs_dir.mkdir(parents=True)
    f = docs_dir / "TEST-CANONICAL.md"
    body = "# TEST CANONICAL\n\n"
    body += "This isn't just a checklist, it's an eye that writes well.\n" * 6
    body += "\n".join(["Continuing prose from 1926."] * 20)
    f.write_text(body, encoding="utf-8")
    target = load_target(f)
    assert not target.frontmatter, "test file should have no frontmatter"
    violations = list(prose_health.check(target, {}))
    tells = [v for v in violations if "false contrast" in (v.message or "")]
    assert len(tells) >= 3, "docs/ canonical without frontmatter should still be checked"


def test_ai_metaphor_density(tmp_path):
    body = "The tapestry of history is a testament to the beacon of culture.\n"
    body += "\n".join(["Prose from 1926."] * 22)
    body += "\n\n[link](https://e.com)"
    violations = _check(tmp_path, body)
    tier2 = [v for v in violations if "metaphor-tell" in (v.message or "")]
    assert len(tier2) == 1
    import re
    m = re.search(r"(\d+) occurrence", tier2[0].message)
    assert m and int(m.group(1)) >= 3, tier2[0].message


def test_ai_ritual_phrases(tmp_path):
    body = "In conclusion, at the end of the day, this matters when it comes to art.\n"
    body += "\n".join(["Prose from 1926."] * 22)
    body += "\n\n[link](https://e.com)"
    violations = _check(tmp_path, body)
    tier3 = [v for v in violations if "ritual phrase" in (v.message or "")]
    assert len(tier3) == 1


# ════════════════════════════════════════════════════════════════════════
# Structural skeleton dims: LIST-DUMP / THIN
# ════════════════════════════════════════════════════════════════════════


def test_list_dump_back_half_bullet_heavy(tmp_path):
    """Back half >40% bullets AND >2x front, on a long-enough article → +3."""
    front = "\n".join([
        "This is a prose narrative line from 1926.",
        "Another research finding from 1994 here.",
        "The most recent record from 2024 today.",
        "Yet more prose narrative description here.",
    ] * 4)  # 16 prose lines, 0 bullets
    back = "\n".join([
        "- bullet item one",
        "- bullet item two",
        "- bullet item three",
        "- bullet item four",
    ] * 4)  # 16 bullet lines, 100% bullets
    body = front + "\n\n" + back
    body += "\n\n[link](https://e.com)"
    score = _score(_check(tmp_path, body))
    assert score >= 3, f"LIST-DUMP should add +3 score, got {score}"


def test_list_dump_not_fired_on_short_article(tmp_path):
    """Short locals-guide article with a closing bullet list is NOT a dump."""
    body = textwrap.dedent(
        """\
        A short intro from 1926 about the place.

        ## The View

        - The ocean to the west
        - The mountains to the east
        - Catalina on a clear day
        - The town below
        """
    )
    body += "\n".join(["Prose line from 2024."] * 10)
    body += "\n\n[link](https://e.com)"
    violations = _check(tmp_path, body)
    dump = [v for v in violations if "list dump" in (v.message or "")]
    assert dump == [], "short article with a vista list should not be a list dump"


def test_thin_block_only_empty_sections(tmp_path):
    """A bullet-list section is content, not thin; only an empty heading is thin."""
    body = textwrap.dedent(
        """\
        Intro from 1926.

        ## The View

        - vista one
        - vista two

        ## Empty Section

        ## Real Section

        Prose here.
        """
    )
    body += "\n".join(["More prose from 2024."] * 14)
    # "## The View" has bullets (content), "## Real Section" has prose, only
    # "## Empty Section" is a true skeleton.
    assert prose_health._count_thin_blocks(body) == 1


def test_thin_blocks_exempt_structural_sections(tmp_path):
    """Structural sections (References / Image Sources / Practical Information)
    are exempt from the THIN check even when they carry no prose.
    """
    body = textwrap.dedent(
        """\
        ## Section One

        Prose line.

        ## Image Sources

        One CC-licensed photo.

        ## References

        [link](https://example.com)

        ## Practical Information

        - Parking is limited.
        """
    )
    body += "\n" + "\n".join(f"extra{i}" for i in range(20))
    body_thin = prose_health._count_thin_blocks(body)
    assert body_thin == 0, (
        f"structural / functional-close sections should be exempt, got {body_thin}"
    )


# ════════════════════════════════════════════════════════════════════════
# Score budget
# ════════════════════════════════════════════════════════════════════════


def test_clean_article_passes_budget(tmp_path):
    body = textwrap.dedent(
        """\
        In 1926, a stone tower was built on the bluff above the cove [link](https://example.com).
        By 1993, the structure had survived the firestorm that destroyed 441 homes.
        A 2024 survey found the staircase still in use by residents.

        ## The Tower

        The 60-foot tower was modeled on a Mediterranean lighthouse.
        It was built for a former actor who lived on the bluff.
        The spiral staircase inside is the access point most visitors miss.

        ## Access

        Both streets have extremely limited parking, no lot and no meters.
        Arrive very early on summer weekends or walk from farther away.

        ## Practical Information

        - Parking: residential streets only.
        - Best time: early morning at low tide.
        """
    )
    score = _score(_check(tmp_path, body, last_human_review=True))
    assert score <= 3, f"clean article scored {score}, should be ≤ 3"


# ════════════════════════════════════════════════════════════════════════
# Plugin metadata
# ════════════════════════════════════════════════════════════════════════


def test_plugin_metadata():
    assert prose_health.CHECK_NAME == "prose-health"
    assert prose_health.DEFAULT_SEVERITY == Severity.WARN
    assert "docs/playbook/ARTICLE-PLAYBOOK.md" in prose_health.EDITORIAL_REF
    assert callable(prose_health.check)


def test_plugin_registered():
    registry.reset_registry()
    found = registry.discover_checks()
    assert "prose-health" in found, list(found.keys())
