"""article_health.vocab -- per-language editorial vocabulary (PROGRESS.md D4).

A check that matches language-specific text (a section heading, a month name,
a word) asks this module rather than hard-coding English. Tables are keyed by
`FileTarget.lang`; an unknown code falls back to `en`, so adding a language is a
new row here and nothing else.

Section headings are the ones the article playbook names, as translated by
`/sekai-write`'s translation mode: the English `## Further Reading` is
`## Per Saperne di Più` in Italian, and so on.
"""
from __future__ import annotations

import re

DEFAULT_LANG = "en"

# Section / label names the structure checks look for, per language.
HEADINGS: dict[str, dict[str, tuple[str, ...]]] = {
    "en": {
        "further_reading": ("Further Reading",),
        "references": ("References",),
        "image_sources": ("Image Sources",),
        "at_a_glance": ("At a glance",),
    },
    "it": {
        "further_reading": ("Per Saperne di Più",),
        "references": ("Riferimenti",),
        "image_sources": ("Fonti delle Immagini",),
        "at_a_glance": ("In breve",),
    },
}

# Month names for the chronicle-lead check (full and abbreviated forms).
MONTHS: dict[str, tuple[str, ...]] = {
    "en": (
        "January", "February", "March", "April", "May", "June", "July", "August",
        "September", "October", "November", "December",
        "Jan", "Feb", "Mar", "Apr", "Jun", "Jul", "Aug", "Sep", "Sept", "Oct", "Nov", "Dec",
    ),
    "it": (
        "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio",
        "agosto", "settembre", "ottobre", "novembre", "dicembre",
        "gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic",
    ),
}

# Words, for length thresholds. Covers the Latin-1 Supplement and Latin
# Extended-A/B letters (accented vowels etc.) on top of ASCII; the pre-i18n
# pattern was ASCII-only, which split "città" into "citt" and undercounted.
WORD_RE = re.compile(r"[A-Za-z0-9'À-ɏ-]+")


# How much longer a faithful translation runs than its English source, measured on
# this instance's translated articles (mean 1.095, range 1.08-1.14). Length
# thresholds in the checks (min words, paragraph "wall", media density band) were
# tuned on English prose, so they compare `normalize_words()` -- the count divided
# by this factor -- not the raw count; otherwise a faithful translation crosses
# a threshold its source did not. Unknown languages fall back to 1.0.
WORD_EXPANSION: dict[str, float] = {"en": 1.0, "it": 1.1}


def normalize_words(lang: str, count: int) -> int:
    """English-equivalent word count of `count` words of `lang` prose."""
    return round(count / WORD_EXPANSION.get(lang, 1.0))


def _row(table: dict, lang: str):
    return table.get(lang) or table[DEFAULT_LANG]


def heading(lang: str, key: str) -> str:
    """Primary name of section `key` in `lang` (for violation messages)."""
    return _row(HEADINGS, lang)[key][0]


def heading_alternation(lang: str, key: str) -> str:
    """Regex alternation of the accepted names for section `key` in `lang`."""
    return "|".join(re.escape(h) for h in _row(HEADINGS, lang)[key])


def months_alternation(lang: str) -> str:
    return "|".join(re.escape(m) for m in _row(MONTHS, lang))
