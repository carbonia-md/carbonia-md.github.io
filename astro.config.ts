import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import tailwindcss from '@tailwindcss/vite';
import remarkWikilinks from './plugins/remark-wikilinks.mjs';
import placeConfig from './place.config';
import { ENABLED_LANGUAGE_CODES, DEFAULT_LANGUAGE } from './src/config/languages';

export default defineConfig({
  site: `https://${placeConfig.place.domain}`,
  markdown: {
    processor: unified({
      remarkPlugins: [
        [remarkWikilinks, {
            categories: placeConfig.categories,
            languages: ENABLED_LANGUAGE_CODES,
            defaultLanguage: DEFAULT_LANGUAGE.code,
          }],
      ],
    }),
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
