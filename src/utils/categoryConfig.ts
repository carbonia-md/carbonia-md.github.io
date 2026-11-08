/**
 * categoryConfig.ts — category metadata (colors, icons, descriptions).
 *
 * Derives from place.config.ts categories; adds display colors for the article
 * surface (hero tints, tag badges, sidebar accents). Colors are instance-owned:
 * each adopter supplies them via categories[].color/colorLight in place.config.ts.
 */
import placeConfig from '../../place.config';
import { localizedCategoryText } from '../lib/place-i18n';

export interface CategoryConfig {
  name: string;
  description: string;
  icon: string;
  color: string;
  colorLight: string;
}

const DEFAULT_COLOR = { color: '#475569', colorLight: '#47556920' };

const configCache = new Map<string, Record<string, CategoryConfig>>();

function buildConfigs(lang: string): Record<string, CategoryConfig> {
  return Object.fromEntries(
    placeConfig.categories.map((cat) => {
      const text = localizedCategoryText(cat.slug, lang);
      return [
        cat.slug,
        {
          name: text.title,
          description: text.description,
          icon: cat.icon,
          color: cat.color ?? DEFAULT_COLOR.color,
          colorLight: cat.colorLight ?? DEFAULT_COLOR.colorLight,
        },
      ];
    }),
  );
}

export type CategoryKey = string;

export const categoryList: string[] = placeConfig.categories.map((c) => c.slug);

/** `name`/`description` are the display text in `lang` (default: base language). */
export function getCategoryConfigs(lang = 'en'): Record<string, CategoryConfig> {
  let configs = configCache.get(lang);
  if (!configs) {
    configs = buildConfigs(lang);
    configCache.set(lang, configs);
  }
  return configs;
}

export function getCategoryConfig(slug: string, lang = 'en'): CategoryConfig | undefined {
  return getCategoryConfigs(lang)[slug];
}
