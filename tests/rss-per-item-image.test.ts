/**
 * Tests for per-item `<itunes:image>` emission in the generated RSS feed.
 *
 * Phase 3: infrastructure only. The generator must emit an item-level
 * `<itunes:image>` when a Talk/Speaker/Session carries an `image_url`,
 * and must omit the tag otherwise.
 */
import { describe, it, expect } from 'vitest';
import { generateRssFeed } from '../src/rss-generator.js';
import { ConferenceOutput, Talk } from '../src/types.js';

/**
 * Build a minimal synthetic conference with one talk. Callers may mutate
 * the returned object (e.g. to set `image_url`) before feeding it to the
 * generator.
 */
function makeSynthetic(mutate?: (talk: Talk) => void): ConferenceOutput[] {
  const talk: Talk = {
    title: 'Synthetic Talk',
    slug: '01synthetic',
    order: 1,
    url: 'https://example.test/conf/sat-am/01synthetic',
    speaker: {
      name: 'Synthetic Speaker',
      role_tag: null,
    },
    audio: {
      url: 'https://example.test/audio/synthetic.mp3',
      duration_ms: 600000,
    },
  };
  mutate?.(talk);
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
            talks: [talk],
          },
        ],
      },
    },
  ];
}

/**
 * Count <itunes:image ...> occurrences inside <item>...</item> blocks.
 * The channel-level <itunes:image> lives outside items and is excluded.
 */
function countItemImageTags(feed: string): number {
  const items = feed.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  let count = 0;
  for (const item of items) {
    const matches = item.match(/<itunes:image\b/g) ?? [];
    count += matches.length;
  }
  return count;
}

/** Extract the href from the (first) per-item <itunes:image> tag. */
function firstItemImageHref(feed: string): string | null {
  const items = feed.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  for (const item of items) {
    const m = item.match(/<itunes:image\s+href="([^"]+)"\s*\/>/);
    if (m) return m[1];
  }
  return null;
}

describe('RSS feed per-item <itunes:image>', () => {
  it('omits item-level <itunes:image> when no image_url is present', () => {
    const feed = generateRssFeed(makeSynthetic(), {
      feedBaseUrl: 'https://example.test/gc',
      language: 'eng',
    });
    expect(countItemImageTags(feed)).toBe(0);
  });

  it('emits exactly one <itunes:image> with the talk image_url when set', () => {
    const talkImage = 'https://example.test/art/talk-cover.jpg';
    const feed = generateRssFeed(
      makeSynthetic((t) => {
        t.image_url = talkImage;
      }),
      { feedBaseUrl: 'https://example.test/gc', language: 'eng' }
    );
    expect(countItemImageTags(feed)).toBe(1);
    expect(firstItemImageHref(feed)).toBe(talkImage);
  });

  it('falls back to speaker.image_url when talk has no image_url', () => {
    const speakerImage = 'https://example.test/art/speaker-portrait.jpg';
    const feed = generateRssFeed(
      makeSynthetic((t) => {
        t.speaker.image_url = speakerImage;
      }),
      { feedBaseUrl: 'https://example.test/gc', language: 'eng' }
    );
    expect(countItemImageTags(feed)).toBe(1);
    expect(firstItemImageHref(feed)).toBe(speakerImage);
  });
});
