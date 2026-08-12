/**
 * Resolves the OG image URL for a page based on feature flags and worker config.
 *
 * Four cases (absent-safe matrix):
 * 1. features.og=true  + workers.og set     → worker URL
 * 2. features.og=true  + workers.og empty   → static fallback
 * 3. features.og=false + workers.og set     → static fallback
 * 4. features.og=false + workers.og empty   → static fallback
 */
export function resolveOgImage(opts: {
  featureOg?: boolean;
  workerOgUrl?: string;
  categorySlug?: string;
  slug?: string;
  explicitImage?: string;
  defaultOgImage: string;
}): string {
  if (opts.explicitImage) return opts.explicitImage;
  if (
    opts.featureOg === true &&
    opts.workerOgUrl &&
    opts.categorySlug &&
    opts.slug
  ) {
    return `${opts.workerOgUrl}/og/${opts.categorySlug}/${opts.slug}.png`;
  }
  return opts.defaultOgImage;
}
