"""Tests for the frontmatter_title plugin.

The plugin gates three English dimensions: puffery adjectives, title length
(> 60 chars), and a required subcategory (HARD) on non-About articles.
"""

from pathlib import Path

import pytest

from lib.article_health import registry
from lib.article_health.checks import frontmatter_title
from lib.article_health.loader import load_target
from lib.article_health.types import Severity


def _make_article(
    tmp_path: Path,
    title: str,
    category: str = "Nature",
    description: str = "desc",
) -> Path:
    d = tmp_path / "knowledge" / category
    d.mkdir(parents=True, exist_ok=True)
    f = d / "test.md"
    f.write_text(
        f"---\ntitle: '{title}'\ndescription: '{description}'\nsubcategory: 'test-sub'\n---\n\nbody.\n",
        encoding="utf-8",
    )
    return f


def _check(tmp_path: Path, title: str, category: str = "Nature"):
    f = _make_article(tmp_path, title, category)
    target = load_target(f)
    return list(frontmatter_title.check(target, {}))


# ════════════════════════════════════════════════════════════════════════
# WARN: vague / puffery adjectives
# ════════════════════════════════════════════════════════════════════════


@pytest.mark.parametrize("adj", ["iconic", "legendary", "world-class", "must-see", "hidden gem", "ultimate"])
def test_vague_adjective_is_warn(tmp_path, adj):
    violations = _check(tmp_path, f"The {adj} coastal guide")
    warns = [v for v in violations if v.severity == Severity.WARN and "puffery" in v.message]
    assert len(warns) == 1


def test_vague_adjective_case_insensitive(tmp_path):
    violations = _check(tmp_path, "The ICONIC tower at the cove")
    warns = [v for v in violations if v.severity == Severity.WARN and "puffery" in v.message]
    assert len(warns) == 1


def test_clean_title_no_vague_warn(tmp_path):
    violations = _check(tmp_path, "Victoria Beach")
    warns = [v for v in violations if v.severity == Severity.WARN and "puffery" in v.message]
    assert warns == []


def test_english_comma_not_flagged(tmp_path):
    """Half-width punctuation is not gated for English titles."""
    violations = _check(tmp_path, "Sun, Y. H. monograph")
    hard = [v for v in violations if v.severity == Severity.HARD and "subcategory" not in v.message]
    assert hard == []


# ════════════════════════════════════════════════════════════════════════
# WARN: title length (raw chars > 60)
# ════════════════════════════════════════════════════════════════════════


def test_long_title_warns(tmp_path):
    long_title = "A" * 61  # 61 chars > 60 threshold
    violations = _check(tmp_path, long_title)
    warns = [v for v in violations if "too long" in v.message.lower()]
    assert len(warns) == 1


def test_normal_title_passes_length(tmp_path):
    violations = _check(tmp_path, "Victoria Beach")
    warns = [v for v in violations if "too long" in v.message.lower()]
    assert warns == []


# ════════════════════════════════════════════════════════════════════════
# Mixed severities + runner severity preservation
# ════════════════════════════════════════════════════════════════════════


def test_mixed_severities_in_one_check(tmp_path):
    """A title with a puffery adjective (WARN) on an article missing its
    subcategory (HARD) yields one WARN + one HARD from a single check."""
    d = tmp_path / "knowledge" / "Beaches"
    d.mkdir(parents=True)
    f = d / "test.md"
    f.write_text(
        "---\ntitle: 'The iconic cove'\ndescription: 'desc'\n---\n\nbody.\n",
        encoding="utf-8",
    )
    target = load_target(f)
    violations = list(frontmatter_title.check(target, {}))
    hard = [v for v in violations if v.severity == Severity.HARD]
    warn = [v for v in violations if v.severity == Severity.WARN]
    assert len(hard) >= 1  # missing subcategory
    assert len(warn) >= 1  # puffery adjective


def test_runner_preserves_per_violation_hard(tmp_path):
    """Even with a profile override default→warn, the plugin's HARD violations
    (missing subcategory) stay HARD."""
    from lib.article_health import config as cfg_mod
    from lib.article_health.runner import run_checks

    d = tmp_path / "knowledge" / "Beaches"
    d.mkdir(parents=True)
    f = d / "test.md"
    f.write_text(
        "---\ntitle: 'Victoria Beach'\ndescription: 'desc'\n---\n\nbody.\n",
        encoding="utf-8",
    )
    target = load_target(f)
    cfg = cfg_mod.Config()
    cfg.profiles["test"] = cfg_mod.ProfileConfig(
        name="test",
        checks=["frontmatter-title"],
        severity_overrides={"frontmatter-title": Severity.WARN},
    )
    report = run_checks(target, cfg, profile_name="test")
    hard_violations = [v for r in report.results for v in r.violations if v.severity == Severity.HARD]
    assert len(hard_violations) >= 1, "subcategory HARD must survive profile override"


# ════════════════════════════════════════════════════════════════════════
# Plugin metadata
# ════════════════════════════════════════════════════════════════════════


def test_plugin_metadata():
    assert frontmatter_title.CHECK_NAME == "frontmatter-title"
    assert frontmatter_title.DEFAULT_SEVERITY == Severity.WARN
    assert callable(frontmatter_title.check)


def test_plugin_registered():
    registry.reset_registry()
    found = registry.discover_checks()
    assert "frontmatter-title" in found, list(found.keys())


# ════════════════════════════════════════════════════════════════════════
# Subcategory HARD (non-About articles)
# ════════════════════════════════════════════════════════════════════════


def _make_article_no_subcategory(tmp_path: Path, title: str, category: str) -> Path:
    d = tmp_path / "knowledge" / category
    d.mkdir(parents=True, exist_ok=True)
    f = d / "test.md"
    f.write_text(
        f"---\ntitle: '{title}'\ndescription: 'desc'\n---\n\nbody.\n",
        encoding="utf-8",
    )
    return f


def test_missing_subcategory_is_hard(tmp_path):
    f = _make_article_no_subcategory(tmp_path, "Victoria Beach", "Beaches")
    target = load_target(f)
    violations = list(frontmatter_title.check(target, {}))
    sub_hard = [
        v for v in violations
        if v.severity == Severity.HARD and "subcategory" in v.message
    ]
    assert len(sub_hard) == 1


def test_about_category_subcategory_exempt(tmp_path):
    f = _make_article_no_subcategory(tmp_path, "About this project", "About")
    target = load_target(f)
    violations = list(frontmatter_title.check(target, {}))
    sub_violations = [v for v in violations if "subcategory" in v.message]
    assert sub_violations == []


def test_present_subcategory_passes(tmp_path):
    d = tmp_path / "knowledge" / "Beaches"
    d.mkdir(parents=True)
    f = d / "test.md"
    f.write_text(
        "---\ntitle: 'Victoria Beach'\ndescription: 'desc'\nsubcategory: 'South Coast'\n---\n\nbody.\n",
        encoding="utf-8",
    )
    target = load_target(f)
    violations = list(frontmatter_title.check(target, {}))
    sub_violations = [v for v in violations if "subcategory" in v.message]
    assert sub_violations == []
