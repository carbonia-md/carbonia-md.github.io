/**
 * categoryConfig.ts — category metadata (colors, icons, descriptions).
 *
 * Derives from place.config.ts categories; adds display colors for the article
 * surface (hero tints, tag badges, sidebar accents). Colors are instance-owned:
 * each adopter supplies them via categories[].color/colorLight in place.config.ts.
 */
import placeConfig from '../../place.config';

export interface CategoryConfig {
  name: string;
  description: string;
  icon: string;
  color: string;
  colorLight: string;
}

const DEFAULT_COLOR = { color: '#475569', colorLight: '#47556920' };

const configs: Record<string, CategoryConfig> = Object.fromEntries(
  placeConfig.categories.map((cat) => [
    cat.slug,
    {
      name: cat.title,
      description: cat.description,
      icon: cat.icon,
      color: cat.color ?? DEFAULT_COLOR.color,
      colorLight: cat.colorLight ?? DEFAULT_COLOR.colorLight,
    },
  ]),
);

export type CategoryKey = string;

export const categoryList: string[] = placeConfig.categories.map((c) => c.slug);

export function getCategoryConfig(slug: string): CategoryConfig | undefined {
  return configs[slug];
}

export function getCategoryConfigs(): Record<string, CategoryConfig> {
  return configs;
}
