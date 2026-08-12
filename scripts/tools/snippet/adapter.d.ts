// adapter.d.ts -- the platform-adapter interface for the snippet pipeline.
//
// This is the whole seam. There is no registry, no loader, and no base class:
// an adapter is a plain object matching `SnippetAdapter`, and
// `scripts/tools/snippet/publish.mjs` imports exactly one of them.
//
// See ./README.md for what an adapter may and may not do, and for the rule that
// governs when the first platform adapter is allowed to exist.

/** One approved queue entry, handed to an adapter verbatim. */
export interface SnippetDraft {
  /** The entry id, e.g. `snippet-2026-07-31-tide-pools`. Stable and unique. */
  readonly id: string;
  /** `<Category>/<article-slug>` -- the knowledge/ article the draft is grounded in. */
  readonly slug: string;
  /** ISO date the draft was queued, `YYYY-MM-DD`. */
  readonly created: string;
  /** Unicode code points in `text`. Validated against `text` before publish. */
  readonly chars: number;
  /** The post text, exactly as the human approved it. Never truncate it. */
  readonly text: string;
}

/** What an adapter returns once the post is live. */
export interface PublishResult {
  /** The canonical http(s) URL of the published post. Written back to the queue. */
  readonly url: string;
}

/**
 * A publishing sink.
 *
 * `publish` either resolves with the live post's URL or throws. Throwing leaves
 * the entry `approved` so a later run retries it; it never marks the entry
 * `posted`. An adapter is not asked to enforce `maxChars` -- the runner refuses
 * an over-length entry before calling `publish`, so an adapter never receives a
 * draft it would have to truncate.
 */
export interface SnippetAdapter {
  /** Short identifier used in runner output, e.g. `manual`. */
  readonly id: string;
  /** Longest post this sink accepts, in Unicode code points. */
  readonly maxChars: number;
  publish(draft: SnippetDraft): Promise<PublishResult>;
}
