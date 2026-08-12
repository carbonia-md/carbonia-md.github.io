"""Parity tests — canonical fixture counts for frontmatter_title plugin.

These fixtures assert the plugin's expected violation counts across the
English title dimensions.
"""

from pathlib import Path

import pytest

from lib.article_health.checks import frontmatter_title
from lib.article_health.loader import load_target
from lib.article_health.types import Severity


# Canonical fixtures: (title, category, expected_hard, expected_warn, label)
FIXTURES = [
    # clean titles
    ("Victoria Beach", "Beaches", 0, 0, "clean-short"),
    ("The Cliff Restaurant", "Food", 0, 0, "clean-normal"),
    # vague adjective
    ("The Iconic Tower at the cove", "Beaches", 0, 1, "vague-iconic"),
    ("Hidden Gem of the south coast", "Beaches", 0, 1, "vague-hidden-gem"),
    # too long (> 60 chars)
    ("A" * 61, "Nature", 0, 1, "title-too-long"),
    # exactly 60 chars — no warn
    ("A" * 60, "Nature", 0, 0, "title-at-limit"),
]


def _check_via_python(title: str, category: str, tmp_path: Path):
    """Run the Python plugin and return (hard_count, warn_count)."""
    d = tmp_path / "knowledge" / category
    d.mkdir(parents=True, exist_ok=True)
    f = d / "py.md"
    f.write_text(
        f"---\ntitle: '{title}'\ndescription: 'desc'\nsubcategory: 'parity-fixture'\n---\nbody.\n",
        encoding="utf-8",
    )
    target = load_target(f)
    violations = list(frontmatter_title.check(target, {}))
    hard = sum(1 for v in violations if v.severity == Severity.HARD)
    warn = sum(1 for v in violations if v.severity == Severity.WARN)
    return hard, warn


@pytest.mark.parametrize(
    "title,category,expected_hard,expected_warn,label", FIXTURES
)
def test_python_plugin_matches_expected(
    tmp_path, title, category, expected_hard, expected_warn, label
):
    """Python plugin's count matches the fixture's expected counts."""
    py_hard, py_warn = _check_via_python(title, category, tmp_path)
    assert py_hard == expected_hard, (
        f"[{label}] Python hard={py_hard}, expected {expected_hard}; title={title!r}"
    )
    assert py_warn == expected_warn, (
        f"[{label}] Python warn={py_warn}, expected {expected_warn}; title={title!r}"
    )
