"""Test config — sys.path shim + shared article/file writers.

`lib.article_health` is importable via the sys.path insert below. The
`write_article` / `write_tmp` fixtures are the single shared helpers for
building test fixtures (replacing the per-file `_write_article` / `_write_tmp`
duplicates).
"""

import sys
from pathlib import Path

import pytest

# Add scripts/tools to path so `from lib.article_health import ...` works
_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts" / "tools"))


@pytest.fixture
def write_article(tmp_path):
    """Write a knowledge/{Category}/{slug}.md article; return its Path.

    body     — markdown body after the frontmatter.
    category — path category segment (knowledge/<category>/...).
    name     — filename (default x.md).
    extra    — raw frontmatter lines appended before the closing `---`
               (e.g. "category: Nature\\n" or an image: line).
    """
    def _write(body: str = "", *, category: str = "Nature", name: str = "x.md", extra: str = "") -> Path:
        f = tmp_path / "knowledge" / category / name
        f.parent.mkdir(parents=True, exist_ok=True)
        fm = f"title: x\ndescription: y\ndate: 2026-05-04\ntags: [t]\n{extra}"
        f.write_text(f"---\n{fm}---\n\n{body}\n", encoding="utf-8")
        return f

    return _write


@pytest.fixture
def write_tmp(tmp_path):
    """Write raw file content verbatim (no frontmatter template); return Path.

    For loader-level tests that need exact byte control over the file.
    """
    def _write(content: str, name: str = "test.md") -> Path:
        f = tmp_path / name
        f.write_text(content, encoding="utf-8")
        return f

    return _write
