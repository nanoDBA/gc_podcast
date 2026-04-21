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
import { buildConferenceSquareImageUrl, extractOgImageHash } from '../src/image-extractor.js';
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
      `https://www.churchofjesuschrist.org/imgs/${hash}/square/3000,3000/0/default`,
    );
  });

  it('uses /square/ region (not /full/)', () => {
    const url = buildConferenceSquareImageUrl('testhash');
    expect(url).toContain('/square/');
    expect(url).not.toContain('/full/');
  });

  it('uses 3000,3000 (not percent-encoded)', () => {
    const url = buildConferenceSquareImageUrl('testhash');
    expect(url).toContain('3000,3000');
    expect(url).not.toContain('3000%2C3000');
    // Ensure we're not regressing to the old 1500,1500 size
    expect(url).not.toContain('1500,1500');
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

  it('returns null and does NOT fall back to /feature/general-conference when collection page 404s (gc_podcast-vce)', async () => {
    // Collection page 404s and there is no secondary fetch — the generic
    // feature page's og:image is an evergreen banner (not per-conference),
    // so we deliberately don't consult it. Rotation in generateRssFeed
    // picks up the previous conference's art when this returns null.
    const mockFetch = vi.fn().mockResolvedValueOnce(makeEmptyResponse(404));
    vi.stubGlobal('fetch', mockFetch);
    const scraper = new ConferenceScraper({ useCache: false });

    const result = await scraper.fetchConferenceImage(2025, 4);
    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).not.toBe(FALLBACK_URL);
  });

  it('returns null (does not throw) on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network failure')));
    const scraper = new ConferenceScraper({ useCache: false });

    const result = await scraper.fetchConferenceImage(2025, 4);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RSS channel image rotation
// ---------------------------------------------------------------------------

const DEFAULT_CHANNEL_IMAGE =
  'https://www.churchofjesuschrist.org/imgs/5uahv05h1s6416y49vw745z70juiiffhiq0vn8a2/full/!1400,/0/default';

const CONFERENCE_IMAGE_APR_2025 =
  'https://www.churchofjesuschrist.org/imgs/apr2025hash/square/3000,3000/0/default';
const CONFERENCE_IMAGE_OCT_2025 =
  'https://www.churchofjesuschrist.org/imgs/oct2025hash/square/3000,3000/0/default';

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

describe('RSS channel image rotation (gc_podcast-8t0)', () => {
  it('uses conference_image_url for <itunes:image> when set', () => {
    const conferences = [makeConferenceOutput(2025, 4, CONFERENCE_IMAGE_APR_2025)];
    const feed = generateRssFeed(conferences, {
      feedBaseUrl: 'https://example.test/gc',
      language: 'eng',
    });
    expect(getChannelItuniesImage(feed)).toBe(CONFERENCE_IMAGE_APR_2025);
  });

  it('uses conference_image_url for <image><url> when set', () => {
    const conferences = [makeConferenceOutput(2025, 4, CONFERENCE_IMAGE_APR_2025)];
    const feed = generateRssFeed(conferences, {
      feedBaseUrl: 'https://example.test/gc',
      language: 'eng',
    });
    expect(getChannelImageUrl(feed)).toBe(CONFERENCE_IMAGE_APR_2025);
  });

  it('falls back to default PODCAST_CONFIG.imageUrl when no conference has the field', () => {
    const conferences = [makeConferenceOutput(2025, 4, null)];
    const feed = generateRssFeed(conferences, {
      feedBaseUrl: 'https://example.test/gc',
      language: 'eng',
    });
    expect(getChannelItuniesImage(feed)).toBe(DEFAULT_CHANNEL_IMAGE);
  });

  it('falls back to default when conference_image_url is undefined', () => {
    const conferences = [makeConferenceOutput(2025, 4, undefined)];
    const feed = generateRssFeed(conferences, {
      feedBaseUrl: 'https://example.test/gc',
      language: 'eng',
    });
    expect(getChannelItuniesImage(feed)).toBe(DEFAULT_CHANNEL_IMAGE);
  });

  it('multi-conference: most-recent conference image wins (2025-10 over 2025-04)', () => {
    const conferences = [
      makeConferenceOutput(2025, 4, CONFERENCE_IMAGE_APR_2025),
      makeConferenceOutput(2025, 10, CONFERENCE_IMAGE_OCT_2025),
    ];
    const feed = generateRssFeed(conferences, {
      feedBaseUrl: 'https://example.test/gc',
      language: 'eng',
    });
    // October 2025 is more recent — its image must win.
    expect(getChannelItuniesImage(feed)).toBe(CONFERENCE_IMAGE_OCT_2025);
    expect(getChannelItuniesImage(feed)).not.toBe(CONFERENCE_IMAGE_APR_2025);
  });

  it('multi-conference: older conference image not used when newer has image', () => {
    const conferences = [
      makeConferenceOutput(2024, 10, CONFERENCE_IMAGE_OCT_2025), // older but has image
      makeConferenceOutput(2025, 4, null), // newer but no image
    ];
    // April 2025 has no image; October 2024 does — October 2024 wins
    // (most-recent WITH image, not most-recent overall).
    const feed = generateRssFeed(conferences, {
      feedBaseUrl: 'https://example.test/gc',
      language: 'eng',
    });
    expect(getChannelItuniesImage(feed)).toBe(CONFERENCE_IMAGE_OCT_2025);
  });

  it('per-item <itunes:image> is unaffected by conference_image_url', () => {
    const talkImage =
      'https://www.churchofjesuschrist.org/imgs/talkimg/full/!1400%2C1400/0/default.jpg';
    const conf = makeConferenceOutput(2025, 4, CONFERENCE_IMAGE_APR_2025);
    // Inject a talk-level image URL to verify it does NOT bleed to channel level.
    conf.conference.sessions[0].talks[0].image_url = talkImage;
    const feed = generateRssFeed([conf], {
      feedBaseUrl: 'https://example.test/gc',
      language: 'eng',
    });
    // Channel uses the conference image, not the talk image.
    expect(getChannelItuniesImage(feed)).toBe(CONFERENCE_IMAGE_APR_2025);
    // Item uses the talk image.
    const itemBlock = feed.match(/<item>[\s\S]*?<\/item>/)?.[0] ?? '';
    expect(itemBlock).toContain(talkImage);
  });
});
