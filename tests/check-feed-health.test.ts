/**
 * Published-feed health check: pure verdict logic (no network).
 */
import { describe, it, expect } from 'vitest';
import {
  conferenceSaturday,
  currentConference,
  evaluateFeed,
  parseFeed,
} from '../src/check-feed-health.js';

function feedXml(opts: { built: string; guids: string[]; url?: string }): string {
  const items = opts.guids
    .map(
      (g) => `<item>
      <title>t</title>
      <enclosure url="${opts.url ?? `https://assets.example.org/${g}.mp3`}" length="1" type="audio/mpeg"/>
      <guid isPermaLink="false">${g}</guid>
    </item>`,
    )
    .join('\n');
  return `<?xml version="1.0"?><rss><channel><lastBuildDate>${opts.built}</lastBuildDate>${items}</channel></rss>`;
}

const SESSIONS = ['sat-am', 'sat-pm', 'sun-am', 'sun-pm'];
const fullConference = (y: number, m: number, talks: number) => [
  ...SESSIONS.map((s) => `gc-${y}-${m}-${s}-full`),
  ...Array.from({ length: talks }, (_, i) => `gc-${y}-${m}-${SESSIONS[i % 4]}-${i}talk`),
];

describe('conference dates', () => {
  it('is the first Saturday of April/October', () => {
    expect(conferenceSaturday(2026, 10).toISOString().slice(0, 10)).toBe('2026-10-03');
    expect(conferenceSaturday(2026, 4).toISOString().slice(0, 10)).toBe('2026-04-04');
    expect(conferenceSaturday(2025, 10).toISOString().slice(0, 10)).toBe('2025-10-04');
  });

  it('picks the latest conference that has started', () => {
    expect(currentConference(new Date('2026-10-02T23:00:00Z'))).toMatchObject({
      year: 2026,
      month: 4,
    });
    expect(currentConference(new Date('2026-10-03T00:00:00Z'))).toMatchObject({
      year: 2026,
      month: 10,
    });
    expect(currentConference(new Date('2027-02-01T00:00:00Z'))).toMatchObject({
      year: 2026,
      month: 10,
    });
  });
});

describe('evaluateFeed', () => {
  const april = fullConference(2026, 4, 37);

  it('conference Saturday morning: October not due yet, fresh feed passes', () => {
    const now = new Date('2026-10-03T13:00:00Z');
    const feed = parseFeed(feedXml({ built: 'Sat, 03 Oct 2026 07:53:59 GMT', guids: april }));
    const r = evaluateFeed(feed, now);
    expect(r.failures).toEqual([]);
    expect(r.notes[0]).toContain('2026-10: 0/4 sessions, 0 talks');
  });

  it('fails when the feed stops being rebuilt during the conference window', () => {
    const now = new Date('2026-10-05T12:00:00Z');
    const feed = parseFeed(feedXml({ built: 'Sat, 03 Oct 2026 07:53:59 GMT', guids: april }));
    expect(evaluateFeed(feed, now).failures.join()).toMatch(/not rebuilt for 52h/);
  });

  it('fails when full sessions are missing after they are due', () => {
    const now = new Date('2026-10-07T12:00:00Z');
    const guids = [...april, 'gc-2026-10-sat-am-full', 'gc-2026-10-sat-pm-full'];
    const feed = parseFeed(feedXml({ built: 'Wed, 07 Oct 2026 08:00:00 GMT', guids }));
    expect(evaluateFeed(feed, now).failures).toEqual([
      '2026-10: 2/4 full-session episodes (due by now)',
    ]);
  });

  it('fails when talks are missing after they are due, passes once they land', () => {
    const now = new Date('2026-10-14T12:00:00Z');
    const built = 'Wed, 14 Oct 2026 08:00:00 GMT';
    const partial = [...april, ...fullConference(2026, 10, 10)];
    expect(
      evaluateFeed(parseFeed(feedXml({ built, guids: partial })), now).failures.join(),
    ).toMatch(/10 talk episodes, expected at least 25/);
    const complete = [...april, ...fullConference(2026, 10, 36)];
    expect(evaluateFeed(parseFeed(feedXml({ built, guids: complete })), now).ok).toBe(true);
  });

  it('outside the window a months-old build is fine', () => {
    const now = new Date('2027-02-01T12:00:00Z');
    const guids = fullConference(2026, 10, 36);
    const feed = parseFeed(feedXml({ built: 'Thu, 15 Jan 2027 12:00:00 GMT', guids }));
    expect(evaluateFeed(feed, now).ok).toBe(true);
  });

  it('fails on empty feeds, blank enclosures and duplicate GUIDs', () => {
    const now = new Date('2027-02-01T12:00:00Z');
    const built = 'Mon, 01 Feb 2027 00:00:00 GMT';
    expect(evaluateFeed(parseFeed(feedXml({ built, guids: [] })), now).failures).toContain(
      'feed has no items',
    );
    const blank = evaluateFeed(parseFeed(feedXml({ built, guids: ['a'], url: ' ' })), now);
    expect(blank.failures.join()).toMatch(/missing or non-https enclosure/);
    const dup = evaluateFeed(parseFeed(feedXml({ built, guids: ['a', 'a'] })), now);
    expect(dup.failures.join()).toMatch(/duplicate GUIDs: a/);
  });
});
