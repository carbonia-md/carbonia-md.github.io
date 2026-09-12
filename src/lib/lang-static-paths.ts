/**
 * lang-static-paths.ts — shared `getStaticPaths` for pages with no dynamic
 * params of their own besides the `[...lang]` segment every `src/pages/**`
 * route now lives under.
 *
 * `en` (the default language) is unprefixed at `/` (`lang: undefined`);
 * every other enabled language is prefixed at `/{lang}/...` — matching
 * `showDefaultLang = false` in `src/i18n/ui.ts` and `useTranslatedPath`
 * (`src/i18n/utils.ts`). A page with its own dynamic params (e.g.
 * `[category]/[slug].astro`) cross-products this same lang list with its
 * other params instead of importing this helper.
 */
import { ENABLED_LANGUAGE_CODES, DEFAULT_LANGUAGE } from '../config/languages';

export function langStaticPaths() {
  return ENABLED_LANGUAGE_CODES.map((code) => ({
    params: { lang: code === DEFAULT_LANGUAGE.code ? undefined : code },
  }));
}
