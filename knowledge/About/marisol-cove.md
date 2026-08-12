---
title: 'About Marisol Cove'
description: 'What this knowledge base is, why the town it describes is fictional, and how the sekai-kb demo place works.'
date: 2026-07-11
category: 'About'
tags: ['about', 'meta', 'demo']
author: 'Marisol Cove'
featured: false
lastVerified: 2026-07-11
lastHumanReview: false
source:
  - https://github.com/wilsonkichoi/sekai-kb
---

Marisol Cove is a small, fictional coastal town, and this knowledge base is its demo. It ships with **sekai-kb**, an open-source template for building place knowledge bases: fast, static, and readable by both people and AI agents.

> **At a glance:** Every place name here is a placeholder — when you adopt the template, `npm run init` rewrites `place.config.ts` and your own articles under `knowledge/` replace the entire demo corpus.

## Why a fictional place

The town, its wharf, its cafe, and its kelp preserve are invented. That is deliberate. A demo built on a real place would owe real-place accuracy forever; a fictional one lets the template stay a template. Every article here exists to show the shape of a good entry, not to be correct about anywhere in particular.

If you are reading this on a live site, someone has either kept the demo as-is or is about to replace it. To make it your own, run `npm run init` (or the `/sekai-adopt` skill) and point it at a real place: the wizard rewrites `place.config.ts`, and your content goes under `knowledge/`.

## How it is organized

Content lives as plain Markdown under `knowledge/`, one folder per category. That directory is the single source of truth; everything the site renders is derived from it at build time. The demo covers five categories:

- **[[founding-of-marisol-cove|History]]** — how the cove became a town.
- **[[lantern-cove-beach|Beaches]]** — the coves and tide pools.
- **[[kelp-forest-preserve|Nature]]** — the marine preserve offshore.
- **[[summit-ridge-trail|Trails]]** — the ridge above the cove.
- **[[the-harborlight-cafe|Food]]** — the landmark on the pier.

## Sourced and open

Every article carries footnotes and a verification date, even here in the demo, because that discipline is the point of the format. The sources in the demo articles are placeholders; a real instance links to real evidence. All content and code are public.
