/**
 * Tests for Church session-slot numbering in the generated RSS feed
 * (gc_podcast session-slots fix).
 *
 * The Church numbers conference sessions with FIXED slots, whether or not a
 * Saturday Evening session is held:
 *   1 Saturday Morning, 2 Saturday Afternoon, 3 Saturday Evening,
 *   4 Sunday Morning, 5 Sunday Afternoon.
 * Talk slugs carry the same numbering as a leading code (11oaks = slot 1
 * talk 1, 41uchtdorf = slot 4 talk 1, 510x = slot 5 talk 10).
 *
 * Before this fix the schedule was keyed by session POSITION, so a 4-session
 * conference (no Saturday Evening, e.g. April 2026) stamped Sunday Morning
 * with the Saturday-evening time and Sunday Afternoon with Sunday morning's.
 * Season was the bare year (April and October collided) and episode was
 * talk.order (reset per session), producing duplicate (season, episode) pairs.
 */
import { describe, it, expect } from 'vitest';
import { generateRssFeed } from '../src/rss-generator.js';
import type { ConferenceOutput, Session, Talk } from '../src/types.js';

function makeTalk(order: number, slug: string): Talk {
  return {
    title: `Talk ${slug}`,
    slug,
    order,
    url: `https://example.test/t/${slug}`,
    speaker: { name: `Speaker ${slug}`, role_tag: null },
    audio: { url: `https://example.test/audio/${slug}.mp3`, duration_ms: 600_000 },
  };
}

function makeSession(order: number, slug: string, talks: Talk[]): Session {
  return {
    name: slug,
    slug,
    order,
    url: `https://example.test/s/${slug}`,
    audio: { url: `https://example.test/audio/${slug}-full.mp3`, duration_ms: 3_600_000 },
    talks,
  };
}

function makeConference(year: number, month: 4 | 10, sessions: Session[]): ConferenceOutput {
  return {
    scraped_at: `${year}-${month}-10T00:00:00Z`,
    version: '1.0',
    conference: {
      year,
      month,
      name: `${month === 4 ? 'April' : 'October'} ${year} General Conference`,
      url: `https://example.test/${year}-${month}`,
      language: 'eng',
      sessions,
    },
  };
}

/** April 2026 shape: four sessions, no Saturday Evening, Sunday talks still 4x/5x. */
function fourSessionConference(): ConferenceOutput {
  return makeConference(2026, 4, [
    makeSession(1, 'saturday-morning-session', [makeTalk(1, '11oaks'), makeTalk(2, '12bednar')]),
    makeSession(2, 'saturday-afternoon-session', [
      makeTalk(1, '21christofferson'),
      makeTalk(10, '210soares'),
    ]),
    makeSession(3, 'sunday-morning-session', [makeTalk(1, '41uchtdorf'), makeTalk(2, '42freeman')]),
    makeSession(4, 'sunday-afternoon-session', [makeTalk(1, '51wong'), makeTalk(9, '59oaks')]),
  ]);
}

/** October 2025 shape: all five sessions. */
function fiveSessionConference(): ConferenceOutput {
  return makeConference(2025, 10, [
    makeSession(1, 'saturday-morning-session', [makeTalk(1, '11a')]),
    makeSession(2, 'saturday-afternoon-session', [makeTalk(1, '21b')]),
    makeSession(3, 'saturday-evening-session', [makeTalk(1, '31c')]),
    makeSession(4, 'sunday-morning-session', [makeTalk(1, '41d')]),
    makeSession(5, 'sunday-afternoon-session', [makeTalk(1, '51e')]),
  ]);
}

interface ParsedItem {
  guid: string;
  pubDate: number;
  season: number;
  episode: number;
}

function parseItems(feed: string): ParsedItem[] {
  const blocks = feed.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return blocks.map((b) => ({
    guid: b.match(/<guid[^>]*>([^<]+)<\/guid>/)![1],
    pubDate: Date.parse(b.match(/<pubDate>([^<]+)<\/pubDate>/)![1]),
    season: Number(b.match(/<itunes:season>([^<]+)<\/itunes:season>/)![1]),
    episode: Number(b.match(/<itunes:episode>([^<]+)<\/itunes:episode>/)![1]),
  }));
}

function feedFor(conferences: ConferenceOutput[]): ParsedItem[] {
  return parseItems(
    generateRssFeed(conferences, {
      feedBaseUrl: 'https://example.test/gc',
      language: 'eng',
      includeSessions: true,
      includeTalks: true,
    }),
  );
}

function byGuid(items: ParsedItem[], guid: string): ParsedItem {
  const item = items.find((i) => i.guid === guid);
  if (!item) throw new Error(`missing item ${guid}`);
  return item;
}

describe('session slots: conference without a Saturday Evening session', () => {
  const items = feedFor([fourSessionConference()]);

  it('stamps Sunday Morning at Sunday 16:00Z (slot 4), not the Saturday-evening slot', () => {
    // April 2026: first Saturday is 2026-04-04, so Sunday is 2026-04-05.
    const item = byGuid(items, 'gc-2026-4-sunday-morning-session-full');
    expect(item.pubDate).toBe(Date.UTC(2026, 3, 5, 16, 0, 0));
  });

  it('stamps Sunday Afternoon at Sunday 20:00Z (slot 5)', () => {
    const item = byGuid(items, 'gc-2026-4-sunday-afternoon-session-full');
    expect(item.pubDate).toBe(Date.UTC(2026, 3, 5, 20, 0, 0));
  });

  it('talks keep sessionStart + order minutes', () => {
    const item = byGuid(items, 'gc-2026-4-sunday-afternoon-session-59oaks');
    expect(item.pubDate).toBe(Date.UTC(2026, 3, 5, 20, 9, 0));
  });

  it('uses the Church talk code as the episode number', () => {
    expect(byGuid(items, 'gc-2026-4-sunday-morning-session-41uchtdorf').episode).toBe(41);
    expect(byGuid(items, 'gc-2026-4-sunday-afternoon-session-59oaks').episode).toBe(59);
    expect(byGuid(items, 'gc-2026-4-saturday-afternoon-session-210soares').episode).toBe(210);
  });

  it('numbers full sessions slot × 100', () => {
    expect(byGuid(items, 'gc-2026-4-sunday-morning-session-full').episode).toBe(400);
    expect(byGuid(items, 'gc-2026-4-sunday-afternoon-session-full').episode).toBe(500);
    expect(byGuid(items, 'gc-2026-4-saturday-morning-session-full').episode).toBe(100);
  });

  it('uses season = year × 100 + month', () => {
    expect(new Set(items.map((i) => i.season))).toEqual(new Set([202604]));
  });
});

describe('session slots: five-session conference is unchanged', () => {
  const items = feedFor([fiveSessionConference()]);

  it.each([
    ['saturday-morning-session', Date.UTC(2025, 9, 4, 16)],
    ['saturday-afternoon-session', Date.UTC(2025, 9, 4, 20)],
    ['saturday-evening-session', Date.UTC(2025, 9, 5, 0)],
    ['sunday-morning-session', Date.UTC(2025, 9, 5, 16)],
    ['sunday-afternoon-session', Date.UTC(2025, 9, 5, 20)],
  ])('%s starts at its fixed slot time', (slug, expected) => {
    expect(byGuid(items, `gc-2025-10-${slug}-full`).pubDate).toBe(expected);
  });

  it('uses season 202510', () => {
    expect(new Set(items.map((i) => i.season))).toEqual(new Set([202510]));
  });
});

describe('session slots: unrecognized session slugs fall back to position', () => {
  // Historical conferences (e.g. 1974 Friday sessions) do not follow the
  // modern five-slot layout. The whole conference keeps the old
  // position-based schedule so pubDates stay unique.
  const items = feedFor([
    makeConference(1974, 4, [
      makeSession(1, 'friday-morning-session', [makeTalk(1, 'touchstone-of-truth')]),
      makeSession(2, 'saturday-morning-session', [makeTalk(1, 'hanging-on')]),
    ]),
  ]);

  it('schedules by position and numbers episodes slot × 100 + order', () => {
    // April 1974: first Saturday is 1974-04-06.
    const fri = byGuid(items, 'gc-1974-4-friday-morning-session-full');
    const sat = byGuid(items, 'gc-1974-4-saturday-morning-session-full');
    expect(fri.pubDate).toBe(Date.UTC(1974, 3, 6, 16));
    expect(sat.pubDate).toBe(Date.UTC(1974, 3, 6, 20));
    expect(byGuid(items, 'gc-1974-4-friday-morning-session-touchstone-of-truth').episode).toBe(101);
    expect(byGuid(items, 'gc-1974-4-saturday-morning-session-hanging-on').episode).toBe(201);
  });
});

describe('session slots: whole-feed invariants', () => {
  const items = feedFor([fiveSessionConference(), fourSessionConference()]);

  it('has no duplicate (season, episode) pairs', () => {
    const keys = items.map((i) => `${i.season}:${i.episode}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps pubDates strictly decreasing from top to bottom', () => {
    for (let i = 1; i < items.length; i++) {
      expect(items[i].pubDate).toBeLessThan(items[i - 1].pubDate);
    }
  });
});
