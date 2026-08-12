"""Tests for the image_health plugin: file existence, hot-link detection,
frontmatter image coherence, Image Sources section."""

from lib.article_health import registry
from lib.article_health.checks import image_health
from lib.article_health.loader import load_target
from lib.article_health.types import Severity

_CAT = "category: Nature\n"


def test_inline_image_missing_file_hard(write_article, monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    body = "![alt](/article-images/nature/missing.jpg) caption"
    target = load_target(write_article(body, extra=_CAT))
    violations = list(image_health.check(target, {}))
    assert any("not found" in v.message for v in violations)


def test_inline_image_existing_file_passes(write_article, monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    img = tmp_path / "public" / "article-images" / "nature" / "owl.jpg"
    img.parent.mkdir(parents=True)
    img.write_bytes(b"fake")
    body = "![alt](/article-images/nature/owl.jpg) caption"
    target = load_target(write_article(body, extra=_CAT))
    violations = list(image_health.check(target, {}))
    # No HARD violations (file exists, no hot-link). INFO stat + min-count WARN are expected.
    hard_violations = [v for v in violations if v.severity == Severity.HARD]
    assert hard_violations == []


def test_external_hotlink_flagged(write_article, monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    body = "![alt](https://example.com/external.jpg) caption"
    target = load_target(write_article(body, extra=_CAT))
    violations = list(image_health.check(target, {}))
    assert any("hot-link" in v.message.lower() for v in violations)


def test_wikimedia_external_allowed(write_article, monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    body = "![alt](https://upload.wikimedia.org/file.jpg) caption"
    target = load_target(write_article(body, extra=_CAT))
    violations = list(image_health.check(target, {}))
    hot_warns = [v for v in violations if "hot-link" in v.message.lower()]
    assert hot_warns == []


def test_frontmatter_image_missing_hard(write_article, monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    target = load_target(
        write_article("caption", extra=_CAT + "image: '/article-images/missing.jpg'\n")
    )
    violations = list(image_health.check(target, {}))
    assert any("Frontmatter image" in v.message for v in violations)


def test_attribution_without_section_warn(write_article, monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    img = tmp_path / "public" / "article-images" / "owl.jpg"
    img.parent.mkdir(parents=True)
    img.write_bytes(b"fake")
    target = load_target(
        write_article(
            "caption",
            extra=(
                _CAT
                + "image: '/article-images/owl.jpg'\n"
                "imageCredit: 'gailhampshire'\n"
                "imageLicense: 'CC BY 2.0'\n"
            ),
        )
    )
    violations = list(image_health.check(target, {}))
    assert any("Image Sources" in v.message for v in violations)


def test_image_health_registered():
    registry.reset_registry()
    assert "image-health" in registry.discover_checks()
