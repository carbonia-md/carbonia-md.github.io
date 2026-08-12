/**
 * home-defaults.mjs — generic defaults for the `home.*` config block.
 *
 * The home-page copy surface (~200 config lines) exceeds any init interview,
 * so the wizard writes GENERIC defaults computed from the place name and the
 * chosen categories: the site builds and reads sensibly out of the box, and no
 * prompt walks the copy. Place-specific copy arrives later — /sekai-adopt may draft
 * it behind the same human-approval gate as /sekai-seed-articles, or the adopter
 * edits place.config.ts by hand (the file is instance-owned).
 *
 * Every array here is consumed with .map() by the home components, so any
 * category count (5-14) renders without layout assumptions.
 */

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

export function buildHomeDefaults(cfg) {
  const name = cfg.place.name;
  const cats = cfg.categories;

  // Pair categories into exhibition halls (two paragraphs per hall, the
  // layout rhythm the template ships with; a trailing odd category gets its
  // own hall).
  const halls = [];
  for (let i = 0; i < cats.length; i += 2) {
    const pair = cats.slice(i, i + 2);
    halls.push({
      label: `${ROMAN[halls.length] ?? String(halls.length + 1)} — ${pair
        .map((c) => c.title)
        .join(' & ')}`,
      paragraphs: pair.map((c) => ({
        text: `${c.description}. Sourced articles on ${c.title.toLowerCase()} live here as the knowledge base grows.`,
        pillHref: `/${c.slug}`,
        pillIcon: c.icon,
        pillLabel: c.title,
        categorySlug: c.slug,
      })),
    });
  }

  return {
    hero: {
      subtitle: 'Knowledge, curated.',
      description: `An open-source, AI-friendly knowledge base for ${name}: sourced articles, a knowledge graph, and machine-readable endpoints.`,
      highlight: 'Sourced. Verified. Always evolving.',
      cta: { explore: 'Explore Topics', github: 'Star on GitHub' },
    },
    stats: [
      { icon: '📚', number: String(cats.length), label: 'knowledge domains' },
      { icon: '📝', number: 'Day 1', label: 'of the knowledge base' },
      { icon: '🔍', number: '100%', label: 'source-traced articles' },
      { icon: '🤖', number: '/kb', label: 'AI-readable endpoints' },
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
      lead: `Every place has a story. This knowledge base exists to hold the story of ${name}: sourced, verified, and open.`,
      quotes: [
        {
          era: 'Then',
          quote:
            'Replace these placeholder quotes with moments from the historical record: the founding, the turning points, the thing that made this place what it is.',
          cite: 'Placeholder, edit home.coverStory in place.config.ts',
        },
        {
          era: 'Now',
          quote: `Add the one sentence you would tell a first-time visitor about ${name} today.`,
          cite: 'Placeholder, edit home.coverStory in place.config.ts',
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
          description: `${cats.length} domains covering the full spectrum: ${cats
            .map((c) => c.title.toLowerCase())
            .join(', ')}.`,
        },
      ],
      cta: { graph: 'Explore the Knowledge Graph', ssot: 'View Raw Knowledge' },
    },
    exhibitions: {
      heading: 'Exhibition Halls',
      divider: 'All Categories',
      halls,
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
  };
}
