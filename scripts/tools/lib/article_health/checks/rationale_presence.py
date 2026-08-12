"""rationale_presence — check that frontmatter rationale block has 4 required keys present.

Per docs/playbook/ARTICLE-PLAYBOOK.md §4.9 Rationale Block:
  - rationale must contain 4 required keys: why_this_hook / whats_excluded /
    where_it_hedges / whos_pushing_back
  - which_framing is optional (5th key)
  - Plugin only checks key PRESENCE (existence + non-empty + not placeholder),
    NOT content depth — brief fill is OK, no depth enforcement

Strict vs advisory category split:
  Strict categories (supplied per instance via the `strict_categories` option)
    -> missing rationale is WARN (the release-pr profile, fail_on=warn, escalates
    it to a ship blocker).
  All other categories -> missing rationale is INFO (dashboard awareness only,
    never blocks ship).
  Categories in the `skip_categories` option are exempt from the rationale check
    entirely (e.g. meta/site pages). Both option lists resolve to place.config
    categories and default to empty, so no category name is baked into the check.

Severity model:
  - HARD: rationale key name typo (e.g. `why_hook` instead of `why_this_hook`)
    — applies to any category, structural integrity issue
  - WARN: strict category missing rationale block / required key / empty value
    — release-pr profile (fail_on=warn) escalates to ship blocker
  - INFO: advisory category missing rationale — dashboard awareness only,
    never blocks ship

Auto-fix:
  None — rationale content is a thinking artifact, should not be auto-generated.
"""

from __future__ import annotations

from typing import Any, Iterator

from ..types import FileTarget, Severity, Violation


CHECK_NAME = "rationale-presence"
DIMENSION = "rationale"
DEFAULT_SEVERITY = Severity.WARN
EDITORIAL_REF = "docs/playbook/ARTICLE-PLAYBOOK.md §4.9 Rationale Block"


REQUIRED_KEYS = [
    "why_this_hook",
    "whats_excluded",
    "where_it_hedges",
    "whos_pushing_back",
]

OPTIONAL_KEYS = [
    "which_framing",
]

ALL_KNOWN_KEYS = set(REQUIRED_KEYS + OPTIONAL_KEYS)

# Strict / skip category sets are supplied per instance via check options (see
# article-health.config.toml [checks.rationale-presence.options]). They resolve
# to place.config categories and default to empty, so this framework check bakes
# in no category names.
DEFAULT_STRICT_CATEGORIES: list[str] = []
DEFAULT_SKIP_CATEGORIES: list[str] = []

# Placeholder values that count as "empty" / unfilled.
EMPTY_MARKERS = {"", "[TODO]", "TODO", "todo", "TBD", "tbd"}


def check(target: FileTarget, config: dict[str, Any]) -> Iterator[Violation]:
    strict = set(config.get("strict_categories", DEFAULT_STRICT_CATEGORIES))
    skip = set(config.get("skip_categories", DEFAULT_SKIP_CATEGORIES))
    if target.category in skip:
        return

    rationale = target.frontmatter.get("rationale")
    missing_sev = Severity.WARN if target.category in strict else Severity.INFO

    # Case 1: No rationale block at all
    if rationale is None:
        yield Violation(
            check=CHECK_NAME,
            severity=missing_sev,
            message=(
                f"frontmatter missing `rationale:` block — "
                f"add the 4 required keys ({' / '.join(REQUIRED_KEYS)}). A brief one-liner per key is fine."
            ),
            line=1,
            fix_suggestion=(
                "rationale:\n"
                "  why_this_hook: '...'\n"
                "  whats_excluded: '...'\n"
                "  where_it_hedges: '...'\n"
                "  whos_pushing_back: '...'\n"
                "  which_framing: '...'  # optional"
            ),
            editorial_ref=EDITORIAL_REF,
        )
        return

    # Case 2: rationale exists but is not a mapping (malformed YAML)
    if not isinstance(rationale, dict):
        yield Violation(
            check=CHECK_NAME,
            severity=Severity.HARD,
            message="frontmatter `rationale` must be a YAML mapping (nested keys)",
            line=1,
            fix_suggestion="Use `rationale:` with the 4 nested keys",
            editorial_ref=EDITORIAL_REF,
        )
        return

    # Case 3: Check each required key is present and non-empty
    for key in REQUIRED_KEYS:
        if key not in rationale:
            yield Violation(
                check=CHECK_NAME,
                severity=missing_sev,
                message=f"rationale missing required key `{key}` (a brief one-liner is fine)",
                line=1,
                fix_suggestion=f"Add `{key}: '...'`",
                editorial_ref=EDITORIAL_REF,
            )
            continue

        value = rationale.get(key)
        # Treat None / empty string / placeholder markers as unfilled
        value_str = "" if value is None else str(value).strip()
        if value_str in EMPTY_MARKERS:
            yield Violation(
                check=CHECK_NAME,
                severity=missing_sev,
                message=f"rationale `{key}` is empty or a placeholder (a brief one-liner is fine, but not empty)",
                line=1,
                fix_suggestion=f"Fill `{key}` with a one-line description",
                editorial_ref=EDITORIAL_REF,
            )

    # Case 4: Check for typo'd / unknown keys (HARD — structural integrity)
    # Underscore-prefixed sister keys (e.g. _rationale_meta) are allowed.
    for key in rationale.keys():
        if key in ALL_KNOWN_KEYS:
            continue
        if isinstance(key, str) and key.startswith("_"):
            continue
        yield Violation(
            check=CHECK_NAME,
            severity=Severity.HARD,
            message=(
                f"rationale key `{key}` is not a canonical name — typo?"
                f" canonical keys: {', '.join(REQUIRED_KEYS + OPTIONAL_KEYS)}"
            ),
            line=1,
            fix_suggestion=f"Check spelling, or prefix with underscore `_{key}` to mark it as a sister key",
            editorial_ref=EDITORIAL_REF,
        )
