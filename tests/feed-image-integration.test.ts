/**
 * Integration test: per-item <itunes:image> emission across a multi-talk feed.
 *
 * The existing unit test (rss-per-item-image.test.ts) covers single-talk
 * scenarios in isolation. This test uses a synthetic conference with four
 * talks — each representing a distinct image-source combination — and
 * exercises the full generateRssFeed pipeline end-to-end.
 *
 * Coverage:
 *   A  talk.image_url present     → emits talk URL (canonical IIIF)
 *   B  speaker.image_url only     → emits speaker URL (fallback, canonical IIIF)
 *   C  talk.image_url beats speaker.image_url when both are set → emits talk URL
 *   D  neither image_url present  → no <itunes:image> inside <item>
 */
import { describe, it, expect } from 'vitest';
import { generateRssFeed } from '../src/rss-generator.js';
import { ConferenceOutput } from '../src/types.js';

/** Canonical IIIF image URL pattern used by the scraper (Phase 4). */
const IIIF_TALK_IMAGE =
  'https://www.churchofjesuschrist.org/imgs/abc123/full/!1400%2C1400/0/default.jpg';
const IIIF_SPEAKER_A_IMAGE =
  'https://www.churchofjesuschrist.org/imgs/speakerA/full/!1400%2C1400/0/default.jpg';
const IIIF_SPEAKER_C_IMAGE =
  'https://www.churchofjesuschrist.org/imgs/speakerC/full/!1400%2C1400/0/default.jpg';

/**
 * Build a synthetic ConferenceOutput containing four talks that span all
 * image-source combinations:
 *   talk 1 (talkOnly)    – talk.image_url set, no speaker image
 *   talk 2 (speakerOnly) – no talk image, speaker.image_url set
 *   talk 3 (both)        – both image URLs set (talk must win)
 *   talk 4 (neither)     – no image anywhere
 */
function makeMultiTalkConference(): ConferenceOutput[] {
  return [
    {
      scraped_at: '2026-04-05T12:00:00Z',
      version: '1.0',
      conference: {
        year: 2026,
        month: 4,
        name: 'April 2026 General Conference',
        url: 'https://example.test/conf',
        language: 'eng',
        sessions: [
          {
            name: 'Saturday Morning Session',
            slug: 'saturday-morning-session',
            order: 1,
            url: 'https://example.test/conf/sat-am',
            talks: [
              {
                title: 'Talk A – talk image only',
                slug: '01talk-a',
                order: 1,
                url: 'https://example.test/conf/sat-am/01talk-a',
                speaker: { name: 'Speaker A', role_tag: null },
                audio: {
                  url: 'https://example.test/audio/talk-a.mp3',
                  duration_ms: 600000,
                },
                image_url: IIIF_TALK_IMAGE,
              },
              {
                title: 'Talk B – speaker image only',
                slug: '02talk-b',
                order: 2,
                url: 'https://example.test/conf/sat-am/02talk-b',
                speaker: {
                  name: 'Speaker B',
                  role_tag: null,
                  image_url: IIIF_SPEAKER_A_IMAGE,
                },
                audio: {
                  url: 'https://example.test/audio/talk-b.mp3',
                  duration_ms: 600000,
                },
              },
              {
                title: 'Talk C – both set, talk must win',
                slug: '03talk-c',
                order: 3,
                url: 'https://example.test/conf/sat-am/03talk-c',
                speaker: {
                  name: 'Speaker C',
                  role_tag: null,
                  image_url: IIIF_SPEAKER_C_IMAGE,
                },
                audio: {
                  url: 'https://example.test/audio/talk-c.mp3',
                  duration_ms: 600000,
                },
                image_url: IIIF_TALK_IMAGE,
              },
              {
                title: 'Talk D – no image at all',
                slug: '04talk-d',
                order: 4,
                url: 'https://example.test/conf/sat-am/04talk-d',
                speaker: { name: 'Speaker D', role_tag: null },
                audio: {
                  url: 'https://example.test/audio/talk-d.mp3',
                  duration_ms: 600000,
                },
              },
            ],
          },
        ],
      },
    },
  ];
}

/**
 * Return all `<item>…</item>` blocks from the feed, preserving order.
 * The generator emits talks in descending order (talk 4 first), but the
 * helper makes no assumptions about ordering.
 */
function extractItems(feed: string): string[] {
  return feed.match(/<item>[\s\S]*?<\/item>/g) ?? [];
}

/**
 * Extract the `href` value from the first `<itunes:image>` inside a single
 * `<item>` block. Returns null when the tag is absent.
 */
function itemImageHref(item: string): string | null {
  const m = item.match(/<itunes:image\s+href="([^"]+)"\s*\/>/);
  return m ? m[1] : null;
}

/**
 * Find the item block whose `<link>` element contains the given slug.
 */
function findItemBySlug(items: string[], slug: string): string | undefined {
  return items.find((item) => item.includes(slug));
}

describe('RSS feed – per-item <itunes:image> integration (multi-talk)', () => {
  const feed = generateRssFeed(makeMultiTalkConference(), {
    feedBaseUrl: 'https://example.test/gc',
    language: 'eng',
  });
  const items = extractItems(feed);

  it('produces exactly 4 items (one per talk)', () => {
    expect(items).toHaveLength(4);
  });

  it('talk A: emits <itunes:image> with the talk-level IIIF URL', () => {
    const item = findItemBySlug(items, '01talk-a');
    expect(item).toBeDefined();
    expect(itemImageHref(item!)).toBe(IIIF_TALK_IMAGE);
  });

  it('talk B: emits <itunes:image> with the speaker-level IIIF URL (fallback)', () => {
    const item = findItemBySlug(items, '02talk-b');
    expect(item).toBeDefined();
    expect(itemImageHref(item!)).toBe(IIIF_SPEAKER_A_IMAGE);
  });

  it('talk C: talk.image_url beats speaker.image_url when both are set', () => {
    const item = findItemBySlug(items, '03talk-c');
    expect(item).toBeDefined();
    expect(itemImageHref(item!)).toBe(IIIF_TALK_IMAGE);
    // Confirm the speaker image was NOT used
    expect(itemImageHref(item!)).not.toBe(IIIF_SPEAKER_C_IMAGE);
  });

  it('talk D: no <itunes:image> child when neither image URL is set', () => {
    const item = findItemBySlug(items, '04talk-d');
    expect(item).toBeDefined();
    expect(itemImageHref(item!)).toBeNull();
  });

  it('emitted URLs use the canonical IIIF path /full/!1400%2C1400/0/default.jpg', () => {
    const iiifSuffix = '/full/!1400%2C1400/0/default.jpg';
    const itemA = findItemBySlug(items, '01talk-a')!;
    const itemB = findItemBySlug(items, '02talk-b')!;
    expect(itemImageHref(itemA)).toContain(iiifSuffix);
    expect(itemImageHref(itemB)).toContain(iiifSuffix);
  });

  it('speaker IIIF image URLs never bleed to channel level', () => {
    // Strip every <item>...</item> block from the feed. Speaker-only image
    // URLs must not survive outside item blocks; the first talk's hero IS
    // intentionally used as the channel image (gc_podcast-9ut follow-up —
    // talk-hero-over-collection-painting behaviour), so IIIF_TALK_IMAGE
    // legitimately appears at channel level.
    const feedWithoutItems = feed.replace(/<item>[\s\S]*?<\/item>/g, '');
    expect(feedWithoutItems).not.toContain(IIIF_SPEAKER_A_IMAGE);
    expect(feedWithoutItems).not.toContain(IIIF_SPEAKER_C_IMAGE);
  });

  it('first talk hero image IS used at channel level (gc_podcast-9ut follow-up)', () => {
    const feedWithoutItems = feed.replace(/<item>[\s\S]*?<\/item>/g, '');
    expect(feedWithoutItems).toContain(IIIF_TALK_IMAGE);
  });
});
