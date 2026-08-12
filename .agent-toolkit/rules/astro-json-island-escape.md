---
tier: gotcha
triggers:
  objective:
    - "set:html"
    - "json island"
    - "application/json"
  definition_of_done:
    - "set:html"
    - "json island"
---
# Emitting build-time JSON into a page: escape `<` for a set:html script island

Astro's `set:html` does no escaping. Embedding a JSON string in a
`<script type="application/json" ... set:html={json}>` island lets a `</script>` substring
inside any string value terminate the script early and corrupt the payload (or inject
markup). `JSON.stringify` does not escape `<`.

When emitting JSON into a script island via `set:html`, escape every `<` to its `\uXXXX`
form:

    const json = JSON.stringify(data).replace(/</g, '\\u003c');

The escaped form is valid JSON, so the client's `JSON.parse` restores the `<` — the
round-trip is lossless and no raw `<` (hence no `</script>`) survives in the emitted HTML.

`<script define:vars={{ ... }}>` auto-escapes and lacks this hazard; the island tradeoff is
taken only when the emitted JSON must also be machine-readable (e.g. a postbuild contract
check parsing it — LB-16's check-graph.mjs).

**Why (LB-16):** graph.astro moved graph data from `define:vars` to a
`type="application/json"` island so check-graph.mjs could assert node/edge counts over it;
review S1 flagged that an article title containing `</script>` would break the island.
Fixed with the `<`-escape (PR #17).
