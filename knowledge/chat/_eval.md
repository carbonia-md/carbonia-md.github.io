---
# The chat evaluation set: the questions `npm run chat:eval` asks a deployed chat
# worker, and what each answer has to look like.
#
# The leading `_` in this filename is load-bearing. It is what makes the file
# invisible to the three scanners that walk `knowledge/` looking for articles
# (scripts/core/test-frontmatter.mjs, scripts/tools/article-health.py, and
# scripts/core/build-content-dates.mjs). Rename it without the prefix and the
# article pipeline starts treating this list of questions as an article with no
# title, description, or category.
#
# The whole file is optional. An instance that never writes one is not broken:
# `npm run chat:eval` reports "no evaluation set" and exits 0.
#
# Each question carries:
#   question    - required, what gets posted to the worker.
#   expectSlugs - required, the `category/name` slugs the answer should rest on.
#                 An empty list means the corpus cannot answer this and the model
#                 must refuse.
#   expect      - required, the verdict applied to the response:
#                   sources             the answer should cite articles. The runner
#                                       checks every cited URL resolves to a real one.
#                   no-citations        nothing may be cited. Machine-enforced.
#                   refusal-in-answer   the answer must refuse, but retrieval will
#                                       legitimately surface near-neighbours, so the
#                                       citation list is not a verdict. Human-judged.
#   note        - optional, why this question is in the set.
#
# Why two refusal kinds. Retrieval scores how much a question RESEMBLES the corpus,
# not whether the corpus answers it. Measured against this demo corpus: questions
# about places the corpus never mentions score at most 0.435, comfortably under the
# 0.46 relevance floor, so nothing is retrieved and nothing can be cited. But
# questions about THIS place that no article happens to cover score 0.512 to 0.595,
# which is at or above genuinely answerable questions ("What is the history of this
# town?" scores 0.512). No floor separates those without also rejecting real
# questions, so whether the model refused is something a person reads off the
# report. See docs/runbook/DEPLOY.md for how to re-measure the floor on your corpus.

questions:
  # ── Four single-article factual questions ─────────────────────────────────────
  - question: In what year was the Marisol Point Lighthouse decommissioned, and is it still lit?
    expectSlugs: [history/marisol-point-lighthouse]
    expect: sources
    note: Two facts from one article; the second is the point of the article.

  - question: How much elevation does the Summit Ridge Trail gain, and how long is the climb?
    expectSlugs: [trails/summit-ridge-trail]
    expect: sources
    note: Numeric detail, easy to check against the article and easy to invent.

  - question: When did the town vote to establish the kelp forest preserve?
    expectSlugs: [nature/kelp-forest-preserve]
    expect: sources
    note: A single date, stated once in the corpus.

  - question: What year did the Harborlight Cafe open, and what is on its menu?
    expectSlugs: [food/the-harborlight-cafe]
    expect: sources

  # ── Two questions spanning two articles ───────────────────────────────────────
  - question: Where can I check the tide before walking into the Lantern Cove sea cave?
    expectSlugs: [beaches/lantern-cove-beach, food/the-harborlight-cafe]
    expect: sources
    note: >-
      The cave and its tide dependence are in the beach article; the chalkboard that
      posts the tide is in the cafe article. Answering needs both.

  - question: How did the lighthouse fit into the town's founding as a fishing settlement?
    expectSlugs: [history/marisol-point-lighthouse, history/founding-of-marisol-cove]
    expect: sources
    note: Two articles in one category that reference each other.

  # ── Two category-level questions ──────────────────────────────────────────────
  - question: What hiking is there around the town, and how hard is it?
    expectSlugs: [trails/summit-ridge-trail]
    expect: sources
    note: Broad rather than factual; scores lowest of the answerable set at 0.585.

  - question: What is the history of this town, from its founding onward?
    expectSlugs: [history/founding-of-marisol-cove, history/marisol-point-lighthouse]
    expect: sources
    note: >-
      The weakest answerable question measured (0.512 top-1), which is what sets the
      headroom above the 0.46 floor. If a corpus change pushes this under the floor
      it will refuse, and that is the signal to re-measure.

  # ── Two questions that must be refused ────────────────────────────────────────
  - question: What are the opening hours of the Marisol Cove farmers market?
    expectSlugs: []
    expect: refusal-in-answer
    note: >-
      A plausible-but-absent subject: a coastal town this size would have one, and no
      article mentions it. Measured at 0.574, above several real questions, so
      retrieval cannot tell it apart and near-neighbours will be cited. The answer
      must still say the knowledge base does not cover it. Human-judged.

  - question: What are the best hiking trails near Reykjavik?
    expectSlugs: []
    expect: no-citations
    note: >-
      A place the corpus never mentions. Measured at 0.435, under the floor, so
      nothing is retrieved, nothing is cited, and the model is told outright that no
      excerpt is relevant. Machine-enforced: any citation here fails the run.
---

# Chat evaluation set

Ten questions, run against a deployed chat worker by `npm run chat:eval`. Eight are
answerable from the articles in this knowledge base; two are not, and exist to check
that the chat says so instead of inventing an answer.

The runner is deliberately a narrow judge. It fails the run when a cited URL does not
resolve to a real article, when a `no-citations` question cites anything, or when a
request errors. It does not score answer quality: that is the human review, and the
report it writes is what you read to do it.

Keep the shape of the set when you change the questions. Four single-article, two
spanning two articles, two category-level, and two refusals is what makes a passing
run mean something, and dropping the refusals leaves nothing testing the failure mode
that matters most.
