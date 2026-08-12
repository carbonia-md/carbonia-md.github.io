---
name: sekai-triage-feedback
description: |
  Triage new reader-feedback rows from the configured Cloudflare D1 database.
  Classifies every row, deduplicates submissions, files or comments on GitHub
  issues from place.config.ts, and records the result in D1. All writes require
  an explicit human approval after a complete plan; dry-run performs no writes.
  TRIGGER when: user says "triage feedback", "/sekai-triage-feedback", "process feedback", or "file feedback issues".
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
---

# /sekai-triage-feedback - Triage reader feedback

Read unhandled feedback from the instance's D1 database, produce a deterministic
plan, then execute that exact plan only after explicit human approval. Never write
to GitHub or D1 during dry-run.

## Arguments

Accept these optional arguments:

- `--dry-run`: print the complete plan and stop before the approval prompt.
- `--database <name-or-id>`: use this D1 database, named either by its
  `database_name` or by its UUID. Without it, read the `database_name` from the
  `[[d1_databases]]` block whose `binding` is `DB` in
  `workers/feedback/wrangler.generated.toml`, the config `npm run worker-config`
  derives from `place.config.ts`, never the committed `wrangler.toml`, which
  carries framework placeholders only. Fail if that file or that block is absent
  or ambiguous. The UUID form is what a checkout whose generated `database_id` is
  empty needs; step 1 detects that case and requires it.

Without `--dry-run`, live mode plans writes and reaches the approval gate. When
the database argument is omitted, the generated-config lookup above is mandatory.
Reject unknown arguments. Never hardcode a database name.

## 1. Preflight and resolve configuration

Run every command in this skill from the repository root, and never change
directory into `workers/feedback`. This is load-bearing, not a formatting
preference: Wrangler searches upward from the working directory for a
configuration file, so a command started inside `workers/feedback` resolves the
database through that file's `database_id` rather than by the name you passed.
When that id is the template placeholder, every query fails with
`Invalid property: databaseId => Invalid uuid` before a single row is read.

Require these files:

- `place.config.ts`
- `workers/feedback/wrangler.generated.toml`. Absent means the operator has not
  run `npm run worker-config` in this checkout. Stop and report that command
  rather than falling back to the committed `workers/feedback/wrangler.toml`,
  whose values are placeholders and would resolve to no database at all.
- `workers/feedback/migrations/0002_triage.sql`

Use `npx wrangler`; do not add Wrangler to project dependencies. Confirm both
authenticated tools before querying data:

```bash
gh auth status
npx wrangler whoami
```

Load `place.config.ts` with Node, following the same native import pattern used by
the build scripts. Read only:

- `place.domain`, for article URLs;
- `links.repo`, for the target GitHub repository.

Normalize `links.repo` to `owner/repo`. Require a GitHub HTTPS URL or an exact
`owner/repo` value, strip one trailing `.git`, and fail closed on any other host
or shape. Never fall back to the current checkout's remote.

Build the article origin from `place.domain`: preserve an explicit `http://` or
`https://` scheme, otherwise prepend `https://`. Combine `place.domain` plus the
row's `page` with the URL parser. Fail the whole run if a page does not resolve
inside the configured origin.

Require the target repository to contain the `feedback` label. Check it without
mutating the repository. If it is absent, stop; label administration is outside
this triage run.

When the database came from the generated config rather than `--database`, read
`database_id` from that same block. It is empty in an instance that has recorded
no id yet: `npm run worker-config` reads it from `place.config.ts`
(`workers.feedbackDatabaseId`), which the operator fills in after
`wrangler d1 create`. An absent or empty id means the name cannot resolve through
that file, so stop and require the run to name the database by UUID instead,
reporting these commands:

```bash
npx wrangler d1 list
```

Rerun this skill with `--database <uuid>` from that listing. Never edit
`workers/feedback/wrangler.toml` to resolve this: it is framework-owned, carries
placeholders only, and `npm run worker-config:check` fails the build on a real
value committed there. Recording the id in `place.config.ts` and regenerating is
the operator's deploy step (`docs/runbook/DEPLOY.md`), not a step this skill takes.

Read the remote schema through Wrangler and require the `feedback` table to have
`issue_url`. If it does not, stop and report this operator command, substituting
the resolved database name:

```bash
npx wrangler d1 migrations apply <database-name> --remote \
  --config workers/feedback/wrangler.generated.toml
```

That command presumes the generated config carries a real `database_id`, which an
adopter records in `place.config.ts` once at deploy time and regenerates from (see
`docs/runbook/DEPLOY.md`). Unlike the query commands above it accepts no UUID
override, because `d1 migrations apply` resolves the database only through a config
file and needs its `migrations_dir`. In a checkout whose generated id is still
empty, supplying the real one is the operator's separate deploy step, not a step
this skill performs or works around.

Do not apply a migration inside a triage run.

`npx wrangler d1 list` reports a `num_tables` field. It is not a schema check and
can read `0` for a fully migrated database. The `issue_url` check above is the
only authoritative one; never conclude from `num_tables` that a database is
unmigrated or undeployed.

## 2. Read new rows

Run this query through `wrangler d1 execute --command`; `--json` is required so
the result is parsed as data rather than terminal text:

```bash
READ_SQL="SELECT id, created_at, page, category, message, contact, issue_url FROM feedback WHERE status = 'new' ORDER BY created_at, id;"
npx wrangler d1 execute "$DATABASE" --remote --command "$READ_SQL" --json
```

Parse Wrangler's JSON result envelope and require an array of row objects with
all selected fields. Treat an unexpected envelope, duplicate row id, missing
field, or non-string `id`, `page`, `category`, or `message` as a hard stop. If no
rows exist, report `0 new feedback rows` and stop without asking for approval.

Do not print or copy `contact`; this workflow does not need it.

## 3. Classify every row exactly once

Use exactly these five outputs and this ordered decision table. The first matching
row wins, so the classes are mutually exclusive and exhaustive.

| Order | Class | Decidable signal |
|---|---|---|
| 1 | `spam` | The message is an unsolicited promotion, an unrelated link or sales pitch, repeated or unintelligible noise, or abuse with no actionable page feedback. |
| 2 | `broken-link` | The message reports a URL, citation, image, download, anchor, or navigation target that is missing, 404, inaccessible, or points to the wrong resource. |
| 3 | `correction` | The submitted category is `correction`, or the message says an existing claim, date, name, number, instruction, or description is wrong, outdated, or misleading. |
| 4 | `addition` | The submitted category is `addition`, or the message supplies identifiable missing information or a concrete fact, source, place, or context to add. |
| 5 | `praise-other` | Everything else, including praise, thanks, questions, opinions, and non-actionable suggestions that passed the spam rule. |

Record the matched signal in the plan. Do not invent a sixth class and do not
leave a row unclassified. If the signal is genuinely undecidable, stop and ask the
human to classify that row before planning writes.

## 4. Normalize, title, and deduplicate

For deduplication only, normalize each message by:

1. applying Unicode NFKC normalization;
2. case-folding with a locale-stable lowercase operation;
3. collapsing all Unicode whitespace into one ASCII space;
4. trimming leading and trailing whitespace.

Rows with the same `page` and normalized message are one batch group. The oldest
row by `created_at`, then `id`, is the canonical row; every later row in the group
is a duplicate.

Generate the canonical issue title deterministically:

```text
[feedback:<class>] <page> - <normalized-message-summary>
```

Use the first 80 Unicode code points of `page` and the first 100 Unicode code
points of the normalized message, then cap the complete title at 240 Unicode code
points. Do not include place names or repository names in the format.

Fetch every open issue in the target repository through paginated GitHub output,
exclude pull requests, and compare `title` fields for exact equality. Search text
is only a performance hint; it is never the equality check.

A row is a duplicate when either condition holds:

1. its normalized message matches another row for the same `page`; or
2. an open issue already has its generated title.

A duplicate comments on the existing or canonical issue instead of creating a
second issue.

Plan actions as follows:

- `spam`: create no issue; plan D1 status `spam` and `issue_url = NULL`.
- Canonical non-spam row with no matching open title: plan one new issue.
- Canonical non-spam row with a matching open title: plan a comment on that issue.
- Later row in an in-batch group: plan a comment on the canonical row's new or
  existing issue, never a second issue.

Issue bodies and duplicate comments must contain the article URL, the assigned
class, the original submitted category, timestamp, row id, and the quoted
submission. Do not include `contact`. Include this idempotency marker:

```text
<!-- feedback-id:<row-id> -->
```

Before planning a comment, read the issue's comments. If the exact marker already
exists, plan no GitHub write for that row and only the conditional D1 update.

## 5. Display the complete plan

Print one deterministic plan, ordered by `created_at`, then `id`, containing:

- database name and target repository;
- every row id, page, article URL, class, and matched classification signal;
- every generated title;
- every planned `gh issue create` or `gh issue comment`, including the existing
  issue URL when applicable;
- every planned D1 result: `triaged` plus issue URL, or `spam` plus `NULL`;
- totals by class and by action.

Do not display `contact`.

If `--dry-run` is set, print `DRY RUN: no GitHub or D1 writes performed` and stop.
Do not ask for approval and do not execute any write command.

Otherwise stop and ask the human to approve this exact plan. A request to revise,
partial approval, silence, or any answer other than explicit approval is not
approval. Rebuild the plan after revisions.

Before approval, no GitHub or D1 write or update may run.

## 6. Revalidate after approval

Approval expires if its inputs change. Before the first write:

1. rerun the D1 read query and require every planned row to remain unchanged and
   `status = 'new'`;
2. rerun the open-title and idempotency-marker reads;
3. compare the resulting action plan byte-for-byte with the approved plan.

If anything differs, perform no writes, display the revised plan, and require new
explicit approval.

## 7. Execute the approved writes

Use the repository resolved from `links.repo` on every `gh` command.

Create a new issue with:

```bash
gh issue create --repo "$REPO" --title "$TITLE" --label feedback --body-file "$BODY_FILE"
```

Capture and validate the returned issue URL. Comment on an existing or just-created
issue with:

```bash
gh issue comment "$ISSUE_NUMBER" --repo "$REPO" --body-file "$BODY_FILE"
```

After the GitHub action for a non-spam row succeeds, update its D1 row to
`status = 'triaged'` and its created or existing issue URL. For spam, set
`status = 'spam'` and `issue_url = NULL`.

Every non-spam row ends with `status = 'triaged'` and `issue_url` set to the
created or existing issue URL.

Build every SQL string literal with one encoder: reject NUL, replace each single
quote with two single quotes, then wrap the value in single quotes. Never place a
raw row value or URL into SQL. Every update must include both the encoded row id
and `AND status = 'new'`:

```sql
UPDATE feedback
SET status = '<encoded-status>', issue_url = '<encoded-url>'
WHERE id = '<encoded-id>' AND status = 'new';
```

Use SQL `NULL`, without quotes, for spam's `issue_url`. Execute each update with
the resolved database name using this command shape:

```bash
UPDATE_SQL="UPDATE feedback SET status = $STATUS_SQL, issue_url = $ISSUE_URL_SQL WHERE id = $ID_SQL AND status = 'new';"
npx wrangler d1 execute "$DATABASE" --remote --command "$UPDATE_SQL" --json
```

Require Wrangler to report exactly one changed row. Zero or more than one is a
hard stop.

Process one row at a time. If a GitHub write fails, do not update that row in D1.
If a D1 update fails after a GitHub write, stop and report the exact row and issue
URL. On rerun, the title and marker checks make the GitHub side idempotent.

## 8. Verify and report

Read every processed id back from D1 and print `id`, `status`, and `issue_url`.
Require:

- every non-spam row is `triaged` with the expected issue URL;
- every spam row is `spam` with `issue_url` null;
- no processed row remains `new`.

Report the created issue URLs, commented issue URLs, skipped idempotent comments,
spam row ids, and the final D1 values. Never claim a write succeeded from command
exit status alone; the final D1 readback is required.
