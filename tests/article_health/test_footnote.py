"""Tests for footnote_format + footnote_density plugins."""

import textwrap

from lib.article_health import registry
from lib.article_health.checks import footnote_density, footnote_format
from lib.article_health.loader import load_target
from lib.article_health.types import Severity


# ════════════════════════════════════════════════════════════════════════
# footnote-format
# ════════════════════════════════════════════════════════════════════════


def test_canonical_footnote_no_violation(write_article):
    body = "Body[^1]\n\n[^1]: [Source Title](https://example.com) — description text\n"
    target = load_target(write_article(body))
    violations = list(footnote_format.check(target, {}))
    assert violations == []


def test_pure_prose_footnote_accepted(write_article):
    """Explanatory pure-prose footnotes (no URL) ARE canonical —
    `[^N]: <prose >=10 chars>` is a valid markdown convention for explanatory
    notes, not just citations."""
    body = "Body[^1]\n\n[^1]: An explanatory note that needs no external link is compliant.\n"
    target = load_target(write_article(body))
    violations = list(footnote_format.check(target, {}))
    assert violations == []


def test_too_short_prose_footnote_flagged(write_article):
    """Pure-prose footnote shorter than 10 chars is still flagged (likely a stub)."""
    body = "Body[^1]\n\n[^1]: brief\n"
    target = load_target(write_article(body))
    violations = list(footnote_format.check(target, {}))
    assert len(violations) == 1
    assert violations[0].severity == Severity.HARD


def test_short_description_below_six_flagged(write_article):
    """URL-form footnote with a description below the 6-char floor is flagged."""
    body = "Body[^1]\n\n[^1]: [Title](https://example.com) — abc\n"  # 3-char desc
    target = load_target(write_article(body))
    violations = list(footnote_format.check(target, {}))
    assert len(violations) == 1


def test_six_char_description_passes(write_article):
    """A description at the 6-char floor passes."""
    body = "Body[^1]\n\n[^1]: [Title](https://example.com) — source\n"  # 6-char desc
    target = load_target(write_article(body))
    violations = list(footnote_format.check(target, {}))
    assert violations == []


def test_prettier_autolink_wrap_url_with_parens_accepted(write_article):
    """Prettier auto-wraps URLs containing parens (e.g. Wikipedia
    disambiguation slugs) into autolink form `<URL>` to avoid markdown
    ambiguity. The regex must accept both bare URLs and `<URL>` form, or every
    paren-containing citation fails the format gate after a Prettier reformat."""
    body = (
        "Body[^1][^2][^3]\n\n"
        "[^1]: [Wikipedia: Mercury (element)](<https://en.wikipedia.org/wiki/Mercury_(element)>) — confirmed melting point\n"
        "[^2]: [Wikipedia (EN): Chi Cheng (athlete)](<https://en.wikipedia.org/wiki/Chi_Cheng_(athlete)>) — athlete biography entry\n"
        "[^3]: [Wikipedia: Mercury (mythology)](<https://en.wikipedia.org/wiki/Mercury_(mythology)>) — confirmed Roman deity\n"
    )
    target = load_target(write_article(body))
    violations = list(footnote_format.check(target, {}))
    assert violations == [], f"autolink-wrapped URLs should pass: {[v.message for v in violations]}"


def test_bare_url_still_accepted(write_article):
    """Regression: making regex accept autolink form must not break bare URLs."""
    body = "Body[^1]\n\n[^1]: [Title](https://example.com) — proper desc 7+ chars\n"
    target = load_target(write_article(body))
    violations = list(footnote_format.check(target, {}))
    assert violations == []


def test_multiple_violations(write_article):
    body = (
        "Body[^1][^2][^3]\n\n"
        "[^1]: [Title](https://example.com) — proper desc enough chars\n"
        "[^2]: hi\n"  # too short prose
        "[^3]: ?\n"  # too short
    )
    target = load_target(write_article(body))
    violations = list(footnote_format.check(target, {}))
    assert len(violations) == 2


def test_format_plugin_metadata():
    assert footnote_format.CHECK_NAME == "footnote-format"
    assert footnote_format.DEFAULT_SEVERITY == Severity.HARD


# ════════════════════════════════════════════════════════════════════════
# footnote-density grading
# ════════════════════════════════════════════════════════════════════════


def test_grade_a_high_density(write_article):
    body = textwrap.dedent(
        """\
        Short body.

        [^1]: [src](https://e.com) — desc enough chars
        [^2]: [src2](https://e.com) — desc enough chars2
        [^3]: [src3](https://e.com) — desc enough chars3
        """
    )
    target = load_target(write_article(body))
    violations = list(footnote_density.check(target, {}))
    # Grade A → no violation yielded
    assert violations == []


def test_grade_b_few_footnotes(write_article):
    body = textwrap.dedent(
        """\
        A somewhat longer paragraph with only one footnote.

        [^1]: [src](https://e.com) — desc enough chars
        """
    ) + "\n".join(["padding"] * 350)  # inflate word count → density > 300
    target = load_target(write_article(body))
    violations = list(footnote_density.check(target, {}))
    # B grade → no violation
    assert violations == []


def test_grade_c_only_inline_urls(write_article):
    body = "Text https://a.com more https://b.com more https://c.com and one more segment"
    target = load_target(write_article(body))
    violations = list(footnote_density.check(target, {}))
    assert len(violations) == 1
    assert violations[0].fix_suggestion == "C"


def test_grade_d_one_url(write_article):
    body = "Text https://only.com end"
    target = load_target(write_article(body))
    violations = list(footnote_density.check(target, {}))
    assert len(violations) == 1
    assert violations[0].fix_suggestion == "D"


def test_grade_f_naked(write_article):
    body = "Plain text paragraph with no citation and no URL at all"
    target = load_target(write_article(body))
    violations = list(footnote_density.check(target, {}))
    assert len(violations) == 1
    assert violations[0].fix_suggestion == "F"
    assert "citation desert" in violations[0].message


def test_density_plugin_metadata():
    assert footnote_density.CHECK_NAME == "footnote-density"
    assert footnote_density.DEFAULT_SEVERITY == Severity.WARN


def test_both_plugins_registered():
    registry.reset_registry()
    found = registry.discover_checks()
    assert "footnote-format" in found
    assert "footnote-density" in found
