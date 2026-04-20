/**
 * Tests for Podcasting 2.0 namespace + `<podcast:guid>` emission in
 * the generated RSS feed.
 */
import { describe, it, expect } from 'vitest';
import { generateRssFeed } from '../src/rss-generator.js';
import { ConferenceOutput } from '../src/types.js';

function makeSynthetic(): ConferenceOutput[] {
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
              },
            ],
          },
        ],
      },
    },
  ];
}

const UUID_V5_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('RSS feed Podcasting 2.0 namespace', () => {
  const feed = generateRssFeed(makeSynthetic(), {
    feedBaseUrl: 'https://example.test/gc',
    language: 'eng',
  });

  it('declares the podcast namespace on the <rss> root', () => {
    expect(feed).toContain(
      'xmlns:podcast="https://podcastindex.org/namespace/1.0"'
    );
  });

  it('emits exactly one <podcast:guid> at channel level', () => {
    const matches = feed.match(/<podcast:guid>[^<]+<\/podcast:guid>/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('<podcast:guid> value is a valid v5 UUID', () => {
    const m = feed.match(/<podcast:guid>([^<]+)<\/podcast:guid>/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(UUID_V5_REGEX);
  });
});
