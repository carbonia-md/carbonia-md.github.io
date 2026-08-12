"""article_health.registry — plugin discovery + check protocol.

Each check plugin is a `.py` file under `lib/article_health/checks/` exposing:
  - CHECK_NAME (str)
  - DIMENSION (str)
  - DEFAULT_SEVERITY (Severity)
  - EDITORIAL_REF (str)
  - check(target: FileTarget, config: dict) -> Iterator[Violation]
  - fix(target: FileTarget, config: dict) -> bool   [optional]

Phase 1 ships an empty registry — Phase 2+ adds plugins.
"""

from __future__ import annotations
import importlib
import importlib.util
import pkgutil
from pathlib import Path
from typing import Any, Callable, Iterator, Protocol, runtime_checkable

from .types import FileTarget, Severity, Violation


@runtime_checkable
class CheckPlugin(Protocol):
    """Plugin interface (duck-typed via Protocol)."""

    CHECK_NAME: str
    DIMENSION: str
    DEFAULT_SEVERITY: Severity
    EDITORIAL_REF: str

    def check(self, target: FileTarget, config: dict[str, Any]) -> Iterator[Violation]:
        ...


# Module-level registry: name → module
_REGISTRY: dict[str, Any] = {}
_DISCOVERED: bool = False


def _checks_package_path() -> Path:
    return Path(__file__).parent / "checks"


def _validate_module(mod: Any) -> tuple[bool, str]:
    """Return (ok, error_message). ok=True means the module looks like a plugin."""
    required = ["CHECK_NAME", "DIMENSION", "DEFAULT_SEVERITY", "EDITORIAL_REF", "check"]
    missing = [r for r in required if not hasattr(mod, r)]
    if missing:
        return False, f"missing attrs: {missing}"
    if not callable(mod.check):
        return False, "check is not callable"
    if not isinstance(mod.DEFAULT_SEVERITY, Severity):
        return False, "DEFAULT_SEVERITY must be Severity enum"
    return True, ""


def discover_checks(reload: bool = False) -> dict[str, Any]:
    """Auto-discover plugin modules under checks/.

    Returns: dict[check_name → module]. Modules failing validation are skipped
    silently (they'll never be runnable).
    """
    global _DISCOVERED, _REGISTRY
    if _DISCOVERED and not reload:
        return _REGISTRY
    _REGISTRY = {}
    pkg_path = _checks_package_path()
    if not pkg_path.exists():
        _DISCOVERED = True
        return _REGISTRY
    # Try multiple import-path candidates because this lib gets called from
    # different sys.path contexts (script vs. test vs. installed package).
    pkg_candidates = [
        # When this module's __package__ is set, use it (most robust).
        __package__ + ".checks" if __package__ else None,
        "scripts.tools.lib.article_health.checks",
        "lib.article_health.checks",
        "article_health.checks",
    ]
    pkg_candidates = [p for p in pkg_candidates if p]

    for _finder, name, _ispkg in pkgutil.iter_modules([str(pkg_path)]):
        if name.startswith("_"):
            continue
        mod = None
        # Try regular import via each candidate package path
        for pkg_name in pkg_candidates:
            try:
                mod = importlib.import_module(f"{pkg_name}.{name}")
                break
            except Exception:
                continue
        # File-loader fallback if no package import worked
        if mod is None:
            spec = importlib.util.spec_from_file_location(
                f"_article_health_check_{name}", pkg_path / f"{name}.py"
            )
            if spec is None or spec.loader is None:
                continue
            mod = importlib.util.module_from_spec(spec)
            try:
                spec.loader.exec_module(mod)
            except Exception:
                continue
        ok, _err = _validate_module(mod)
        if ok:
            _REGISTRY[mod.CHECK_NAME] = mod
    _DISCOVERED = True
    return _REGISTRY


def list_checks() -> list[dict[str, Any]]:
    """List all registered checks with metadata."""
    discover_checks()
    return [
        {
            "name": mod.CHECK_NAME,
            "dimension": mod.DIMENSION,
            "default_severity": mod.DEFAULT_SEVERITY.value,
            "editorial_ref": mod.EDITORIAL_REF,
            "fix_supported": hasattr(mod, "fix") and callable(mod.fix),
        }
        for mod in _REGISTRY.values()
    ]


def get_check(name: str) -> Any | None:
    """Get a registered check module by name."""
    discover_checks()
    return _REGISTRY.get(name)


def reset_registry() -> None:
    """For tests."""
    global _DISCOVERED, _REGISTRY
    _DISCOVERED = False
    _REGISTRY = {}
