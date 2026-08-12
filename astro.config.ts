import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import tailwindcss from '@tailwindcss/vite';
import remarkWikilinks from './plugins/remark-wikilinks.mjs';
import placeConfig from './place.config';

export default defineConfig({
  site: `https://${placeConfig.place.domain}`,
  markdown: {
    processor: unified({
      remarkPlugins: [
        [remarkWikilinks, { categories: placeConfig.categories }],
      ],
    }),
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
