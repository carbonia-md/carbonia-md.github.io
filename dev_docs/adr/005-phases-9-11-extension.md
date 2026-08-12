# ADR 005: Phases 9-11 extension — MCP delivery, analytics perception, autonomous routines

**Status:** Accepted (2026-07-07, maintainer session decision)
**Deciders:** Wilson Choi, with Fable 5 as architect

> **Moved to sekai-kb (2026-07-28, ADR 008).** Phases 9-11 are framework feature phases
> executed in this repository, so the decision that scheduled them lives here.

## Context

The maintainer audited roadmap coverage of three goal areas: routine pipelines (KB
maintenance, semantic embedding/indexing, PR review, feedback triage, trend discovery,
analytics data refresh, social media), the RAG chatbot, and MCP server / alternative
knowledge delivery. The RAG chatbot (ROADMAP tasks 7.2a-c) and the `/kb/` + llms.txt
lazy-loading protocol (shipped in Phase 1) are covered. The MCP endpoint had only a named
trigger ("port when 7.2c ships") with no phase; the routines had only the Phase-8
ROUTINE-organ *scaffold*; the inherited-fork disposition removes the fork's
16 routines as "delete-now as implementation, concept returns as per-routine opt-ins" —
with zero routines actually scheduled, and the analytics fetchers parked on a
"port-on-trigger: accounts exist" clause nothing was set to fire. The maintainer directed
that these be scheduled, not tabled.

## Decision

Extend the operative docs with **Phases 9 (MCP + AI delivery), 10 (analytics perception),
and 11 (autonomous routines)**. Sub-decisions:

1. **Governance.** `dev_docs/ROADMAP.md` owns milestone rows and detailed task blocks;
   `/dev:plan` converts packets from those blocks. `dev_docs/SPEC.md` and `dev_docs/PRD.md` own
   the corresponding engineering and product contracts. Since ADR 008 those three
   documents live in this repository for the framework's own phases.
2. **Scheduler substrate: hybrid.** Deterministic pipelines (embeddings/index refresh,
   analytics fetch) run as GitHub Actions cron/push-triggers — free, machine-independent,
   adopter-portable. AI routines (maintainer/PR review, feedback triage, trend discovery,
   social publish, rewrite) run as Claude Code native scheduled tasks on the maintainer's
   machine (the proven pattern inherited from the fork). Each routine declares its
   substrate in ROUTINE.md.
3. **Ship mode: PRs, auto-merge for data.** Every routine ships via a PR behind CI;
   data-only PRs (analytics JSON, vectors) carry auto-merge-on-green, content PRs wait
   for human merge. The fork's direct-push-to-main routine model is rejected — the
   dev-plugin iron rule (no work done outside a verified merge) applies to automation.
4. **Analytics: full stack.** GA4 + Google Search Console + Cloudflare Web Analytics
   behind `features.analytics`; Search Console is the only source of query-level SEO data,
   which the trend-discovery routine consumes.
5. **Release-train execution.** Phases 9-11 run post-cut, so every code task executes in
   `sekai-kb`; each phase ships as a tagged release and instances adopt it via
   `/sekai-upgrade` (ADR 004) — the pull is part of each phase's exit gate. Task 9.3
   extends `docs/runbook/UPGRADE.md`, the adopter-facing upgrade playbook, from the first
   real feature-release upgrade (Phase 9 itself, whose `features.mcp` is the first
   post-cut config-schema addition). **Absent-safe rule:** every new `place.config` key
   defaults to feature-off when missing, so instances upgrade without config surgery.
6. **Model policy:** all Phase 9-11 execution uses Opus (2026-07-07); reviews
   follow `.agent-toolkit/dev.md` defaults.

**Technical verification (2026-07):** stateless remote MCP servers (Streamable HTTP, no
Durable Objects) run on the Workers free tier via the `createMcpHandler` pattern —
Cloudflare docs: <https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/>,
<https://blog.cloudflare.com/remote-model-context-protocol-servers-mcp/>. Fits the
no-paid-services constraint; McpAgent/Durable Objects documented as the scale-up path.

## Consequences

- Every inherited-fork "port-on-named-trigger" item in scope now has a scheduled home: MCP → 9.1,
  analytics fetchers → 10.2, embeddings refresh → 11.2, per-routine opt-ins → 11.3-11.8.
- Grand totals grow by AI ≈ 26.75h | Human ≈ 2.5h (ROADMAP totals updated).
- The PRD "no paid services" non-goal is clarified to "no paid hosting/infra services";
  routine AI compute rides the maintainer's existing Claude subscription/API budget.
- Instance operations gain a machine dependency for claude-cron routines (an always-on
  machine); the GitHub Actions substrate keeps the deterministic half portable for
  adopters, and any adopter can run zero routines (organ off = nothing fires).
- `.agent-toolkit/dev.md` milestones span "Phase 0" … "Phase 11"; `review_action_installed`
  flips at 11.3.
