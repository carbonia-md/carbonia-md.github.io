"""Tests for config loader."""

from pathlib import Path

from lib.article_health import load_config
from lib.article_health.types import Severity


def test_load_default_config():
    """Default config exists at scripts/tools/article-health.config.toml."""
    cfg = load_config("scripts/tools/article-health.config.toml")
    assert cfg.version == 1
    assert cfg.canonical_doc == "docs/playbook/ARTICLE-PLAYBOOK.md"
    # Phase 1: profiles defined but checks lists are empty
    assert "pre-commit" in cfg.profiles
    assert "release-pr" in cfg.profiles
    assert "dashboard" in cfg.profiles


def test_missing_config_returns_empty(tmp_path):
    cfg = load_config(tmp_path / "nonexistent.toml")
    assert cfg.version == 1
    assert cfg.checks == {}
    assert cfg.profiles == {}


def test_severity_override_via_check_block(tmp_path):
    cfg_file = tmp_path / "test.toml"
    cfg_file.write_text(
        '[checks.example]\nseverity = "warn"\nenabled = true\n', encoding="utf-8"
    )
    cfg = load_config(cfg_file)
    assert cfg.checks["example"].severity == Severity.WARN
    assert cfg.checks["example"].enabled is True


def test_profile_severity_override(tmp_path):
    cfg_file = tmp_path / "test.toml"
    cfg_file.write_text(
        '[profiles.test]\nchecks = ["a", "b"]\nfail_on = "warn"\n'
        '[profiles.test.severity_overrides]\na = "hard"\n',
        encoding="utf-8",
    )
    cfg = load_config(cfg_file)
    p = cfg.get_profile("test")
    assert p is not None
    assert p.checks == ["a", "b"]
    assert p.fail_on == "warn"
    assert p.severity_overrides == {"a": Severity.HARD}


def test_profile_wildcard_checks(tmp_path):
    cfg_file = tmp_path / "test.toml"
    cfg_file.write_text(
        '[profiles.all]\nchecks = "*"\nfail_on = "never"\n', encoding="utf-8"
    )
    cfg = load_config(cfg_file)
    assert cfg.get_profile("all").checks is None  # wildcard → None means "all"
