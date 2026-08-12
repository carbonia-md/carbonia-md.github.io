// workers/og/src/handler.mjs — pure HTTP handler logic, testable without wasm
// or binary imports.
//
// The rendering dependencies (satori, Resvg, initWasm, resvgWasm, fontData) are
// passed via the `deps` argument by the entry point (index.mjs). Tests inject
// stubs instead.

const WIDTH = 1200;
const HEIGHT = 630;

let wasmInitialized = false;

// topics.json parsed result, cached in global scope outside the handler so
// subsequent warm invocations reuse it (platform-notes.md CPU doctrine).
let topicsCache = null;
let topicsFetchPromise = null;

async function ensureWasm(deps) {
  if (!wasmInitialized && deps) {
    await deps.initWasm(deps.resvgWasm);
    wasmInitialized = true;
  }
}

async function fetchTopics(env) {
  if (topicsCache !== null) return topicsCache;
  if (topicsFetchPromise !== null) return topicsFetchPromise;
  topicsFetchPromise = fetch(`${env.SITE_ORIGIN}/kb/topics.json`)
    .then((res) => {
      if (!res.ok) throw new Error(`topics.json: ${res.status}`);
      return res.json();
    })
    .then((data) => {
      topicsCache = data;
      topicsFetchPromise = null;
      return data;
    })
    .catch((err) => {
      topicsFetchPromise = null;
      throw err;
    });
  return topicsFetchPromise;
}

function findArticle(topics, category, slug) {
  return topics.find(
    (a) => a.category === category && a.url === `/${category}/${slug}`,
  );
}

function parseColors(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function buildCard(env, article) {
  const siteName = env.SITE_NAME || 'Knowledge Base';
  const colors = parseColors(env.CATEGORY_COLORS);

  if (!article) {
    return {
      type: 'div',
      props: {
        style: {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          backgroundColor: '#0f172a',
          color: '#f8fafc',
          fontFamily: 'Inter',
        },
        children: [
          {
            type: 'div',
            props: {
              style: { fontSize: 64, fontWeight: 700 },
              children: siteName,
            },
          },
        ],
      },
    };
  }

  const categoryTitle =
    article.category.charAt(0).toUpperCase() + article.category.slice(1);
  const accentColor = colors[article.category] || '#3b82f6';

  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: '#0f172a',
        color: '#f8fafc',
        fontFamily: 'Inter',
        padding: '60px 80px',
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              alignItems: 'center',
              marginBottom: '40px',
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    backgroundColor: accentColor,
                    color: '#ffffff',
                    padding: '8px 20px',
                    borderRadius: '6px',
                    fontSize: 24,
                    fontWeight: 700,
                  },
                  children: categoryTitle,
                },
              },
            ],
          },
        },
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flex: 1,
              alignItems: 'center',
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    fontSize: article.title.length > 40 ? 48 : 56,
                    fontWeight: 700,
                    lineHeight: 1.2,
                    maxWidth: '100%',
                  },
                  children: article.title,
                },
              },
            ],
          },
        },
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderTop: '2px solid #334155',
              paddingTop: '24px',
            },
            children: [
              {
                type: 'div',
                props: {
                  style: { fontSize: 28, color: '#94a3b8' },
                  children: siteName,
                },
              },
            ],
          },
        },
      ],
    },
  };
}

async function renderPng(card, deps) {
  const font = deps.fontData instanceof ArrayBuffer
    ? deps.fontData
    : deps.fontData?.buffer ?? new ArrayBuffer(0);

  const svg = await deps.satori(card, {
    width: WIDTH,
    height: HEIGHT,
    fonts: [
      { name: 'Inter', data: font, weight: 400, style: 'normal' },
      { name: 'Inter', data: font, weight: 700, style: 'normal' },
    ],
  });

  const resvg = new deps.Resvg(svg, {
    fitTo: { mode: 'width', value: WIDTH },
  });
  const pngData = resvg.render();
  return pngData.asPng();
}

export async function handleRequest(request, env, deps) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (method !== 'GET' && method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const match = url.pathname.match(/^\/og\/([^/]+)\/([^/]+)\.png$/);
  if (!match) {
    return new Response('Not Found', { status: 404 });
  }

  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const [, category, slug] = match;

  await ensureWasm(deps);
  const topics = await fetchTopics(env);
  const article = findArticle(topics, category, slug);
  const card = buildCard(env, article);

  const pngBuffer = await renderPng(card, deps);

  const response = new Response(pngBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });

  await cache.put(cacheKey, response.clone());
  return response;
}

export function resetForTesting() {
  topicsCache = null;
  topicsFetchPromise = null;
  wasmInitialized = false;
}
