"""Tests for runner — verify orchestration works with synthetic plugins."""

from typing import Any, Iterator

from lib.article_health import registry, run_checks
from lib.article_health.config import Config, ProfileConfig
from lib.article_health.loader import load_target
from lib.article_health.types import (
    FileTarget,
    Severity,
    Violation,
)


def _make_target(tmp_path, content: str = "test\n") -> FileTarget:
    f = tmp_path / "test.md"
    f.write_text(content, encoding="utf-8")
    return load_target(f)


def _register_synthetic_plugin(check_name: str, n_violations: int = 1):
    """Inject a fake plugin module into the registry for testing."""

    class FakeMod:
        CHECK_NAME = check_name
        DIMENSION = "test"
        DEFAULT_SEVERITY = Severity.WARN
        EDITORIAL_REF = "test"

        @staticmethod
        def check(
            target: FileTarget, config: dict[str, Any]
        ) -> Iterator[Violation]:
            for i in range(n_violations):
                yield Violation(
                    check=check_name,
                    severity=Severity.WARN,
                    message=f"v{i}",
                    line=i + 1,
                )

    registry._REGISTRY[check_name] = FakeMod()
    registry._DISCOVERED = True
    return FakeMod


def test_runner_disabled_via_profile_filter(tmp_path):
    """Runner with profile.checks=[] should run nothing even if plugins exist."""
    registry.reset_registry()
    target = _make_target(tmp_path)
    cfg = Config()
    cfg.profiles["empty"] = ProfileConfig(name="empty", checks=[])
    report = run_checks(target, cfg, profile_name="empty")
    assert report.results == []


def test_runner_single_plugin_yields_violations(tmp_path):
    registry.reset_registry()
    _register_synthetic_plugin("test-a", n_violations=3)
    target = _make_target(tmp_path)
    cfg = Config()
    report = run_checks(target, cfg)
    assert len(report.results) == 1
    r = report.results[0]
    assert r.check == "test-a"
    assert len(r.violations) == 3
    assert r.warn_count == 3
    assert r.passed  # WARN is not HARD


def test_runner_severity_escalation_via_config(tmp_path):
    """Profile severity override escalates WARN → HARD."""
    registry.reset_registry()
    _register_synthetic_plugin("test-a", n_violations=2)
    target = _make_target(tmp_path)
    cfg = Config()
    cfg.profiles["strict"] = ProfileConfig(
        name="strict",
        checks=["test-a"],
        severity_overrides={"test-a": Severity.HARD},
    )
    report = run_checks(target, cfg, profile_name="strict")
    assert report.hard_count == 2  # all violations escalated
    assert not report.passed


def test_runner_profile_filters_to_subset(tmp_path):
    registry.reset_registry()
    _register_synthetic_plugin("test-a", n_violations=1)
    _register_synthetic_plugin("test-b", n_violations=1)
    target = _make_target(tmp_path)
    cfg = Config()
    cfg.profiles["only-a"] = ProfileConfig(name="only-a", checks=["test-a"])
    report = run_checks(target, cfg, profile_name="only-a")
    assert len(report.results) == 1
    assert report.results[0].check == "test-a"


def test_runner_check_name_overrides_profile(tmp_path):
    registry.reset_registry()
    _register_synthetic_plugin("test-a", n_violations=1)
    _register_synthetic_plugin("test-b", n_violations=1)
    target = _make_target(tmp_path)
    cfg = Config()
    cfg.profiles["all"] = ProfileConfig(name="all", checks=["test-a", "test-b"])
    report = run_checks(target, cfg, profile_name="all", check_name="test-b")
    assert len(report.results) == 1
    assert report.results[0].check == "test-b"


def test_runner_disabled_check_skipped(tmp_path):
    """checks.X.enabled=false → check is skipped."""
    registry.reset_registry()
    _register_synthetic_plugin("test-a", n_violations=1)
    target = _make_target(tmp_path)
    cfg = Config()
    from lib.article_health.config import CheckConfig

    cfg.checks["test-a"] = CheckConfig(enabled=False)
    report = run_checks(target, cfg)
    assert report.results == []


def test_health_report_as_dict_serializable(tmp_path):
    """as_dict output must be JSON-serializable."""
    import json

    registry.reset_registry()
    _register_synthetic_plugin("test-a", n_violations=1)
    target = _make_target(tmp_path)
    cfg = Config()
    report = run_checks(target, cfg)
    out = report.as_dict()
    # round-trip
    s = json.dumps(out, ensure_ascii=False)
    parsed = json.loads(s)
    assert parsed["summary"]["passed"] is True
    assert len(parsed["results"]) == 1
