/**
 * Progressive-publication tests: a conference weekend goes through states
 * (sessions only -> talk pages -> session audio -> per-talk audio -> artwork).
 * Each intermediate state must scrape, merge, and render without regressions.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { __parsersForTesting } from '../src/scraper.js';
import { generateRssFeed } from '../src/rss-generator.js';
import { mergePreviousScrape } from '../src/merge-previous.js';
import { ConferenceOutputSchema } from '../src/schemas.js';
import { log } from '../src/logger.js';
import type { ConferenceOutput, Session, Talk } from '../src/types.js';

function talk(order: number, overrides: Partial<Talk> = {}): Talk {
  return {
    title: `Talk ${order}`,
    slug: `t${order}`,
    order,
    url: `https://example.test/t${order}`,
    speaker: { name: `Speaker ${order}`, role_tag: null },
    ...overrides,
  };
}

function session(order: number, overrides: Partial<Session> = {}): Session {
  return {
    name: `Session ${order}`,
    slug: `session-${order}`,
    order,
    url: `https://example.test/s${order}`,
    talks: [],
    ...overrides,
  };
}

function output(sessions: Session[], extra: Record<string, unknown> = {}): ConferenceOutput {
  return {
    scraped_at: '2026-10-03T00:00:00.000Z',
    version: '1.0',
    conference: {
      year: 2026,
      month: 10,
      name: 'October 2026 general conference',
      url: 'https://example.test/c',
      language: 'eng',
      sessions,
      ...extra,
    },
  };
}

const items = (xml: string) => xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
const guids = (xml: string) => [...xml.matchAll(/<guid[^>]*>([^<]+)<\/guid>/g)].map((m) => m[1]);

afterEach(() => vi.restoreAllMocks());

describe('state 1: sessions listed, zero talks', () => {
  const empty = output([1, 2, 3, 4].map((n) => session(n)));

  it('passes schema validation', () => {
    expect(ConferenceOutputSchema.safeParse(empty).success).toBe(true);
  });

  it('renders a valid feed with no items', () => {
    const xml = generateRssFeed([empty], { language: 'eng' });
    expect(items(xml)).toHaveLength(0);
    expect(xml).toContain('</channel>');
  });
});

describe('state 2/3: talks without audio, session audio first', () => {
  const partial = output([
    session(1, {
      audio: { url: 'https://example.test/s1.mp3', duration_ms: 3_600_000 },
      talks: [talk(1), talk(2, { audio: { url: '   ' } })],
    }),
    session(2, { talks: [talk(1)] }),
  ]);

  it('publishes the session item and omits talks lacking audio', () => {
    const xml = generateRssFeed([partial], { language: 'eng' });
    expect(items(xml)).toHaveLength(1);
    expect(guids(xml)).toEqual(['gc-2026-10-session-1-full']);
    expect(xml).not.toMatch(/<enclosure url="\s*"/);
  });

  it('keeps GUIDs stable when talk audio arrives later', () => {
    const before = guids(generateRssFeed([partial], { language: 'eng' }));
    const later = output([
      session(1, {
        audio: { url: 'https://example.test/s1.mp3', duration_ms: 3_600_000 },
        talks: [
          talk(1, { audio: { url: 'https://example.test/t1.mp3', duration_ms: 1000 } }),
          talk(2, { audio: { url: 'https://example.test/t2.mp3', duration_ms: 1000 } }),
        ],
      }),
      session(2, { talks: [talk(1)] }),
    ]);
    const after = guids(generateRssFeed([later], { language: 'eng' }));
    for (const g of before) expect(after).toContain(g);
    expect(after).toHaveLength(3);
    expect(new Set(after).size).toBe(after.length);
  });
});

describe('doc-map parser with partially published sessions', () => {
  const html = `<nav class="manifest"><ul class="doc-map">
<li><h2 class="label"><p class="title">Saturday Morning Session</p></h2>
<ul class="doc-map"><li><a href="/study/general-conference/2026/10/saturday-morning-session?lang=eng" class="list-tile"><p class="title">Saturday Morning Session</p></a></li>
<li><a href="/study/general-conference/2026/10/11oaks?lang=eng" class="list-tile"><p class="primaryMeta">Dallin H. Oaks</p><p class="title">Intro</p></a></li></ul></li>
<li><h2 class="label"><p class="title">Saturday Afternoon Session</p></h2>
<ul class="doc-map"><li><a href="/study/general-conference/2026/10/saturday-afternoon-session?lang=eng" class="list-tile"><p class="title">Saturday Afternoon Session</p></a></li></ul></li>
</ul></nav>`;

  it('keeps a session whose talks are not yet published, so its audio is still scraped', () => {
    const sessions = __parsersForTesting().viaDocMap(html);
    expect(sessions.map((s) => s.slug)).toEqual([
      'saturday-morning-session',
      'saturday-afternoon-session',
    ]);
    expect(sessions[1].talks).toEqual([]);
    expect(sessions[1].order).toBe(2);
  });
});

describe('mergePreviousScrape: never regress already-captured data', () => {
  const prev = output(
    [
      session(1, {
        audio: { url: 'https://example.test/s1.mp3', duration_ms: 5 },
        duration_ms: 5,
        talks: [
          talk(1, {
            audio: { url: 'https://example.test/t1.mp3', duration_ms: 10 },
            duration_ms: 10,
            image_url: 'https://example.test/img1',
            speaker: { name: 'Real Name', role_tag: null },
          }),
        ],
      }),
    ],
    { conference_image_url: 'https://example.test/conf.jpg' },
  );

  it('restores audio, image, speaker and channel art lost to a transient failure', () => {
    const next = output(
      [
        session(1, {
          talks: [talk(1, { speaker: { name: 'Unknown Speaker', role_tag: null } })],
        }),
      ],
      { conference_image_url: null },
    );
    const merged = mergePreviousScrape(prev.conference, next.conference);
    const s = merged.sessions[0];
    expect(s.audio?.url).toBe('https://example.test/s1.mp3');
    expect(s.duration_ms).toBe(5);
    expect(s.talks[0].audio?.url).toBe('https://example.test/t1.mp3');
    expect(s.talks[0].duration_ms).toBe(10);
    expect(s.talks[0].image_url).toBe('https://example.test/img1');
    expect(s.talks[0].speaker.name).toBe('Real Name');
    expect(merged.conference_image_url).toBe('https://example.test/conf.jpg');
  });

  it('prefers fresh data when the new scrape has it', () => {
    const next = output([
      session(1, {
        audio: { url: 'https://example.test/new-s1.mp3', duration_ms: 6 },
        talks: [talk(1, { audio: { url: 'https://example.test/new-t1.mp3', duration_ms: 11 } })],
      }),
    ]);
    const merged = mergePreviousScrape(prev.conference, next.conference);
    expect(merged.sessions[0].audio?.url).toBe('https://example.test/new-s1.mp3');
    expect(merged.sessions[0].talks[0].audio?.url).toBe('https://example.test/new-t1.mp3');
  });

  it('does not invent sessions or talks that the new scrape lacks', () => {
    const next = output([session(2)]);
    const merged = mergePreviousScrape(prev.conference, next.conference);
    expect(merged.sessions).toHaveLength(1);
    expect(merged.sessions[0].slug).toBe('session-2');
  });
});

describe('API audio variant drift', () => {
  const body = '<p>no audio here</p>';

  it('warns when meta.audio is populated but has no "audio" variant', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const res = __parsersForTesting().audioFromApi({
      meta: { title: 't', audio: [{ mediaUrl: 'https://x/a.mp3', variant: 'podcast' }] },
      content: { body },
    });
    expect(res).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls[0])).toContain('podcast');
  });

  it('stays quiet when meta.audio is absent (audio simply not published yet)', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const res = __parsersForTesting().audioFromApi({
      meta: { title: 't' },
      content: { body },
    });
    expect(res).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });
});
