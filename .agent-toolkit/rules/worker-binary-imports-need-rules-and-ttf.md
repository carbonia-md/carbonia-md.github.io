---
tier: gotcha
triggers:
  paths:
    - "workers/**/wrangler.toml"
  objective:
    - "worker"
    - "satori"
    - "resvg"
    - "wasm"
    - "font"
---

# Worker binary imports: wrangler [[rules]] and Satori font format

When a Cloudflare Worker imports a binary asset (font, wasm, image), wrangler has no default
loader for it. The `wrangler.toml` template must declare a `[[rules]]` block per extension:

- `.wasm` → `type = "CompiledWasm"` (pre-compiled Module; avoids the "code generation
  disallowed by embedder" error that raw `WebAssembly.instantiate(bytes)` hits).
- `.ttf` / `.otf` → `type = "Data"` (raw ArrayBuffer).

Satori (the OG/SVG renderer) uses `@shuding/opentype.js`, which only parses TTF, OTF, and
woff1. It rejects woff2 with "Unsupported OpenType signature wOF2". Always bundle a `.ttf`
for Satori, never `.woff2`.

The `scripts/deploy/wrangler-config.mjs` TOML parser must also support inline arrays
(`globs = ["**/*.wasm"]`) since `[[rules]]` uses them. This was extended in LB-82; a future
worker adding a new glob shape should confirm the parser handles it.

**Why (LB-82):** Three deploy-blocking errors discovered only during the manual deploy step:
(1) Satori rejected the bundled woff2 at render time, (2) wrangler refused to bundle the
font without a `[[rules]]` declaration, and (3) `@resvg/resvg-wasm`'s `initWasm` hit the
embedder restriction on compiling wasm from bytes. All three passed the test suite because
tests stub the rendering pipeline. The existing DoD 9 (deployed proof) is what caught them;
this rule makes the next executor avoid them in the first place.
