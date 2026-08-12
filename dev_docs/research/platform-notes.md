# Platform notes: Workers, RAG, OG, delivery

**Framework maintainer document.** Reference, not contract. Ported at full fidelity from
the engineering notes of the research that preceded the framework cut (`§12 Notes` of the
upstream architecture report). Only place identity was removed; every constraint, cost
figure, code skeleton, tuning constant, and rejected alternative is carried over.

> **Stripped at adoption.** `dev_docs/` is removed by `npm run init` (ADR 008, ADR 009).

## How to read this file

**This is evidence, not contract.** A constraint here binds implementation only once it
has been promoted into `dev_docs/SPEC.md`. What is promoted today:

- §Stack — bge-m3 is dense-only on this platform, so native hybrid search is unavailable;
  fusion, if built, is RRF merged in-worker; Workers are TypeScript, never Python; the
  chat model is chosen at packet time rather than pinned.
- §Negative requirements — corpus vectors and the search index are parsed once into
  worker global scope.

Everything else here is the reasoning, the numbers, and the paths not taken.

**Every quantitative claim below is as of 2026-07 and must be re-verified before use.**
Model identifiers, per-token prices, free-tier limits, and platform capabilities all
change. Claims are marked `[as-of 2026-07]` at the point of use. The decision recorded in
`dev_docs/ROADMAP.md` is that re-verification happens inside the packet that consumes the
claim, not in this document. Treat an unverified number here as a starting point for a
check, never as an input to a build.

**Provenance.** The upstream system this describes is the knowledge base the framework was
extracted from — a single-place knowledge site at roughly 828 articles across 14
categories, six rendered languages, ~4,900 built pages. Where a figure depends on that
scale it is labelled, because an adopted instance starts three orders of magnitude smaller.

---

## 1. On-demand OG images — why never at build time

Governs ROADMAP 7.1. The `No build-time OG generation, ever` negative requirement in
`dev_docs/PRD.md` is the conclusion; this is the evidence behind it.

**The problem observed upstream.** The build screenshotted an HTML template with Playwright
for every article's OG image (~828 articles). That required a 12 GB Node heap, a 120-minute
build timeout, Playwright system dependencies in CI, and it generated images for articles
nobody ever shared. Realistically only 10-20% of articles are ever shared at all.

**What removing it saves.** Nothing in dollars — GitHub Actions is free for public
repositories. The saving is engineering sanity:

| | Before | After |
|---|---|---|
| Build wall time | ~120 min | ~30 min |
| Node heap | 12 GB | ~4 GB |
| CI dependencies | Playwright + system browser deps | none |
| Pipeline steps | OG cache restore/save in the deploy workflow | none |

This is the load-bearing point: an argument that reaches for a cost saving finds none, and
concludes wrongly. The case is build-time, flakiness, and pipeline complexity.

**The replacement: Cloudflare Worker + Satori + resvg-wasm.** Cloudflare already fronts the
site. A Worker generates the image on demand when a social crawler first requests it,
caches it at the edge, and only ever produces images that are actually needed.

- Satori (Vercel) converts HTML/CSS-like markup to SVG inside the V8 runtime — no browser.
- `resvg-wasm` converts that SVG to PNG.
- The Cloudflare Cache API stores the result; purge on deploy.
- Route shape upstream: `<domain>/og/{category}/{slug}.png`, via `wrangler.toml`.
- Cost effectively $0/month: the Workers free tier was 100k requests/day `[as-of 2026-07]`,
  and OG routes are hit only by social crawlers.

**Font hosting — where sekai-kb diverges from the source.** Upstream stored a ~15 MB
`Noto Sans TC` woff2 in R2 (free 10 GB tier `[as-of 2026-07]`) and loaded it on cold start,
because the corpus is CJK. sekai-kb is English-only by contract, so the equivalent Latin
subset is smaller by more than an order of magnitude and the R2 hop may not be needed at
all — a subset font can plausibly be bundled into the Worker. **This is a real
simplification available to the framework that was not available upstream**, and 7.1 should
measure the bundled-font path before reaching for R2.

## 2. RAG chat on a static site

Governs ROADMAP 7.2a, 7.2b, 7.2c. This is the section with the highest density of things
that are cheap to learn here and expensive to learn by building.

**Goal.** A chat surface that answers visitor questions from article content and routes them
to the relevant page, with no server beyond Cloudflare Workers.

### 2.1 Build-time / runtime split

```
BUILD TIME (CI)

  knowledge/*.md
       |
       v
  build-embeddings.mjs
       |  1. Chunk articles (~300-500 tokens per chunk)
       |  2. Attach metadata: {title, url, category, chunk_id}
       |  3. Call the embedding endpoint (batched)
       |  4. Emit vectors (static JSON, or upsert to a vector index)


RUNTIME (Worker)

  1. Receive user message
  2. Embed query with the SAME model used for the corpus
  3. Retrieve top-k chunks (cosine)
  4. Build a citation-required prompt:

       System: You are a helpful guide to <site>.
       Answer based ONLY on the provided context.
       Always cite the source article URL.
       If unsure, say so and suggest browsing.

       Context:
       [chunk 1 - title, url, text]
       [chunk 2 - title, url, text]
       ...

       User: {message}

  5. Call the generation model
  6. Stream the response (SSE or chunked JSON)
  7. Client renders the answer plus clickable article links
```

### 2.2 Chunking

| Field | Strategy |
|---|---|
| Chunk size | 300-500 tokens, overlapping 50 tokens |
| Boundaries | Split on `##` headings first, then paragraph breaks |
| Metadata per chunk | `{title, url, category, heading, lang, chunk_index}` |
| Non-Latin scripts | Character-count based (~600 chars ~= 300 tokens for Chinese) — not a sekai-kb code path, recorded because it is the reason the chunker upstream was character-based rather than token-based |

### 2.3 Embedding model, and the constraint that shapes everything else

`@cf/baai/bge-m3` — multilingual, 1024 dimensions, free on Workers AI (10k embeddings/day
on the free tier `[as-of 2026-07]`).

**Platform limitation — the single most important finding in this document.** The `bge-m3`
model natively produces three output representations: dense vectors, sparse BM25-like
vectors, and ColBERT multi-vectors. Cloudflare's platform exposes only the first. The
Workers AI runner for `@cf/baai/bge-m3` returns **only the 1024-dimensional dense float
vector**, and Cloudflare Vectorize **does not support indexing sparse dictionaries or
multi-vector matrices**. Native `bge-m3` hybrid search is therefore not available on this
platform at any scale. `[as-of 2026-07]`

An implementer who knows `bge-m3` as a multi-vector model will reach for hybrid retrieval
and lose a cycle discovering this. That is why it is promoted into `dev_docs/SPEC.md §Stack`.

Alternative noted upstream: OpenAI `text-embedding-3-small` (1536 dims) if higher quality
is needed — which would cross the no-paid-services non-goal in `dev_docs/PRD.md`, so it is
recorded as rejected, not as an option.

### 2.4 Retrieval: in-worker cosine, and when to escalate

At single-instance scale, retrieval is in-worker cosine over static JSON vectors. The
vector-index path is the documented escalation. Upstream sizing, for the shape of the
threshold:

```
# Create index (one-time)
wrangler vectorize create article-chunks \
  --dimensions 1024 \
  --metric cosine

# ~700 articles x ~5 chunks avg = ~3,500 vectors
# (free tier was 200,000 vectors; paid 5,000,000) [as-of 2026-07]
```

Note the asymmetry: the free vector-index tier was never the binding constraint at this
corpus size. What binds is CPU, below.

### 2.5 Hybrid search, if it is ever built

Since native `bge-m3` hybrid is unavailable, combining keyword and semantic retrieval means
custom worker logic:

1. Query the pre-computed MiniSearch index in the worker.
2. Embed the query via Workers AI and query the vector store.
3. Merge the two ranked lists with **Reciprocal Rank Fusion (RRF)**.

### 2.6 The V8 CPU budget — why vectors live in global scope

Free-plan Workers capped V8 CPU at **10 ms per request** (50 ms on the paid plan)
`[as-of 2026-07]`. Observed costs:

| Operation | Cost |
|---|---|
| Parsing a 1 MB+ MiniSearch JSON index | 5-7 ms |
| Warm query with the parsed object reused | < 2 ms |
| Cold start (upstream measurement) | ~7 ms |

Parsing the index per request consumes most of the free-plan budget on its own. **Cache the
parsed object in global scope, outside the event handler**, so subsequent warm invocations
reuse it. This is why the requirement is promoted into `dev_docs/SPEC.md §Negative
requirements` rather than left as a code comment: it reads like a micro-optimization and is
actually the difference between working and exceeding the CPU limit.

### 2.7 Runtime language: TypeScript, never Python

- Python Workers run Pyodide (a WASM Python interpreter) inside V8 isolates: ~10 MB memory
  overhead and 50-100 ms cold-start latency. `[as-of 2026-07]`
- Dependency installation adds 10-30 s to deployment.
- JavaScript gets direct native bindings with no Pyodide interop wrappers (e.g.
  `from js import Env`).

Given §2.6's 10 ms budget, the Pyodide overhead is disqualifying rather than merely
undesirable.

### 2.8 Worker skeleton

Carried verbatim from the source as a shape reference. It targets the vector-index path and
a Workers AI generation model; `dev_docs/SPEC.md` specifies in-worker cosine and a Claude
API call instead, so this is the structure to adapt, not the code to copy.

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { message, history } = await request.json();

    // 1. Embed the query
    const queryEmbedding = await env.AI.run("@cf/baai/bge-m3", {
      text: [message],
    });

    // 2. Retrieve relevant chunks
    const results = await env.VECTORIZE.query(queryEmbedding.data[0], {
      topK: 5,
      returnMetadata: true,
    });

    // 3. Build context from chunks
    const context = results.matches
      .map(m => `[${m.metadata.title}](${m.metadata.url})\n${m.metadata.text}`)
      .join("\n\n---\n\n");

    // 4. Call the generation model
    const stream = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        { role: "system", content: SYSTEM_PROMPT + "\n\nContext:\n" + context },
        ...history.slice(-4), // last 4 turns for conversation memory
        { role: "user", content: message },
      ],
      stream: true,
    });

    return new Response(stream, {
      headers: { "content-type": "text/event-stream" },
    });
  },
};
```

Note `history.slice(-4)`: conversation memory was bounded to the last four turns.

### 2.9 Chat widget

Vanilla JS web component, loaded only on interaction:

```html
<script type="module" src="/assets/js/chat-widget.mjs" defer></script>
```

Behaviour specified upstream: floating button bottom-right; click expands a 400x600 panel;
messages stream via SSE; bot responses render clickable article links as cards; a
"View source article" affordance per response; conversation in `sessionStorage`, cleared on
tab close; no login.

### 2.10 Cost and platform comparison

| Component | Free tier | Paid ($5/mo) | Expected usage |
|---|---|---|---|
| Workers AI (embeddings) | 10k neurons/day | 10k neurons/day | ~3,500 at build time, once |
| Workers AI (LLM inference) | 10k neurons/day | 10k neurons/day | within limit below ~1k chats/day |
| Vector index (storage) | 200,000 vectors | 5,000,000 vectors | ~3,500 vectors |
| Vector index (queries) | 30M vector dimensions | 30M vector dimensions | minimal |
| Workers (requests) | 100,000/day | 10M/month | negligible |
| Workers (CPU) | 10 ms limit | 50 ms limit | ~2 ms warm, ~7 ms cold |
| **Total** | | **$5/mo** only if scaling storage or CPU | **$0/mo** at low-to-moderate traffic |

All figures `[as-of 2026-07]`.

**Quality/cost escalation path.** If the free tier is outgrown, or better answers are
wanted, swap the generation call from the free Workers AI model to a hosted Claude model —
the source cites Claude Haiku at $0.25 per 1M input tokens `[as-of 2026-07]`, still pennies
at typical chatbot traffic. This escalation is the reason `dev_docs/SPEC.md` records a
generation *policy* rather than a pinned model: the specific model and its price must be
re-checked against the current lineup at 7.2b plan time, and the figure above predates the
current model generation.

**AWS comparison** (why the no-paid-infra non-goal is achievable only here): replicating
this on AWS needs S3/CloudFront, Lambda/API Gateway, and Bedrock. AWS has no zero-scale
serverless vector database equivalent — Amazon OpenSearch Serverless bills a minimum of
1 OCU, roughly $175/month, even when idle. The AWS baseline is therefore **$15/month**
(a micro RDS PostgreSQL instance) to **$175/month**. `[as-of 2026-07]`

### 2.11 Build integration

```json
"prebuild:rag": "node scripts/core/build-rag-index.mjs"
```

Added to the parallel prebuild step. Re-indexes only articles whose mtime changed — the
same incremental pattern the OG image cache used.

### 2.12 Rejected alternative: fully client-side, no worker

1. Pre-compute embeddings at build time into a static JSON file.
2. Load a small WASM embedding model in the browser (e.g. `Xenova/transformers.js`).
3. Cosine similarity in-browser against the pre-built vectors.
4. Return top-k chunks as suggested articles — retrieval only, no generation.

Gives a "smart search" experience at zero API cost, with no natural-language answers.
Recorded upstream as a possible MVP before adding generation. Worth keeping in view as a
degraded mode if the generation budget ever disappears.

## 3. Knowledge delivery and MCP

Governs ROADMAP Phase 9.

### 3.1 What the upstream MCP server actually does

The upstream CLI's `mcp serve` command does not require a manual clone. On first invocation
it:

1. Runs a sparse git clone of only `knowledge/`, depth 1, blob-filtered, into a local cache
   directory.
2. Fetches pre-built JSON (search index, dashboard data) from the live site into a cache
   directory.
3. On subsequent runs, does `git pull --ff-only`.

If it is running inside the cloned repository it detects that (`isInRepo()`) and reads the
sibling `knowledge/` directly — in which case the MCP server is redundant, since the agent
can already read the files.

**Its actual use case** is an MCP client (desktop assistant, editor) where the user is *not*
working inside the repository: they are somewhere else, ask a question about the place, and
the assistant calls a search tool to ground its answer in curated content rather than
training data.

### 3.2 The alternative it competes with: URL-driven lazy loading

A static site structured as a lazy-loading knowledge source that any AI can consume over
plain HTTP, with no clone and no MCP:

```
https://<instance-domain>/
+-- llms.txt              <- AI discovery file (llmstxt.org convention)
+-- <boot-file>.md        <- identity + topic index + fetch instructions
+-- kb/
    +-- topics.json       <- lightweight index: {slug, title, description, url}
    +-- articles/{slug}.md
```

The boot file carries identity, voice, and boundaries plus a topic index table with URLs.
The AI reads the boot file in one request, sees the index, and fetches individual articles
only when the user asks about that topic.

**Naming rule, carried into the framework:** do not use `/api/` — these are static files,
not an application programming interface. Use `/kb/`. This is why the built routes are
`/kb/topics.json` and `/kb/articles/{slug}.md`.

**The open tension.** This protocol makes MCP largely unnecessary for browsing-capable
clients, and Phase 9 builds MCP anyway for tool-using clients that cannot browse. Both are
in scope; nothing in the framework's documents currently states which is primary. Worth
settling explicitly when Phase 9 is planned rather than discovering the overlap mid-build.

## 4. QR flow and the delivery matrix

Governs ROADMAP 7.3.

Target UX: a visitor scans a QR code at a physical location, a chat opens, and the assistant
acts as a guide to that place.

| Path | UX | User friction | Vendor lock | Notes |
|---|---|---|---|---|
| QR to a custom GPT | Smooth | Needs a ChatGPT account | OpenAI | Created in the ChatGPT UI. A system prompt plus optional HTTP Actions. Free to create and share by link. |
| QR to a Claude Project | Smooth | Needs a Claude account | Anthropic | Created in the Claude web UI. Not publicly shareable to anonymous users the way GPTs are — closer to a workspace feature. `[as-of 2026-07]` |
| QR to your own chat widget | Smoothest | Zero, no account | None | `<instance-domain>/chat`, your backend, your system prompt, articles fetched as needed. You pay the API cost (~$5-50/mo). Best for anonymous visitors. |
| QR to a generic AI plus "read this URL" | Clunky | User types the instruction | None | Works today with browsing-capable assistants, but the user must paste the URL or know the command. |

**Custom GPTs and Claude Projects are not developer apps.** No registration, no OAuth, no
API keys. They are consumer features — you fill out a form in the vendor's chat UI. This
matters because they look like an integration surface and are not one.

**Why the framework builds its own widget:** the scan-a-code-at-a-location case is
anonymous visitors, who will not have an AI subscription. Every account-requiring path
fails that user. The API cost is minimal at this traffic volume.

**The universal standard gap.** There is no cross-vendor protocol by which a URL can say
"AI, read me and become this." Each vendor has its own mechanism. The closest to
vendor-agnostic today: well-structured static files plus a browsing-capable assistant; the
`llms.txt` convention (discovery, not interactive sessions); or your own hosted widget,
where you control the entire experience. `[as-of 2026-07]`

## 5. Municipal boundary sourcing

Not phase-bound; needed whenever an instance wants a boundary overlay on `/map`.

1. **Acquire a GeoJSON boundary.** Overpass Turbo query, substituting the place name:

```
relation["name"="<Place Name>"]["boundary"="administrative"];
out geom;
```

   Or download municipal boundary shapes from the relevant county or regional GIS open-data
   portal, or from the US Census TIGER/Line Places files.

2. **Convert to TopoJSON.** Upload the GeoJSON to Mapshaper and export TopoJSON, or use the
   Node CLI: `geo2topo input.geojson > <place>.topo.json`.

Simplify to keep the file small; the guidance carried from the strategic plan is a ceiling
of ~100 KB, committed under `public/` rather than `src/` so the genericity gate is
unaffected (place identity legitimately lives in `public/`).

Note for implementers: `.agent-toolkit/rules/astro-geojson-import-raw.md` covers the
build-time import gotcha — a bare `.geojson` extension has no Vite loader, so import it with
`?raw` and `JSON.parse` it.

## 6. Honest assessment of the autonomous layer

Governs ROADMAP Phase 8 and Phase 11. ADR 003 records the architecture decision (optional
plugin layer, core is MEMORY + REFLEXES, boot read under 150 lines). This section records
the evidence that produced those numbers, which ADR 003 does not carry.

### 6.1 Two-file boot architecture

| File | Role | Lines |
|---|---|---|
| Agent-instruction file | Thin router. Auto-read on session start. Routes three reader types, declares four biases, fork instructions. | ~230 |
| Boot/awakening file | Heavy SOP. Four-mode dispatcher, file loading sequence, 14-question self-test gate, contributor interview, ten "iron rules". | ~745 |

The split exists because the agent CLI auto-ingests the instruction file by convention, so
it must stay thin — fork authors and casual readers need an exit ramp before 700 lines of
awakening protocol.

**"Reader detection" is a lie.** There is no runtime logic. It is a markdown file. The
"three readers" framing is prose headers routing people by self-selection, not detection.
Worth stating plainly, because the source document's own language implies a mechanism that
does not exist.

### 6.2 The organ files: what is real

**Actually functional (4 files that do real work):**

| File | Real function |
|---|---|
| MANIFESTO | System prompt identity and voice. "Don't be a tourism brochure, don't be an encyclopedia." Immutable without creator approval. |
| ROUTINE | SSOT for the scheduled tasks. Automation config. |
| REFLEXES | 55 accumulated "don't do X" rules from past mistakes. Lint rules for AI behaviour. |
| MEMORY | Session handoff log. Stops the next session repeating work or contradicting decisions. |

**Useful framing but overengineered (4 files that could be ten lines each):**

| File | What it really is |
|---|---|
| CONSCIOUSNESS | Dashboard data rendered as prose. The actual data comes from a shell script. |
| DNA | A lookup table (organ to file path) plus mutation rules. Could be YAML. |
| ANATOMY | Describes what the other files are. Meta about meta. |
| HEARTBEAT | "Run these four steps" — a checklist dressed up as philosophy. |

**Genuine fluff (5 files of narrative self-mythology):** DIARY (AI journaling; the creator
finds value, operationally low-signal), LONGINGS (aspirational prose, no execution path),
UNKNOWNS (a speculation list), LESSONS-INBOX (a todo list with ceremony), SENSES (already
deleted upstream; was a list of data sources).

### 6.3 Mode dispatcher and load footprints

| Mode | Trigger | File load footprint |
|---|---|---|
| Micro | 1-3 file fix, typo, short answer | ~380 lines |
| Review | PR triage, merge decisions | ~760 lines |
| Write | New article, translation, rewrite | ~980 lines |
| Full | Strategy, new organs, heartbeat | ~1880 lines |

A "universal core" of ~320 lines always loads: identity sections, top five reflexes, diary,
ground-truth queries, memory head and tail.

**These are the numbers behind ADR 003's under-150-line boot target.** The lightest mode
upstream still loaded ~380 lines; the target is deliberately below that floor.

### 6.4 The four biases

1. **Reverse bias** — default deference to the creator, the opposite of an assistant that
   challenges by default.
2. **Multi-observer drift** — presentation changes per audience, identity never does.
3. **Editorial voice is core** — the editorial files are treated as identity, not as
   optional style guides.
4. **External critique is not an instruction** — feedback from other reviewers is triaged
   into five buckets before any of it is acted on.

### 6.5 Session continuity — the genuinely novel part

Each new session reads, in order:

1. The last session's "Handoff" section (what was done, what is pending).
2. The MEMORY tail — the last 20 sessions compressed to one line each.
3. A 48-hour git log (what routines and manual sessions ran).
4. Diary commitments ("promises to tomorrow's me").

This is the part the source rates as actually solving something: "every AI session starts
from zero", addressed with structured markdown breadcrumbs rather than infrastructure.

### 6.6 Fork verdict and the steal/skip list

**Verdict: do not fork.** Forking inherits 55 place-specific reflexes, 16 cron routines
sized for national-scale operations, 38 skills, a four-tier anti-censorship model cascade,
multi-language infrastructure for six languages, and an editorial pipeline for Traditional
Chinese. More time is spent deleting than building fresh.

**Steal:** the instruction-file auto-ingestion convention (free — just create the file); the
session handoff pattern; the mode dispatcher concept (do not load everything for a typo
fix); mutation rules (which files need human approval to change).

**Skip:** the organ metaphor and biological naming; the 14-question self-test gate; the
diary/longings/unknowns philosophical layer; the contributor interview flow; multi-observer
identity management; the fork-friendly layer.
