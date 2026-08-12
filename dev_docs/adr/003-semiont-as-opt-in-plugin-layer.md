# ADR 003: Semiont as an opt-in plugin layer

**Status:** Accepted (2026-07-04)
**Deciders:** Wilson Choi, with Fable 5 as architect

> **Moved to sekai-kb (2026-07-28, ADR 008).** This decision governs framework code,
> so it now lives beside that code. It was written before the framework was cut, when
> one repository held both the framework and instance #1; references to "the instance"
> below were originally that first instance.

## Context

The inherited fork's Semiont (AI-organism identity layer) is a monolith: a 753-line
awakening protocol, organs that read each other's files, and site code entangled with
identity machinery. The audit found memory/reflexes/manifesto/routine earn their keep;
the introspection organs are art. The first instance's place is an art town and its
maintainer values the experiment — but adopters must not be forced to take it.

## Decision

Semiont becomes a `semiont/` directory the site build never imports from — **the site must
build with the directory deleted** (CI-checked in Phase 8). A `semiont/config.json`
manifest lists enabled organs. Default-on core: boot identity (<150-line replacement for
the BECOME protocol), MEMORY (session handoff), REFLEXES (don't-do rules). Opt-in:
MANIFESTO, DIARY, ROUTINE, INTROSPECTION pack. Constraints: organs may not require each
other; no organ reads another organ's files; skills probe for organ existence and no-op
gracefully when absent. Instance #1 enables core + MANIFESTO at launch (ROADMAP task 8.2).

## Consequences

- Plug-and-play becomes real rather than aspirational: the two constraints (build-without,
  no cross-dependency) are exactly what the inherited monolith violates.
- The art stays available without being mandatory or deleted.
- Phase 8 builds the organ shells fresh; only MANIFESTO/REFLEXES prose is salvaged by
  hand from the v1 archive (instance-side history; see the instance's own SPEC).
