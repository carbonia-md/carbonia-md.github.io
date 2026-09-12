/**
 * LANGUAGES_REGISTRY -- single source of truth for enabled UI languages.
 *
 * Trimmed to English-only for the rebuild (task 1.1a), then re-enabled for a
 * second language (Italian) as a controlled, instance-local experiment before
 * discussing upstreaming with the framework owner — see /PROGRESS.md. The
 * registry shape was kept (framework capability) so adding a language is a
 * config edit, not a code change: append an entry here + a
 * `place.config.languages` code + wrapper pages. The fork's babel/cascade
 * i18n toolchain is still NOT ported (STRATEGIC-DIRECTION §F) — this reuses
 * the hand-rolled `src/i18n/*` helpers, not a new toolchain.
 */

export interface LanguageEntry {
  code: string;
  displayName: string;
  hreflang: string;
  isDefault?: boolean;
  enabled: boolean;
  notes?: string;
}

export const LANGUAGES = [
  {
    code: 'en',
    displayName: 'English',
    hreflang: 'en',
    isDefault: true,
    enabled: true,
  },
  {
    code: 'it',
    displayName: 'Italiano',
    hreflang: 'it',
    enabled: true,
  },
] as const satisfies readonly LanguageEntry[];

export type Lang = (typeof LANGUAGES)[number]['code'];

export const ENABLED_LANGUAGE_CODES: readonly Lang[] = LANGUAGES.filter(
  (l) => l.enabled,
).map((l) => l.code);

export const ALL_LANGUAGE_CODES: readonly Lang[] = LANGUAGES.map((l) => l.code);

export const DEFAULT_LANGUAGE: LanguageEntry = LANGUAGES.find(
  (l): l is Extract<(typeof LANGUAGES)[number], { isDefault: true }> =>
    'isDefault' in l,
)!;

export const LANGUAGE_DISPLAY_NAMES: Record<string, string> =
  Object.fromEntries(LANGUAGES.map((l) => [l.code, l.displayName]));

export function getLanguage(code: string): LanguageEntry | undefined {
  return LANGUAGES.find((l) => l.code === code);
}
