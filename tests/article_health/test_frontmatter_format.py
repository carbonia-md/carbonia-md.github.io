"""Tests for frontmatter_format plugin.

This is the formatter counterpart to `frontmatter-title`: it checks the
REWRITE-PIPELINE Stage 4 YAML shape, field order, and Prettier-stable style.
"""

from pathlib import Path

from lib.article_health import registry
from lib.article_health.checks import frontmatter_format
from lib.article_health.config import Config, ProfileConfig
from lib.article_health.loader import load_target
from lib.article_health.runner import run_checks
from lib.article_health.types import Severity


GOOD_FRONTMATTER = """\
title: 'The Media Literacy Guide'
description: 'desc'
date: 2026-05-07
category: 'Society'
tags: ['media', 'science']
subcategory: 'media and speech'
author: 'Example KB'
featured: false
lastVerified: 2026-05-07
lastHumanReview: false
researchReport: reports/research/2026-05/media-literacy.md
"""


def _write_article(tmp_path: Path, frontmatter: str) -> Path:
    f = tmp_path / "knowledge" / "Society" / "test.md"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(f"---\n{frontmatter}---\n\nbody.\n", encoding="utf-8")
    return f


def _violations(tmp_path: Path, frontmatter: str):
    target = load_target(_write_article(tmp_path, frontmatter))
    return list(frontmatter_format.check(target, {}))


def test_good_frontmatter_passes(tmp_path):
    assert _violations(tmp_path, GOOD_FRONTMATTER) == []


def test_missing_required_field_is_hard(tmp_path):
    fm = GOOD_FRONTMATTER.replace("featured: false\n", "")
    violations = _violations(tmp_path, fm)
    hard = [v for v in violations if v.severity == Severity.HARD]
    assert any("featured" in v.message for v in hard)


def test_required_field_order_warns_by_default(tmp_path):
    fm = GOOD_FRONTMATTER.replace(
        "category: 'Society'\ntags: ['media', 'science']\n",
        "tags: ['media', 'science']\ncategory: 'Society'\n",
    )
    violations = _violations(tmp_path, fm)
    assert any("field order wrong" in v.message for v in violations)
    assert all(v.severity != Severity.HARD for v in violations)


def test_stage4_promotes_formatter_warns_to_hard(tmp_path):
    fm = GOOD_FRONTMATTER.replace(
        "category: 'Society'\ntags: ['media', 'science']\n",
        "tags: ['media', 'science']\ncategory: 'Society'\n",
    )
    target = load_target(_write_article(tmp_path, fm))
    cfg = Config()
    cfg.profiles["rewrite-stage-4"] = ProfileConfig(
        name="rewrite-stage-4",
        checks=["frontmatter-format"],
        severity_overrides={"frontmatter-format": Severity.HARD},
    )
    report = run_checks(target, cfg, profile_name="rewrite-stage-4")
    hard = [v for v in report.all_violations if v.severity == Severity.HARD]
    assert any("field order wrong" in v.message for v in hard)


def test_prettier_wrapped_flow_tags_passes(tmp_path):
    fm = GOOD_FRONTMATTER.replace(
        "tags: ['media', 'science']\n",
        "tags:\n  [\n    'media',\n    'science',\n  ]\n",
    )
    assert _violations(tmp_path, fm) == []


def test_hyphen_tags_warns_for_flow_array_style(tmp_path):
    fm = GOOD_FRONTMATTER.replace(
        "tags: ['media', 'science']\n",
        "tags:\n  - media\n  - science\n",
    )
    violations = _violations(tmp_path, fm)
    assert any("flow array" in v.message for v in violations)


def test_unquoted_string_scalar_warns(tmp_path):
    fm = GOOD_FRONTMATTER.replace("category: 'Society'\n", "category: Society\n")
    violations = _violations(tmp_path, fm)
    assert any("category" in v.message and "single-quoted" in v.message for v in violations)


def test_quoted_date_warns(tmp_path):
    fm = GOOD_FRONTMATTER.replace("date: 2026-05-07\n", "date: '2026-05-07'\n")
    violations = _violations(tmp_path, fm)
    assert any("date should not be quoted" in v.message for v in violations)


def test_string_tags_are_hard(tmp_path):
    fm = GOOD_FRONTMATTER.replace(
        "tags: ['media', 'science']\n",
        "tags: 'media, science'\n",
    )
    violations = _violations(tmp_path, fm)
    hard = [v for v in violations if v.severity == Severity.HARD]
    assert any("tags" in v.message and "array" in v.message for v in hard)


def test_category_must_match_path(tmp_path):
    fm = GOOD_FRONTMATTER.replace("category: 'Society'\n", "category: 'Culture'\n")
    violations = _violations(tmp_path, fm)
    hard = [v for v in violations if v.severity == Severity.HARD]
    assert any("must match the path category" in v.message for v in hard)


def test_no_frontmatter_is_hard(tmp_path):
    f = tmp_path / "knowledge" / "Society" / "test.md"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("body only\n", encoding="utf-8")
    violations = list(frontmatter_format.check(load_target(f), {}))
    assert len(violations) == 1
    assert violations[0].severity == Severity.HARD
    assert "Missing frontmatter" in violations[0].message


def test_plugin_registered():
    registry.reset_registry()
    found = registry.discover_checks()
    assert "frontmatter-format" in found, list(found.keys())


# ── fix() tests (frontmatter format-conflict root-cause fix) ──────────────


def _fix_and_reload(tmp_path: Path, frontmatter: str) -> tuple[int, str]:
    f = _write_article(tmp_path, frontmatter)
    target = load_target(f)
    n = frontmatter_format.fix(target, {})
    return n, f.read_text(encoding="utf-8")


def test_fix_idempotent_on_canonical_frontmatter(tmp_path):
    n, _ = _fix_and_reload(tmp_path, GOOD_FRONTMATTER)
    assert n == 0


def test_fix_reorders_canonical_fields(tmp_path):
    fm = GOOD_FRONTMATTER.replace(
        "category: 'Society'\ntags: ['media', 'science']\nsubcategory: 'media and speech'\n",
        "subcategory: 'media and speech'\ntags: ['media', 'science']\ncategory: 'Society'\n",
    )
    n, body = _fix_and_reload(tmp_path, fm)
    assert n >= 1
    # Re-validate: order warning should be gone
    f = _write_article(tmp_path, "")  # no-op to get path
    f.write_text(body, encoding="utf-8")
    target = load_target(f)
    violations = list(frontmatter_format.check(target, {}))
    assert not any("field order wrong" in v.message for v in violations), (
        f"reorder did not produce canonical order:\n{body}"
    )


def test_fix_converts_list_mode_tags_to_flow_array(tmp_path):
    fm = GOOD_FRONTMATTER.replace(
        "tags: ['media', 'science']\n",
        "tags:\n  - media\n  - science\n",
    )
    n, body = _fix_and_reload(tmp_path, fm)
    assert n >= 1
    assert "tags: ['media', 'science']" in body, (
        f"flow array conversion failed:\n{body}"
    )


def test_fix_preserves_prettier_wrapped_flow_array(tmp_path):
    """Prettier wraps long flow arrays; we must not touch that style."""
    fm = GOOD_FRONTMATTER.replace(
        "tags: ['media', 'science']\n",
        "tags:\n  [\n    'media',\n    'science',\n  ]\n",
    )
    n, body = _fix_and_reload(tmp_path, fm)
    # No fix needed if frontmatter is otherwise canonical and tags is valid flow
    assert "tags:\n  [" in body, f"prettier wrap was destroyed:\n{body}"


def test_fix_quotes_unquoted_scalar_string(tmp_path):
    fm = GOOD_FRONTMATTER.replace("category: 'Society'\n", "category: Society\n")
    n, body = _fix_and_reload(tmp_path, fm)
    assert n >= 1
    assert "category: 'Society'" in body, f"category was not quoted:\n{body}"


def test_fix_unquotes_quoted_date(tmp_path):
    fm = GOOD_FRONTMATTER.replace("date: 2026-05-07\n", "date: '2026-05-07'\n")
    n, body = _fix_and_reload(tmp_path, fm)
    assert n >= 1
    assert "date: 2026-05-07\n" in body, f"date was not unquoted:\n{body}"


def test_fix_unquotes_quoted_boolean(tmp_path):
    fm = GOOD_FRONTMATTER.replace("featured: false\n", "featured: 'false'\n")
    n, body = _fix_and_reload(tmp_path, fm)
    assert n >= 1
    assert "featured: false\n" in body, f"featured was not unquoted:\n{body}"


def test_fix_combined_reorder_and_flow_conversion(tmp_path):
    """The original frontmatter conflict pattern: contributor PR has subcategory
    before tags AND list-mode tags. Our fix must handle both in one pass."""
    fm = GOOD_FRONTMATTER.replace(
        "category: 'Society'\ntags: ['media', 'science']\nsubcategory: 'media and speech'\n",
        "subcategory: 'media and speech'\ntags:\n  - media\n  - science\ncategory: 'Society'\n",
    )
    n, body = _fix_and_reload(tmp_path, fm)
    assert n >= 2
    assert "tags: ['media', 'science']" in body, "flow conversion failed"

    f = _write_article(tmp_path, "")
    f.write_text(body, encoding="utf-8")
    target = load_target(f)
    violations = list(frontmatter_format.check(target, {}))
    assert not any("field order wrong" in v.message for v in violations)
    assert not any("flow array" in v.message for v in violations)


def test_fix_preserves_trailing_comments(tmp_path):
    """Trailing # design_rationale: blocks must survive reordering."""
    fm = GOOD_FRONTMATTER.replace(
        "category: 'Society'\ntags: ['media', 'science']\n",
        "tags: ['media', 'science']\ncategory: 'Society'\n",
    ) + "# design_rationale:\n#   why_this_hook: 'test'\n"
    n, body = _fix_and_reload(tmp_path, fm)
    assert n >= 1
    assert "# design_rationale:" in body, f"trailing comment was lost:\n{body}"
    assert "#   why_this_hook: 'test'" in body, f"trailing comment was lost:\n{body}"


def test_fix_reorder_does_not_concat_last_block(tmp_path):
    """Regression: loader strips trailing \\n before closing ---. After
    reorder, the original-last block (no \\n) must not concat with the next
    block, e.g. producing `lastHumanReview: falsereadingTime: 12`."""
    fm = (
        "title: 'Foo'\n"
        "description: 'Bar'\n"
        "category: 'Society'\n"
        "tags: ['x']\n"
        "subcategory: 'sub'\n"
        "author: 'Example KB'\n"
        "featured: false\n"
        "date: 2026-03-27\n"
        "readingTime: 12\n"  # unknown key — will be moved to other_blocks
        "lastVerified: 2026-03-27\n"
        "lastHumanReview: false\n"  # was last; will be moved earlier
    )
    n, body = _fix_and_reload(tmp_path, fm)
    assert n >= 1
    assert "lastHumanReview: false\n" in body, (
        f"trailing newline regression — fields concatenated:\n{body}"
    )
    assert "lastHumanReview: falsereadingTime" not in body
    assert "lastHumanReview: falseimage" not in body


def test_fix_quotes_unquoted_flow_array_items(tmp_path):
    """`tags: [foo, bar]` (no quotes) → `tags: ['foo', 'bar']`."""
    fm = GOOD_FRONTMATTER.replace(
        "tags: ['media', 'science']\n",
        "tags: [media, science]\n",
    )
    n, body = _fix_and_reload(tmp_path, fm)
    assert n >= 1
    assert "tags: ['media', 'science']" in body, (
        f"unquoted flow tags were not quoted:\n{body}"
    )


def test_fix_preserves_already_quoted_flow_items(tmp_path):
    """If items already quoted, don't double-quote them."""
    n, body = _fix_and_reload(tmp_path, GOOD_FRONTMATTER)
    assert n == 0
    assert "tags: ['media', 'science']" in body


def test_fix_handles_mixed_quoted_unquoted_items(tmp_path):
    """Some items quoted, some not — quote the unquoted ones only."""
    fm = GOOD_FRONTMATTER.replace(
        "tags: ['media', 'science']\n",
        "tags: ['media', science]\n",
    )
    n, body = _fix_and_reload(tmp_path, fm)
    assert n >= 1
    assert "tags: ['media', 'science']" in body, (
        f"mixed quote fix failed:\n{body}"
    )


def test_fix_converts_double_quoted_scalars_to_single(tmp_path):
    """Legacy double-quoted scalars (`category: "Society"`) → single-quoted."""
    fm = GOOD_FRONTMATTER.replace(
        "title: 'The Media Literacy Guide'\n",
        'title: "The Media Literacy Guide"\n',
    ).replace(
        "category: 'Society'\n",
        'category: "Society"\n',
    ).replace(
        "tags: ['media', 'science']\n",
        'tags: ["media", "science"]\n',
    )
    n, body = _fix_and_reload(tmp_path, fm)
    assert n >= 1
    assert "title: 'The Media Literacy Guide'" in body
    assert "category: 'Society'" in body
    assert "tags: ['media', 'science']" in body, f"flow item double→single failed:\n{body}"


def test_fix_preserves_double_quoted_with_escape_sequences(tmp_path):
    """If `\\n` or `\\t` escapes are present, leave double-quoted (single can't)."""
    fm = GOOD_FRONTMATTER.replace(
        "description: 'desc'\n",
        'description: "line1\\nline2"\n',
    )
    n, body = _fix_and_reload(tmp_path, fm)
    # description should remain double-quoted because of \n escape
    assert 'description: "line1\\nline2"' in body, (
        f"escape sequence preservation failed:\n{body}"
    )


def test_fix_handles_apostrophe_in_quoted_value(tmp_path):
    """`description: \"I'm here\"` → `description: 'I''m here'` (YAML escape)."""
    fm = GOOD_FRONTMATTER.replace(
        "description: 'desc'\n",
        'description: "I\'m here"\n',
    )
    n, body = _fix_and_reload(tmp_path, fm)
    assert n >= 1
    assert "description: 'I''m here'" in body, (
        f"apostrophe-in-double-quote handling failed:\n{body}"
    )


def test_fix_does_not_introduce_blank_line_before_closing_fence(tmp_path):
    """Regression: after reorder, fm_text ended with \\n which combined with
    hardcoded `\\n---\\n` to produce `\\n\\n---\\n` (blank line inside FM)."""
    fm = (
        "title: 'Indigenous Literature'\n"
        "description: 'desc'\n"
        "category: 'Society'\n"
        "tags: ['x']\n"
        "subcategory: 'literature'\n"
        "author: 'Example KB'\n"
        "featured: false\n"
        "date: 2026-03-24\n"
        "readingTime: 7\n"  # unknown — gets pushed to end after reorder
        "lastVerified: 2026-03-24\n"
        "lastHumanReview: false\n"
    )
    f = _write_article(tmp_path, fm)
    target = load_target(f)
    n = frontmatter_format.fix(target, {})
    assert n >= 1
    body = f.read_text(encoding="utf-8")
    # Must NOT have a blank line before closing fence
    assert "\n\n---\n" not in body, (
        f"blank line before closing fence regression:\n{body}"
    )


def test_fix_handles_empty_tags_list_mode_safely(tmp_path):
    """Edge case: `tags:` followed by nothing (empty value, no items).
    Should NOT explode and should leave the field alone."""
    fm = GOOD_FRONTMATTER.replace(
        "tags: ['media', 'science']\n",
        "tags:\n",
    )
    # No items to convert; flow conversion should no-op on this case.
    # (This is technically a HARD violation since tags must be a list,
    # but our flow conversion should be idempotent on empty.)
    n, body = _fix_and_reload(tmp_path, fm)
    # tags: should still be there (don't write `tags: []` since we can't
    # tell if user meant empty or forgot to fill in)
    assert "tags:" in body
