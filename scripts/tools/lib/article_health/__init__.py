"""article_health — SSOT article health check module.

Public API:
    from scripts.tools.lib.article_health import run_checks, FileTarget, Severity

Target contract: the tool checks knowledge/{Category}/*.md articles only
(loader.is_article_path); eligibility is enforced at the CLI boundary and
checks assume eligible input.
"""

from .types import (
    FileTarget,
    Severity,
    Violation,
    CheckResult,
    HealthReport,
)
from .loader import is_article_path, load_target
from .registry import (
    discover_checks,
    get_check,
    list_checks,
)
from .config import load_config
from .runner import run_checks

__all__ = [
    "FileTarget",
    "Severity",
    "Violation",
    "CheckResult",
    "HealthReport",
    "is_article_path",
    "load_target",
    "discover_checks",
    "get_check",
    "list_checks",
    "load_config",
    "run_checks",
]

__version__ = "0.1.0-phase1"
