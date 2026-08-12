# ARTICLE-PLAYBOOK — How to Turn Research Into an Article With Some Warmth In It

> After reading this, the next time you sit down with raw material about your place you
> should naturally ask: what's the one thing here a local would tell a friend? What's the
> concrete object or number a reader will remember? Is every quote and figure traceable to
> a real source? Does the opening earn the second sentence?
>
> The mechanical stuff — frontmatter shape, footnote format, word count, SEO length,
> wikilink syntax — is enforced by the `article-health` tool. Run the mandatory ship gate
> after writing (§7.4 covers the media-complete `rewrite-stage-4` self-check too):
>
> ```bash
> npm run article-health -- knowledge/{Category}/{slug}.md --profile=ci-deploy
> ```
>
> This document is for what the tool can't catch: **craft, voice, judgment, warmth**.

All examples below come from the demo place that ships with the template, **Marisol
Cove** — a fictional coastal town. When you adopt the template, your own articles replace
the demo; the craft rules don't change.

---

## 1. What an Article Here Is

A sekai-kb instance is a curated guide, not an encyclopedia and not a brochure.

Don't aim for comprehensive coverage. Aim for every article to leave the reader knowing
one thing they didn't know — a fact, a parking trick, a piece of history that explains why
the place looks the way it does. A good article is one you'd actually repeat to a friend
before they visit: "Did you know the sea cave at Lantern Cove floods completely at high
tide, so the tide chart is not optional?"

Wikipedia answers "What is Lantern Cove?" A travel blog answers "Top 10 Things to Do at
Lantern Cove!" A sekai-kb article answers **"Why the cove's worth knowing about before you
stand in front of it."**

### Three Rules

1. **A reason to know this, not just a fact sheet.** Years, addresses, and hours are the
   skeleton. The one fact or angle that makes a reader care is the flesh.
2. **Every fact is checkable.** A claim with no source behind it is worse than no claim —
   list `source:` URLs in frontmatter; for a specific number or quote that needs
   sentence-level attribution, use a footnote.
3. **Specific, not generic.** "A community-run marine preserve established by a town vote
   in 1979" beats "a beautiful and pristine stretch of coast." If a sentence would be
   equally true of any other town in the region, it doesn't belong in the article.

### Length: Match the Topic, Don't Pad or Compress

Not every topic needs the same depth. The `word-count` gate enforces a 250-word floor as a
stub-catcher, not a target. Three rough bands:

| Band           | Words   | Sources | Fits                                                                 |
| -------------- | ------- | ------- | -------------------------------------------------------------------- |
| **Quick Take** | 250-400 | 1-2     | A single beach, trail, or business with one clear angle              |
| **Standard**   | 400-600 | 2-3     | Most articles — an institution, a neighborhood, a recurring event    |
| **Deep Dive**  | 600-900 | 3-5+    | Contested or layered topics: a disaster, a founding fight, a pivot   |

Judgment call: if the topic needs origin + turning point + present-day state + an honest
complication to make sense, it's Standard or Deep Dive. If two sections cover it
completely, it's a Quick Take, and padding it to hit a higher band produces filler, not
depth.

---

## 2. Five Things to Find Before You Write

Sit with the research first. If you can't find these, you don't have an article yet — you
have a fact sheet.

### 1. The Angle (a small tension, not a thesis)

One sentence. Not "the town has a complicated relationship with development" — that's a
thesis a planning commission would write. A _tension_ is concrete: this exists, but that's
also true, and the gap is interesting.

| Found it                                                                                          |
| -------------------------------------------------------------------------------------------------- |
| The town's founding industry collapsed in the 1910s, and the pivot away from it is now its identity |
| Residents voted to protect the reef from trawling rather than profit from it                        |
| The cafe that opened between two eras of the town's history, and kept the habits of both           |

No angle = the article is still an encyclopedia stub waiting to happen. Either the
research isn't deep enough yet, or the topic genuinely is a two-sentence Quick Take and
that's fine.

### 2. The Object

One concrete thing a reader could touch or photograph. Specification sheets don't stick in
memory; objects do.

Examples in the demo corpus: the wrought-iron lantern that named Lantern Cove's bluff
stairway. The old wharf pilings still visible at low tide. The chalkboard by the
Harborlight Cafe's door with the day's tide and surf.

### 3. The Quote (when one genuinely exists)

Not mandatory for every article — a beach or a trail often has no one's words to quote,
and that's fine. But History and Events entries with named figures (a town vote, a
founding charter, a newspaper account) often _do_ have one, and it's worth digging for. A
quote in quotation marks is a promise that these are the speaker's exact words, traceable
to a source you can cite. Never paraphrase something and then put it in quotes.

### 4. The Scene

Turn an abstract fact into a person/moment/place/action. "The fishing industry declined"
is abstract. "The sardine runs that built the town thinned in the early 1910s; many
fishing families left, and the boatwrights who stayed turned to craft" — from the demo's
founding article — is a scene.

### 5. The Detail — this is where the warmth lives

The thing that isn't in a spec sheet but proves someone actually checked: that the stair
to the cove is closed during high-surf advisories; that the back room of the cafe looks
straight down the pier toward the kelp canopy on calm mornings; that collecting is
prohibited inside the preserve boundary, which runs from the cove mouth south along the
shelf. These details are the difference between a guide written by someone who's been
there and one assembled from a press kit.

**All five found → write. One missing → go back to the source, don't fabricate it to fill
the gap.**

---

## 3. The Opening: Earn the Second Sentence

**Banned**: opening with a vague claim that could describe any town — "Marisol Cove is
known for its stunning coastline and vibrant arts scene." The first sentence has to
contain a specific, checkable anchor: a year, a measurement, a proper noun, a number.

This does **not** mean banning "X is a Y" as a sentence shape — it works when the very
next clause carries a real anchor:

```
✅ "Lantern Cove is a small, rocky beach at the north end of Marisol Cove, named for
   the wrought-iron lantern that once hung over the top of its bluff stairway."
   — "X is a Y" shape, but the sentence is doing real work: location, name origin,
   a physical object.

❌ "Lantern Cove is one of Marisol Cove's most picturesque and beloved coastal spots."
   — Same shape, zero anchors. Could be any beach anywhere.
```

The test isn't the grammar of the first sentence. It's whether a fact-checker could verify
anything in it.

### Five Opening Patterns

| Pattern               | Example                                                                                                | Fits                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| **Identify + anchor** | "Lantern Cove is a small, rocky beach... named for the wrought-iron lantern over its bluff stairway."  | Most place/business entries (default)      |
| **Number shock**      | "Roughly a square mile of reef, protected by a town vote, monitored on four fixed transects."          | Statistics-driven topics                   |
| **Contrast**          | "A town that voted to protect its reef from trawling rather than profit from it."                      | Founding/conservation/policy topics        |
| **Scene**             | "The sardine runs that built the town thinned in the early 1910s, as they did up and down the coast."  | History, events with a clear start moment  |
| **Object first**      | "The old wharf is gone, but its pilings are still visible at low tide from the Lantern Cove stair."    | Landmarks, single-object features          |

---

## 4. Structure

### 4.0 Frontmatter: The Required Shape

Every article opens with a YAML frontmatter block. Copy this skeleton and fill it
in — the field **order**, quoting, and types below are exactly what `article-health`
enforces (`frontmatter-format`), so a copy of this passes the `ci-deploy` gate with
zero frontmatter violations:

```yaml
---
title: 'Article Title'
description: 'One plain sentence describing the article (≤ 160 chars for SEO).'
date: 2026-07-18
category: 'History'
tags: ['tag-one', 'tag-two']
subcategory: 'A grouping within the category'
author: 'Your Place Name'
featured: false
lastVerified: 2026-07-18
lastHumanReview: false
---
```

Rules the linter checks:

- **Field order is canonical** — the ten fields above in exactly that order.
- **String scalars are single-quoted** (`title`, `description`, `category`,
  `subcategory`, `author`).
- **Dates are unquoted ISO** `YYYY-MM-DD` (`date`, `lastVerified`).
- **`tags` is a flow array** — `['a', 'b']`, not a `- a` / `- b` list.
- **`featured` and `lastHumanReview` are booleans** — unquoted `true`/`false`.
  `lastHumanReview` is a **boolean**, not a date: `false` until a human has
  reviewed the article, `true` after.
- **`category` must match the folder** the file lives in under `knowledge/`.
- **All ten fields are required** — a missing one is a HARD failure. `subcategory` is
  mandatory too (its *value* is a loose grouping of your choosing, but the field must be
  present); the sole exception is articles in the `About` category, which are exempt from
  this check.

Optional fields go **after** `lastHumanReview`, in this order when present:
`researchReport`, then the image set (`image`, `imageAlt`, `imageCredit`,
`imageLicense`, `imageSource`), then instance conventions (`source`, `geo`,
`rationale` — the `rationale` block is required for contested categories, §4.9).

### 4.1 The Opening Paragraph + At a Glance

Every article opens with a short prose paragraph (identify the subject, plant the anchor
fact). Immediately after it, before the first `##` heading, add an **At a Glance**
blockquote:

```markdown
> **At a glance:** One or two plain sentences — the single fact or tip you'd
> actually tell a friend before they go. Not a restatement of the opening
> paragraph, not a teaser, not a sales pitch.
```

`format-structure` checks for this on every article (WARN). On a 300-word Quick Take, the
opening paragraph already does most of the "what is this" work — so the blockquote's job
there is narrower: surface the one practical or surprising thing (a hidden access point, a
seasonal closure, a number worth knowing) rather than re-summarizing what the reader just
read. On a Standard or Deep Dive article, it can carry slightly more — the angle from §2.1
in a sentence.

```
✅ "> **At a glance:** The sea cave floods completely at high tide and the bluff
   stair closes during high-surf advisories — check the tide chart before you go."
   (Tells the reader something the opening paragraph didn't.)

❌ "> **At a glance:** Lantern Cove is a beach at the north end of town with a
   sea cave."
   (Just restates the title and the first sentence. Delete.)
```

### 4.2 Body Sections

Adapt to the topic; this isn't a fill-in-the-blank template. Common shapes:

- **Place/landmark**: identify → the one distinguishing feature, in depth → practical
  access details → (optional) ecology/context
- **Institution**: identify → collection/program → history → practical information
- **Event**: identify → history/origin → what the experience is actually like →
  season/schedule → practical information
- **History**: identify with the anchor fact → timeline of what happened → impact
  (numbers) → aftermath/legacy

### 4.3 Subheadings: No Date-Led Timeline Headers

The one hard rule the `chronicle-lead` check enforces: an H2 must never lead with a
literal date — no `## May 2016`, no `## 2020: The Renovation`, no `## 2020.5.6`. That
pattern turns the section into an encyclopedia timeline entry instead of a piece of the
story.

Plain functional labels are fine at this format's scale: `## History`, `## Access`,
`## Tide Pools`, `## Practical Information`, `## Monitoring`, `## Visiting`. At 300-700
words, a reader scanning the table of contents benefits more from knowing exactly what's
in each section than from a clever hook on every header. Where a more specific or
evocative header is genuinely available without straining for it — `## The Sea Cave`,
`## The Sardine Years and After` — use it. Don't force one onto a section that's plainly
just "the hours and the parking situation."

Year ranges (`## 1949-1993`) and decade references (`## The 1990s`) are allowed; they
describe historical scope, not an event-by-event chronicle.

### 4.4 Practical Information

Most place and business entries end with a practical closing section — address, hours,
parking, price range, what to bring (`## Practical Information`, `## Visiting`, or
`## Access`). This is a legitimate, expected closing block for this format, not a cop-out.
It does the job a brochure's footer does, and readers scanning on a phone before they
leave the house want it predictably at the end.

### 4.5 Further Reading

For Standard and Deep Dive articles, add a closing section:

```markdown
## Further Reading

- [[founding-of-marisol-cove|The Founding of Marisol Cove]]
- [[kelp-forest-preserve|Marisol Kelp Forest Preserve]]
```

Use `[[wikilink]]` syntax in the list — it renders to a normal link and, unlike a plain
`[text](/category/slug)` link, it feeds the knowledge graph. Wikilinks in list items
render correctly (the same as inline ones); `article-health` accepts them there. A
wikilink whose target article does not exist is a HARD failure (`wikilink-target`), so
every entry must point at a real article.

This is different from an inline wikilink. An inline link
(`[[lantern-cove-beach|Lantern Cove]]`) belongs at the exact sentence where the
cross-reference is relevant — use that convention throughout the body. Further Reading is
a separate, curated "if this interested you, read these 2-4 articles next" list, useful
for site navigation and the knowledge graph. Quick Takes can skip it if there's genuinely
nothing closely related yet.

### 4.6 Citations: `source:` List First, Footnotes for Precision

The default citation mechanism is the frontmatter `source:` list — a flat list of the URLs
that informed the article. This is sufficient for the large majority of entries (a town's
own page, a museum's own site, an encyclopedia article used as a factual backbone).

Reach for an inline footnote (`[^1]` … definitions at the end) only when a _specific
sentence-level claim_ needs precise attribution — an exact count, a verbatim quote, a
contested figure someone might reasonably ask "says who?" about. When you use footnotes,
add a `## References` H2 before the definitions (`format-structure` flags footnote use
without one).

```markdown
The town voted to establish the preserve in 1979[^1].

## References

[^1]: [Town preserve charter](https://example.com/preserve-charter) — the founding
  charter; documents the 1979 vote and the preserve boundary.
```

Footnote definitions carry a description, not just a bare link: link + dash + a
sentence on what the source is and what it supports (`footnote-format` gates this).

If no footnotes are used, no `## References` H2 is needed — the frontmatter `source:`
list already does that job.

### 4.7 Image Sources

When an article uses images that require attribution (CC-licensed, commons repositories,
etc.), credit them under a `## Image Sources` heading at the end of the article body. The
`image-health` and `image-alt` checks read this section (alt text there is descriptive
caption, not accessibility alt).

```markdown
## Image Sources

- Hero: The bluff stairway at Lantern Cove. Photo by [photographer], [license].
- Inline: Kelp canopy from the pier, calm morning. [repository], CC BY-SA 4.0.
```

### 4.8 Quote Fidelity

Anything inside quotation marks must be a real person's, organization's, or document's
exact words, and it must be traceable to something in `source:` or a footnote. If you
found a fact described in a secondary source's own words and want to use the phrasing,
attribute it as reported speech without quotation marks, or find the primary statement.
Never invent a "local saying" or a plausible-sounding remark to make a paragraph feel more
alive — an unverifiable quote is worse than no quote.

### 4.9 Rationale Block (contested categories: expected; everywhere else: advisory)

Some categories cover contested ground — who was displaced, who profited, whose account of
a founding survives. For articles in your instance's strict categories (configured in
`scripts/tools/article-health.config.toml` under `rationale-presence`; the demo sets
`History`), add a frontmatter `rationale` block with four keys:

```yaml
rationale:
  why_this_hook: 'Brief note on why this is the angle, not some other one.'
  whats_excluded: 'What you deliberately left out and why.'
  where_it_hedges: 'Where the record is thin or disputed.'
  whos_pushing_back: 'Who would object to this framing, and why.'
```

A one-line answer per key is fine — the check gates presence, not depth. For every other
category the block is advisory: nice to have on anything with a real editorial judgment
call buried in it, not required for "here are the hours and the parking situation."

---

## 5. SEO Metadata

- **Title**: ≤ 60 characters (search results truncate around there; `frontmatter-title`
  warns above 60). Titles are plain identifying names — `Lantern Cove Beach`,
  `The Harborlight Cafe` — not colon-sandwich narrative hooks. The hook belongs in the
  description, not the title.
- **Title puffery ban**: `iconic`, `legendary`, `world-class`, `must-see`, `hidden gem`,
  `ultimate` trigger a WARN in `frontmatter-title` — they're empty puffery that could
  describe anywhere. Replace with specifics (a year, a number, a proper noun).
- **Description**: 50-160 characters. This is the search snippet — open with a concrete
  detail, not "This article covers..." or the site's own name. Don't simply repeat the
  title.
- One concrete anchor (a year or a number) in the description earns its space better than
  an adjective.

```
✅ "A sheltered cove known for a walk-in sea cave, deep tide pools, and the
   lantern-topped stairway down the bluff."
❌ "Lantern Cove is a beautiful and popular beach in Marisol Cove."
```

---

## 6. Voice: A Local Friend, Not a Brochure and Not an Encyclopedia

Picture explaining the place to a friend who's visiting for the first time and asked a
real question — not a tourist who wants to be sold something, not a student who wants a
citation. You'd say where to park, when to skip it, and the one thing that makes it worth
the trip.

### Wanted

- **Specific over general**: "a shallow sea cave that cuts about forty feet into the
  sandstone bluff" beats "a fascinating natural feature."
- **The locals'-knowledge layer**: parking realities, tide timing, seasonal closures, the
  access point most visitors miss. The demo's beach entry does this: _"a public concrete
  stairway from the end of Bluff Road; no lot, limited street parking."_ That sentence
  could only be written by someone (or something) that actually checked.
- **Honest about the downside**: parking is bad, the stair closes in high surf, the cafe
  is cash-friendly and small so expect a wait. A guide that only ever says nice things
  reads like an ad and loses trust fast.

### Not Wanted: Travel-Brochure Tells

Words that could be glued onto a description of literally any town and the sentence would
still parse:

| Tell                                                       | Why it's empty                                              | Fix                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------- |
| stunning / breathtaking / picturesque / charming / idyllic | Could describe any coastline anywhere                        | Name the specific thing that's actually striking   |
| hidden gem / a true gem / best-kept secret                 | If it's in a public guide, it's not hidden                    | Say who actually knows about it and why            |
| nestled / boasts / offers visitors                         | Brochure verbs; nothing is being claimed                      | Use a plain verb and a concrete subject            |
| must-see / must-visit / bucket-list                        | Imperative with no specific reason attached                   | State the actual reason it's worth the trip        |
| something for everyone                                     | Vacuous; true of every place with more than one attraction    | Name who, specifically, it's for                   |
| rich history / vibrant arts scene / unparalleled views     | Adjective doing the work a fact should do                     | Replace with the year, the name, the number        |
| Whether you're a local or a first-time visitor, ...        | Stock opener that adds nothing                                | Delete and start with the anchor fact              |

**Three-second test**: cover the sentence and ask if it would still be true with the
place's name swapped for any other town in the region. If yes, it's a tell — cut it or
replace it with something specific to this place.

### The "Not Just X, It's Y" Pattern

This AI fingerprint shows up in travel writing as "isn't just a cafe, it's an experience"
/ "more than a preserve, it's a way of life." In nearly every case, the "X" half is a
strawman the reader never assumed, manufactured purely to set up the "Y" half. Delete the
setup and state "Y" directly — the sentence loses nothing and gains confidence.

```
❌ "The Harborlight isn't just a place to eat — it's the informal center of town."
✅ "The Harborlight has been the informal center of town since 1948."
```

### Em Dash Discipline

Em dashes are normal, correct punctuation. But AI-generated prose reaches for them
constantly as a tic, often where a period, semicolon, or parenthetical would read more
naturally. If a paragraph has more than two or three, read it back and ask whether each
one is doing something a period couldn't.

### Canned Endings

- ❌ "Whether you're a local or just visiting, X is a must-see stop on your itinerary."
- ❌ "X will continue to charm visitors for generations to come."
- ❌ "So next time you're in town, be sure to stop by."
- ❌ "...and the story is still being written." (The writer can't produce concrete
  closure and retreats to story-as-meta-narrative cliché. Replace the abstract "story"
  with a concrete event, or cut the sentence.)
- ❌ A summary of everything the article just said.

For most place/business entries, the practical closing section (§4.4) is the legitimate
functional close — that's fine, it's doing real work. What's banned is a _prose_ sentence
that tries to wrap up with a sales pitch instead of just stopping once the last useful
fact has been delivered. The demo's founding article closes well: _"The old wharf is gone,
replaced by the current town pier, but its pilings are still visible at low tide from the
Lantern Cove stair."_ — a concrete image, no pitch, no summary.

---

## 7. Quality Gate (Before Every Commit)

This is the runbook for the write/rewrite pipeline's verify stage
([REWRITE-PIPELINE.md](REWRITE-PIPELINE.md) Stage 4). **Fail = don't commit. Fix, then
re-verify.**

### 7.1 Five-finger test (manual, 60 seconds)

| #   | Test                    | Ask yourself                                                    | Pass standard                                         |
| --- | ----------------------- | ---------------------------------------------------------------- | ------------------------------------------------------ |
| 1   | **Surprise point**      | Where will the reader say "huh, didn't know that"?               | You can point to a specific sentence                   |
| 2   | **The anchor test**     | Pick any paragraph at random — is there a checkable specific?    | A name, year, number, or place in every paragraph      |
| 3   | **The brochure test**   | Read it aloud — does any sentence sound like it's selling?       | No travel-brochure tells (§6) survive                  |
| 4   | **The swap test**       | Would the opening or closing be true of a neighboring town?      | No — it's only true here                               |
| 5   | **One-sentence retell** | Can you tell a friend the gist in one sentence?                  | You can naturally say "hey, did you know [one line]"   |

### 7.2 Structure check

- [ ] Opening paragraph carries concrete facts (year/number/name — at least 2 kinds in
      the first three sentences)
- [ ] At a Glance blockquote present and non-redundant (§4.1)
- [ ] No date-led H2s (§4.3)
- [ ] Inline wikilinks at the sentences where cross-references are relevant; Further
      Reading block for Standard/Deep Dive articles (§4.5)
- [ ] Everything in quotation marks is verbatim and traceable (§4.8)
- [ ] Footnotes (if any) have descriptions and a `## References` H2 (§4.6)
- [ ] Frontmatter complete: `title`, `description`, `date`, `category`, `tags`,
      `subcategory` (except About), `featured` set; `rationale` block for strict
      categories (§4.9)
- [ ] Ending isn't canned (§6); the last sentence delivers a fact or an image, not a pitch

### 7.3 Plastic-language scan (manual, 90 seconds)

1. **Read only the second half** (start at the 60% mark — endings accumulate filler).
2. For each sentence ask: "if I cut this, what information does the article lose?"
3. If the answer is "nothing" → it's a plastic sentence → **replace it with a fact or
   delete it**.
4. Watch especially for: empty modifiers ("profound impact", "important role"),
   "not just X, it's Y" constructions, all-purpose endings, causal leaps ("business then
   took off"), official-statement quotes.

### 7.4 Automated verification (must run)

Two article-health profiles matter here, and they are different bars:

- **`ci-deploy` — the mandatory ship gate.** Every article (and the demo corpus)
  must clear this to commit and deploy. It is the exact profile the instance's CI
  runs over the whole corpus; it runs every check and blocks on HARD violations
  only. A text-first article passes it.
- **`rewrite-stage-4` — the media-complete self-check.** The aspirational bar for
  depth/long-form articles once images are supplied: it HARD-requires a
  media-complete article (hero + scene images, ≥3 length-scaled). It is **not**
  the universal new-article gate, and it is run **in addition to `ci-deploy`, not
  instead of it**: `ci-deploy` runs the full check set (`checks = "*"`) while
  `rewrite-stage-4` runs only a media/structure subset, so passing it does **not**
  imply passing `ci-deploy` (e.g. `footnote-format`, `link-url-mangle` are HARD in
  `ci-deploy` but don't run here). The framework's own text-first demo corpus
  clears `ci-deploy`, not `rewrite-stage-4`. Its image/media thresholds are
  long-form-calibrated and tunable per instance (§8).

```bash
# 1. Sync knowledge/ into the build (SSOT rule: edit knowledge/ only)
npm run sync

# 2. Article health — the mandatory ship gate every article must clear
npm run article-health -- knowledge/{Category}/{slug}.md --profile=ci-deploy

# 2b. Optional: media-complete self-check for a depth article with supplied images
npm run article-health -- knowledge/{Category}/{slug}.md --profile=rewrite-stage-4

# 3. Build (includes post-build contract checks)
npm run build
```

| Result                                   | Action                             |
| ---------------------------------------- | ---------------------------------- |
| `ci-deploy` passes + build OK            | ✅ proceed to commit               |
| `ci-deploy` HARD violations              | ❌ fix, rerun                      |
| build fails                              | ❌ fix frontmatter/syntax, rerun   |

Do not fabricate images to satisfy `rewrite-stage-4`; for a text-first article
`ci-deploy` is the honest blocking gate.

The pre-commit hook re-runs frontmatter validation and `article-health
--profile=pre-commit` on staged files as a backstop; don't rely on it as the first check.

---

## 8. A Note on Numeric Thresholds

The `article-health` prose and media thresholds (`paragraph-rhythm`, `media-richness`,
`word-count`, `image-health` counts) were calibrated against the framework's first
production corpus — short, English, locals-guide format. They are starting points, not
settled doctrine, for your instance. If a violation looks wrong for your corpus (longer
essays, media-dense features), that's a signal to retune the threshold in
`scripts/tools/article-health.config.toml` — not necessarily a signal that the article is
broken.

---

## 9. Language Support Boundary

UI strings and editorial tooling are English-calibrated; Latin-script content largely
works (plain word tokenization; article-health prose thresholds may need retuning per
instance); CJK content is unsupported until the post-project multi-language revisit. The
config seams (`place.locale`, `place.languages[]`) are declared but dormant — don't build
on them yet.

---

## 10. Sister Documents

| Task                              | Pointer                                              |
| --------------------------------- | ----------------------------------------------------- |
| Write/rewrite process, stage by stage | [REWRITE-PIPELINE.md](REWRITE-PIPELINE.md)        |
| Fact-checking methodology         | [FACTCHECK-PIPELINE.md](FACTCHECK-PIPELINE.md)        |
| Deploy, CI, and toolchain setup   | [../runbook/DEPLOY.md](../runbook/DEPLOY.md)          |
