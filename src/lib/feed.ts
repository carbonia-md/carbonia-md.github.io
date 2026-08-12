import { getCollection } from 'astro:content';
import placeConfig from '../../place.config';

export interface FeedItem {
  title: string;
  description: string;
  link: string;
  pubDate: Date;
  category: string;
}

/**
 * Feed items for the RSS/Atom endpoints, newest-first. Sourced from the `en`
 * content collection (the sync.sh projection of knowledge/); category set flows
 * from place.config.ts. Shared by rss.xml.ts + feed.xml.ts.
 */
export async function getFeedItems(limit = 50): Promise<FeedItem[]> {
  const validSlugs = new Set(placeConfig.categories.map((c) => c.slug));
  const entries = await getCollection('en');

  const items = entries
    .map((entry) => {
      const parts = entry.id.split('/');
      const category = parts.length > 1 ? parts[0] : 'uncategorized';
      const slug = (parts.length > 1 ? parts.slice(1).join('/') : entry.id).replace(
        /\.md$/,
        '',
      );
      return {
        title: entry.data.title,
        description: entry.data.description ?? '',
        link: `/${category}/${slug}`,
        pubDate: entry.data.date ? new Date(entry.data.date) : new Date(),
        category,
      };
    })
    .filter((item) => validSlugs.has(item.category));

  items.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
  return items.slice(0, limit);
}
