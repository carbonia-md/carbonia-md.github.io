"""Tests for the cross_reference plugin: wikilink reciprocity between articles."""

from lib.article_health import registry
from lib.article_health.checks import cross_reference
from lib.article_health.loader import load_target
from lib.article_health.types import Severity


def test_cross_ref_symmetric_passes(write_article, monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    cross_reference._reset_cache()
    # A links to B, B links to A — symmetric
    a = write_article("See [[B]] here", name="A.md")
    write_article("See [[A]] here", name="B.md")
    target = load_target(a)
    violations = list(cross_reference.check(target, {}))
    assert violations == []


def test_cross_ref_asymmetric_info(write_article, monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    cross_reference._reset_cache()
    # A links to B, B doesn't link back
    a = write_article("See [[B]] here", name="A.md")
    write_article("No backlink here", name="B.md")
    target = load_target(a)
    violations = list(cross_reference.check(target, {}))
    assert len(violations) == 1
    assert violations[0].severity == Severity.INFO
    assert "[[B]]" in violations[0].message


def test_cross_reference_registered():
    registry.reset_registry()
    assert "cross-reference" in registry.discover_checks()
