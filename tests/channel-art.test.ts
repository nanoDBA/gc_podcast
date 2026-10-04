/**
 * Deliberate channel art (no silent auto-switch).
 *
 * Pocket Casts locks the first channel art it sees for a feed URL, so the
 * channel image may only change when someone chooses it: a manual override in
 * config/conference-image-overrides.json, or art self-hosted on the feed's own
 * GitHub Pages site. A new conference that only carries the Church's
 * auto-extracted image must not move the channel art.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { generateRssFeed } from '../src/rss-generator.js';
import { loadImageOverrides, overrideKey, selectDeliberateChannelArt } from '../src/channel-art.js';
import type { Conference, ConferenceOutput } from '../src/types.js';

const BASE = 'https://nanodba.github.io/gc_podcast';
const CHURCH_OCT_2026 =
  'https://www.churchofjesuschrist.org/imgs/oct2026hash/square/1500,1500/0/default';
const CHURCH_APR_2026 =
  'https://www.churchofjesuschrist.org/imgs/apr2026hash/square/1500,1500/0/default';
const SELF_APR_2026 = `${BASE}/channel-art-april-2026.jpg`;
const OVERRIDE_APR_2026 = `${BASE}/channel-art-april-2026-override.jpg`;
const OVERRIDE_OCT_2026 = `${BASE}/channel-art-october-2026-en.jpg`;

function conf(year: number, month: number, imageUrl: string | null): ConferenceOutput {
  return {
    scraped_at: `${year}-${String(month).padStart(2, '0')}-05T00:00:00Z`,
    version: '1.0',
    conference: {
      year,
      month,
      name: `${month === 4 ? 'April' : 'October'} ${year} General Conference`,
      url: `https://example.test/conf/${year}/${month}`,
      language: 'eng',
      conference_image_url: imageUrl,
      sessions: [
        {
          name: 'Saturday Morning Session',
          slug: 'saturday-morning-session',
          order: 1,
          url: `https://example.test/conf/${year}/${month}/sat-am`,
          talks: [
            {
              title: 'Talk',
              slug: '01talk',
              order: 1,
              url: `https://example.test/conf/${year}/${month}/01talk`,
              speaker: { name: 'Speaker', role_tag: null },
              audio: { url: `https://assets.example.test/${year}-${month}.mp3`, quality: '64k' },
              image_url: `https://www.churchofjesuschrist.org/imgs/hero${year}${month}/full/!1400%2C1400/0/default.jpg`,
            },
          ],
        },
      ],
    },
  } as unknown as ConferenceOutput;
}

const newestFirst = (...cs: ConferenceOutput[]): Conference[] => cs.map((c) => c.conference);

function channelImage(feed: string): string | null {
  const withoutItems = feed.replace(/<item>[\s\S]*?<\/item>/g, '');
  return /<itunes:image\s+href="([^"]+)"\s*\/>/.exec(withoutItems)?.[1] ?? null;
}

describe('overrideKey', () => {
  it('formats YYYY-MM-<lang>', () => {
    expect(overrideKey(2027, 4, 'spa')).toBe('2027-04-spa');
    expect(overrideKey(2026, 10, 'eng')).toBe('2026-10-eng');
  });
});

describe('selectDeliberateChannelArt', () => {
  const opts = (overrides: Record<string, string> = {}) => ({
    language: 'eng',
    overrides,
    selfHostBase: BASE,
  });

  it('new conference with only Church art and no override keeps the previous override', () => {
    const art = selectDeliberateChannelArt(
      newestFirst(conf(2026, 10, CHURCH_OCT_2026), conf(2026, 4, CHURCH_APR_2026)),
      opts({ '2026-04-eng': OVERRIDE_APR_2026 }),
    );
    expect(art).toEqual({ url: OVERRIDE_APR_2026, cycle: '2026-04' });
  });

  it('an override for the newest conference is used, even before a re-scrape', () => {
    const art = selectDeliberateChannelArt(
      newestFirst(conf(2026, 10, CHURCH_OCT_2026), conf(2026, 4, SELF_APR_2026)),
      opts({ '2026-10-eng': OVERRIDE_OCT_2026 }),
    );
    expect(art).toEqual({ url: OVERRIDE_OCT_2026, cycle: '2026-10' });
  });

  it('overrides for another language do not count', () => {
    const art = selectDeliberateChannelArt(
      newestFirst(conf(2026, 10, CHURCH_OCT_2026), conf(2026, 4, SELF_APR_2026)),
      opts({ '2026-10-spa': `${BASE}/es.jpg` }),
    );
    expect(art).toEqual({ url: SELF_APR_2026, cycle: '2026-04' });
  });

  it('a self-hosted conference_image_url qualifies without an override', () => {
    const art = selectDeliberateChannelArt(
      newestFirst(conf(2026, 4, SELF_APR_2026), conf(2025, 10, CHURCH_APR_2026)),
      opts(),
    );
    expect(art).toEqual({ url: SELF_APR_2026, cycle: '2026-04' });
  });

  it('host match is case-insensitive (CI passes the owner as nanoDBA)', () => {
    const art = selectDeliberateChannelArt(newestFirst(conf(2026, 4, SELF_APR_2026)), {
      language: 'eng',
      overrides: {},
      selfHostBase: 'https://nanoDBA.github.io/gc_podcast/',
    });
    expect(art).toEqual({ url: SELF_APR_2026, cycle: '2026-04' });
  });

  it('a look-alike host is not self-hosted', () => {
    const art = selectDeliberateChannelArt(
      newestFirst(conf(2026, 4, `${BASE}-evil.example/x.jpg`)),
      opts(),
    );
    expect(art).toBeUndefined();
  });

  it('returns undefined when no conference qualifies', () => {
    expect(
      selectDeliberateChannelArt(
        newestFirst(conf(2026, 10, CHURCH_OCT_2026), conf(2026, 4, CHURCH_APR_2026)),
        opts(),
      ),
    ).toBeUndefined();
  });
});

describe('generateRssFeed channel art policy', () => {
  const gen = (cs: ConferenceOutput[], overrides: Record<string, string> = {}) =>
    generateRssFeed(cs, { feedBaseUrl: BASE, language: 'eng', imageOverrides: overrides });

  it('Church art on a new conference does not replace the previous override', () => {
    const feed = gen([conf(2026, 4, CHURCH_APR_2026), conf(2026, 10, CHURCH_OCT_2026)], {
      '2026-04-eng': OVERRIDE_APR_2026,
    });
    expect(channelImage(feed)).toBe(`${OVERRIDE_APR_2026}?v=2026-04`);
  });

  it('override present for the new conference is used with its own cycle', () => {
    const feed = gen([conf(2026, 4, SELF_APR_2026), conf(2026, 10, CHURCH_OCT_2026)], {
      '2026-10-eng': OVERRIDE_OCT_2026,
    });
    expect(channelImage(feed)).toBe(`${OVERRIDE_OCT_2026}?v=2026-10`);
  });

  it('self-hosted URL is used with its own cycle', () => {
    const feed = gen([conf(2026, 4, SELF_APR_2026), conf(2026, 10, CHURCH_OCT_2026)]);
    expect(channelImage(feed)).toBe(`${SELF_APR_2026}?v=2026-04`);
  });

  it('no qualifying conference keeps the old fallback (newest conference_image_url)', () => {
    const feed = gen([conf(2026, 4, CHURCH_APR_2026), conf(2026, 10, CHURCH_OCT_2026)]);
    expect(channelImage(feed)).toBe(`${CHURCH_OCT_2026}?v=2026-10`);
  });

  it('no qualifying conference and no conference art falls back to the talk hero', () => {
    const feed = gen([conf(2026, 10, null)]);
    expect(channelImage(feed)).toBe(
      'https://www.churchofjesuschrist.org/imgs/hero202610/full/!1400%2C1400/0/default.jpg',
    );
  });
});

describe('loadImageOverrides', () => {
  it('reads string entries, skips _comment keys, and tolerates a missing file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-overrides-'));
    const file = path.join(dir, 'o.json');
    await fs.writeFile(file, JSON.stringify({ _comment: 'x', '2026-10-eng': 'u', bad: 3 }));
    expect(await loadImageOverrides(file)).toEqual({ '2026-10-eng': 'u' });
    expect(await loadImageOverrides(path.join(dir, 'missing.json'))).toEqual({});
    await fs.rm(dir, { recursive: true, force: true });
  });
});
