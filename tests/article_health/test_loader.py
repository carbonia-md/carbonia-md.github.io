"""Tests for article_health.loader.

Critical invariants:

- A markdown link URL's closing `)` must sit inside a protected region so
  punctuation rules never rewrite it.
- A malformed link (missing/wrong close paren) must NOT let the link-url
  protected region span across newlines and swallow a later line's real `)`.
- Frontmatter is separated from body.
- is_article_path is the tool's target contract (knowledge/{Category}/*.md,
  no leading-underscore hubs).
"""

import textwrap

from lib.article_health.loader import is_article_path, load_target


def test_frontmatter_separated_from_body(write_tmp):
    f = write_tmp(
        textwrap.dedent(
            """\
            ---
            title: 'Tawny Fish Owl'
            category: Nature
            ---

            The first paragraph of the article body.
            """
        )
    )
    target = load_target(f)
    assert target.frontmatter.get("title") == "Tawny Fish Owl"
    assert target.frontmatter.get("category") == "Nature"
    assert "title:" not in target.body
    assert "first paragraph" in target.body


def test_no_frontmatter(write_tmp):
    f = write_tmp("# No frontmatter\n\nJust body text.\n")
    target = load_target(f)
    assert target.frontmatter == {}
    assert target.body == target.text


def test_path_derives_category_slug(tmp_path):
    # knowledge/{Category}/{slug}.md is the SSOT source path.
    knowledge = tmp_path / "knowledge" / "Nature"
    knowledge.mkdir(parents=True)
    f = knowledge / "tawny-fish-owl.md"
    f.write_text("---\ntitle: x\n---\nbody\n", encoding="utf-8")
    target = load_target(f)
    assert target.category == "Nature"
    assert target.slug == "tawny-fish-owl"


def test_link_url_does_not_eat_across_newlines(write_tmp):
    """REGRESSION: a malformed link (no close paren on its line) must not let
    `_RE_MD_LINK_URL` run across newlines into the next line's `)`.

    The link-url region regex excludes `\\n`, so a link missing its close paren
    simply fails to match on that line rather than swallowing later lines. If
    the exclusion were dropped, line 1 below would span to line 2's `)`.
    """
    body = (
        "- [Article A](/cat/x — desc one\n"
        "- [Article B](/cat/y) — desc two\n"
        "- [Article C](/cat/z) — desc three\n"
    )
    f = write_tmp(body)
    target = load_target(f)
    # Each protected region must NOT contain newlines
    for start, end, kind in target.protected_regions:
        if kind == "link-url":
            seg = target.body[start:end]
            assert "\n" not in seg, (
                f"link-url region eats newlines: {seg!r}"
            )


def test_protected_regions_includes_md_link_url(write_tmp):
    """The half-width `)` closing a markdown link URL must be inside a
    protected region so punctuation rules don't touch it.
    """
    f = write_tmp(
        "- [Formosan Ornithology](/nature/formosan-ornithology) — named in 1916\n",
    )
    target = load_target(f)
    # Find the link URL
    body = target.body
    url_start = body.index("](/nature")
    url_end = body.index(")", url_start) + 1  # +1 to include the )
    # Assert this exact range is protected
    matched = any(
        s <= url_start and e >= url_end and kind == "link-url"
        for s, e, kind in target.protected_regions
    )
    assert matched, (
        f"link URL `]({body[url_start+1:url_end]}` not protected: "
        f"regions={target.protected_regions}"
    )


def test_protected_regions_includes_fenced_code(write_tmp):
    f = write_tmp(
        "Intro\n```python\ncode,with,commas\n```\nOutro\n",
    )
    target = load_target(f)
    has_fence = any(kind == "fenced-code" for _, _, kind in target.protected_regions)
    assert has_fence


def test_protected_regions_includes_inline_code(write_tmp):
    f = write_tmp("Intro `code,with,comma` outro\n")
    target = load_target(f)
    has_inline = any(kind == "inline-code" for _, _, kind in target.protected_regions)
    assert has_inline


def test_body_without_protected_blanks_regions(write_tmp):
    """body_without_protected() preserves char positions but blanks protected."""
    f = write_tmp(
        "abc [link](/foo) xyz\n",
    )
    target = load_target(f)
    out = target.body_without_protected()
    # `](url)` segment becomes blanks; abc/xyz stay intact
    assert "abc" in out
    assert "xyz" in out
    assert "/foo" not in out  # blanked
    assert len(out) == len(target.body)  # length preserved


def test_body_line_numbers_match_original_file(write_tmp):
    """Regression: checks reported line numbers off-by-(frontmatter line count).
    Fix: loader pads body with blank lines equal to frontmatter span, so any
    line N in body corresponds to line N in the original file.
    """
    content = textwrap.dedent(
        """\
        ---
        title: 'test'
        description: 'test desc'
        date: 2026-05-04
        tags: ['x']
        category: Nature
        ---

        First content line — this is line 9 in the file.

        A second content line for offset checking.
        """
    )
    f = write_tmp(content)
    target = load_target(f)
    # body must have leading blank lines so body's line 9 matches file's line 9
    body_lines = target.body.split("\n")
    assert body_lines[8] == "First content line — this is line 9 in the file."
    # The following line must also align: file line 11
    assert body_lines[10] == "A second content line for offset checking."


def test_is_article_path_contract():
    """is_article_path is the tool's target contract."""
    assert is_article_path("knowledge/Nature/tawny-fish-owl.md")
    assert is_article_path("/abs/path/knowledge/History/founding.md")
    # leading-underscore hubs are not standalone articles
    assert not is_article_path("knowledge/Nature/_index.md")
    assert not is_article_path("knowledge/Nature/_Nature Hub.md")
    # outside a knowledge/ tree
    assert not is_article_path("docs/playbook/ARTICLE-PLAYBOOK.md")
    # not markdown
    assert not is_article_path("knowledge/Nature/photo.jpg")
    # a multi-language tree still resolves to a category directory
    assert is_article_path("knowledge/ja/Nature/tawny-fish-owl.md")


def test_is_article_path_excludes_root_level_workflow_queues():
    """A .md directly at knowledge/ is a human-edited queue, not an article.

    These files carry no frontmatter and no category by design, so checking them
    reports a hard violation for a file that is behaving correctly -- and the
    pre-commit hook, which runs `--staged`, then refuses the edit. The
    projection layer, `scripts/core/sync.sh`, skips the same names for the
    same reason.
    """
    assert not is_article_path("knowledge/INBOX.md")
    assert not is_article_path("knowledge/SNIPPET-INBOX.md")
    assert not is_article_path("/abs/path/knowledge/SNIPPET-INBOX.md")
    # The exclusion is structural (depth), not a name list: any future
    # root-level workflow doc is covered without another edit here.
    assert not is_article_path("knowledge/SOME-FUTURE-QUEUE.md")
