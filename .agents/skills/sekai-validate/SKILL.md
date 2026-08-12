---
name: sekai-validate
description: |
  Validate knowledge/ articles for editorial quality, frontmatter correctness,
  and cross-reference integrity. Use when reviewing a PR that touches knowledge/,
  after writing or editing an article, or when asked "is this article good
  enough?". Runs article-health + the frontmatter schema test and reports; a thin
  wrapper over the existing checks, it does not reimplement them.
  TRIGGER when: user says "validate", "/sekai-validate", "check article", "review
  quality", or when editing .md files in knowledge/.
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
---

# /sekai-validate — Validate articles (thin wrapper)

> The quality bar is canonical in `docs/playbook/ARTICLE-PLAYBOOK.md` §7 — read
> it before judging prose. This skill runs the existing checks and reports; it
> does not restate the rubric. The SSOT is `knowledge/`; never validate the
> derived `src/content/`.

## 1. Frontmatter schema (whole repo)

```bash
npm run test
```

Checks required fields (title, description, date, tags), date format,
tags-is-array, duplicate slugs, and file naming across all of `knowledge/`.

## 2. Article health (prose + structure + links)

Per file while writing:

```bash
npm run article-health -- knowledge/{Category}/{slug}.md --profile=ci-deploy
```

Whole corpus (PR review / baseline) — the exact gate CI enforces:

```bash
npm run article-health -- --all --profile=ci-deploy
```

`ci-deploy` runs every plugin (prose-health, frontmatter-format,
frontmatter-title, wikilink-target, link-target, cross-reference, word-count, …)
and blocks on HARD violations only. Use `--list-checks` to see the active
plugins and `--check <name>` to run just one.

## 3. Report

Summarize which checks passed or failed and every HARD violation, quoting the
exact failing output — never paraphrase or paper over a failure. For a single
article, end with a go / needs-work call against the ARTICLE-PLAYBOOK §7 bar:
a concrete (named-person or scene) opening, a counter-intuitive insight in the
description, specific dates and numbers, cited sources, and resolving cross-links.
