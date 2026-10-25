import { ui, defaultLang, showDefaultLang } from './ui';
import { ALL_LANGUAGE_CODES, ENABLED_LANGUAGE_CODES } from '../config/languages';
import type { Lang } from '../config/languages';

/**
 * i18n helpers. Originally trimmed to en-only (task 1.1a); `getLangFromUrl`
 * is re-enabled here for a second language (Italian) as a controlled,
 * instance-local experiment — see /PROGRESS.md. The fork's multi-language
 * fallback cascade + babel tooling is still not ported (STRATEGIC-DIRECTION
 * §F); this stays a plain URL-prefix check, not that toolchain.
 */

/**
 * `src/pages/**` routes live under the optional `[...lang]` segment (en
 * unprefixed at `/`, every other enabled language prefixed at `/{lang}/...`
 * — `showDefaultLang` is false). Reads the first path segment and returns it
 * only if it's a real enabled language code; anything else (including no
 * prefix at all) is `defaultLang`.
 */
export function getLangFromUrl(url: URL): Lang {
  const [, maybeLang] = url.pathname.split('/');
  return (ALL_LANGUAGE_CODES as readonly string[]).includes(maybeLang)
    ? (maybeLang as Lang)
    : defaultLang;
}

export function useTranslations(lang: Lang) {
  return function t(key: keyof (typeof ui)[typeof defaultLang]) {
    return (ui as any)[lang]?.[key] ?? (ui as any)[defaultLang]?.[key] ?? String(key);
  };
}

export function useTranslatedPath(lang: Lang) {
  return function translatePath(path: string, l: string = lang) {
    if (!showDefaultLang && l === defaultLang) return path;
    // The language root is `/it`, not `/it/`.
    return path === '/' ? `/${l}` : `/${l}${path}`;
  };
}

/**
 * The language-neutral form of a pathname: `/it/Food/x/` -> `/Food/x/`,
 * `/it` -> `/`. Paths without a language prefix come back unchanged.
 */
export function stripLangPrefix(pathname: string): string {
  const [, maybeLang, ...rest] = pathname.split('/');
  if (!(ALL_LANGUAGE_CODES as readonly string[]).includes(maybeLang)) return pathname;
  return `/${rest.join('/')}`;
}

/**
 * One entry per language the current page exists in, each with its URL path.
 * `available` narrows the set for pages that may lack a translation (articles);
 * every other route is generated for all enabled languages by
 * `lang-static-paths.ts`, so the default is all of them.
 */
export function getAlternates(
  url: URL,
  available: readonly Lang[] = ENABLED_LANGUAGE_CODES,
): { lang: Lang; path: string }[] {
  const base = stripLangPrefix(url.pathname);
  return ENABLED_LANGUAGE_CODES.filter((l) => available.includes(l)).map((l) => ({
    lang: l,
    path: useTranslatedPath(l)(base),
  }));
}
