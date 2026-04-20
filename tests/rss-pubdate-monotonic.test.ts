/**
 * Tests for monotonic pubDate ordering in the generated RSS feed.
 *
 * Invariant: every <pubDate> in the feed must be strictly monotonically
 * DECREASING from the first <item> (top of feed, newest) to the last
 * <item> (bottom of feed, oldest). Additionally every pubDate must be
 * unique — no two items may share a timestamp.
 *
 * This is required by the RSS/podcast spec: clients use publication date
 * to determine episode recency, and a non-monotonic or duplicate sequence
 * causes incorrect ordering in podcast apps.
 */
import { describe, it, expect } from 'vitest';
import { generateRssFeed } from '../src/rss-generator.js';
import type { ConferenceOutput } from '../src/types.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Talk with a real audio URL so it is included in the feed.
 */
function makeTalk(order: number, slug: string) {
  return {
    title: `Talk ${order}`,
    slug,
    order,
    url: `https://example.test/t/${slug}`,
    speaker: { name: `Speaker ${order}`, role_tag: null as null },
    audio: { url: `https://example.test/audio/${slug}.mp3`, duration_ms: 600_000 },
  };
}

/**
 * Build a minimal Session with a real audio URL and the given talks.
 */
function makeSession(
  order: number,
  name: string,
  slug: string,
  talks: ReturnType<typeof makeTalk>[]
) {
  return {
    name,
    slug,
    order,
    url: `https://example.test/s/${slug}`,
    audio: { url: `https://example.test/audio/${slug}-full.mp3`, duration_ms: 3_600_000 },
    talks,
  };
}

/**
 * Two-conference fixture:
 *   - April 2025  (older): Saturday Morning (2 talks) + Sunday Afternoon (2 talks)
 *   - October 2025 (newer): Saturday Morning (3 talks) + Sunday Morning (2 talks)
 *
 * 2 conferences × 2 sessions × 2-3 talks = 10 talks + 4 session items = 14 items total.
 */
function makeFixture(): ConferenceOutput[] {
  return [
    {
      scraped_at: '2025-04-07T20:00:00Z',
      version: '1.0',
      conference: {
        year: 2025,
        month: 4,
        name: 'April 2025 General Conference',
        url: 'https://example.test/2025-04',
        language: 'eng',
        sessions: [
          makeSession(1, 'Saturday Morning Session', 'saturday-morning-session', [
            makeTalk(1, 'apr25-sat-am-t1'),
            makeTalk(2, 'apr25-sat-am-t2'),
          ]),
          makeSession(5, 'Sunday Afternoon Session', 'sunday-afternoon-session', [
            makeTalk(1, 'apr25-sun-pm-t1'),
            makeTalk(2, 'apr25-sun-pm-t2'),
          ]),
        ],
      },
    },
    {
      scraped_at: '2025-10-06T20:00:00Z',
      version: '1.0',
      conference: {
        year: 2025,
        month: 10,
        name: 'October 2025 General Conference',
        url: 'https://example.test/2025-10',
        language: 'eng',
        sessions: [
          makeSession(1, 'Saturday Morning Session', 'saturday-morning-session', [
            makeTalk(1, 'oct25-sat-am-t1'),
            makeTalk(2, 'oct25-sat-am-t2'),
            makeTalk(3, 'oct25-sat-am-t3'),
          ]),
          makeSession(4, 'Sunday Morning Session', 'sunday-morning-session', [
            makeTalk(1, 'oct25-sun-am-t1'),
            makeTalk(2, 'oct25-sun-am-t2'),
          ]),
        ],
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Helpers to extract pubDate values from a feed string
// ---------------------------------------------------------------------------

/**
 * Extract all <pubDate> values from <item> blocks in feed order (top to
 * bottom), returning them as millisecond timestamps (Date.parse).
 */
function extractPubDates(feed: string): number[] {
  const itemBlocks = feed.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return itemBlocks.map((block) => {
    const m = block.match(/<pubDate>([^<]+)<\/pubDate>/);
    if (!m) throw new Error('Item block missing <pubDate>');
    const ms = Date.parse(m[1]);
    if (isNaN(ms)) throw new Error(`Unparseable pubDate: "${m[1]}"`);
    return ms;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RSS feed pubDate monotonic ordering', () => {
  const feed = generateRssFeed(makeFixture(), {
    feedBaseUrl: 'https://example.test/gc',
    language: 'eng',
    includeSessions: true,
    includeTalks: true,
  });

  const timestamps = extractPubDates(feed);

  it('produces items in the feed', () => {
    // 2 conferences × (2+2) sessions × (1-3 talks + 1 session item) = 14 total
    expect(timestamps.length).toBeGreaterThanOrEqual(10);
  });

  it('all pubDate values are unique (no two items share a timestamp)', () => {
    const set = new Set(timestamps);
    expect(set.size).toBe(timestamps.length);
  });

  it('pubDates are strictly monotonically decreasing (newest-to-oldest)', () => {
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeLessThan(timestamps[i - 1]);
    }
  });

  it('newest conference items all have higher pubDates than oldest conference items', () => {
    // October 2025 is newer than April 2025; all oct25 items must have
    // pubDates greater than all apr25 items.
    //
    // Filter individual already-parsed item blocks (not a cross-item regex)
    // to avoid multi-item span matching with greedy/lazy wildcards.
    const itemBlocks = feed.match(/<item>[\s\S]*?<\/item>/g) ?? [];
    const oct25Items = itemBlocks.filter((b) => b.includes('oct25'));
    const apr25Items = itemBlocks.filter((b) => b.includes('apr25'));

    expect(oct25Items.length).toBeGreaterThan(0);
    expect(apr25Items.length).toBeGreaterThan(0);

    const minOct = Math.min(
      ...oct25Items.map((b) => Date.parse(b.match(/<pubDate>([^<]+)<\/pubDate>/)![1]))
    );
    const maxApr = Math.max(
      ...apr25Items.map((b) => Date.parse(b.match(/<pubDate>([^<]+)<\/pubDate>/)![1]))
    );
    expect(minOct).toBeGreaterThan(maxApr);
  });

  it('within a single session, later talks have later pubDates than earlier talks', () => {
    // In the feed, talks appear in descending order (latest first).
    // Extract October 2025 Saturday Morning items specifically.
    const itemBlocks = feed.match(/<item>[\s\S]*?<\/item>/g) ?? [];
    const oct25SatAmTalkItems = itemBlocks.filter((b) =>
      b.includes('oct25-sat-am-t')
    );
    // There are 3 talks; they should appear in feed as t3, t2, t1 (descending).
    expect(oct25SatAmTalkItems.length).toBe(3);

    const talkTimestamps = oct25SatAmTalkItems.map((b) =>
      Date.parse(b.match(/<pubDate>([^<]+)<\/pubDate>/)![1])
    );
    // Emitted descending in feed, so talkTimestamps[0] > [1] > [2]
    for (let i = 1; i < talkTimestamps.length; i++) {
      expect(talkTimestamps[i]).toBeLessThan(talkTimestamps[i - 1]);
    }
  });

  it('session item has a lower pubDate than all of its talks', () => {
    // The full-session item for a given session should be stamped at
    // sessionStart (offset 0), which is earlier than any talk (offset >= 60s).
    const itemBlocks = feed.match(/<item>[\s\S]*?<\/item>/g) ?? [];

    // Find the Saturday Morning full-session item for October 2025
    const sessionItem = itemBlocks.find((b) =>
      b.includes('gc-2025-10-saturday-morning-session-full')
    );
    expect(sessionItem).toBeDefined();
    const sessionTs = Date.parse(
      sessionItem!.match(/<pubDate>([^<]+)<\/pubDate>/)![1]
    );

    // Find all talk items for the same session
    const talkItems = itemBlocks.filter((b) =>
      b.includes('oct25-sat-am-t')
    );
    expect(talkItems.length).toBeGreaterThan(0);
    for (const talkItem of talkItems) {
      const talkTs = Date.parse(
        talkItem.match(/<pubDate>([^<]+)<\/pubDate>/)![1]
      );
      expect(sessionTs).toBeLessThan(talkTs);
    }
  });

  it('pins the pubDate algorithm: April 2025 Sunday Afternoon session 5 starts at the correct UTC time', () => {
    // April 2025: month=4, year=2025.
    // 2025-04-01 is a Tuesday (UTC day 2).
    // Days until Saturday = (6 - 2 + 7) % 7 = 4  →  first Saturday = 2025-04-05
    // Session 5 (Sunday Afternoon): dayOffset=1, hourUtc=20
    //   → 2025-04-05 + 1 day + 20h = 2025-04-06T20:00:00Z
    // Session item uses sessionStart (no offset).
    const expectedSessionStartMs = Date.UTC(2025, 3, 6, 20, 0, 0); // month is 0-indexed

    const itemBlocks = feed.match(/<item>[\s\S]*?<\/item>/g) ?? [];
    const sessionItem = itemBlocks.find((b) =>
      b.includes('gc-2025-4-sunday-afternoon-session-full')
    );
    expect(sessionItem).toBeDefined();
    const sessionTs = Date.parse(
      sessionItem!.match(/<pubDate>([^<]+)<\/pubDate>/)![1]
    );
    expect(sessionTs).toBe(expectedSessionStartMs);
  });

  it('pins the pubDate algorithm: a specific talk gets sessionStart + (order × 60s)', () => {
    // April 2025 Sunday Afternoon talk order=2:
    //   sessionStart = 2025-04-06T20:00:00Z  (as computed above)
    //   talkDate = sessionStart + 2 * 60_000 ms = 2025-04-06T20:02:00Z
    const expectedTalkMs = Date.UTC(2025, 3, 6, 20, 2, 0);

    const itemBlocks = feed.match(/<item>[\s\S]*?<\/item>/g) ?? [];
    const talkItem = itemBlocks.find((b) => b.includes('apr25-sun-pm-t2'));
    expect(talkItem).toBeDefined();
    const talkTs = Date.parse(
      talkItem!.match(/<pubDate>([^<]+)<\/pubDate>/)![1]
    );
    expect(talkTs).toBe(expectedTalkMs);
  });
});

describe('RSS feed pubDate monotonic ordering — talks-only mode', () => {
  const feed = generateRssFeed(makeFixture(), {
    feedBaseUrl: 'https://example.test/gc',
    language: 'eng',
    includeSessions: false,
    includeTalks: true,
  });

  const timestamps = extractPubDates(feed);

  it('all pubDate values are unique in talks-only mode', () => {
    const set = new Set(timestamps);
    expect(set.size).toBe(timestamps.length);
  });

  it('pubDates are strictly monotonically decreasing in talks-only mode', () => {
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeLessThan(timestamps[i - 1]);
    }
  });
});

describe('RSS feed pubDate monotonic ordering — sessions-only mode', () => {
  const feed = generateRssFeed(makeFixture(), {
    feedBaseUrl: 'https://example.test/gc',
    language: 'eng',
    includeSessions: true,
    includeTalks: false,
  });

  const timestamps = extractPubDates(feed);

  it('all pubDate values are unique in sessions-only mode', () => {
    const set = new Set(timestamps);
    expect(set.size).toBe(timestamps.length);
  });

  it('pubDates are strictly monotonically decreasing in sessions-only mode', () => {
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeLessThan(timestamps[i - 1]);
    }
  });
});
