/**
 * prompt-table.mjs — the schema-driven prompt table for `npm run init`.
 *
 * Every wizard question is a ROW in PROMPTS, not flow code: adding a future
 * prompt (features.mcp, an analytics ID) means adding a table entry, never new
 * flow logic. Both the interactive runner and the non-interactive
 * `--answers <json>` mode resolve answers through this same table, in the same
 * order, into the same resolved-config object that feeds the single writer —
 * so the two paths cannot drift and produce byte-identical output.
 *
 * Row shape:
 *   id        dot-path into the resolved config; also the answers-JSON path
 *   question  interactive prompt text
 *   kind      one of KINDS below (parse + coerce + shared validation)
 *   default   literal, or fn(partialConfig) evaluated when the row is reached
 *             (rows resolve in order, so defaults may read earlier answers)
 *   required  true = empty interactive input / missing answers key is an error
 *   validate  fn(value, partialConfig) → error string, or null when valid
 */

/** Category slugs are top-level routes; these routes already exist. */
export const RESERVED_SLUGS = [
  'about',
  'changelog',
  'contribute',
  'dashboard',
  'explore',
  'graph',
  'kb',
  'latest',
  'map',
  'media',
  'rss',
  'feed',
  '404',
];

export const CATEGORY_PRESETS = {
  'coastal-town': [
    {
      slug: 'history',
      title: 'History',
      icon: '📜',
      description: 'Founding, growth, and the events that shaped the town',
    },
    {
      slug: 'beaches',
      title: 'Beaches',
      icon: '🏖️',
      description: 'Shoreline access, coves, tide pools, and swimming conditions',
    },
    {
      slug: 'nature',
      title: 'Nature',
      icon: '🌿',
      description: 'Habitats, wildlife, and protected areas',
    },
    {
      slug: 'trails',
      title: 'Trails',
      icon: '🥾',
      description: 'Hikes, walks, and viewpoints',
    },
    {
      slug: 'food',
      title: 'Food',
      icon: '🍽️',
      description: 'Restaurants, cafes, markets, and culinary landmarks',
    },
  ],
  city: [
    {
      slug: 'history',
      title: 'History',
      icon: '📜',
      description: 'Founding, growth, and the events that shaped the city',
    },
    {
      slug: 'neighborhoods',
      title: 'Neighborhoods',
      icon: '🏘️',
      description: 'Districts, their character, and what defines each',
    },
    {
      slug: 'culture',
      title: 'Culture',
      icon: '🎭',
      description: 'Museums, arts, festivals, and traditions',
    },
    {
      slug: 'food',
      title: 'Food',
      icon: '🍽️',
      description: 'Restaurants, cafes, markets, and culinary landmarks',
    },
    {
      slug: 'parks',
      title: 'Parks',
      icon: '🌳',
      description: 'Green spaces, playgrounds, and outdoor recreation',
    },
    {
      slug: 'transit',
      title: 'Transit',
      icon: '🚌',
      description: 'Getting around: routes, stations, and practical tips',
    },
  ],
  'small-town': [
    {
      slug: 'history',
      title: 'History',
      icon: '📜',
      description: 'Founding, growth, and the events that shaped the town',
    },
    {
      slug: 'landmarks',
      title: 'Landmarks',
      icon: '🏛️',
      description: 'Notable buildings, monuments, and sites',
    },
    {
      slug: 'nature',
      title: 'Nature',
      icon: '🌿',
      description: 'Habitats, wildlife, and the surrounding landscape',
    },
    {
      slug: 'food',
      title: 'Food',
      icon: '🍽️',
      description: 'Restaurants, cafes, markets, and culinary landmarks',
    },
    {
      slug: 'community',
      title: 'Community',
      icon: '🤝',
      description: 'Institutions, events, and local life',
    },
  ],
};

export function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LOCALE_RE = /^[a-z]{2}(-[a-z0-9]{2,8})?$/i;

/** The title becomes the knowledge/{Title}/ folder name and sync.sh reads
 * titles back as directory names, so path separators or control characters
 * in it would silently break the content mapping. */
const TITLE_UNSAFE_RE = /[\\/\u0000-\u001f]/;

/**
 * Field/slug validity of ONE category entry, shared by validateCategories and
 * the interactive custom-entry loop (which validates mid-loop, where the 5-14
 * count cannot hold yet). `seenSlugs` catches duplicates against earlier
 * entries.
 */
export function validateCategoryEntry(c, seenSlugs = new Set()) {
  for (const field of ['slug', 'title', 'icon', 'description']) {
    if (typeof c?.[field] !== 'string' || c[field].trim() === '')
      return `every category needs a non-empty "${field}"`;
  }
  if (TITLE_UNSAFE_RE.test(c.title))
    return `category title "${c.title}" must not contain path separators or control characters (it becomes the knowledge/ folder name)`;
  if (!SLUG_RE.test(c.slug)) return `category slug "${c.slug}" must be kebab-case`;
  if (RESERVED_SLUGS.includes(c.slug))
    return `category slug "${c.slug}" collides with an existing route`;
  if (seenSlugs.has(c.slug)) return `duplicate category slug "${c.slug}"`;
  return null;
}

export function validateCategories(cats) {
  if (!Array.isArray(cats)) return 'categories must be a preset name or an array';
  if (cats.length < 5 || cats.length > 14)
    return `5-14 categories required (got ${cats.length})`;
  const seen = new Set();
  for (const c of cats) {
    const err = validateCategoryEntry(c, seen);
    if (err) return err;
    seen.add(c.slug);
  }
  return null;
}

function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function validateLatLng(v) {
  if (!Array.isArray(v) || v.length !== 2 || !v.every(isFiniteNumber))
    return 'expected [lat, lng] numbers';
  const [lat, lng] = v;
  if (lat < -90 || lat > 90) return `lat ${lat} out of range [-90, 90]`;
  if (lng < -180 || lng > 180) return `lng ${lng} out of range [-180, 180]`;
  return null;
}

function validateBounds(v) {
  if (
    !Array.isArray(v) ||
    v.length !== 2 ||
    !v.every((corner) => Array.isArray(corner) && corner.length === 2)
  )
    return 'expected [[south, west], [north, east]]';
  const swErr = validateLatLng(v[0]);
  if (swErr) return `SW corner: ${swErr}`;
  const neErr = validateLatLng(v[1]);
  if (neErr) return `NE corner: ${neErr}`;
  const [[s, w], [n, e]] = v;
  if (s >= n) return `south (${s}) must be less than north (${n})`;
  if (w >= e) return `west (${w}) must be less than east (${e})`;
  return null;
}

/**
 * Kind handlers. `parseText` turns raw interactive input into a typed value
 * (throws Error on unparseable input); `coerce` type-checks/normalizes a value
 * arriving from answers JSON; `validate` is shared by both paths.
 */
export const KINDS = {
  text: {
    parseText: (s) => s.trim(),
    coerce: (v) => {
      if (typeof v !== 'string') throw new Error('expected a string');
      return v.trim();
    },
  },
  number: {
    parseText: (s) => {
      const n = Number(s.trim());
      if (!Number.isFinite(n)) throw new Error(`"${s.trim()}" is not a number`);
      return n;
    },
    coerce: (v) => {
      if (!isFiniteNumber(v)) throw new Error('expected a number');
      return v;
    },
  },
  boolean: {
    parseText: (s) => {
      const t = s.trim().toLowerCase();
      if (['y', 'yes', 'true'].includes(t)) return true;
      if (['n', 'no', 'false'].includes(t)) return false;
      throw new Error(`answer y or n (got "${s.trim()}")`);
    },
    coerce: (v) => {
      if (typeof v !== 'boolean') throw new Error('expected true or false');
      return v;
    },
  },
  /** Interactive input "lat,lng" → [lat, lng]. JSON input: [lat, lng]. */
  latlng: {
    parseText: (s) => {
      const parts = s.split(',').map((p) => Number(p.trim()));
      if (parts.length !== 2 || !parts.every(Number.isFinite))
        throw new Error(`"${s.trim()}" is not "lat,lng"`);
      return parts;
    },
    coerce: (v) => {
      const err = validateLatLng(v);
      if (err) throw new Error(err);
      return v;
    },
  },
  /** Interactive input "south,west,north,east" → [[S,W],[N,E]]. JSON: nested array. */
  bounds: {
    parseText: (s) => {
      const parts = s.split(',').map((p) => Number(p.trim()));
      if (parts.length !== 4 || !parts.every(Number.isFinite))
        throw new Error(`"${s.trim()}" is not "south,west,north,east"`);
      return [
        [parts[0], parts[1]],
        [parts[2], parts[3]],
      ];
    },
    coerce: (v) => {
      const err = validateBounds(v);
      if (err) throw new Error(err);
      return v;
    },
  },
  /** Social handle: empty means "none"; a leading @ is added when missing. */
  handle: {
    parseText: (s) => {
      const t = s.trim();
      if (t === '') return '';
      return t.startsWith('@') ? t : `@${t}`;
    },
    coerce: (v) => {
      if (typeof v !== 'string') throw new Error('expected a string handle');
      const t = v.trim();
      if (t === '') return '';
      return t.startsWith('@') ? t : `@${t}`;
    },
  },
  /**
   * Categories: JSON accepts a preset name (string) or a full array; the
   * interactive runner shows the preset menu (plus a custom entry loop).
   */
  categories: {
    parseText: null, // handled by the interactive runner's menu flow
    coerce: (v) => {
      if (typeof v === 'string') {
        const preset = CATEGORY_PRESETS[v];
        if (!preset)
          throw new Error(
            `unknown category preset "${v}" (known: ${Object.keys(CATEGORY_PRESETS).join(', ')})`,
          );
        return preset;
      }
      return v;
    },
  },
};

/** Rounded so bounds derived from a float center stay clean in the output. */
function round3(n) {
  return Number(n.toFixed(3));
}

export const PROMPTS = [
  {
    id: 'place.name',
    question: 'Place name (used as the site wordmark, e.g. "MarisolCove")',
    kind: 'text',
    required: true,
    validate: (v) => (v === '' ? 'place name is required' : null),
  },
  {
    id: 'place.tagline',
    question: 'Tagline (one sentence describing the site)',
    kind: 'text',
    default: (cfg) =>
      `Open-source, AI-friendly knowledge base for ${cfg.place.name}.`,
  },
  {
    id: 'place.domain',
    question:
      'Domain (custom domain writes CNAME; a *.github.io domain skips it)',
    kind: 'text',
    default: (cfg) => `${slugify(cfg.place.name)}.github.io`,
    validate: (v) =>
      /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v) ? null : `"${v}" is not a domain`,
  },
  {
    id: 'place.locale',
    question: 'Locale (BCP-47 language code; en is the supported baseline)',
    kind: 'text',
    default: 'en',
    validate: (v) => (LOCALE_RE.test(v) ? null : `"${v}" is not a locale code`),
  },
  {
    id: 'categories',
    question: 'Categories',
    kind: 'categories',
    default: () => CATEGORY_PRESETS['coastal-town'],
    validate: (v) => validateCategories(v),
  },
  {
    id: 'map.center',
    question: 'Map center as "lat,lng" (e.g. "35.102,-120.658")',
    kind: 'latlng',
    required: true,
    validate: (v) => validateLatLng(v),
  },
  {
    id: 'map.zoom',
    question: 'Map initial zoom (1-19)',
    kind: 'number',
    default: 13,
    validate: (v) =>
      Number.isInteger(v) && v >= 1 && v <= 19 ? null : 'zoom must be an integer 1-19',
  },
  {
    id: 'map.maxBounds',
    question: 'Map max bounds as "south,west,north,east"',
    kind: 'bounds',
    default: (cfg) => {
      const [lat, lng] = cfg.map.center;
      return [
        [round3(lat - 0.05), round3(lng - 0.07)],
        [round3(lat + 0.05), round3(lng + 0.07)],
      ];
    },
    validate: (v) => validateBounds(v),
  },
  { id: 'features.graph', question: 'Enable knowledge graph page?', kind: 'boolean', default: true },
  { id: 'features.map', question: 'Enable map page?', kind: 'boolean', default: true },
  { id: 'features.dashboard', question: 'Enable health dashboard page?', kind: 'boolean', default: true },
  { id: 'features.soundscape', question: 'Enable soundscape (needs audio assets)?', kind: 'boolean', default: false },
  { id: 'features.feedback', question: 'Enable feedback widget (needs a worker)?', kind: 'boolean', default: false },
  { id: 'features.chat', question: 'Enable chat (needs a worker)?', kind: 'boolean', default: false },
  { id: 'features.social', question: 'Show social links (footer + SEO)?', kind: 'boolean', default: false },
  { id: 'features.analytics', question: 'Enable analytics?', kind: 'boolean', default: false },
  { id: 'features.og', question: 'Enable per-article OG images (needs a worker)?', kind: 'boolean', default: false },
  {
    id: 'links.repo',
    question: 'GitHub repository URL of this instance',
    kind: 'text',
    default: (cfg) => `https://github.com/OWNER/${slugify(cfg.place.name)}`,
    validate: (v) => (/^https?:\/\/\S+$/.test(v) ? null : `"${v}" is not a URL`),
  },
  {
    id: 'links.email',
    question: 'Contact email',
    kind: 'text',
    default: (cfg) => `hello@${cfg.place.domain}`,
    validate: (v) => (/^\S+@\S+\.\S+$/.test(v) ? null : `"${v}" is not an email`),
  },
  { id: 'links.social.twitter', question: 'Twitter/X handle (blank for none)', kind: 'handle', default: '' },
  { id: 'links.social.threads', question: 'Threads handle (blank for none)', kind: 'handle', default: '' },
  { id: 'links.social.instagram', question: 'Instagram handle (blank for none)', kind: 'handle', default: '' },
  {
    // Blank by default because the worker is deployed AFTER init (DEPLOY.md
    // §Cloudflare Workers): an adopter has no URL to give yet. Blank is also the
    // absent-safe off state — the widget needs both features.feedback and a
    // non-empty endpoint — so the emitted config is valid either way.
    id: 'workers.feedback',
    question: 'Feedback worker URL (blank until you deploy workers/feedback)',
    kind: 'text',
    default: '',
    validate: (v) =>
      v === '' || /^https?:\/\/\S+$/.test(v) ? null : `"${v}" is not a URL`,
  },
  {
    id: 'workers.chat',
    question: 'Chat worker URL (blank until you deploy workers/chat)',
    kind: 'text',
    default: '',
    validate: (v) =>
      v === '' || /^https?:\/\/\S+$/.test(v) ? null : `"${v}" is not a URL`,
  },
  {
    id: 'workers.og',
    question: 'OG image worker URL (blank until you deploy workers/og)',
    kind: 'text',
    default: '',
    validate: (v) =>
      v === '' || /^https?:\/\/\S+$/.test(v) ? null : `"${v}" is not a URL`,
  },
];
