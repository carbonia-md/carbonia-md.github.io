import { ui, defaultLang, showDefaultLang } from './ui';
import type { Lang } from '../config/languages';

/**
 * Trimmed en-only i18n helpers (task 1.1a). The fork's multi-language fallback
 * cascade + babel tooling is not ported (STRATEGIC-DIRECTION §F); with a single
 * enabled language these collapse to: always `en`, identity path translation.
 * The registry shape is kept so re-enabling languages is a config edit.
 */

export function getLangFromUrl(_url: URL): Lang {
  return defaultLang;
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
