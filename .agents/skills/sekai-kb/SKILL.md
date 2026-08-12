---
name: sekai-kb
description: |
  Top-level router for this knowledge base. Lists the available skills (with
  their triggers) so you can pick the right one for a fuzzy request, and reports
  organ vitals when the semiont layer is configured. Routes only — it never runs
  a pipeline.
  TRIGGER when: user says "kb", "/sekai-kb", "what can I do", "which skill", "help me
  pick", or has a fuzzy request and needs routing to the right skill.
allowed-tools:
  - Bash
  - Read
  - Glob
---

# /sekai-kb — Skill router (route only)

> This skill **routes**; it does not run anything. The work lives in the other
> skills — point at the best fit, do not restate its steps.

## 1. (Optional) organ vitals

The autonomous-organ layer (memory, routines) is configured by
`semiont/config.json`, which arrives in a later framework release and is absent
in this one. Probe it best-effort and no-op silently when absent:

```bash
[ -f semiont/config.json ] && echo "semiont: configured" || true
```

No output when the file is absent is correct — it is not a gate.

## 2. List the available skills

Enumerate from the directory so adopter-added skills appear automatically (do
not hardcode a list):

```bash
for d in .agents/skills/*/SKILL.md; do
  name=$(grep -m1 '^name:' "$d" | sed 's/name:[[:space:]]*//')
  trig=$(grep -m1 'TRIGGER when' "$d" | sed 's/^[[:space:]]*//')
  printf '• /%-13s %s\n' "$name" "$trig"
done
```

## 3. Recommend, don't run

Name the single best-fit skill for what the user asked, in one line. If the
intent is genuinely ambiguous, list the 2–3 candidates and ask. Never invoke a
pipeline from here.
