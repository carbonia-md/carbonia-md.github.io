"""Locale-awareness of article-health (PROGRESS.md M6, D4).

The default language lives at knowledge/{Category}/ and every other enabled
language at knowledge/{lang}/{Category}/. Checks that match language-specific
text pick a vocab table by `FileTarget.lang` (lib/article_health/vocab.py) and
fall back to English. These tests use the committed place.config.ts, which
enables `it`.
"""

import importlib.util
from pathlib import Path

from lib.article_health import vocab
from lib.article_health.checks import (
    chronicle_lead,
    format_structure,
    image_health,
    paragraph_rhythm,
    word_count,
)
from lib.article_health.loader import is_article_path, load_target

_REPO_ROOT = Path(__file__).resolve().parents[2]


def _write(tmp_path: Path, lang: str, body: str, extra: str = "") -> Path:
    root = tmp_path / "knowledge" / (f"{lang}/" if lang != "en" else "") / "Nature"
    root.mkdir(parents=True, exist_ok=True)
    f = root / "x.md"
    f.write_text(f"---\ntitle: x\ndescription: y\n{extra}---\n\n{body}\n", encoding="utf-8")
    return f


# ── loader ───────────────────────────────────────────────────────────────────


def test_loader_derives_lang_category_slug_for_nested_language(tmp_path):
    t = load_target(_write(tmp_path, "it", "corpo"))
    assert (t.lang, t.category, t.slug) == ("it", "Nature", "x")


def test_loader_default_language_is_unnested(tmp_path):
    t = load_target(_write(tmp_path, "en", "body"))
    assert (t.lang, t.category, t.slug) == ("en", "Nature", "x")


def test_is_article_path_accepts_nested_language_tree():
    assert is_article_path("knowledge/it/History/founding.md")
    assert not is_article_path("knowledge/it/INBOX.md")


# ── vocab ────────────────────────────────────────────────────────────────────


def test_vocab_unknown_language_falls_back_to_english():
    assert vocab.heading("xx", "references") == "References"
    assert vocab.normalize_words("xx", 100) == 100


def test_word_regex_keeps_accented_words_whole():
    assert vocab.WORD_RE.findall("la città è più antica") == ["la", "città", "è", "più", "antica"]
    # the English contract is unchanged
    assert vocab.WORD_RE.findall("it's a well-known fact") == ["it's", "a", "well-known", "fact"]


def test_normalize_words_scales_by_language_factor():
    assert vocab.normalize_words("it", 1100) == 1000


# ── format_structure ─────────────────────────────────────────────────────────

_IT_BODY = (
    "> **In breve:** tesi dell'articolo\n\n## Apertura\n\nTesto[^1].\n\n"
    "## Riferimenti\n\n[^1]: fonte\n\n## Per Saperne di Più\n\n- [[altro]]\n"
)


def test_format_structure_accepts_italian_headings(tmp_path):
    t = load_target(_write(tmp_path, "it", _IT_BODY + "x " * 800))
    assert list(format_structure.check(t, {})) == []


def test_format_structure_flags_missing_italian_overview_in_italian(tmp_path):
    t = load_target(_write(tmp_path, "it", "## Apertura\n\nTesto.\n"))
    msgs = [v.message for v in format_structure.check(t, {})]
    assert any("In breve" in m for m in msgs)
    assert not any("At a glance" in m for m in msgs)


def test_format_structure_english_heading_does_not_satisfy_italian(tmp_path):
    t = load_target(_write(tmp_path, "it", "> **At a glance:** x\n\n## Body\n\nText.\n"))
    assert any("In breve" in v.message for v in format_structure.check(t, {}))


# ── image_health ─────────────────────────────────────────────────────────────


def test_image_health_accepts_italian_image_sources_heading(tmp_path):
    body = "> **In breve:** x\n\n## Fonti delle Immagini\n\n- foto\n"
    t = load_target(_write(tmp_path, "it", body, extra="imageCredit: someone\n"))
    assert not any("Image Sources" in v.message for v in image_health.check(t, {}))


def test_image_health_missing_italian_image_sources_still_warns(tmp_path):
    t = load_target(_write(tmp_path, "it", "> **In breve:** x\n", extra="imageCredit: someone\n"))
    assert any("Image Sources" in v.message for v in image_health.check(t, {}))


# ── chronicle_lead ───────────────────────────────────────────────────────────


def test_chronicle_lead_flags_italian_month_year_heading(tmp_path):
    t = load_target(_write(tmp_path, "it", "## Maggio 2016: l'incendio\n\nTesto.\n"))
    assert any("Chronicle-style" in v.message for v in chronicle_lead.check(t, {}))


def test_chronicle_lead_english_month_is_not_a_violation_in_italian(tmp_path):
    t = load_target(_write(tmp_path, "it", "## May 2016 notes\n\nTesto.\n"))
    assert list(chronicle_lead.check(t, {})) == []


# ── length thresholds ────────────────────────────────────────────────────────


def test_word_count_counts_accents_and_normalizes(tmp_path):
    body = "città " * 275  # 275 raw words = 250 English-equivalent at 1.1x
    t = load_target(_write(tmp_path, "it", body))
    info = next(v for v in word_count.check(t, {}) if "Word count" in v.message)
    assert "250 words" in info.message


def test_paragraph_wall_uses_normalized_words(tmp_path):
    # 190 raw Italian words = 173 English-equivalent: under the 180-word wall.
    # (12 filler sections keep the article above the 800-word depth gate, so the
    # negative assertion is not vacuous.)
    para = "parola " * 190
    filler = "\n\n".join(f"## S{i}\n\n" + "parola " * 60 for i in range(12))
    t = load_target(_write(tmp_path, "it", f"## Muro\n\n{para}\n\n{filler}\n"))
    assert not any("wall" in v.message for v in paragraph_rhythm.check(t, {}))
    t_en = load_target(_write(tmp_path / "en_case", "en", f"## Muro\n\n{para}\n\n{filler}\n"))
    assert any("wall" in v.message for v in paragraph_rhythm.check(t_en, {}))


# ── --all discovery ──────────────────────────────────────────────────────────


def test_get_all_source_finds_nested_language_articles(monkeypatch):
    spec = importlib.util.spec_from_file_location(
        "article_health_cli", _REPO_ROOT / "scripts" / "tools" / "article-health.py"
    )
    cli = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cli)
    monkeypatch.chdir(_REPO_ROOT)
    files = {p.as_posix() for p in cli._get_all_source()}
    assert any(f.startswith("knowledge/it/") for f in files)
    assert any(f.count("/") == 2 for f in files)  # default-language articles too
    assert not any(f.startswith("knowledge/it/") and f.count("/") == 2 for f in files)
