"""article_health.config — declarative TOML config loader.

Schema:
    [meta]
    version = 1
    canonical_doc = "docs/playbook/ARTICLE-PLAYBOOK.md"

    [checks.<name>]
    severity = "hard" | "warn" | "info"   # override default
    enabled = true                          # default true
    options = { ... }                       # plugin-specific

    [profiles.<profile-name>]
    checks = ["check-a", "check-b"] | "*"
    fail_on = "hard" | "warn" | "score-budget" | "never"
    severity_overrides = { check-a = "warn" }
    options_override = { check-b = { ... } }
"""

from __future__ import annotations
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .types import Severity


@dataclass
class CheckConfig:
    severity: Severity | None = None  # None = use plugin's default
    enabled: bool = True
    options: dict[str, Any] = field(default_factory=dict)


@dataclass
class ProfileConfig:
    name: str
    checks: list[str] | None = None  # None means "*"
    fail_on: str = "hard"  # hard / warn / score-budget / never
    severity_overrides: dict[str, Severity] = field(default_factory=dict)
    options_overrides: dict[str, dict[str, Any]] = field(default_factory=dict)


@dataclass
class Config:
    version: int = 1
    canonical_doc: str = ""
    checks: dict[str, CheckConfig] = field(default_factory=dict)
    profiles: dict[str, ProfileConfig] = field(default_factory=dict)

    def get_check_config(self, check_name: str) -> CheckConfig:
        return self.checks.get(check_name, CheckConfig())

    def get_profile(self, name: str) -> ProfileConfig | None:
        return self.profiles.get(name)


def _parse_severity(value: Any) -> Severity | None:
    if value is None:
        return None
    if isinstance(value, Severity):
        return value
    return Severity(str(value).lower())


def load_config(path: Path | str | None = None) -> Config:
    """Load TOML config. If path is None, search default locations.

    Default search order:
      1. $ARTICLE_HEALTH_CONFIG (env var)
      2. ./scripts/tools/article-health.config.toml
      3. ./article-health.config.toml
      4. fallback: empty Config()
    """
    import os
    import tomllib

    if path is None:
        candidates = [
            os.environ.get("ARTICLE_HEALTH_CONFIG"),
            "scripts/tools/article-health.config.toml",
            "article-health.config.toml",
        ]
        for c in candidates:
            if c and Path(c).exists():
                path = c
                break
    if path is None:
        return Config()

    p = Path(path)
    if not p.exists():
        return Config()

    with p.open("rb") as f:
        raw = tomllib.load(f)

    cfg = Config()
    meta = raw.get("meta", {})
    cfg.version = meta.get("version", 1)
    cfg.canonical_doc = meta.get("canonical_doc", "")

    for name, body in (raw.get("checks", {}) or {}).items():
        cfg.checks[name] = CheckConfig(
            severity=_parse_severity(body.get("severity")),
            enabled=body.get("enabled", True),
            options=body.get("options", {}) or {},
        )

    for name, body in (raw.get("profiles", {}) or {}).items():
        checks_raw = body.get("checks")
        checks_list: list[str] | None
        if checks_raw is None or checks_raw == "*":
            checks_list = None
        elif isinstance(checks_raw, list):
            checks_list = list(checks_raw)
        else:
            checks_list = [str(checks_raw)]
        cfg.profiles[name] = ProfileConfig(
            name=name,
            checks=checks_list,
            fail_on=body.get("fail_on", "hard"),
            severity_overrides={
                k: Severity(v.lower())
                for k, v in (body.get("severity_overrides", {}) or {}).items()
            },
            options_overrides=body.get("options_overrides", {}) or {},
        )

    return cfg
