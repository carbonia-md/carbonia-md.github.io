#!/usr/bin/env bash
# sync.sh — knowledge/ SSOT → src/content/ projection layer
#
# Design:
#   - SSOT: enabled languages from place.config.ts
#   - en (default): knowledge/{Category}/ → src/content/en/{category-slug}/
#   - Other langs:  knowledge/{lang}/{Category}/ → src/content/{lang}/{category-slug}/
#   - Root files:   knowledge/*.md (en) / knowledge/{lang}/*.md → src/content/{lang}/*.md
#   - Idempotent: rm -rf all enabled lang dirs then rebuild
#
# Usage: bash scripts/core/sync.sh

set -euo pipefail
unset CDPATH

readonly REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

# Read enabled languages from place.config.ts
ENABLED_LANGS=$(node -e "
  import('./place.config.ts')
    .then(m => console.log((m.default.place.languages || ['en']).join(' ')))
    .catch(e => { console.error(e.message); process.exit(1); });
" 2>&1) || {
  echo "Cannot read languages from place.config.ts" >&2
  echo "  Error: $ENABLED_LANGS" >&2
  exit 2
}

if [ -z "$ENABLED_LANGS" ]; then
  echo "place.config.ts languages array is empty" >&2
  exit 2
fi

# Read category titles from place.config.ts (used as knowledge/ folder names)
CATEGORIES=$(node -e "
  import('./place.config.ts')
    .then(m => console.log(m.default.categories.map(c => c.title).join('\n')))
    .catch(e => { console.error(e.message); process.exit(1); });
" 2>&1) || {
  echo "Cannot read categories from place.config.ts" >&2
  echo "  Error: $CATEGORIES" >&2
  exit 2
}

# Read category slugs (parallel array to titles)
CATEGORY_SLUGS=$(node -e "
  import('./place.config.ts')
    .then(m => console.log(m.default.categories.map(c => c.slug).join('\n')))
    .catch(e => { console.error(e.message); process.exit(1); });
" 2>&1) || {
  echo "Cannot read category slugs from place.config.ts" >&2
  exit 2
}

# Build parallel arrays (bash 3.2 compatible — no mapfile)
CAT_TITLES=()
while IFS= read -r line; do
  [ -n "$line" ] && CAT_TITLES+=("$line")
done <<< "$CATEGORIES"

CAT_SLUGS=()
while IFS= read -r line; do
  [ -n "$line" ] && CAT_SLUGS+=("$line")
done <<< "$CATEGORY_SLUGS"

echo "sync: knowledge/ -> src/content/"
echo "  languages: $ENABLED_LANGS"
echo "  categories: ${#CAT_TITLES[@]}"
echo ""

# Phase 1: Clean
for lang in $ENABLED_LANGS; do
  if [ -d "src/content/$lang" ]; then
    rm -rf "src/content/$lang"
  fi
done

# Phase 2: Sync
SYNCED_TOTAL=0

sync_lang() {
  local lang="$1"
  local src_root dst_root count=0

  if [ "$lang" = "en" ]; then
    src_root="knowledge"
  else
    src_root="knowledge/$lang"
  fi
  dst_root="src/content/$lang"

  if [ ! -d "$src_root" ]; then
    echo "  $lang: SKIP (no $src_root/)"
    return
  fi

  # Category subdirs
  local i=0
  while [ $i -lt ${#CAT_TITLES[@]} ]; do
    local title="${CAT_TITLES[$i]}"
    local slug="${CAT_SLUGS[$i]}"
    local src_dir="$src_root/$title"
    i=$((i + 1))

    [ ! -d "$src_dir" ] && continue

    local dst_dir="$dst_root/$slug"
    mkdir -p "$dst_dir"

    for file in "$src_dir"/*.md; do
      [ ! -f "$file" ] && continue
      cp "$file" "$dst_dir/$(basename "$file")"
      count=$((count + 1))
    done
  done

  # Root-level .md files. The skip set is the workflow queues — they live in
  # knowledge/ because a human edits them, but they are not articles: projecting
  # one into src/content/{lang}/ hands the collection a file with no title,
  # description, date, or category, and articleSchema (src/content.config.ts)
  # rejects it, so `astro build` fails. Add any future root-level workflow doc here.
  for file in "$src_root"/*.md; do
    [ ! -f "$file" ] && continue
    case "$(basename "$file")" in INBOX.md | SNIPPET-INBOX.md) continue ;; esac
    mkdir -p "$dst_root"
    cp "$file" "$dst_root/$(basename "$file")"
    count=$((count + 1))
  done

  SYNCED_TOTAL=$((SYNCED_TOTAL + count))
  printf "  %-6s %4d files\n" "$lang" "$count"
}

for lang in $ENABLED_LANGS; do
  sync_lang "$lang"
done

echo ""
echo "sync complete: $SYNCED_TOTAL files projected"
