---
name: sekai-write
description: |
  Write, rewrite, or translate a knowledge/ article via the canonical
  REWRITE-PIPELINE. Handles new articles, rewrites, and translations into
  another enabled language (one skill, one pipeline, three modes). Thin
  shell: loads place identity and the editorial bar from config + the
  playbook, reads the pipeline, and executes its stages.
  TRIGGER when: user says "write X", "rewrite X", "/sekai-write", "new article",
  "rewrite article", "translate X into {language}", "translate X to {language}",
  or asks to write, improve, or translate any knowledge/ article.
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

Read `place.config.ts` for `place.name`, the `categories` list (each
category's `title` — the `knowledge/` folder name — and `slug`), and
`place.languages` (the enabled language codes; the first is the default,
unprefixed language — translation targets must be one of the others). Then
read, in full (no `limit` / `offset`):

- `docs/playbook/ARTICLE-PLAYBOOK.md` — voice, structure, and the quality bar.
- `docs/playbook/REWRITE-PIPELINE.md` — the process you execute (Stages 0–5,
  including its translation-mode branches).

## 2. Execute the pipeline

Follow REWRITE-PIPELINE Stages 0–5 as written. No skipping, no reordering, no
adding stages — translation mode is one of the three modes Stage 0 asks
about, not a different pipeline.

- Stage 0 sets the mode: new, rewrite, or translation. A translation request
  names a target language that must be in `place.languages`; if it isn't,
  say so rather than writing to an unconfigured language tree.
- Stage 3 (fact-check) escalates to `/sekai-factcheck` for contested claims,
  a post-ship audit, **or any translation** (Translation Fidelity mode); a
  quick self-audit is inline for the rest.
- The mandatory ship gate is Stage 4's `--profile=ci-deploy` (blocks on HARD).
  `--profile=rewrite-stage-4` is the media-complete self-check for a depth
  article with supplied images — run it in addition, never instead, and never
  fabricate images to clear it.

Write to `knowledge/{Category}/{slug}.md` for new articles and rewrites —
`{Category}` is a folder name from `place.config.ts`; `{slug}` is the
article's own lowercase filename slug. **Translation mode writes to
`knowledge/{lang}/{Category}/{slug}.md` instead** — the same `{Category}`
and `{slug}` as the source article, only the language-root segment differs;
never translate the category folder name itself (it stays the English
folder name in every language's tree — that's what `scripts/core/sync.sh`
globs on). Stage 5 syncs, builds, and commits the `knowledge/` file.
