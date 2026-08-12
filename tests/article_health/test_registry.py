"""Tests for plugin registry — auto-discovery + validation."""

from lib.article_health import registry, list_checks


def test_discover_finds_real_plugins():
    """Registry auto-discovers plugins under checks/."""
    registry.reset_registry()
    items = list_checks()
    names = [it["name"] for it in items]
    assert "prose-health" in names, f"expected prose-health in registry, got {names}"


def test_validate_module_missing_attrs():
    """A module missing required attrs is rejected."""
    class Fake:
        CHECK_NAME = "fake"
        # missing the rest

    ok, err = registry._validate_module(Fake())
    assert not ok
    assert "missing" in err


def test_get_check_returns_module():
    registry.reset_registry()
    mod = registry.get_check("prose-health")
    assert mod is not None
    assert mod.CHECK_NAME == "prose-health"


def test_get_check_unknown_returns_none():
    registry.reset_registry()
    assert registry.get_check("does-not-exist") is None
