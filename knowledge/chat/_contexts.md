---
# The chat contexts: the physical places this knowledge base puts a QR code, and how
# `/chat?ctx=<slug>` greets a reader who scans one.
#
# The leading `_` in this filename is load-bearing. It is what makes the file
# invisible to the three scanners that walk `knowledge/` looking for articles
# (scripts/core/test-frontmatter.mjs, scripts/tools/article-health.py, and
# scripts/core/build-content-dates.mjs). Rename it without the prefix and the
# article pipeline starts treating this list of greetings as an article with no
# title, description, or category.
#
# The whole file is optional. An instance that never writes one is not broken:
# `/chat` behaves exactly as it does without any context, and `npm run qr:sheet`
# reports "no contexts declared" and exits 0.
#
# A context requires `slug`, `label`, `greeting`. A context also accepts optional
# `hint`, `article`:
#
#   slug     - required, the `ctx` query value. Lowercase letters, digits, and single
#              hyphens only: it gets printed inside a URL, so it may not be a string
#              that needs percent-encoding.
#   label    - required, the place's name as it reads on the printed card.
#   greeting - required, the opening message. Write it for somebody standing there
#              holding a phone, not for a reader at a desk.
#   hint     - optional, a short phrase that biases RETRIEVAL toward this location.
#              It is appended to the embedded text of the reader's first question and
#              is never shown to the model as an instruction, so a hint can steer
#              which articles are found and cannot talk the answer into anything.
#              A hint is capped at 200 characters, the longest one the chat worker
#              accepts. A longer hint is ignored with a build-time warning and the
#              context still works: sending it would fail every question asked from
#              this context, which would take the printed code out of service.
#   article  - optional, a site-root-absolute route this build produces. It renders as
#              a link under the greeting. A route that does not resolve drops the whole
#              context with a build-time warning, because a greeting that sends a
#              reader at a 404 is worse than one code that does not work.
#
# Contexts are dropped one at a time, never as a set: a duplicate slug, a missing
# required field, an unusable slug, and an unresolvable `article` each take out that
# one entry with a named warning and leave every other code working.
#
# These are DEMO contexts for a fictional town. Adoption removes them along with the
# rest of the demo knowledge base.

contexts:
  - slug: lighthouse
    label: Marisol Point Lighthouse
    greeting: >-
      You are at Marisol Point Lighthouse. Ask about the light, the keepers, or the
      cove below it.
    hint: Marisol Point Lighthouse, the light station and its keepers
    article: /history/marisol-point-lighthouse

  - slug: lantern-cove
    label: Lantern Cove Beach
    greeting: >-
      You are at Lantern Cove. Ask about the tide pools, the sea cave, or how to get
      down to the sand.
    hint: Lantern Cove Beach, its tide pools and sea cave
    article: /beaches/lantern-cove-beach

  - slug: summit-trailhead
    label: Summit Ridge Trailhead
    greeting: >-
      You are at the Summit Ridge trailhead. Ask about the climb, the views, or what
      to bring.
    hint: Summit Ridge Trail, the climb and the ridge above the cove
    article: /trails/summit-ridge-trail

  - slug: harbor-pier
    label: Harbor Pier
    greeting: >-
      You are on the pier. Ask about the harbor, the cafe at the end of it, or the
      town that grew up around this spot.
    hint: the harbor, the pier, and the cafe on it
    article: /food/the-harborlight-cafe

  - slug: kelp-preserve-overlook
    label: Kelp Forest Overlook
    greeting: >-
      You are looking out over the kelp forest preserve. Ask about what lives down
      there, or how the preserve came to be.
    hint: the kelp forest preserve offshore and the life in it
    article: /nature/kelp-forest-preserve
---

# Chat contexts

Five places, five codes. `npm run qr:sheet` turns this list into a printable sheet:
one card per context, each carrying the code that opens `/chat?ctx=<slug>`, the
place's name, and the URL in plain text for anyone who would rather type it.

The point of a context is that a visitor standing at the lighthouse has no app, no
account, and no reason to search. A code on the sign is the whole onboarding, and the
greeting is what tells them the thing they just opened knows where they are.

Keep the list short. Every context is a physical sign somebody has to print, mount,
and eventually take down, and a slug that outlives its sign is a code that quietly
falls back to the ordinary chat page — which is the intended failure, not a bug.
