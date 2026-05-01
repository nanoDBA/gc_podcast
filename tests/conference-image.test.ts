/**
 * Tests for conference-branded channel image (gc_podcast-8t0).
 *
 * Covers:
 *   - buildConferenceSquareImageUrl produces the exact expected URL.
 *   - fetchConferenceImage for month=4 year=2025 constructs the correct URL.
 *   - fetchConferenceImage returns null for month=5 (non-conference month).
 *   - 404 on collection page triggers fallback fetch to /feature/general-conference.
 *   - Both endpoints failing → returns null, does not throw.
 *   - Hash extracted correctly from synthetic og:image meta tag.
 *   - RSS feed with conference_image_url emits that URL in channel tags.
 *   - RSS feed with no conference_image_url emits the default PODCAST_CONFIG.imageUrl.
 *   - Multi-conference: most-recent conference image wins.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
  buildConferenceSquareImageUrl,
  extractOgImageHash,
  isCanonicalChannelImageHash,
} from '../src/image-extractor.js';
import { ConferenceScraper, __retryTuning } from '../src/scraper.js';
import { generateRssFeed } from '../src/rss-generator.js';
import type { ConferenceOutput } from '../src/types.js';

const originalTuning = { ...__retryTuning };

beforeEach(() => {
  __retryTuning.backoffBaseMs = 1;
  __retryTuning.jitterMaxMs = 1;
  __retryTuning.maxRetries = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(__retryTuning, originalTuning);
});

// ---------------------------------------------------------------------------
// buildConferenceSquareImageUrl
// ---------------------------------------------------------------------------

describe('buildConferenceSquareImageUrl', () => {
  it('produces the exact expected square URL format', () => {
    const hash = 'abc123def456abc1';
    expect(buildConferenceSquareImageUrl(hash)).toBe(
      `https://www.churchofjesuschrist.org/imgs/${hash}/square/1500,1500/0/default`,
    );
  });

  it('uses /square/ region (not /full/)', () => {
    const url = buildConferenceSquareImageUrl('testhash');
    expect(url).toContain('/square/');
    expect(url).not.toContain('/full/');
  });

  it('uses 1500,1500 — the largest size the Church IIIF server serves (gc_podcast-9ut)', () => {
    const url = buildConferenceSquareImageUrl('testhash');
    expect(url).toContain('1500,1500');
    expect(url).not.toContain('1500%2C1500');
    // 3000×3000 exceeded the source's native resolution and returned
    // HTTP 400 from the Church IIIF server — must not regress to that.
    expect(url).not.toContain('3000,3000');
  });

  it('is different from buildCanonicalImageUrl output', async () => {
    const { buildCanonicalImageUrl } = await import('../src/image-extractor.js');
    const hash = 'testhash';
    expect(buildConferenceSquareImageUrl(hash)).not.toBe(buildCanonicalImageUrl(hash));
  });
});

// ---------------------------------------------------------------------------
// extractOgImageHash (used internally by fetchConferenceImage)
// ---------------------------------------------------------------------------

describe('extractOgImageHash', () => {
  it('extracts hash from a synthetic og:image meta tag', () => {
    const hash = 'abc123def456abc1';
    const html = `<html><head>
      <meta property="og:image" content="https://www.churchofjesuschrist.org/imgs/${hash}/full/!1400%2C1400/0/default.jpg">
    </head><body></body></html>`;
    expect(extractOgImageHash(html)).toBe(hash);
  });

  it('returns undefined when no og:image is present', () => {
    const html = '<html><head></head><body></body></html>';
    expect(extractOgImageHash(html)).toBeUndefined();
  });

  it('returns undefined when og:image URL is not a Church IIIF URL', () => {
    const html = `<html><head>
      <meta property="og:image" content="https://example.com/some-image.jpg">
    </head><body></body></html>`;
    expect(extractOgImageHash(html)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// isCanonicalChannelImageHash (gc_podcast-fpx)
// ---------------------------------------------------------------------------

describe('isCanonicalChannelImageHash (gc_podcast-fpx)', () => {
  // Confirmed-good conference hero hashes from real output JSON, all of which
  // serve `/square/1500,1500` with HTTP 200.
  const CANONICAL_HASHES = [
    's1du36854oeygpk5w04dar2vhijkxysmtn2wv1cf', // April 2026 hero
    'zb8ulamgq3e3g70jd6q9odrzisz7ap1kgzztmyra', // October 2025 hero
    'rh1ugr50sjbpepbf5f8mqppasje9opcozk5jxrua', // April 2025 hero
    '4kjpahrj015593n6vfw57sjoo6w9clo2ensncxm1', // October 2024 hero
    'd0xl8aqbmrkvaaisbzfy9yg1i5khrqhlejo87a4h', // April 2026 thumbnail (still canonical IIIF)
  ];

  // Confirmed-bad hashes: pure hex (SHA-1-style) IDs that the Church CDN
  // assigns to evergreen banners and other non-conference assets. These all
  // return HTTP 400 from the `/square/1500,1500` IIIF endpoint.
  const NON_CANONICAL_HEX_HASHES = [
    'bd28805cb67a5524cd310c394c06f1dfbe19cf86', // Good Shepherd evergreen banner
    '525086c4c22d11eebef2eeeeac1e2ff8be72073b', // Older evergreen-style asset
    '3084da5ff78811ee8069eeeeac1e31ec4f04a6a8',
    '00000000000000000000000000000000deadbeef',
  ];

  it.each(CANONICAL_HASHES)('accepts canonical IIIF hash %s', (hash) => {
    expect(isCanonicalChannelImageHash(hash)).toBe(true);
  });

  it.each(NON_CANONICAL_HEX_HASHES)('rejects non-canonical hex-only hash %s', (hash) => {
    expect(isCanonicalChannelImageHash(hash)).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isCanonicalChannelImageHash('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fetchConferenceImage
// ---------------------------------------------------------------------------

const COLLECTION_URL_APRIL_2025 =
  'https://www.churchofjesuschrist.org/media/collection/april-2025-general-conference?lang=eng';
const FALLBACK_URL = 'https://www.churchofjesuschrist.org/feature/general-conference?lang=eng';
const SAMPLE_HASH = 'confhash1234abcd';

function makeHtmlResponse(hash: string, status = 200): Response {
  const html = `<html><head>
    <meta property="og:image" content="https://www.churchofjesuschrist.org/imgs/${hash}/full/!1400%2C1400/0/default.jpg">
  </head><body></body></html>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html' } });
}

function makeEmptyResponse(status: number): Response {
  return new Response(null, { status });
}

describe('fetchConferenceImage', () => {
  it('constructs the correct collection URL for month=4, year=2025', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeHtmlResponse(SAMPLE_HASH));
    vi.stubGlobal('fetch', mockFetch);
    const scraper = new ConferenceScraper({ useCache: false });

    await scraper.fetchConferenceImage(2025, 4);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe(COLLECTION_URL_APRIL_2025);
  });

  it('constructs the correct collection URL for month=10, year=2026', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeHtmlResponse(SAMPLE_HASH));
    vi.stubGlobal('fetch', mockFetch);
    const scraper = new ConferenceScraper({ useCache: false });

    await scraper.fetchConferenceImage(2026, 10);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('october-2026-general-conference');
  });

  it('returns the square image URL when collection page succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeHtmlResponse(SAMPLE_HASH)));
    const scraper = new ConferenceScraper({ useCache: false });

    const result = await scraper.fetchConferenceImage(2025, 4);
    expect(result).toBe(buildConferenceSquareImageUrl(SAMPLE_HASH));
  });

  it('returns null for month=5 (non-conference month) without fetching', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const scraper = new ConferenceScraper({ useCache: false });

    const result = await scraper.fetchConferenceImage(2025, 5);
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns null for month=1 without fetching', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const scraper = new ConferenceScraper({ useCache: false });

    const result = await scraper.fetchConferenceImage(2025, 1);
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('falls back to GC landing page when collection page 404s (gc_podcast-gx9)', async () => {
    // Collection page 404s → fallback fetches the main GC landing page
    // and extracts the conference thumbnail hash from nearby HTML.
    const landingHtml = `<html><body>
      <img src="https://www.churchofjesuschrist.org/imgs/${SAMPLE_HASH}/full/%2160%2C/0/default">
      <a href="/study/general-conference/2025/04?lang=eng">April 2025</a>
    </body></html>`;
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeEmptyResponse(404))
      .mockResolvedValueOnce(
        new Response(landingHtml, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      );
    vi.stubGlobal('fetch', mockFetch);
    const scraper = new ConferenceScraper({ useCache: false });

    const result = await scraper.fetchConferenceImage(2025, 4);
    expect(result).toBe(buildConferenceSquareImageUrl(SAMPLE_HASH));
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns null when both collection and landing page fail (gc_podcast-vce)', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeEmptyResponse(404))
      .mockResolvedValueOnce(makeEmptyResponse(500));
    vi.stubGlobal('fetch', mockFetch);
    const scraper = new ConferenceScraper({ useCache: false });

    const result = await scraper.fetchConferenceImage(2025, 4);
    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).not.toBe(FALLBACK_URL);
  });

  it('returns null (does not throw) on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network failure')));
    const scraper = new ConferenceScraper({ useCache: false });

    const result = await scraper.fetchConferenceImage(2025, 4);
    expect(result).toBeNull();
  });

  // gc_podcast-fpx: prevent the Good Shepherd evergreen banner (or any other
  // non-conference IIIF asset whose hash is pure hex) from leaking into
  // conference_image_url. The collection page has historically returned an
  // og:image that points at such an asset; the result is a /square/1500,1500
  // URL that 400s, breaking channel artwork. This test pins the expected
  // behaviour: when extracted hash is non-canonical AND landing fallback also
  // yields a non-canonical hash, the function returns null rather than a
  // poisoned URL.
  it('rejects a non-canonical (hex-only) hash from the collection page (gc_podcast-fpx)', async () => {
    const POISONED_HASH = 'bd28805cb67a5524cd310c394c06f1dfbe19cf86';
    const collectionHtml = `<html><head>
      <meta property="og:image" content="https://www.churchofjesuschrist.org/imgs/${POISONED_HASH}/full/!1280%2C667/0/default">
    </head><body></body></html>`;
    // Landing fallback should also be probed; arrange a 404 so the function
    // exhausts both paths and returns null.
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(collectionHtml, { status: 200, headers: { 'content-type': 'text/html' } }),
      )
      .mockResolvedValueOnce(makeEmptyResponse(404));
    vi.stubGlobal('fetch', mockFetch);
    const scraper = new ConferenceScraper({ useCache: false });

    const result = await scraper.fetchConferenceImage(2026, 4);
    expect(result).toBeNull();
    // The poisoned hash MUST NOT appear anywhere in the result, even partially.
    expect(result ?? '').not.toContain(POISONED_HASH);
  });

  it('rejects a non-canonical (hex-only) hash from the landing-page fallback (gc_podcast-fpx)', async () => {
    const POISONED_HASH = 'bd28805cb67a5524cd310c394c06f1dfbe19cf86';
    const landingHtml = `<html><body>
      <img src="https://www.churchofjesuschrist.org/imgs/${POISONED_HASH}/full/%2160%2C/0/default">
      <a href="/study/general-conference/2026/04?lang=eng">April 2026</a>
    </body></html>`;
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeEmptyResponse(404))
      .mockResolvedValueOnce(
        new Response(landingHtml, { status: 200, headers: { 'content-type': 'text/html' } }),
      );
    vi.stubGlobal('fetch', mockFetch);
    const scraper = new ConferenceScraper({ useCache: false });

    const result = await scraper.fetchConferenceImage(2026, 4);
    expect(result).toBeNull();
    expect(result ?? '').not.toContain(POISONED_HASH);
  });
});

// ---------------------------------------------------------------------------
// RSS channel image rotation
// ---------------------------------------------------------------------------

const DEFAULT_CHANNEL_IMAGE =
  'https://www.churchofjesuschrist.org/imgs/5uahv05h1s6416y49vw745z70juiiffhiq0vn8a2/full/!1400,/0/default';

const CONFERENCE_IMAGE_APR_2025 =
  'https://www.churchofjesuschrist.org/imgs/apr2025hash/square/1500,1500/0/default';
const CONFERENCE_IMAGE_OCT_2025 =
  'https://www.churchofjesuschrist.org/imgs/oct2025hash/square/1500,1500/0/default';

function makeTalk(slug: string, order: number) {
  return {
    title: `Talk ${order}`,
    slug,
    order,
    url: `https://example.test/talk/${slug}`,
    speaker: { name: 'Speaker', role_tag: null as null },
    audio: { url: `https://example.test/audio/${slug}.mp3`, duration_ms: 600000 },
  };
}

function makeConferenceOutput(
  year: number,
  month: number,
  conferenceImageUrl?: string | null,
): ConferenceOutput {
  return {
    scraped_at: `${year}-${String(month).padStart(2, '0')}-01T00:00:00Z`,
    version: '1.0',
    conference: {
      year,
      month,
      name: `${month === 4 ? 'April' : 'October'} ${year} General Conference`,
      url: `https://example.test/conf/${year}/${month}`,
      language: 'eng',
      conference_image_url: conferenceImageUrl,
      sessions: [
        {
          name: 'Saturday Morning Session',
          slug: 'saturday-morning-session',
          order: 1,
          url: `https://example.test/conf/${year}/${month}/sat-am`,
          talks: [makeTalk('01talk', 1)],
        },
      ],
    },
  };
}

function getChannelItuniesImage(feed: string): string | null {
  // Match the <itunes:image> that is NOT inside an <item> block.
  const withoutItems = feed.replace(/<item>[\s\S]*?<\/item>/g, '');
  const m = withoutItems.match(/<itunes:image\s+href="([^"]+)"\s*\/>/);
  return m ? m[1] : null;
}

function getChannelImageUrl(feed: string): string | null {
  const withoutItems = feed.replace(/<item>[\s\S]*?<\/item>/g, '');
  const m = withoutItems.match(/<image>[\s\S]*?<url>([^<]+)<\/url>/);
  return m ? m[1] : null;
}

describe('RSS channel image rotation (gc_podcast-gx9)', () => {
  const APR_2026_TALK_HERO =
    'https://www.churchofjesuschrist.org/imgs/apr2026talkhero/full/!1400%2C1400/0/default.jpg';
  const OCT_2025_TALK_HERO =
    'https://www.churchofjesuschrist.org/imgs/oct2025talkhero/full/!1400%2C1400/0/default.jpg';

  // gc_podcast-due: channel artwork URL is suffixed with ?v=<YYYY-MM> of the
  // most-recent conference contributing the conference_image_url.
  const APR_2025_BUSTED = `${CONFERENCE_IMAGE_APR_2025}?v=2025-04`;
  const OCT_2025_BUSTED = `${CONFERENCE_IMAGE_OCT_2025}?v=2025-10`;

  it('prefers conference_image_url over talk hero when both are present', () => {
    const conf = makeConferenceOutput(2025, 10, CONFERENCE_IMAGE_OCT_2025);
    conf.conference.sessions[0].talks[0].image_url = OCT_2025_TALK_HERO;
    const feed = generateRssFeed([conf], {
      feedBaseUrl: 'https://example.test/gc',
      language: 'eng',
    });
    // conference_image_url is 1500x1500 square — Apple-compliant; it wins.
    expect(getChannelItuniesImage(feed)).toBe(OCT_2025_BUSTED);
    expect(getChannelImageUrl(feed)).toBe(OCT_2025_BUSTED);
  });

  it('conference_image_url takes precedence over first-talk hero', () => {
    const conf = makeConferenceOutput(2025, 4, CONFERENCE_IMAGE_APR_2025);
    conf.conference.sessions[0].talks[0].image_url = APR_2026_TALK_HERO;
    const feed = generateRssFeed([conf], {
      feedBaseUrl: 'https://example.test/gc',
      language: 'eng',
    });
    // gc_podcast-gx9: prefer square conference image over 16:9 talk hero.
    expect(getChannelItuniesImage(feed)).toBe(APR_2025_BUSTED);
    expect(getChannelItuniesImage(feed)).not.toBe(APR_2026_TALK_HERO);
  });

  it('falls back to talk.image_url when conference_image_url is absent', () => {
    const conf = makeConferenceOutput(2025, 4, null);
    conf.conference.sessions[0].talks[0].image_url = APR_2026_TALK_HERO;
    const feed = generateRssFeed([conf], {
      feedBaseUrl: 'https://example.test/gc',
      language: 'eng',
    });
    expect(getChannelItuniesImage(feed)).toBe(APR_2026_TALK_HERO);
  });

  it('falls back to PODCAST_CONFIG.imageUrl when neither talk nor conference has an image', () => {
    const conf = makeConferenceOutput(2025, 4, null);
    const feed = generateRssFeed([conf], {
      feedBaseUrl: 'https://example.test/gc',
      language: 'eng',
    });
    expect(getChannelItuniesImage(feed)).toBe(DEFAULT_CHANNEL_IMAGE);
  });

  it('multi-conference: most-recent conference_image_url wins', () => {
    const apr = makeConferenceOutput(2025, 4, CONFERENCE_IMAGE_APR_2025);
    apr.conference.sessions[0].talks[0].image_url =
      'https://www.churchofjesuschrist.org/imgs/apr2025talkhero/full/!1400%2C1400/0/default.jpg';
    const oct = makeConferenceOutput(2025, 10, CONFERENCE_IMAGE_OCT_2025);
    oct.conference.sessions[0].talks[0].image_url = OCT_2025_TALK_HERO;
    const feed = generateRssFeed([apr, oct], {
      feedBaseUrl: 'https://example.test/gc',
      language: 'eng',
    });
    // October 2025 is more recent; its conference_image_url wins.
    expect(getChannelItuniesImage(feed)).toBe(OCT_2025_BUSTED);
  });

  it('multi-conference: falls through to older conference_image_url when newer has none', () => {
    const newer = makeConferenceOutput(2026, 4, null);
    // newer conference has no conference_image_url (e.g. scrape too early)
    newer.conference.sessions[0].talks = [];
    const older = makeConferenceOutput(2025, 10, CONFERENCE_IMAGE_OCT_2025);
    older.conference.sessions[0].talks[0].image_url = OCT_2025_TALK_HERO;
    const feed = generateRssFeed([newer, older], {
      feedBaseUrl: 'https://example.test/gc',
      language: 'eng',
    });
    // newer has no conference_image_url → fall through to older → Oct 2025 conference image wins.
    expect(getChannelItuniesImage(feed)).toBe(OCT_2025_BUSTED);
  });

  it('appends ?v=<YYYY-MM> cache-bust to channel artwork URL (gc_podcast-due)', () => {
    const conf = makeConferenceOutput(2026, 4, CONFERENCE_IMAGE_APR_2025);
    const feed = generateRssFeed([conf], {
      feedBaseUrl: 'https://example.test/gc',
      language: 'eng',
    });
    expect(getChannelItuniesImage(feed)).toBe(`${CONFERENCE_IMAGE_APR_2025}?v=2026-04`);
    expect(getChannelImageUrl(feed)).toBe(`${CONFERENCE_IMAGE_APR_2025}?v=2026-04`);
  });
});
