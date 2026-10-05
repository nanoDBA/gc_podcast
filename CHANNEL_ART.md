# Channel art runbook

How the podcast-level artwork gets to listeners, and the steps for changing it.
Read this before you touch channel art or answer "the art is wrong".

## Where the art comes from

- `config/conference-image-overrides.json` is the only source. Keys are
  `YYYY-MM-<lang>` (eng/spa/por); each language uses its newest entry. Scraped
  Church images never become channel art (gc_podcast-uuc).
- The image files are committed under `docs/` and served by GitHub Pages.
- Feed Health fails from 10 days before a conference if that conference has no
  entry for a language. Set the entries before the window opens: an app that
  copies the art during the window keeps that copy for days.

## How Pocket Casts shows it

Apps never load the feed's image URL. They show Pocket Casts' server copy,
keyed by the podcast's Pocket Casts UUID
(`static.pocketcasts.com/discover/images/<size>/<uuid>.jpg`).

- **Origin**: Pocket Casts re-reads the feed and replaces its copy on its own,
  hours after a change (about 20 h on 2026-10-04). Authors have no refresh
  button; listeners can use Settings > Appearance > Refresh All Podcast Artwork.
- **Cloudflare edge**: each size of that copy is cached for 7 days. A listener
  can keep seeing the old art for up to 7 days after the origin updates.
- Every GET of a `static.pocketcasts.com` image warms the edge cache with
  whatever is there at that moment. Check with HEAD until the image exists.
- A feed URL with a harmless query (`audio.xml?pc=N`; Pages ignores it) gets a
  new UUID with nothing cached, so it shows the new art at once.

Feed Health (`src/pocketcasts-art.ts`) compares the origin copy with our art
picture to picture, reports "propagating" during the 7-day edge window, and
opens or closes its `feed-health` issue on its own.

## Changing the art

1. Add the image under `docs/`, point the override at it, merge, and wait for
   the Pages deploy. Confirm the live feed's channel `<itunes:image>` is the new
   URL.
2. Only then create the next `?pc=N` entry: search Pocket Casts for
   `https://nanodba.github.io/gc_podcast/<feed>?pc=N`. Creating it fetches the
   feed once, so creating it early locks in the old art.
3. Poll its image with HEAD until it returns 200, then GET it once to verify.
4. Update the table below and give the maintainer the new addresses.

Once Feed Health reports the plain feeds as matching and the edge window has
passed, the plain addresses show the right art too.

## Current Pocket Casts entries

| Feed | Address | UUID | Art |
|---|---|---|---|
| English | `audio.xml?pc=3` | `0d372890-a2e6-013f-a6b9-0afff49f3561` | temple front (Oct 2026) |
| Spanish | `audio-es.xml?pc=3` | `95511ff0-a2e2-013f-a6b9-0afff49f3561` | sculpture (Oct 2026) |
| Portuguese | `audio-pt.xml?pc=3` | `9cf5dba0-a2e2-013f-2d9b-02ffd80f4ca1` | temple + Tabernacle (Oct 2026) |

## Things that did not work

- `?v=<cycle>` cache-busting on the image URL (gc_podcast-due).
- Switching to a different self-hosted image file (9p1).
- A second English feed, `audio-en.xml` (gc_podcast-bf8). Removed in v1.5.0;
  the project publishes exactly three feeds.
