/**
 * Deliberate channel art (no silent auto-switch).
 *
 * The channel image changes only when a person chooses it, through an entry
 * in config/conference-image-overrides.json. Neither the Church's
 * auto-extracted conference image nor self-hosted art without an entry moves
 * the channel art (apps refresh copied art slowly; see CHANNEL_ART.md).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { generateRssFeed } from '../src/rss-generator.js';
import {
  DEFAULT_CHANNEL_ART,
  loadImageOverrides,
  overrideKey,
  selectChannelArt,
} from '../src/channel-art.js';
import type { ConferenceOutput } from '../src/types.js';

const BASE = 'https://nanodba.github.io/gc_podcast';
const CHURCH_OCT_2026 =
  'https://www.churchofjesuschrist.org/imgs/oct2026hash/square/1500,1500/0/default';
const CHURCH_APR_2026 =
  'https://www.churchofjesuschrist.org/imgs/apr2026hash/square/1500,1500/0/default';
const DEFAULT_ART = DEFAULT_CHANNEL_ART;
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

describe('selectChannelArt (overrides file is the only source)', () => {
  it('picks the newest entry for the language', () => {
    const o = { '2026-04-eng': OVERRIDE_APR_2026, '2026-10-eng': OVERRIDE_OCT_2026 };
    expect(selectChannelArt(o, 'eng')).toEqual({ url: OVERRIDE_OCT_2026, cycle: '2026-10' });
  });

  it('ignores entries for other languages and malformed keys', () => {
    const o = {
      '2026-10-spa': 'x',
      '2027-04-eng-old': 'y',
      'latest-eng': 'z',
      '2026-04-eng': OVERRIDE_APR_2026,
    };
    expect(selectChannelArt(o, 'eng')).toEqual({ url: OVERRIDE_APR_2026, cycle: '2026-04' });
  });

  it('returns undefined when the language has no entry', () => {
    expect(selectChannelArt({ '2026-10-spa': 'x' }, 'eng')).toBeUndefined();
  });
});

describe('generateRssFeed channel art policy', () => {
  const gen = (cs: ConferenceOutput[], overrides: Record<string, string> = {}) =>
    generateRssFeed(cs, { feedBaseUrl: BASE, language: 'eng', imageOverrides: overrides });

  it('Church art on a new conference never replaces the previous override', () => {
    const feed = gen([conf(2026, 4, CHURCH_APR_2026), conf(2026, 10, CHURCH_OCT_2026)], {
      '2026-04-eng': OVERRIDE_APR_2026,
    });
    expect(channelImage(feed)).toBe(`${OVERRIDE_APR_2026}?v=2026-04`);
  });

  it('an override set for the next conference goes live before its data exists', () => {
    const feed = gen([conf(2026, 4, SELF_APR_2026)], { '2026-10-eng': OVERRIDE_OCT_2026 });
    expect(channelImage(feed)).toBe(`${OVERRIDE_OCT_2026}?v=2026-10`);
  });

  it('an override older than the feed window still applies', () => {
    const feed = gen([conf(2028, 4, CHURCH_APR_2026)], { '2026-10-eng': OVERRIDE_OCT_2026 });
    expect(channelImage(feed)).toBe(`${OVERRIDE_OCT_2026}?v=2026-10`);
  });

  it('self-hosted conference_image_url without an override is not special', () => {
    const feed = gen([conf(2026, 10, SELF_APR_2026)]);
    expect(channelImage(feed)).toBe(DEFAULT_ART);
  });

  it('no override at all: fixed default, never scraped Church art or a talk hero', () => {
    expect(
      channelImage(gen([conf(2026, 4, CHURCH_APR_2026), conf(2026, 10, CHURCH_OCT_2026)])),
    ).toBe(DEFAULT_ART);
    expect(channelImage(gen([conf(2026, 10, null)]))).toBe(DEFAULT_ART);
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
