/**
 * The lengths the site and README promise must match the published audio
 * (src/episode-lengths.ts). Reads the committed feeds, so a conference whose
 * talks run longer or shorter fails here and the copy gets updated.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { SESSION_HOURS_TEXT, TALK_MINUTES, TALK_MINUTES_TEXT } from '../src/episode-lengths.js';

const FEEDS = ['docs/audio.xml', 'docs/audio-es.xml', 'docs/audio-pt.xml'];

function minutesByKind(file: string): { talks: number[]; sessions: number[] } {
  const xml = readFileSync(file, 'utf-8');
  const talks: number[] = [];
  const sessions: number[] = [];
  for (const [, item] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const guid = /<guid[^>]*>([^<]*)<\/guid>/.exec(item)?.[1] ?? '';
    const duration = /<itunes:duration>([^<]+)<\/itunes:duration>/.exec(item)?.[1];
    if (!duration) continue;
    const minutes = duration.split(':').reduce((s, v) => s * 60 + Number(v), 0) / 60;
    (guid.endsWith('-full') ? sessions : talks).push(minutes);
  }
  return { talks, sessions };
}

// Never in the publishing workflow: a copy mismatch must not stop a feed
// update. CI on the next PR reports it instead.
const inPublishRun = process.env.GITHUB_WORKFLOW === 'Update Podcast Feed';

describe.skipIf(inPublishRun).each(FEEDS)(
  '%s episode lengths match the advertised ranges',
  (file) => {
    const { talks, sessions } = minutesByKind(file);

    it('at least 90% of talk episodes fall in the advertised talk range', () => {
      // The rest are sustainings, reports, introductions and closing remarks.
      const inRange = talks.filter((m) => m >= TALK_MINUTES.min && m <= TALK_MINUTES.max + 0.5);
      expect(talks.length).toBeGreaterThan(0);
      expect(inRange.length / talks.length).toBeGreaterThanOrEqual(0.9);
    });

    it('no talk episode runs longer than the advertised maximum', () => {
      expect(Math.max(...talks)).toBeLessThanOrEqual(TALK_MINUTES.max + 0.5);
    });

    it('full sessions run about 1½–2 hours', () => {
      expect(sessions.length).toBeGreaterThan(0);
      for (const m of sessions) {
        expect(m).toBeGreaterThanOrEqual(80);
        expect(m).toBeLessThanOrEqual(130);
      }
    });
  },
);

describe('README states the same ranges', () => {
  it('quotes the talk and session lengths from src/episode-lengths.ts', () => {
    const readme = readFileSync('README.md', 'utf-8');
    expect(readme).toContain(`about ${TALK_MINUTES_TEXT} min`);
    expect(readme).toContain(`about ${SESSION_HOURS_TEXT} hours`);
  });
});
