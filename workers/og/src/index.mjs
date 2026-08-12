// workers/og/src/index.mjs — on-demand OG image Worker entry point.
//
// GET /og/{category}/{slug}.png renders a per-article social card with Satori
// and resvg-wasm, cached at the Cloudflare edge. Free tier only.
//
// This file is framework-owned and carries zero place identity: site name,
// origin, and category colors arrive as env vars at deploy time, never as
// literals here (AGENTS.md iron rule 2; both machine gates scan workers/).
//
// Binary imports (wasm, font) live here so the testable handler.mjs stays
// importable by Node's test runner without bundler support.

import satori from 'satori';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import fontData from '../assets/inter-latin.ttf';

import { handleRequest } from './handler.mjs';

export { handleRequest };

const deps = { satori, Resvg, initWasm, resvgWasm, fontData };

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, deps);
  },
};
