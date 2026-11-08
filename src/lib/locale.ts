/**
 * locale.ts — resolve a per-language value out of a locale map.
 *
 * `place.config.ts`'s translatable fields (category titles/descriptions, home-page
 * copy — see /PROGRESS.md's D2) are `Record<Lang, T>` maps rather than plain
 * strings, e.g. `{ en: 'History', it: 'Storia' }`. Display call sites resolve one
 * with `resolveLocale`; filesystem-path call sites (knowledge/ folder names) must
 * read `.en` directly instead — folder identity never localizes (D2's hard rule).
 */

export function resolveLocale<T>(map: Record<string, T>, lang: string): T {
  return map[lang] ?? map['en'];
}
