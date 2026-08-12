---
name: sekai-snippet
description: |
  Draft a short-form social post from a knowledge/ article and queue it for human
  approval. Reads exactly one article, writes a platform-neutral draft carrying no
  claim that article does not make, and appends it to knowledge/SNIPPET-INBOX.md
  with status pending. Never approves, never publishes, never edits the article.
  TRIGGER when: user says "snippet", "/sekai-snippet", "draft a post", "social post
  from <article>", "short-form draft", or "queue a snippet".
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
---

# /sekai-snippet - Queue a short-form draft

> Grounding is the whole job. A snippet is read by people who have not read the
> article, so a claim invented here is a claim the knowledge base never made and
> cannot defend. `docs/playbook/FACTCHECK-PIPELINE.md` is the standing discipline;
> this skill applies it to a 280-character surface.

## Arguments

`/sekai-snippet <article>` where `<article>` is either a path
(`knowledge/{Category}/{slug}.md`) or a slug this skill resolves. With no
argument, ask which article; never pick one yourself.

Reject unknown arguments. This skill takes no flags: there is no dry-run mode
because it performs no publish and no destructive write, and no approval flag
because approval is a human edit to the queue file and nothing else.

## 1. Resolve exactly one article

Resolve the argument to one existing file under `knowledge/{Category}/`:

```bash
ls knowledge/*/<slug>.md
```

Stop and ask if it resolves to zero or to more than one. A leading-underscore
file (`_*.md`) is a section hub, not an article; refuse it. Never draft from
`src/content/`, which is a derived projection, and never from a root-level
workflow file.

Read the whole article. Read the whole article before writing anything, not a
skim of the opening: the strongest snippet is usually a specific fact from the
middle, and you cannot tell which claims are load-bearing from the lead alone.

## 2. Write the draft

The draft is **derived reporting, not marketing**. Constraints, all binding:

- **Every factual claim appears in the article.** Dates, numbers, names, and
  causal statements are copied or faithfully compressed, never inferred, rounded
  into vagueness, or embellished. If a claim needs a qualifier the article gives
  it ("as of 2019", "the town's own estimate"), the qualifier comes along.
- **No claim the article does not make.** Not from your own knowledge, not from
  the wider web, not from the place's other articles. If the article is thin, the
  snippet is short; that is the correct outcome, not a problem to write around.
- **Platform-neutral text.** No hashtags, no @-handles, no platform-specific
  affordances, no "link in bio". One URL at most, the article's own, and only if
  `place.domain` is set in `place.config.ts`.
- **At most 280 Unicode code points**, the tightest mainstream short-form limit,
  so the text pastes anywhere. Over that, the runner refuses the entry.
- **The house voice**, per `docs/playbook/ARTICLE-PLAYBOOK.md`: concrete, specific,
  no hype adjectives, no rhetorical questions, no "did you know".

Lead with the most specific true thing in the article -- a named person, a dated
event, a number -- rather than a summary of what the article covers.

## 3. Verify the draft against the article

Before writing anything to disk, list every claim in the draft and name the line
or passage of the article that supports it. A claim you cannot point at is
removed, not softened. Show this mapping to the user with the draft.

Then count the characters exactly. Code points, not bytes and not UTF-16 units:

```bash
node -e 'process.stdout.write(String([...require("node:fs").readFileSync(0,"utf8")].length))' < <draft-file>
```

## 4. Append the queue entry

Create `knowledge/SNIPPET-INBOX.md` if it is absent -- a freshly adopted instance
has no queue until the first snippet, because the init wizard reseeds `knowledge/`
with category folders and `INBOX.md` only. Create it by copying the framework's
template, which lives under `scripts/` and therefore survives adoption:

```bash
[ -f knowledge/SNIPPET-INBOX.md ] \
  || cp scripts/tools/snippet/queue-template.md knowledge/SNIPPET-INBOX.md
```

Never hand-write that header. The template carries the lifecycle table, the
approval instruction, and the worked format example the human reads when deciding
whether to approve an entry, and `npm run test:snippet` holds it to the parser.

Append one entry at the end of the file, under its `## Entries` heading:

```
## snippet-<YYYY-MM-DD>-<article-slug>

- slug: <Category>/<article-slug>
- created: <YYYY-MM-DD>
- chars: <count from step 3>
- status: pending
- url:
```

followed by a blank line and the post text in a fenced ```text block.

Rules the runner enforces, so get them right here:

- The id must be unique in the file. A second snippet from the same article on the
  same day takes a `-2`, `-3`, ... suffix.
- `created` is today's date, resolved from the system, never guessed.
- `chars` must equal the code-point count of the post text. A mismatch fails the
  whole queue file, not just this entry.
- `status` is always `pending` on append. **Never write `approved`.** Approval is
  the human's edit; a skill that grants it removes the only gate in the pipeline.
- `url` is left empty.

Append only. Never edit, reorder, or delete an existing entry, whatever its
status -- including a `rejected` one, which is a record of a decision.

## 5. Report and stop

Print the draft, its character count, the claim-to-article mapping from step 3,
and the entry id. Then tell the user exactly what happens next:

1. Read the entry in `knowledge/SNIPPET-INBOX.md` against its source article.
2. Edit `status: pending` to `status: approved` by hand.
3. Run `npm run snippet:publish`.

Do not run the publisher, do not offer to run it, and do not commit the queue
file on the user's behalf. This skill's output is one `pending` entry and nothing
else.
