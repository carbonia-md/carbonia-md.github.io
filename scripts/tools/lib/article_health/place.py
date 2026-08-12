"""article_health.place — read place identity from place.config.ts.

The article-health tool ships into the sekai-kb framework (Phase 5), so it must
stay place-generic: no instance name may be hardcoded in `scripts/`. Place
identity flows from the repo-root `place.config.ts` (the single ingress, same as
`src/` and the `scripts/core/*.mjs` builders), which this module reads at runtime.

Only the two scalars the checks need are parsed — `place.name` and `place.domain`
— via a narrow regex over the config's first `name:`/`domain:` string literals.
This avoids a TypeScript dependency; the tool is stdlib-only. When the config is
absent (e.g. an isolated unit test), the fields resolve to empty strings and the
place-derived checks (seo-meta brand prefix, frontmatter author default) simply
do not fire.
"""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

_RE_NAME = re.compile(r"\bname:\s*'([^']+)'")
_RE_DOMAIN = re.compile(r"\bdomain:\s*'([^']+)'")


def _find_place_config(start: Path | None = None) -> Path | None:
    base = (start or Path.cwd()).resolve()
    for d in (base, *base.parents):
        candidate = d / "place.config.ts"
        if candidate.exists():
            return candidate
    return None


@lru_cache(maxsize=1)
def _load() -> tuple[str, str]:
    """Return (name, domain) from place.config.ts, or ("", "") if not found."""
    path = _find_place_config()
    if path is None:
        return ("", "")
    text = path.read_text(encoding="utf-8")
    # The first `name:` / `domain:` literals belong to the `place:` block.
    name_m = _RE_NAME.search(text)
    domain_m = _RE_DOMAIN.search(text)
    return (name_m.group(1) if name_m else "", domain_m.group(1) if domain_m else "")


def place_name() -> str:
    """The instance display name, from place.config.ts (empty if unresolved)."""
    return _load()[0]


def brand_author() -> str:
    """Default article author for this instance, `<name>.md` (empty if unresolved).

    Mirrors the convention the site uses for its own byline; empty means the
    frontmatter author-default auto-fix stays inert on an unconfigured checkout.
    """
    name = place_name()
    return f"{name}.md" if name else ""


def brand_prefix_pattern() -> str | None:
    """Anchored regex matching a description that opens with the brand token
    (`<name>.md`), used by seo-meta to flag wasted snippet real estate. Returns
    None when the place name is unresolved so no brand rule is applied.
    """
    name = place_name()
    if not name:
        return None
    return r"^" + re.escape(f"{name}.md") + r"\s*"
