"""Tests for chronicle_lead plugin.

Detects chronicle-style H2 subheadings that turn articles into
Wikipedia-style timelines (ARTICLE-PLAYBOOK §4.3 Subheadings). The check targets
English articles and English chronicle patterns.

Canonical: docs/playbook/ARTICLE-PLAYBOOK.md §4.3 Subheadings
"""

from pathlib import Path

from lib.article_health.checks import chronicle_lead
from lib.article_health.loader import load_target


def _write_tmp(tmp_path: Path, content: str, name: str = "test.md") -> Path:
    f = tmp_path / name
    f.write_text(content, encoding="utf-8")
    return f


def _check_subheadings(tmp_path: Path, subheadings: list[str], path_hint: str = "knowledge/People/test.md"):
    """Build a synthetic article and return chronicle-lead violations."""
    body = (
        "---\ntitle: Test\n---\n\n"
        "> **At a glance**: test.\n\n"
        + "\n\n".join(f"{h}\n\nParagraph content." for h in subheadings)
        + "\n"
    )
    out = tmp_path / "test.md"
    out.write_text(body, encoding="utf-8")
    target = load_target(out)
    return list(chronicle_lead.check(target, {}))


# ════════════════════════════════════════════════════════════════════════
# WARN violations (chronicle subheadings should be detected)
# ════════════════════════════════════════════════════════════════════════


def test_year_month_subheading(tmp_path):
    """## May 2016: ... — chronicle event with month + year."""
    violations = _check_subheadings(tmp_path, ["## May 2016: the gallery opened"])
    assert len(violations) == 1
    assert "Chronicle-style subheading" in violations[0].message


def test_year_work_subheading(tmp_path):
    """## 2016 May — reversed year + month."""
    violations = _check_subheadings(tmp_path, ["## 2016 May"])
    assert len(violations) == 1


def test_year_event_subheading(tmp_path):
    """## 2018: the award / ## 2018 "the award" — year-prefixed event."""
    violations1 = _check_subheadings(tmp_path, ["## 2018: the award nomination"])
    violations2 = _check_subheadings(tmp_path, ['## 2018 "the award nomination"'])
    assert len(violations1) == 1
    assert len(violations2) == 1


def test_date_format_subheading(tmp_path):
    """## 2024.5.6 / ## 2024/5/6 / ## 2024-05-06 — date format."""
    for fmt in ["## 2024.5.6", "## 2024/5/6", "## 2024-05-06"]:
        violations = _check_subheadings(tmp_path, [fmt])
        assert len(violations) == 1, f"{fmt} should violate"


def test_multiple_chronicle_subheadings(tmp_path):
    """Multiple chronicle subheadings — all should be detected."""
    violations = _check_subheadings(tmp_path, [
        "## 2011: the summit",
        "## May 2015: the pivot",
        "## 2024-03-01: the rebound",
    ])
    assert len(violations) == 3


# ════════════════════════════════════════════════════════════════════════
# Allowed patterns (legitimate timeline scope - should NOT trigger)
# ════════════════════════════════════════════════════════════════════════


def test_year_range_allowed(tmp_path):
    """## 1949-1987 Martial Law Era — year range with description (legitimate scope)."""
    violations = _check_subheadings(tmp_path, ["## 1949-1987 Martial Law Era"])
    assert len(violations) == 0
    # En-dash / spaced em-dash variants
    violations2 = _check_subheadings(tmp_path, ["## 1949–1987 Martial Law Era", "## 1949 — 1987 Martial Law Era"])
    assert len(violations2) == 0


def test_decade_reference_allowed(tmp_path):
    """## The 1990s — decade reference."""
    violations = _check_subheadings(tmp_path, ["## The 1990s"])
    assert len(violations) == 0


def test_named_period_allowed(tmp_path):
    """## Postwar Period — named period, no specific date."""
    violations = _check_subheadings(tmp_path, ["## The Postwar Period"])
    assert len(violations) == 0


def test_scene_subheadings_allowed(tmp_path):
    """Scene / object / conflict subheadings — never trigger."""
    legitimate = [
        "## The party ended",
        "## The dog named Spud",
        "## The uncredited founder",
        "## The trail above the cove",
    ]
    violations = _check_subheadings(tmp_path, legitimate)
    assert len(violations) == 0


# ════════════════════════════════════════════════════════════════════════
# Severity (soft-launch as WARN)
# ════════════════════════════════════════════════════════════════════════


def test_default_severity_is_warn():
    """Plugin ships as WARN initially (legacy heal'd before HARD promotion)."""
    from lib.article_health.types import Severity
    assert chronicle_lead.DEFAULT_SEVERITY == Severity.WARN


def test_violation_includes_fix_suggestion(tmp_path):
    """Violations should include actionable fix suggestion."""
    violations = _check_subheadings(tmp_path, ["## May 2020: the opening"])
    assert len(violations) == 1
    assert violations[0].fix_suggestion
    assert "scene" in violations[0].fix_suggestion or "object" in violations[0].fix_suggestion
