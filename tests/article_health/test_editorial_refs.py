"""Editorial-reference existence gate (LB-34).

Every `EDITORIAL_REF` constant and inline `editorial_ref="..."` literal in the
check plugins points a finding at the editorial canon. When the canon moves
(as it did in LB-28, when the pre-cut editorial docs were replaced by
docs/playbook/), those pointers silently rot into dead ends shown in
`--list-checks` and every violation message.

This test asserts the file-path component of every reference resolves to a real
path in the repo, so the next doc move fails the suite instead of shipping dead
pointers. References that carry no path component (a bare section or config-key
citation) must be listed in `_NO_PATH_ALLOWLIST` with a reason.
"""

from __future__ import annotations
import re
from pathlib import Path

import pytest

from lib.article_health import list_checks, registry

_REPO_ROOT = Path(__file__).resolve().parents[2]
_CHECKS_DIR = _REPO_ROOT / "scripts" / "tools" / "lib" / "article_health" / "checks"

# References with no repo-path component are only acceptable if named here, each
# with the reason a path check does not apply. Empty today: every shipped
# reference names a real doc/route/dir. A new path-less reference must be
# justified here or it fails.
_NO_PATH_ALLOWLIST: dict[str, str] = {}

# A path token is any whitespace-delimited chunk containing "/". Section anchors
# ("§4.3", "Stage 4") and the "+" joiner never contain "/", so they drop out.
_TRAILING = ",);:"


def _path_tokens(ref: str) -> list[str]:
    """Extract repo-relative path tokens from a reference string."""
    tokens: list[str] = []
    for raw in ref.split():
        if "/" not in raw:
            continue
        token = raw.rstrip(_TRAILING)
        token = token.rstrip("/")  # trailing slash → directory reference
        if token:
            tokens.append(token)
    return tokens


def _resolve(token: str) -> Path:
    return _REPO_ROOT / token


def _registered_refs() -> list[tuple[str, str]]:
    """(check_name, editorial_ref) for every registered check."""
    registry.reset_registry()
    return [(c["name"], c["editorial_ref"]) for c in list_checks()]


def _inline_ref_literals() -> list[tuple[str, str]]:
    """(source_file, literal) for every inline `editorial_ref="..."` in checks/.

    Captures up to the first quote; an escaped inner quote truncates the capture
    but the leading path token (what we validate) is always intact.
    """
    pat = re.compile(r'editorial_ref="([^"]*)"')
    out: list[tuple[str, str]] = []
    for py in sorted(_CHECKS_DIR.glob("*.py")):
        for m in pat.finditer(py.read_text(encoding="utf-8")):
            out.append((py.name, m.group(1)))
    return out


def test_registry_is_populated():
    """Guards against the whole suite passing vacuously on an empty registry."""
    refs = _registered_refs()
    assert len(refs) >= 20, f"expected the full check set, got {len(refs)}"


@pytest.mark.parametrize("name,ref", _registered_refs(), ids=lambda v: v if isinstance(v, str) else "")
def test_registered_editorial_ref_paths_exist(name: str, ref: str):
    """Every registered check's EDITORIAL_REF resolves to a real path."""
    tokens = _path_tokens(ref)
    if not tokens:
        assert ref in _NO_PATH_ALLOWLIST, (
            f"check '{name}' editorial_ref has no path component and is not "
            f"allowlisted: {ref!r}"
        )
        return
    for token in tokens:
        assert _resolve(token).exists(), (
            f"check '{name}' editorial_ref points at missing path "
            f"'{token}' (full ref: {ref!r})"
        )


@pytest.mark.parametrize(
    "src,ref",
    _inline_ref_literals(),
    ids=[f"{s}:{r[:40]}" for s, r in _inline_ref_literals()],
)
def test_inline_editorial_ref_paths_exist(src: str, ref: str):
    """Every inline editorial_ref="..." literal resolves to a real path."""
    tokens = _path_tokens(ref)
    if not tokens:
        assert ref in _NO_PATH_ALLOWLIST, (
            f"{src}: inline editorial_ref has no path component and is not "
            f"allowlisted: {ref!r}"
        )
        return
    for token in tokens:
        assert _resolve(token).exists(), (
            f"{src}: inline editorial_ref points at missing path "
            f"'{token}' (full ref: {ref!r})"
        )


# Reference rot is not confined to editorial_ref. The PR #4 review chain found a
# dead `check-aspect.sh` pointer in a fix_suggestion, fork provenance citing
# scripts/tools/*.sh, fork stage-item numbers (`Stage 2 #4`), fork issue numbers
# (`#884`), and a dead `ROADMAP §3.4` attribution — none of which editorial_ref
# scanning covers, and each hiding in a different file (checks/ source, module
# docstrings, and test docstrings alike). These guards scan every lib AND test
# source so those classes fail the suite instead of shipping. This guard file is
# excluded from its own scan: its comments and regexes legitimately name the
# banned shapes.

_LIB_DIR = _REPO_ROOT / "scripts" / "tools" / "lib" / "article_health"
_SCANNED_SOURCES = sorted(
    p
    for p in (*_LIB_DIR.rglob("*.py"), *Path(__file__).parent.glob("*.py"))
    if p.name != Path(__file__).name
)

# Script-file references anywhere in the source: *.sh / *.mjs (any path), and
# scripts/…*.py (a bare `foo.py` may be prose, but a repo-pathed one is a claim).
_SCRIPT_REF = re.compile(r"(?:[\w./-]+/)?[\w.-]+\.(?:sh|mjs)\b|scripts/[\w./-]+\.py\b")

# Fork-era references the shipped template does not contain:
#   - Step/Stage/Phase N.N sub-numbering (shipped docs use integer stages/phases
#     and section anchors, never a decimal sub-step)
#   - Step/Stage/Phase N #M fork checklist-item numbers
#   - #NNN fork issue-tracker numbers
#   - ROADMAP — the framework template ships no roadmap (docs/ is diagrams/,
#     playbook/, runbook/ only)
_FORK_REF = re.compile(
    r"(?:Step|Stage|Phase) \d+\.\d"
    r"|(?:Step|Stage|Phase) \d+ #\d"
    r"|#\d{3,}"
    r"|\bROADMAP\b"
)


@pytest.mark.parametrize("py", _SCANNED_SOURCES, ids=lambda p: p.name)
def test_sources_reference_no_missing_scripts(py: Path):
    """No lib/test source names a script file that does not exist in the repo."""
    for token in _SCRIPT_REF.findall(py.read_text(encoding="utf-8")):
        assert _resolve(token).exists(), (
            f"{py.name} references missing script '{token}'"
        )


@pytest.mark.parametrize("py", _SCANNED_SOURCES, ids=lambda p: p.name)
def test_sources_carry_no_fork_references(py: Path):
    """No lib/test source carries fork sub-numbering, item/issue numbers, or ROADMAP."""
    hits = _FORK_REF.findall(py.read_text(encoding="utf-8"))
    assert not hits, (
        f"{py.name} carries fork references {hits}; the shipped template uses "
        f"integer stages/phases, §N.N section anchors, and ships no ROADMAP"
    )
