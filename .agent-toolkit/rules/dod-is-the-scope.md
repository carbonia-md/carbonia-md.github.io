---
tier: doctrine
---

# The task packet's DoD is the scope: no self-directed deferral

The claimed task's Objective + DoD define done. Every DoD criterion is implemented in
this task, in full, before hand-off.

- Never cite "don't over-engineer", "simplicity", "not urgent", PRD non-goals, §F
  dispositions, or phase boundaries to skip or trim a DoD criterion. Those govern what
  enters a packet (Wilson + /dev:plan decide), never what leaves one mid-execution.
- A missing implementation goal discovered mid-task or in review is fixed in this task.
  It is NOT a "deferred discovery"; Backlog stubs (.agent-toolkit/dev.md) are only for work
  outside the packet's Objective/DoD.
- If a DoD criterion genuinely conflicts with a doc, surface it to Wilson per the
  dev.md conflict rule. Silently trimming scope is a review BLOCKER, same class as
  dead fork code (see clean-rebuild-no-dead-fork-code.md).

**Why:** Opus 4.6 execution sessions repeatedly deferred in-scope work by quoting doc
sections that govern planning ("address in the future", "don't over-engineer"), and
redo passes still dropped goals. Scope decisions are made at plan time; execution
implements the packet as written.
