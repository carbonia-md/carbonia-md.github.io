/**
 * place.config.ts — THE ingress for this instance's place identity.
 *
 * Everything place-specific (name, categories, map, feature toggles, SEO) lives
 * here. `src/` and `scripts/` stay generic and read from this file, so a single
 * file re-places the whole site. Init-time fields (place, categories, map) are
 * written once by the `npm run init` wizard; `features` and `languages` are
 * runtime-toggleable.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * These are DEMO values for a FICTIONAL town, "Marisol Cove". The sekai-kb
 * template ships them so the site builds and deploys out of the box; a fictional
 * place means the template never owes real-place accuracy upkeep. Run
 * `npm run init` (or the /sekai-adopt skill) to overwrite this file with your own place.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface PlaceConfig {
  place: {
    name: string;
    brandSuffix?: string;
    tagline: string;
    domain: string;
    locale: string;
    languages: string[];
  };
  /** 5-14 categories. slug/icon/description feed nav, hubs, and category pages. */
  categories: Array<{
    slug: string;
    title: string;
    icon: string;
    description: string;
    color?: string;
    colorLight?: string;
  }>;
  /** Leaflet init: center [lat, lng], zoom, and maxBounds [[S,W],[N,E]]. */
  map: {
    center: [number, number];
    zoom: number;
    maxBounds: [[number, number], [number, number]];
  };
  features: {
    graph: boolean;
    map: boolean;
    dashboard: boolean;
    soundscape: boolean;
    feedback: boolean;
    chat: boolean;
    social: boolean;
    analytics: boolean;
    og: boolean;
  };
  /**
   * Outbound identity links. `repo` + `email` are always rendered (footer,
   * SEO sameAs/contactPoint, the "edit on GitHub" affordance). `social`
   * handles feed the footer social row and SEO sameAs, and render ONLY when
   * `features.social` is true. Handles include the leading `@`; component
   * code strips it when building platform URLs.
   */
  links: {
    repo: string;
    email: string;
    social: {
      twitter?: string;
      threads?: string;
      instagram?: string;
    };
  };
  /**
   * Deployed Cloudflare Worker endpoints (`docs/runbook/DEPLOY.md` §Cloudflare
   * Workers). Absent-safe: a missing key — or an empty string — keeps the
   * capability that needs it off even when its `features` flag is true, so an
   * instance upgrading across a framework release never has to edit config.
   */
  workers?: {
    /** URL of this instance's deployed `workers/feedback/` worker. */
    feedback?: string;
    /**
     * D1 `database_id` for `workers/feedback/`, printed by `wrangler d1 create`.
     * It lives here because the generated `workers/feedback/wrangler.generated.toml`
     * is disposable and gitignored, and `workers/` may carry no instance identity
     * (iron rule 2). An account-scoped id, not a credential: useless without account
     * auth. `npm run worker-config` reads it; unset generates an empty id and says so.
     */
    feedbackDatabaseId?: string;
    /**
     * Feedback submissions accepted per hashed address in the rolling window.
     * Template default `5`. The limit is keyed on a hash of the caller's public
     * address, so everyone behind one NAT — a hotspot, a cafe, a school, a group
     * standing at one QR placement — shares one budget, and a rejected submission
     * is silent from the operator's side. Raise it for busier placements.
     * `docs/runbook/DEPLOY.md` §Deploying the feedback worker.
     */
    feedbackRateLimitMax?: number;
    /**
     * Length of that rolling window, in seconds. Template default `3600`.
     * `docs/runbook/DEPLOY.md` §Deploying the feedback worker.
     */
    feedbackRateLimitWindowSeconds?: number;
    /** URL of this instance's deployed `workers/chat/` worker. */
    chat?: string;
    /** D1 `database_id` for the chat worker's rolling rate-limit state. */
    chatDatabaseId?: string;
    /**
     * Accepted chat requests per hashed address in the rolling window. Template
     * default `20`. The limit is keyed on a hash of the caller's public address, so
     * everyone behind one NAT — a hotspot, a cafe, a school — shares one budget.
     * Raise it for busier placements. `docs/runbook/DEPLOY.md` §Deploying the chat
     * worker.
     */
    chatRateLimitMax?: number;
    /**
     * Length of that rolling window, in seconds. Template default `3600`.
     * `docs/runbook/DEPLOY.md` §Deploying the chat worker.
     */
    chatRateLimitWindowSeconds?: number;
    /**
     * Cosine score a corpus chunk must reach to be retrieved by the chat worker,
     * within `0..1`. Template default `0.46`, measured against the demo corpus —
     * a separating value is a property of YOUR corpus, so re-measure it and record
     * the answer here. `docs/runbook/DEPLOY.md` §Tuning the relevance floor has
     * the procedure.
     */
    chatRelevanceFloor?: number;
    /** URL of this instance's deployed `workers/og/` worker. */
    og?: string;
  };
  seo: {
    defaultOgImage: string;
    twitterHandle?: string;
  };
  home: {
    hero: {
      subtitle: string;
      description: string;
      highlight: string;
      cta: { explore: string; github: string };
    };
    stats: Array<{ icon: string; number: string; label: string }>;
    doors: Array<{
      icon: string;
      href: string;
      title: string;
      sub: string;
      tone: 'green' | 'blue' | 'amber' | 'plum';
    }>;
    coverStory: {
      heading: string;
      lead: string;
      quotes: Array<{
        era: string;
        quote: string;
        cite: string;
      }>;
      closing: string[];
      aboutLinkText: string;
    };
    randomDiscovery: {
      button: string;
      subtitle: string;
      description: string;
    };
    features: {
      title: string;
      cards: Array<{ icon: string; title: string; description: string }>;
      cta: { graph: string; ssot: string };
    };
    exhibitions: {
      heading: string;
      divider: string;
      halls: Array<{
        label: string;
        paragraphs: Array<{
          text: string;
          pillHref: string;
          pillIcon: string;
          pillLabel: string;
          categorySlug: string;
        }>;
      }>;
    };
    recentUpdates: {
      heading: string;
      subtitle: string;
      viewAll: string;
      latestLabel: string;
    };
    contribute: {
      heading: string;
      description: string;
      guideLabel: string;
      githubLabel: string;
    };
  };
}

const config: PlaceConfig = {
  place: {
    name: 'Sekai',
    brandSuffix: '-kb',
    tagline:
      'Open-source, AI-friendly knowledge base for the fictional coastal town of Marisol Cove — the sekai-kb demo place.',
    domain: 'sekai-kb.42init.com',
    locale: 'en',
    languages: ['en'],
  },
  categories: [
    {
      slug: 'history',
      title: 'History',
      icon: '📜',
      description:
        'Founding, the fishing era, the arts revival, and civic milestones',
      color: '#92400e',
      colorLight: '#f59e0b20',
    },
    {
      slug: 'beaches',
      title: 'Beaches',
      icon: '🏖️',
      description: 'Coves, tide pools, access points, and swimming conditions',
      color: '#0284c7',
      colorLight: '#0284c720',
    },
    {
      slug: 'nature',
      title: 'Nature',
      icon: '🌊',
      description:
        'Kelp forests, coastal sage, marine life, and the preserve system',
      color: '#0e7490',
      colorLight: '#0e749020',
    },
    {
      slug: 'trails',
      title: 'Trails',
      icon: '🥾',
      description: 'Ridge hikes, bluff walks, and canyon routes above the cove',
      color: '#15803d',
      colorLight: '#15803d20',
    },
    {
      slug: 'food',
      title: 'Food',
      icon: '🍽️',
      description: 'Cafes, seafood shacks, markets, and culinary landmarks',
      color: '#ea580c',
      colorLight: '#ea580c20',
    },
  ],
  map: {
    // Fictional central-coast location; markers in the demo articles cluster here.
    center: [35.102, -120.658],
    zoom: 13,
    // Cove extent (SW → NE corners), keeps panning within Marisol Cove.
    maxBounds: [
      [35.05, -120.72],
      [35.16, -120.58],
    ],
  },
  features: {
    graph: true,
    map: true,
    dashboard: true,
    soundscape: true,
    feedback: false,
    chat: false,
    social: false,
    analytics: false,
    og: false,
  },
  links: {
    repo: 'https://github.com/wilsonkichoi/sekai-kb',
    email: 'hello@sekai-kb.42init.com',
    social: {
      twitter: '@sekaikb',
      threads: '@sekaikb',
      instagram: '@sekaikb',
    },
  },
  seo: {
    defaultOgImage: '/og-default.png',
    twitterHandle: '@sekaikb',
  },
  home: {
    hero: {
      subtitle: 'Knowledge, curated.',
      description:
        'An open-source, AI-friendly knowledge base covering every facet of this small coastal town, from tide pools to ridge trails.',
      highlight: 'Sourced. Verified. Always evolving.',
      cta: { explore: 'Explore Topics', github: 'Star on GitHub' },
    },
    stats: [
      { icon: '🏖️', number: '4 mi', label: 'of shoreline' },
      { icon: '🌿', number: '12', label: 'coves & beaches' },
      { icon: '🥾', number: '20+', label: 'miles of trails' },
      { icon: '📚', number: '5', label: 'knowledge domains' },
    ],
    doors: [
      {
        icon: '🚪',
        href: '#cover-story',
        title: 'First time here?',
        sub: 'Start with the story',
        tone: 'green',
      },
      {
        icon: '🔍',
        href: '/explore',
        title: 'Search everything',
        sub: 'Full-text across all articles',
        tone: 'blue',
      },
      {
        icon: '🎲',
        href: '#random-discovery',
        title: 'Surprise me',
        sub: 'Random deep-dive article',
        tone: 'amber',
      },
      {
        icon: '📊',
        href: '/dashboard',
        title: 'Site health',
        sub: 'Freshness and coverage stats',
        tone: 'plum',
      },
    ],
    coverStory: {
      heading: 'The Story So Far',
      lead: 'Four miles of coast. A century and a half of small-town history. One knowledge base to hold it all.',
      quotes: [
        {
          era: 'Early',
          quote:
            'Coastal peoples fished these tide pools and gathered in the sheltered cove for generations before any survey drew a line around it.',
          cite: 'Regional coastal survey, demo record',
        },
        {
          era: '1861',
          quote:
            'A handful of fishing families built the first wharf at the north end of the cove, and Marisol had a name on the map.',
          cite: 'Town founding, demo record',
        },
        {
          era: '1912',
          quote:
            'When the sardine runs thinned, painters and boatwrights stayed on. The town leaned into craft instead of catch.',
          cite: 'Local history, demo record',
        },
        {
          era: '1948',
          quote:
            'The Harborlight Cafe opened on the pier and never closed. It still pours the first coffee before sunrise.',
          cite: 'Harborlight Cafe, demo record',
        },
        {
          era: '1979',
          quote:
            'The town voted to protect the kelp forest offshore, one of the first community-run marine preserves on this stretch of coast.',
          cite: 'Preserve charter, demo record',
        },
        {
          era: 'Today',
          quote:
            'A working cove that became a quiet town, still shaped by the impulse to keep what makes it different.',
          cite: 'Contemporary observation',
        },
        {
          era: '.md',
          quote:
            'This knowledge base exists to document all of it: sourced, verified, and open for anyone to read or improve.',
          cite: 'Project mission statement',
        },
      ],
      closing: [
        'Every article in this knowledge base traces back to sources.',
        'The goal is not promotion. The goal is the most complete, accurate account of this place that exists anywhere.',
      ],
      aboutLinkText: 'Read the full story',
    },
    randomDiscovery: {
      button: 'Roll the dice',
      subtitle: 'Random deep-dive article',
      description:
        'Every article has footnotes. Hit the button and land somewhere you did not expect.',
    },
    features: {
      title: 'What Makes This Different',
      cards: [
        {
          icon: '🎯',
          title: 'Curated, Not Scraped',
          description:
            'Every article is written and fact-checked by hand, not generated from search results.',
        },
        {
          icon: '🤖',
          title: 'AI-Friendly',
          description:
            'Structured endpoints at /kb/ and /llms.txt for LLM consumption. Built for machines and humans.',
        },
        {
          icon: '🔍',
          title: 'Source-Traced',
          description:
            'Footnotes cite sources. Claims link to evidence. Verification dates are visible.',
        },
        {
          icon: '📚',
          title: 'Comprehensive',
          description:
            'Five domains covering the full spectrum: history, beaches, nature, trails, and food.',
        },
      ],
      cta: { graph: 'Explore the Knowledge Graph', ssot: 'View Raw Knowledge' },
    },
    exhibitions: {
      heading: 'Exhibition Halls',
      divider: 'All Categories',
      halls: [
        {
          label: 'I — The Coast',
          paragraphs: [
            {
              text: 'Four miles of shoreline folded into a dozen coves, each with a different character. Lantern Cove rewards the descent with tide pools and a sea cave you can walk into at low tide.',
              pillHref: '/beaches',
              pillIcon: '🏖️',
              pillLabel: 'The beaches',
              categorySlug: 'beaches',
            },
            {
              text: 'Below the tideline, a kelp forest shelters garibaldi, sea hares, and octopus. The community-run marine preserve offshore is one of the most closely watched on this coast.',
              pillHref: '/nature',
              pillIcon: '🌊',
              pillLabel: 'Nature',
              categorySlug: 'nature',
            },
          ],
        },
        {
          label: 'II — The Story',
          paragraphs: [
            {
              text: 'Coastal peoples gathered at the cove long before the first wharf. Fishing families named the town in 1861; when the sardine runs thinned, boatwrights and painters stayed on and the town leaned into craft.',
              pillHref: '/history',
              pillIcon: '📜',
              pillLabel: 'History',
              categorySlug: 'history',
            },
            {
              text: 'The Harborlight Cafe has poured coffee on the pier since 1948. The town is not fast-casual chains; it is the kind of place where the cook remembers your order and the bread is baked two doors down.',
              pillHref: '/food',
              pillIcon: '🍽️',
              pillLabel: 'Food',
              categorySlug: 'food',
            },
          ],
        },
        {
          label: 'III — The Land',
          paragraphs: [
            {
              text: 'Behind the beach, the ridge climbs fast. The Summit Ridge Trail gives you the whole cove and the open Pacific in a single glance, and the canyon routes below it stay green well into summer.',
              pillHref: '/trails',
              pillIcon: '🥾',
              pillLabel: 'Trails',
              categorySlug: 'trails',
            },
            {
              text: 'Coastal sage scrub covers the slopes, home to gnatcatchers, bobcats, and the last stands of native cactus above the cove. Much of it falls inside the preserve the town voted to protect.',
              pillHref: '/nature',
              pillIcon: '🌊',
              pillLabel: 'Nature',
              categorySlug: 'nature',
            },
          ],
        },
      ],
    },
    recentUpdates: {
      heading: 'Recent Updates',
      subtitle: 'Latest changes to the knowledge base',
      viewAll: 'View All Changes',
      latestLabel: 'Latest Articles',
    },
    contribute: {
      heading: 'Contribute',
      description:
        'This is an open-source project. Every article, every source, every line of code is public. If you know something we missed, you can fix it.',
      guideLabel: 'Contribution Guide',
      githubLabel: 'View on GitHub',
    },
  },
};

export default config;
