---
categories:
  - id: shoreline
    icon: 🌊
    title: Shoreline
    article: /beaches/lantern-cove-beach
    sounds:
      - title: Surf wash on the cove shingle
        location: Lantern Cove, north end
        description: The tide dragging back over rounded stones, recorded from the shingle bank at half tide.
        icon: 🌊
        credit: Synthesized demo clip generated with ffmpeg for the sekai-kb template. Not a field recording of any real place.
        date: 2026-07-30
        file: /media/sounds/surf-wash.mp3
      - title: Bell buoy off the point
        location: Offshore of the marine preserve
        description: A channel marker rolling in the swell, carried in on the onshore wind.
        icon: 🔔
        credit: Synthesized demo clip generated with ffmpeg for the sekai-kb template. Not a field recording of any real place.
        date: 2026-07-30
        file: /media/sounds/bell-buoy.mp3
    wishlist:
      - icon: 🦭
        text: Harbor seals hauled out on the north rocks at dawn
      - icon: ⛵
        text: Halyards ringing in the small-boat harbor during a gale
  - id: ridge
    icon: 🥾
    title: Ridge and trail
    article: /trails/summit-ridge-trail
    sounds:
      - title: Wind through the coastal sage
        location: Summit Ridge Trail, above the cove
        description: Steady afternoon wind moving through low scrub on the exposed ridge.
        icon: 🌿
        credit: Synthesized demo clip generated with ffmpeg for the sekai-kb template. Not a field recording of any real place.
        date: 2026-07-30
        file: /media/sounds/ridge-wind.mp3
    wishlist:
      - icon: 🦉
        text: Owls calling across the ridge after dusk
---

# Soundscape manifest

The frontmatter above is the whole contract. `categories` is an ordered list, and
the page at `/soundscape` renders one section per category, in this order.

A category requires `id`, `icon`, `title`. `id` is the section's anchor, so it
must be unique. A category also accepts optional `article`: a link to one page of
this knowledge base, checked at build time against the routes the build produces,
and dropped with a warning when it resolves to none rather than shipping a dead
link. Each category carries its own `sounds` list and an optional `wishlist`,
whose entries carry `icon`, `text` and name the sounds this place still wants — an
empty category with a wishlist is a legitimate entry, and often the honest one.

A recording requires `title`, `location`, `credit`, `file`. A recording also
accepts optional `description`, `icon`, `contributor`, `contributorUrl`, `date`. A
recording whose required fields are incomplete is dropped with a build-time
warning naming it, and every other recording still renders.

`file` is a site-root-absolute path resolved under `public/`, so
`/media/sounds/surf-wash.mp3` is `public/media/sounds/surf-wash.mp3` on disk. An
entry whose file is missing is dropped with a build-time warning naming it, and
the rest of the list still renders.

A manifest that declares a top-level `sounds` list instead of `categories` — the
shape the first release of this page shipped — still renders exactly as it did,
as a single section with no heading. Adopting categories is an edit to this file
and nothing else.

The leading underscore in this file's name is load-bearing. Three separate
scanners walk `knowledge/` looking for articles, and all three skip files whose
name starts with `_`. Rename this file and the article pipeline will try to
validate it as an article that has no title, description, date, or category.

## About these three clips

Marisol Cove is a fictional demo town, so it owns no field recordings. These are
short synthesized clips: filtered noise beds and a two-partial tone, generated
with ffmpeg purely so the player and the page layout are provable in a repository
that ships them. Each `credit` says so. Replace all three with your own
recordings when you adopt the template — the init wizard removes them for you,
and the page shows its empty state until you add your own.
