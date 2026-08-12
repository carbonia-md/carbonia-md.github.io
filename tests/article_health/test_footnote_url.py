"""Tests for the footnote_url plugin (network-bound liveness check, opt-in)."""

from lib.article_health import registry
from lib.article_health.checks import footnote_url
from lib.article_health.loader import load_target
from lib.article_health.types import Severity


def test_footnote_url_default_skipped(write_article):
    """Network-bound check skipped by default."""
    body = "Body[^1]\n\n[^1]: [src](https://example.com) — desc enough chars"
    target = load_target(write_article(body))
    violations = list(footnote_url.check(target, {}))
    assert violations == []


def test_footnote_url_enabled_via_config(write_article):
    """When config enables network, plugin attempts HEAD."""
    body = "Body[^1]\n\n[^1]: [src](https://this-domain-does-not-exist-12345.invalid) — desc"
    target = load_target(write_article(body))
    violations = list(footnote_url.check(target, {"network": True}))
    # Invalid domain should yield a warning
    assert len(violations) >= 1
    assert violations[0].severity == Severity.WARN


def test_footnote_url_env_var_enables(write_article, monkeypatch):
    monkeypatch.setenv("ARTICLE_HEALTH_NETWORK", "1")
    body = "Body[^1]\n\n[^1]: [src](https://this-bad-12345.invalid) — desc enough"
    target = load_target(write_article(body))
    violations = list(footnote_url.check(target, {}))
    assert len(violations) >= 1


def test_footnote_url_registered():
    registry.reset_registry()
    assert "footnote-url" in registry.discover_checks()
