---
name: sekai-write
description: |
  Write or rewrite a knowledge/ article via the canonical REWRITE-PIPELINE.
  Handles both new articles and rewrites (one skill, one pipeline). Thin shell:
  loads place identity and the editorial bar from config + the playbook, reads
  the pipeline, and executes its stages.
  TRIGGER when: user says "write X", "rewrite X", "/sekai-write", "new article",
  "rewrite article", or asks to write or improve any knowledge/ article.
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - WebFetch
  - WebSearch
---

# /sekai-write — Write / Rewrite an article (thin shell)

> **Intentionally thin.** Every stage, gate, and editorial standard lives in the
> pipeline and playbook canon. This skill only loads context and runs the
> pipeline — it does not restate or fork pipeline content (drift = decay). The
> SSOT is `knowledge/`; never write the derived `src/content/`.

## 1. Load place context

Read `place.config.ts` for `place.name` and the `categories` list (each
category's `title` — the `knowledge/` folder name — and `slug`). Then read, in
full (no `limit` / `offset`):

- `docs/playbook/ARTICLE-PLAYBOOK.md` — voice, structure, and the quality bar.
- `docs/playbook/REWRITE-PIPELINE.md` — the process you execute (Stages 0–5).

## 2. Execute the pipeline

Follow REWRITE-PIPELINE Stages 0–5 as written. No skipping, no reordering, no
adding stages.

- Stage 3 (fact-check) escalates to `/sekai-factcheck` for contested claims or a
  post-ship audit; a quick self-audit is inline.
- The mandatory ship gate is Stage 4's `--profile=ci-deploy` (blocks on HARD).
  `--profile=rewrite-stage-4` is the media-complete self-check for a depth
  article with supplied images — run it in addition, never instead, and never
  fabricate images to clear it.

Write only to `knowledge/{Category}/{slug}.md` — `{Category}` is a folder name
from `place.config.ts`; `{slug}` is the article's own lowercase filename slug.
Stage 5 syncs, builds, and commits the `knowledge/` file.
