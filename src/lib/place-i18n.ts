/**
 * place-i18n.ts — per-language display text from `place.config.ts`.
 *
 * `place.translations.ts` holds, per language, a partial overlay over the base
 * (default-language) `place.config.ts` values: tagline, category title/description, and home-page copy. Anything absent
 * falls back to the base value, and structural fields (slugs, hrefs, icons) are
 * never translated. Folder-path call sites (knowledge/ directory names) must keep
 * reading `categories[].title` from the base config directly — folder identity
 * never localizes (PROGRESS.md D2's hard rule).
 */
import placeConfig from '../../place.config';
import type { PlaceConfig } from '../../place.config';
import translations from '../../place.translations';

// Objects merge key-wise; arrays merge index-wise (an override longer than the
// base appends); anything else is replaced by the override when present.
function merge(base: any, over: any): any {
  if (over === undefined) return base;
  if (Array.isArray(over)) {
    const b = Array.isArray(base) ? base : [];
    return Array.from({ length: Math.max(b.length, over.length) }, (_, i) =>
      merge(b[i], over[i]),
    );
  }
  if (over !== null && typeof over === 'object') {
    const b = base !== null && typeof base === 'object' ? base : {};
    const out: Record<string, any> = { ...b };
    for (const key of Object.keys(over)) out[key] = merge(b[key], over[key]);
    return out;
  }
  return over;
}

const homeCache = new Map<string, PlaceConfig['home']>();

export function localizedHome(lang: string): PlaceConfig['home'] {
  let home = homeCache.get(lang);
  if (!home) {
    home = merge(placeConfig.home, translations[lang]?.home);
    homeCache.set(lang, home!);
  }
  return home!;
}

export function localizedTagline(lang: string): string {
  return translations[lang]?.tagline ?? placeConfig.place.tagline;
}

/** Display title + description for a category in `lang` (base values as fallback). */
export function localizedCategoryText(
  slug: string,
  lang: string,
): { title: string; description: string } {
  const base = placeConfig.categories.find((c) => c.slug === slug);
  const over = translations[lang]?.categories?.[slug];
  return {
    title: over?.title ?? base?.title ?? slug,
    description: over?.description ?? base?.description ?? '',
  };
}
