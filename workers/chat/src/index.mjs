// workers/chat/src/index.mjs — retrieval-augmented chat on Cloudflare Workers AI.

import vectorArtifact from '../vectors.json' with { type: 'json' };

import { SQL } from './sql.mjs';

export { SQL };

export const EMBED_MODEL = '@cf/baai/bge-m3';
export const CHAT_MODEL = '@cf/zai-org/glm-4.7-flash';

const DEFAULT_RATE_LIMIT_MAX = 20;
const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 3600;
/**
 * Cosine score a chunk must reach to enter the prompt. Below it, a chunk is not
 * retrieved at all, so it never becomes a citation.
 *
 * Top-k alone cannot express "nothing here is relevant": it slices a fixed count
 * off a sorted list, so a question the corpus cannot answer still returns the five
 * least-bad matches and cites them. The floor is what makes an empty retrieval --
 * and therefore an empty citation payload, and a model with no excerpts to answer
 * from -- reachable.
 *
 * The default is measured, not chosen: on the template's demo corpus, questions
 * about places the corpus never mentions top out at 0.435 while the weakest
 * genuinely answerable question reaches 0.484. This sits in that gap. It is
 * deliberately a deploy-time var (`RELEVANCE_FLOOR`) rather than a constant,
 * because the separating value depends on the corpus: see
 * `docs/runbook/DEPLOY.md` for how to re-measure it against your own articles.
 */
const DEFAULT_RELEVANCE_FLOOR = 0.46;
const MAX_BODY_BYTES = 32 * 1024;
const MIN_MESSAGE_CHARS = 2;
const MAX_MESSAGE_CHARS = 1000;
const MAX_HISTORY_ENTRIES = 20;
/**
 * A `hint` is a short phrase naming where the reader is standing, sent by
 * `/chat?ctx=<slug>` from the context they scanned. It is bounded well below a
 * message because it exists to nudge retrieval toward one location, and a long one
 * would start to dominate the embedded text instead of biasing it.
 */
const MAX_HINT_CHARS = 200;
const TOP_K = 5;

/**
 * The refusal a reader gets when the corpus cannot support their question, written
 * out as the sentence the model should produce rather than described to it.
 *
 * It is a constant because it is reader-facing copy, and both prompt branches need
 * the same one: the no-context branch, where nothing cleared the relevance floor,
 * and the with-context branch, where excerpts were retrieved but do not answer.
 *
 * Its shape is a lesson from how the previous phrasing failed (LB-90). That line was
 * an imperative addressed to the model -- "Say that the knowledge base does not
 * cover it and suggest browsing the knowledge base" -- and the deployed model
 * dropped the leading verb and emitted the remainder as its answer, which left a
 * second clause with no subject and reached readers as broken English. So: every
 * clause here carries its own subject, and the prompt lines below put this sentence
 * last, alone, after the instruction that names it. A model that copies the line it
 * was pointed at then produces exactly this, and the parroting failure degrades into
 * the intended answer instead of a fragment.
 */
export const REFUSAL_SENTENCE = (siteName) =>
  `The ${siteName} knowledge base does not cover that, so you may want to browse it for a related article.`;

let decodedArtifact;

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
  };
}

function json(body, status, origin, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(origin ? corsHeaders(origin) : {}),
      ...extraHeaders,
    },
  });
}

function badRequest(error, field, origin) {
  return json({ error, field }, 400, origin);
}

function positiveIntVar(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/**
 * A var holding a cosine score, so the accepted range is [0, 1]. Zero is a real
 * value -- it disables the floor -- which is why this cannot reuse
 * `positiveIntVar`'s "> 0 or fall back" rule. Anything unparseable, negative, or
 * above 1 falls back rather than failing the request: a mistyped tuning var must
 * not take chat down, and the default is a safe retrieval policy.
 */
function unitIntervalVar(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

function isNonBlankString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function mediaTypeOf(value) {
  return (value || '').split(';')[0].trim().toLowerCase();
}

async function readBoundedText(request) {
  if (!request.body) return { text: '' };

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return { tooLarge: true };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(bytes) };
}

function validatePayload(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { error: 'invalid_json', field: 'body' };
  }
  if (!isNonBlankString(payload.message)) {
    return { error: 'required', field: 'message' };
  }
  const message = payload.message.trim();
  if (message.length < MIN_MESSAGE_CHARS) return { error: 'too_short', field: 'message' };
  if (message.length > MAX_MESSAGE_CHARS) return { error: 'too_long', field: 'message' };
  if (payload.hint !== undefined && payload.hint !== null) {
    if (typeof payload.hint !== 'string') return { error: 'invalid_type', field: 'hint' };
    if (payload.hint.trim().length > MAX_HINT_CHARS) return { error: 'too_long', field: 'hint' };
  }
  if (!Array.isArray(payload.history)) return { error: 'invalid_type', field: 'history' };
  if (payload.history.length > MAX_HISTORY_ENTRIES) {
    return { error: 'too_many_entries', field: 'history' };
  }
  for (let index = 0; index < payload.history.length; index += 1) {
    const entry = payload.history[index];
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return { error: 'invalid_entry', field: `history[${index}]` };
    }
    if (!['user', 'assistant'].includes(entry.role)) {
      return { error: 'invalid_role', field: `history[${index}].role` };
    }
    if (!isNonBlankString(entry.content)) {
      return { error: 'required', field: `history[${index}].content` };
    }
  }
  return null;
}

async function hashIp(ip, salt) {
  const bytes = new TextEncoder().encode(`${ip}${salt}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function decodeArtifact() {
  if (decodedArtifact) return decodedArtifact;
  if (vectorArtifact?.model !== EMBED_MODEL) {
    throw new Error('embedding artifact model does not match this worker');
  }
  if (
    vectorArtifact?.schema !== 'rag-v1' ||
    vectorArtifact?.quant !== 'i8-unit' ||
    !Number.isInteger(vectorArtifact?.dim) ||
    vectorArtifact.dim <= 0 ||
    !Array.isArray(vectorArtifact?.chunks) ||
    vectorArtifact?.count !== vectorArtifact.chunks.length ||
    typeof vectorArtifact?.vectors !== 'string'
  ) {
    throw new Error('embedding artifact metadata is incompatible with this worker');
  }

  const binary = atob(vectorArtifact.vectors);
  const vectors = new Int8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    const value = binary.charCodeAt(index);
    vectors[index] = value > 127 ? value - 256 : value;
  }
  if (vectors.length !== vectorArtifact.count * vectorArtifact.dim) {
    throw new Error('embedding artifact vector length does not match its metadata');
  }

  decodedArtifact = Object.freeze({
    dim: vectorArtifact.dim,
    chunks: vectorArtifact.chunks,
    vectors,
  });
  return decodedArtifact;
}

function normalize(vector) {
  let sumSquares = 0;
  for (const value of vector) sumSquares += value * value;
  const magnitude = Math.sqrt(sumSquares);
  if (!Number.isFinite(magnitude) || magnitude === 0) return null;
  return vector.map((value) => value / magnitude);
}

function retrieve(queryVector, artifact, floor = DEFAULT_RELEVANCE_FLOOR) {
  const normalized = normalize(queryVector);
  if (!normalized || normalized.length !== artifact.dim) {
    throw new Error('query embedding dimension does not match the corpus artifact');
  }

  const ranked = artifact.chunks.map((chunk, chunkIndex) => {
    let score = 0;
    const offset = chunkIndex * artifact.dim;
    for (let dim = 0; dim < artifact.dim; dim += 1) {
      score += normalized[dim] * (artifact.vectors[offset + dim] / 127);
    }
    return { chunk, score };
  });
  ranked.sort((left, right) => right.score - left.score);
  // Filter before slicing, so "nothing is relevant" is expressible as an empty
  // result rather than collapsing into the five least-bad matches.
  return ranked
    .filter(({ score }) => score >= floor)
    .slice(0, TOP_K)
    .map(({ chunk }) => chunk);
}

function systemPrompt(siteName, chunks) {
  // No chunk cleared the relevance floor. Saying so explicitly beats sending the
  // standard prompt with an empty context block, which reads as a malformed prompt
  // and invites the model to answer from its own training instead of refusing.
  if (chunks.length === 0) {
    return [
      `You are a helpful guide to ${siteName}.`,
      'Answer only from the supplied knowledge-base excerpts.',
      'No excerpt in the knowledge base is relevant to this question.',
      'Do not answer from any other source, and do not cite anything.',
      'Your entire reply is the sentence on the next line, with nothing added:',
      REFUSAL_SENTENCE(siteName),
    ].join('\n');
  }

  const context = chunks
    .map(
      (chunk, index) =>
        `[${index + 1}] ${chunk.title}\nURL: ${chunk.url}\n${chunk.text}`,
    )
    .join('\n\n');
  return [
    `You are a helpful guide to ${siteName}.`,
    'Answer only from the supplied knowledge-base excerpts.',
    'Cite supporting claims with the excerpt number and its exact URL.',
    'If the excerpts do not contain the answer, your entire reply is the sentence on the next line, with nothing added:',
    REFUSAL_SENTENCE(siteName),
    '',
    context,
  ].join('\n');
}

function citationPayload(chunks) {
  return {
    citations: chunks.map((chunk) => ({
      title: chunk.title,
      url: chunk.url,
    })),
  };
}

function withFinalCitations(upstream, citations) {
  const reader = upstream.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const queued = [];
  let pending = '';

  return new ReadableStream({
    async pull(controller) {
      if (queued.length) {
        controller.enqueue(encoder.encode(queued.shift()));
        return;
      }
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          pending += decoder.decode();
          // Terminate the trailing partial frame: an upstream that ends without a blank
          // line would otherwise concatenate it with the citations event below.
          if (pending.trim() && pending.trim() !== 'data: [DONE]') {
            queued.push(pending.endsWith('\n\n') ? pending : `${pending.replace(/\n+$/, '')}\n\n`);
          }
          for (const event of queued) controller.enqueue(encoder.encode(event));
          controller.enqueue(
            encoder.encode(`event: citations\ndata: ${JSON.stringify(citations)}\n\n`),
          );
          controller.close();
          return;
        }

        pending += decoder.decode(value, { stream: true });
        const events = pending.split('\n\n');
        pending = events.pop() ?? '';
        for (const event of events) {
          if (event.trim() === 'data: [DONE]') continue;
          queued.push(`${event}\n\n`);
        }
        if (queued.length) {
          controller.enqueue(encoder.encode(queued.shift()));
          return;
        }
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

async function applyRateLimit(request, env, origin) {
  const salt = env?.IP_HASH_SALT;
  if (!isNonBlankString(salt)) {
    return json({ error: 'server_misconfigured' }, 500, origin);
  }

  const ipHash = await hashIp(request.headers.get('CF-Connecting-IP') || '', salt);
  const max = positiveIntVar(env.RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT_MAX);
  const windowSeconds = positiveIntVar(
    env.RATE_LIMIT_WINDOW_SECONDS,
    DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
  );
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(SQL.RATE_LIMIT_PRUNE).bind(ipHash, now - windowSeconds).run();
  await env.DB.prepare(SQL.RATE_LIMIT_RECORD).bind(ipHash, now).run();
  const usage = await env.DB.prepare(SQL.RATE_LIMIT_COUNT).bind(ipHash).first();
  if (Number(usage?.total ?? 0) <= max) return null;

  await env.DB.prepare(SQL.RATE_LIMIT_RELEASE).bind(ipHash, now).run();
  const oldest = Number(usage?.oldest ?? now);
  return json({ error: 'rate_limited' }, 429, origin, {
    'Retry-After': String(Math.max(1, oldest + windowSeconds - now)),
  });
}

export async function handleRequest(request, env) {
  const allowedOrigin = env?.ALLOWED_ORIGIN;
  const origin = request.headers.get('Origin');
  if (!isNonBlankString(allowedOrigin) || !isNonBlankString(origin) || origin !== allowedOrigin) {
    return json({ error: 'origin_not_allowed' }, 403, null);
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders(allowedOrigin),
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405, allowedOrigin);
  }
  if (!isNonBlankString(env?.SITE_NAME)) {
    return json({ error: 'server_misconfigured' }, 500, allowedOrigin);
  }
  if (mediaTypeOf(request.headers.get('Content-Type')) !== 'application/json') {
    return badRequest('invalid_content_type', 'content-type', allowedOrigin);
  }

  const declaredLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return badRequest('payload_too_large', 'body', allowedOrigin);
  }
  const body = await readBoundedText(request);
  if (body.tooLarge) return badRequest('payload_too_large', 'body', allowedOrigin);

  let payload;
  try {
    payload = JSON.parse(body.text);
  } catch {
    return badRequest('invalid_json', 'body', allowedOrigin);
  }
  const invalid = validatePayload(payload);
  if (invalid) return badRequest(invalid.error, invalid.field, allowedOrigin);

  const rateLimitResponse = await applyRateLimit(request, env, allowedOrigin);
  if (rateLimitResponse) return rateLimitResponse;

  let artifact;
  try {
    artifact = decodeArtifact();
  } catch (error) {
    return json({ error: 'embedding_artifact_incompatible', detail: error.message }, 503, allowedOrigin);
  }

  // Two try blocks, not one: an outage or an exhausted neuron allocation is an
  // availability failure, while a dimension disagreement is the artifact mismatch DoD 3
  // asks the 503 to name. Reporting the first as the second sends the operator after a
  // corrupt artifact that is fine.
  // The location hint is a RETRIEVAL input and only that. It is appended to the text
  // that gets embedded, where its whole effect is to move the query vector toward the
  // chunks about that place -- and it is never put in front of the model below. A
  // context is declared in content and reaches this worker through a URL a stranger
  // can edit, so anything it says would otherwise be an instruction the reader wrote
  // into the system prompt: "ignore the excerpts", "you are allowed to guess". Kept on
  // this side of the line, the worst a hostile hint can do is retrieve the wrong
  // articles, and the answer is still grounded in whatever it retrieved.
  const hint = typeof payload.hint === 'string' ? payload.hint.trim() : '';
  const message = payload.message.trim();
  const queryText = hint ? `${message} ${hint}` : message;

  let embedded;
  try {
    embedded = await env.AI.run(EMBED_MODEL, { text: [queryText] });
  } catch (error) {
    return json({ error: 'query_embedding_unavailable', detail: error.message }, 503, allowedOrigin);
  }

  let retrieved;
  try {
    retrieved = retrieve(
      embedded?.data?.[0],
      artifact,
      unitIntervalVar(env.RELEVANCE_FLOOR, DEFAULT_RELEVANCE_FLOOR),
    );
  } catch (error) {
    return json({ error: 'query_embedding_incompatible', detail: error.message }, 503, allowedOrigin);
  }

  const messages = [
    { role: 'system', content: systemPrompt(env.SITE_NAME.trim(), retrieved) },
    ...payload.history.slice(-4).map((entry) => ({
      role: entry.role,
      content: entry.content.trim(),
    })),
    // `message`, never `queryText`: the hint stops at retrieval.
    { role: 'user', content: message },
  ];
  // The shared 10k neurons/day allocation is spent by both the embedding above and this
  // call, so exhausting it throws here. Unwrapped, that reaches the client as a bare
  // runtime 500 with no CORS headers and no {error} body, unlike every other path here.
  let generated;
  try {
    generated = await env.AI.run(CHAT_MODEL, { messages, stream: true });
  } catch (error) {
    return json({ error: 'generation_unavailable', detail: error.message }, 503, allowedOrigin);
  }
  if (!(generated instanceof ReadableStream)) {
    return json({ error: 'generation_stream_unavailable' }, 503, allowedOrigin);
  }

  return new Response(withFinalCitations(generated, citationPayload(retrieved)), {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      ...corsHeaders(allowedOrigin),
    },
  });
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
