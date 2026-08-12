---
name: sekai-adopt
description: |
  Turn a fresh sekai-kb template clone into your own place. The PRIMARY adopter
  path: interviews you about your place (name, tagline, domain, map center,
  locale, categories, and any material you already have), writes an auditable
  answers file, runs the init wizard to generate place.config.ts + seed the
  instance, offers /sekai-seed-articles, and walks deploy from the runbook. Never
  writes place.config.ts directly — the wizard is the single writer.
  TRIGGER when: user says "adopt", "/sekai-adopt", "make this my place", "set up my
  instance", "onboard", "adopt the template", or is starting a fresh sekai-kb
  clone and wants to configure it.
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
---

# /sekai-adopt — Bootstrap a sekai-kb instance

Interview → answers file → `npm run init` → offer `/sekai-seed-articles` → deploy
walkthrough. This skill orchestrates; it does **not** restate the wizard's
validation or the runbook's commands (drift = decay). The single writer of
place identity is the init wizard: `/sekai-adopt` only produces the answers it
consumes.

## 0. Preflight

Run these from the repo root:

```bash
test -f .sekai-template && echo "template: fresh (ok to adopt)" || echo "template: already adopted"
node --version
```

- **`.sekai-template` present** → a pristine template; proceed.
- **Absent** → this clone was already adopted (init removed the marker). Stop
  and tell the user: re-running adoption reseeds `knowledge/` with empty
  category folders and overwrites `place.config.ts`. Only continue if they
  explicitly confirm, and pass `--force` to the wizard in step 4.

**Install dependencies before anything else.** A fresh template clone has no
`node_modules`, so `npm run init` and `npm run build` (step 4) fail with
`run-p: command not found`. Install both toolchains from the repo root now:

```bash
npm ci --force && uv sync
```

Both must succeed before you continue. If either fails (e.g. `uv` or Node not
installed), **hard-stop** and give the user the exact missing prerequisite and
command — do not proceed to the interview only to hit the failure at build. The
prerequisites and version floor are in `docs/runbook/DEPLOY.md` (Node ≥ 22.13,
`uv`, `gh`).

Then read `scripts/init/README.md` — it is the SSOT for the answers-JSON schema,
per-field validation, and defaults. Do not duplicate its rules here; follow it
when a value is questioned.

## 1. Interview

Ask the questions below one topic at a time, conversationally. Each answer maps
1:1 to a wizard prompt (the answers-JSON dot-path is in parentheses). Offer the
default in brackets; an empty answer takes it.

1. **Place name** (`place.name`, required) — the site wordmark.
2. **Tagline** (`place.tagline`) — one sentence. [default: derived from name]
3. **Domain** (`place.domain`) — a custom domain writes `CNAME`; a `*.github.io`
   domain skips it. [default: `<name-slug>.github.io`]
4. **Locale** (`place.locale`) — BCP-47 code. `en` is the supported baseline;
   note the language boundary (CJK content is unsupported — see the playbook
   §Language Support Boundary) if they ask for anything else. [default: `en`]
5. **Categories** (`categories`) — offer the three presets first
   (`coastal-town`, `city`, `small-town`) by reading their titles from
   `scripts/init/prompt-table.mjs` (`CATEGORY_PRESETS`); or collect a custom set
   (5–14, kebab-case slugs, each with title/icon/description). Reserved route
   slugs are rejected by the wizard.
6. **Map center** (`map.center`, required) — see step 2 (geocode suggestion).
7. **Map zoom** (`map.zoom`) — integer 1–19. [default: 13]
8. **Map max bounds** (`map.maxBounds`) — pan limits. [default: center ± ~0.05°/
   0.07°, which the wizard computes; accept the default unless they have exact
   bounds]
9. **Features** (`features.*`) — one yes/no each: `graph`, `map`, `dashboard`
   default on; `soundscape`, `feedback`, `chat`, `social`, `analytics` default
   off. Note which off-by-default features need later wiring (feedback/chat need
   a worker; soundscape needs audio assets).
10. **Links** (`links.*`) — `repo` (instance GitHub URL), `email`, and optional
    `social.twitter` / `social.threads` / `social.instagram` handles.
11. **Existing material** — ask what they already have written about their place
    (URLs, notes, docs, prior wiki text). This is **not** a wizard field; keep
    it for step 7 (`/sekai-seed-articles` grounds its drafts in it). Summarize back
    what you collected so it survives into that step.

## 2. Map center — geocode from knowledge, then confirm

There is **no geocoding API dependency**. Suggest the center from your own
knowledge of the place, then require confirmation:

> "For _<place>_ I believe the map center is approximately `lat, lng`. Confirm,
> or give me the exact coordinates."

Never write an unconfirmed guess into `map.center`. If you are not confident of
the place, say so and ask the user for the coordinates outright.

## 3. Assemble and show the answers file (approval point)

Build the answers JSON from the interview. Include only keys the user set or
confirmed; omitted non-required keys take the wizard's documented defaults.
Write it to an **auditable artifact** at the repo root:

```bash
cat > adopt-answers.json <<'JSON'
{ ...the assembled answers... }
JSON
```

Then show the file to the user and get explicit confirmation before running
anything: this is the last checkpoint before `place.config.ts` and `knowledge/`
are rewritten. The file is a plain record of exactly what will be written —
tell the user it is disposable (delete it or keep it as an adoption record; the
build does not need it).

## 4. Run the wizard (the single writer)

```bash
npm run init -- --answers adopt-answers.json
```

(Add `--force` only if step 0 established this is an already-adopted clone the
user chose to re-init.) The wizard writes `place.config.ts`, seeds
`knowledge/{Category}/` + `INBOX.md`, writes/clears `CNAME`, the `AGENTS.md`
agent-instruction SSOT + its `CLAUDE.md` `@AGENTS.md` shim, `FRAMEWORK-VERSION`,
and the instance-owned genericity denylist, and removes the `.sekai-template`
marker. Report each action it prints.

An unknown key or malformed value makes the wizard exit non-zero and write
nothing — fix the offending value in `adopt-answers.json` and re-run; never
hand-edit `place.config.ts` to patch around it (that breaks the single-writer
guarantee and drifts from the answers record).

Confirm the instance builds with the new config:

```bash
npm run build
```

Green build = the site now renders as the user's place (with empty categories
until step 7).

## 5. Optional: place-specific home-page copy (behind approval)

The wizard ships **generic** `home.*` defaults. Offer to draft place-specific
home copy (hero heading, subheading, intro) grounded in the interview and any
material from step 1. If the user accepts:

- Draft the copy following the playbook's voice rules
  (`docs/playbook/ARTICLE-PLAYBOOK.md` §6 — specific over generic, no
  travel-brochure tells).
- Show the exact `home.*` edit and get explicit approval **before** touching the
  file. This is the one place `/sekai-adopt` edits `place.config.ts` directly, and it
  is sanctioned only because `home.*` is instance-owned copy, edited after init,
  behind the same human-approval gate as `/sekai-seed-articles`.
- On approval, edit `home.*` in `place.config.ts`, then re-run `npm run build`.

If the user declines, leave the generic defaults — they are editable by hand
anytime.

## 6. Offer /sekai-seed-articles

Offer to run `/sekai-seed-articles` now to draft the first articles. If the user
accepts, hand off the material collected in step 1 (it is already in this
session's context) and invoke the skill. If they decline, point them at
`knowledge/INBOX.md` and `docs/playbook/ARTICLE-PLAYBOOK.md` for writing on
their own.

## 7. Deploy walkthrough (link the runbook, don't duplicate it)

Walk the user through going live using `docs/runbook/DEPLOY.md`. Reference its
sections rather than pasting command text (the runbook is the SSOT and stays
current):

- **Prerequisites** + **Install** — Node ≥ 22.13, `uv`, `gh`; `npm ci --force`,
  `uv sync`.
- **GitHub Pages** — enable Pages (Source: GitHub Actions), then push `main`.
- **Custom domain (Cloudflare DNS)** — only if they set a custom `place.domain`;
  the wizard already wrote `CNAME`, and the runbook covers the DNS records and
  HTTPS enforcement.
- **CI** — the deploy workflow builds every PR and publishes on push to `main`.

Read the relevant sections aloud from the runbook and confirm the user can
follow each command; do not re-derive the steps from memory.

## Done

Report what was written (from the wizard output), whether the build is green,
whether home copy was drafted, whether `/sekai-seed-articles` ran, and the deploy
sections the user still needs to complete.
