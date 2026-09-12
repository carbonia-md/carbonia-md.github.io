import { ui, defaultLang, showDefaultLang } from './ui';
import { ALL_LANGUAGE_CODES } from '../config/languages';
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
    return !showDefaultLang && l === defaultLang ? path : `/${l}${path}`;
  };
}
