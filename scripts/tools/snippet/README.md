# Snippet pipeline

Short-form drafts, grounded in a `knowledge/` article, queued for human approval
and published through an adapter.

```
/sekai-snippet <article>   ->  knowledge/SNIPPET-INBOX.md   ->  npm run snippet:publish
      draft, status: pending      human edits to: approved        adapter -> status: posted
```

Nothing publishes without the approval edit. That is the point of the pipeline,
not a policy layered on top of it: the runner only ever reads `approved` entries,
so a draft that no human touched is unreachable from the publish path.

| Path | What it is |
| ---- | ---------- |
| `knowledge/SNIPPET-INBOX.md` | The queue. Human-edited Markdown; the file's own header documents the entry format. |
| `queue-template.md` | The empty queue `/sekai-snippet` copies when the instance has none. |
| `queue.mjs` | Parse, validate, and write back the queue. Line-level edits only, so hand-written formatting survives. |
| `adapter.d.ts` | The adapter interface. The whole seam, in one file. |
| `manual-adapter.mjs` | The only sink this framework ships. Not a platform client. |
| `publish.mjs` | The runner. `npm run snippet:publish`. |

## The adapter interface

```ts
interface SnippetAdapter {
  readonly id: string;                                // e.g. "manual"
  readonly maxChars: number;                          // Unicode code points
  publish(draft: SnippetDraft): Promise<{ url: string }>;
}
```

`SnippetDraft` carries `{ id, slug, created, chars, text }` -- the queue entry
verbatim. `adapter.d.ts` is the authoritative declaration; the block above is a
summary of it.

Three rules the runner enforces so an adapter does not have to:

- **An over-length entry never reaches `publish`.** The runner compares the
  entry's `chars` against `maxChars` first and refuses the entry with a message
  naming it and the overage. It never truncates: the text is what a human
  approved, and cutting it would publish something nobody signed off on.
- **`chars` must match the text.** A hand edit that shortens the post but leaves
  `chars` stale fails the whole run, rather than being silently recomputed around.
- **Throwing is safe.** A `publish` that rejects leaves the entry `approved`, so a
  later run retries it. Only a resolved http(s) URL moves an entry to `posted`.

## The queue file may change under a run

A sink that waits on a human holds the file open for as long as the human takes.
The runner therefore never writes the snapshot it parsed: it re-reads the queue
after the last entry and re-applies only the `status` and `url` lines of what it
published. An entry appended by a `/sekai-snippet` run in another window, or a
hand edit made while the operator was posting, survives.

When the concurrent change touches an entry this run published -- its text was
edited, its status moved, it was deleted, or the file no longer parses -- there is
no safe merge, because recording a live URL against text nobody posted is worse
than recording nothing. The runner writes nothing, prints each published entry
with its URL, and exits 1. The posts are already live; the operator sets those two
lines by hand.

## Where the queue file comes from

`npm run init` wipes `knowledge/` and reseeds category folders plus `INBOX.md`, so
an adopted instance has no queue until its first snippet. `queue-template.md` is
the empty queue the skill copies into `knowledge/SNIPPET-INBOX.md` at that moment.
It lives here, under `scripts/`, precisely because adoption does not touch this
tree: a template inside `knowledge/` would be deleted by the wizard that makes it
necessary. `npm run test:snippet` parses it, and holds this repository's own
`knowledge/SNIPPET-INBOX.md` header byte-identical to it so the two cannot drift.

## Choosing the adapter

`publish.mjs` imports one adapter, by name, at the top of the file:

```js
import { manualAdapter, closeManualAdapter } from './manual-adapter.mjs';

const adapter = manualAdapter;
```

There is no registry, no loader, no plugin directory, and no environment
variable. Switching sinks is a two-line diff that goes through code review --
which is the intended cost. A configuration surface that lets a live posting
target change without review is the wrong shape for a pipeline whose entire
value is the human gate in front of it.

## The manual sink

`manual-adapter.mjs` opens no network connection, holds no credentials, and knows
no platform API. It prints the approved post text, the operator pastes it wherever
they publish, and the operator pastes the resulting URL back. A blank or non-http
answer is a refusal, so the entry stays `approved`.

Its `maxChars` is 280: the tightest limit among mainstream short-form platforms,
which is the only bound a platform-neutral sink can honestly enforce. A draft that
fits it pastes anywhere.

## When a platform adapter may be added

**Only when a real instance has an account on that platform.** Not before.

An adapter written against a platform nobody has signed up for is a guess about
an API, an auth flow, and a rate limit, maintained at the framework's cost until
someone finds out it was wrong. The framework's standing rule is that a feature
exists only once a real instance uses it. The manual sink is what makes waiting
cheap -- `posted` is already reachable, so the first posts go out by hand while
the account is being set up.

When that day comes: add one file per platform beside `manual-adapter.mjs`,
implement `SnippetAdapter`, and re-point the import in `publish.mjs`. Credentials
come from the environment at call time and are never written to the queue, which
is committed content.
