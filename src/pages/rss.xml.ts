import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import placeConfig from '../../place.config';
import { getFeedItems } from '../lib/feed';

export async function GET(context: APIContext) {
  const { name, domain, tagline, locale } = placeConfig.place;
  const siteName = `${name}.${domain.split('.').pop()}`;
  const items = await getFeedItems(50);

  return rss({
    title: `${siteName} — ${tagline}`,
    description: tagline,
    site: context.site ?? `https://${domain}`,
    items: items.map((item) => ({
      title: item.title,
      description: item.description,
      pubDate: item.pubDate,
      link: item.link,
      categories: [item.category],
    })),
    customData: `<language>${locale}</language>`,
  });
}
