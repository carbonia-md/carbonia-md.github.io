"""Tests for link_target plugin (Phase 1 casing + Phase 2 existence).

Internal links route as `/{category-lower}/{slug}` (this repo is English-only).
Phase 1 flags a capitalized category segment (Astro routes lowercase); Phase 2
cross-checks the target against the `knowledge/{Category}/*.md` filesystem.
"""

from pathlib import Path

import pytest

from lib.article_health.checks import link_target
from lib.article_health.loader import load_target
from lib.article_health.types import Severity


def _write_tmp(tmp_path: Path, body: str, frontmatter: str = "") -> Path:
    content = f"---\n{frontmatter}---\n{body}" if frontmatter else body
    f = tmp_path / "test.md"
    f.write_text(content, encoding="utf-8")
    return f


def _check(tmp_path: Path, body: str, frontmatter: str = ""):
    f = _write_tmp(tmp_path, body, frontmatter)
    target = load_target(f)
    return list(link_target.check(target, {})), target


@pytest.fixture
def fake_knowledge(tmp_path, monkeypatch):
    """Stand up a tiny `knowledge/` tree and point the plugin at it."""
    root = tmp_path / "knowledge"
    (root / "History").mkdir(parents=True)
    (root / "History" / "founding.md").write_text("---\ntitle: x\n---\n")
    (root / "Beaches").mkdir()
    (root / "Beaches" / "victoria-beach.md").write_text("---\ntitle: x\n---\n")
    monkeypatch.setattr(link_target, "_KNOWLEDGE_ROOT", root)
    link_target._reset_cache()
    yield root
    link_target._reset_cache()


# ─── Phase 1: casing ────────────────────────────────────────────────────


def test_capitalized_category_violates(tmp_path, fake_knowledge):
    body = "See [Founding](/History/founding/) for context.\n"
    violations, _ = _check(tmp_path, body)
    casing = [v for v in violations if "category" in v.message]
    assert len(casing) == 1
    assert "/History/" in casing[0].message
    assert "/history/" in casing[0].message


def test_lowercase_category_passes(tmp_path, fake_knowledge):
    body = "See [Founding](/history/founding/) for context.\n"
    violations, _ = _check(tmp_path, body)
    assert violations == []


def test_external_url_ignored(tmp_path, fake_knowledge):
    body = "See [GitHub](https://github.com/X/Y) and [API](/api/x).\n"
    violations, _ = _check(tmp_path, body)
    assert violations == []


def test_multiple_categories_caught(tmp_path, fake_knowledge):
    body = (
        "[A](/History/x/)\n"
        "[B](/Beaches/y/)\n"
        "[C](/Trails/z/)\n"
    )
    violations, _ = _check(tmp_path, body)
    casing = [v for v in violations if "category" in v.message]
    assert len(casing) == 3


# ─── Phase 2: existence ─────────────────────────────────────────────────


def test_nonexistent_slug_violates_as_warn(tmp_path, fake_knowledge):
    body = "See [missing](/history/no-such-slug/) here.\n"
    violations, _ = _check(tmp_path, body)
    existence = [v for v in violations if "target does not exist" in v.message]
    assert len(existence) == 1
    assert "/history/no-such-slug" in existence[0].message
    # Phase 2 = WARN so pre-commit doesn't block parallel work.
    assert existence[0].severity == Severity.WARN


def test_capitalized_category_violates_as_hard(tmp_path, fake_knowledge):
    body = "See [Founding](/History/founding/) here.\n"
    violations, _ = _check(tmp_path, body)
    casing = [v for v in violations if "category must be lowercase" in v.message]
    assert len(casing) == 1
    assert casing[0].severity == Severity.HARD


def test_existing_slug_passes(tmp_path, fake_knowledge):
    body = "See [Victoria Beach](/beaches/victoria-beach/) here.\n"
    violations, _ = _check(tmp_path, body)
    assert violations == []


def test_static_page_skipped(tmp_path, fake_knowledge):
    """Single-segment paths (`/about/`, `/dashboard/`) aren't article-shaped."""
    body = "See [About](/about/) and [Dashboard](/dashboard/).\n"
    violations, _ = _check(tmp_path, body)
    assert violations == []


def test_anchor_and_query_stripped(tmp_path, fake_knowledge):
    body = (
        "[A](/history/founding/#section)\n"
        "[B](/history/founding/?utm=1)\n"
    )
    violations, _ = _check(tmp_path, body)
    assert violations == []  # both resolve to /history/founding


def test_casing_dedups_with_existence(tmp_path, fake_knowledge):
    """A casing violation shouldn't ALSO get an existence violation."""
    body = "See [Founding](/History/founding/) — uppercase.\n"
    violations, _ = _check(tmp_path, body)
    # Only Phase 1 should fire; Phase 2 skipped at same position.
    assert len(violations) == 1
    assert "category" in violations[0].message


def test_casing_AND_existence_both_violate(tmp_path, fake_knowledge):
    """When BOTH casing wrong AND target doesn't exist, only Phase 1 fires.

    After --fix (Phase 1) the lowercase version then trips Phase 2 if the slug
    truly doesn't exist. Two-pass is intentional — keeps each violation actionable.
    """
    body = "See [Bad](/History/no-such-slug/) — both wrong.\n"
    violations, _ = _check(tmp_path, body)
    assert len(violations) == 1
    assert "category" in violations[0].message


# ─── fix() — only Phase 1 ───────────────────────────────────────────────


def test_fix_lowercases_category(tmp_path, fake_knowledge):
    body = "See [Founding](/History/founding/) and [VB](/Beaches/victoria-beach/).\n"
    f = _write_tmp(tmp_path, body)
    target = load_target(f)
    changed = link_target.fix(target, {})
    assert changed is True
    new_text = f.read_text(encoding="utf-8")
    assert "/history/founding/" in new_text
    assert "/beaches/victoria-beach/" in new_text
    assert "/History/" not in new_text


def test_fix_does_not_touch_existence(tmp_path, fake_knowledge):
    """Phase 2 violations are NOT auto-fixed — file unchanged."""
    body = "See [missing](/history/no-such-slug/).\n"
    f = _write_tmp(tmp_path, body)
    target = load_target(f)
    changed = link_target.fix(target, {})
    assert changed is False  # casing was already lowercase, nothing to fix


def test_frontmatter_preserved_after_fix(tmp_path, fake_knowledge):
    fm = "title: Test\nauthor: X\n"
    body = "[Link](/History/founding/)\n"
    f = _write_tmp(tmp_path, body, fm)
    target = load_target(f)
    link_target.fix(target, {})
    new_text = f.read_text(encoding="utf-8")
    assert new_text.startswith("---\ntitle: Test\nauthor: X\n---\n")
    assert "/history/founding/" in new_text
