# Carbonia

Open-source, AI-friendly knowledge base for Carbonia.

Knowledge base for **Carbonia**, published at [alusci.github.io](https://alusci.github.io). Built on the
[sekai-kb](https://github.com/wilsonkichoi/sekai-kb) framework: plain Markdown
content under `knowledge/` rendered as a fast, AI-native static site.

> This file is **instance-owned** (`merge=ours` in `.gitattributes`): framework
> upgrades never overwrite it. Edit it freely to describe your instance.

## Quick start

```sh
npm ci --force && uv sync   # install the site + the editorial tooling
npm run dev                 # http://localhost:4321
npm run build               # production build + contract checks
```

Requires Node.js ≥ 22.13 and [uv](https://docs.astral.sh/uv/) (which fetches
Python ≥ 3.12 for the editorial tooling).

## Where things live

- **`place.config.ts`** — this instance's identity (name, categories, map, links,
  home-page copy). The one file to edit to re-place the site.
- **`knowledge/{Category}/*.md`** — the content, and the single source of truth.
  Everything the site renders is derived from it at build time.
- **`docs/playbook/`** — the editorial canon (voice, structure, the quality bar).
- **`public/media/`** — images and other assets.

## Contributing

Content lives in `knowledge/`; never edit the derived, gitignored `src/content/`.
Run `npm run build` before pushing — CI runs the same gates. Framework internals
(`src/`, `scripts/`) come from [sekai-kb](https://github.com/wilsonkichoi/sekai-kb);
customize through config and content, and send framework changes upstream there.
