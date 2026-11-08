---
name: sekai-factcheck
description: |
  Fact-check a knowledge/ article via the canonical FACTCHECK-PIPELINE. Audits
  claims against their sources and the knowledge/ ground truth. Quick mode during
  rewrites; Full mode for post-ship audits or reader challenges; Translation
  Fidelity mode when the target is a translation (checks it against its source
  article, not against primary sources).
  TRIGGER when: user says "factcheck", "fact-check", "/sekai-factcheck",
  "hallucination audit", "verify claims", "check sources", "check the
  translation"; when a rewrite reaches REWRITE-PIPELINE Stage 3; or when
  `/sekai-write`'s translation mode reaches its own Stage 3.
allowed-tools:
  - Bash
  - Read
  - Grep
  - WebFetch
  - WebSearch
---

# /sekai-factcheck — Fact-check an article (thin shell)

> **Intentionally thin.** Every phase, gate, and method lives in the pipeline
> canon. This skill loads context and runs it — it does not restate or fork
> pipeline content (drift = decay). Ground truth for place facts is `knowledge/`.

## 1. Load context

Read `place.config.ts` for `place.name`, then read
`docs/playbook/FACTCHECK-PIPELINE.md` in full (no `limit` / `offset`). The
editorial standard it protects lives in `docs/playbook/ARTICLE-PLAYBOOK.md` §4.6
(citations) and §4.8 (quote fidelity).

## 2. Execute the pipeline

Follow FACTCHECK-PIPELINE Phases 1–6 as written. Mode is set by context:

- **Quick** — during a rewrite (REWRITE-PIPELINE Stage 3) or spot-checking a PR.
- **Full** — a standalone audit, a reader challenge, or a periodic patrol.
- **Translation Fidelity** — the target is a `knowledge/{lang}/...` article
  with a `translatedFrom` frontmatter field (or you're checking one as part of
  `/sekai-write`'s translation mode). Read the source article too — Phase T
  replaces Phase 3/4 for this mode; Phases 1, 2, 5, 6 still run, against the
  article pair rather than primary sources.

## 3. Report

Report findings per Phase 6 triage (PASS / SOFT-FIX / HARD-FIX / DEAD-LINK /
TRANSLATION-DRIFT). Fix every HARD-FIX, DEAD-LINK, and TRANSLATION-DRIFT in
`knowledge/` (the SSOT) and `npm run sync` before anything ships.
