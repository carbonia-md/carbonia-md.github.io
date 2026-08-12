/**
 * chat.ts — the one place that decides whether this instance has a chat surface.
 *
 * Three surfaces ask the same question: `/chat` itself (render the live panel or the
 * disabled state), and the Header and Footer entry points (link to it or omit the
 * link). They must never disagree, because a nav link to a page that renders "chat is
 * not enabled here" is worse than no link, so the predicate lives here rather than
 * being spelled out three times.
 *
 * The gate is BOTH halves, matching `FeedbackWidget.astro`: a `features.chat` flag
 * turned on before the worker exists would otherwise render a panel that posts
 * nowhere, and an endpoint configured while the flag is off is a deliberate "not yet".
 * `workers` and every key inside it are optional (SPEC ``place.config.ts``), so a
 * config written before the key existed reads as an empty endpoint rather than
 * throwing.
 *
 * This file lives under src/, which both machine gates scan: its source is pure ASCII
 * and carries no place-specific string.
 */
import type { PlaceConfig } from '../../place.config';

export interface ChatSurface {
  /** True only when the feature flag is on AND a non-empty endpoint is configured. */
  enabled: boolean;
  /** The trimmed worker endpoint, or `''` when none is configured. */
  endpoint: string;
}

/**
 * Resolves the chat surface from a place config. Total over the four flag/endpoint
 * combinations: only flag-on plus non-empty-endpoint enables anything.
 */
export function resolveChat(config: PlaceConfig): ChatSurface {
  const endpoint = (config.workers?.chat ?? '').trim();
  return {
    enabled: config.features?.chat === true && endpoint !== '',
    endpoint,
  };
}
