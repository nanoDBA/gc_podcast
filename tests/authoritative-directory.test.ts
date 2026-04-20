/**
 * Tests for authoritative speaker→bio-URL directory (gc_podcast-3wj).
 *
 * Covers:
 *   - Parsing fixture HTML extracts speaker names + bio URLs.
 *   - Name normalisation: honorifics, extra whitespace, case.
 *   - resolveBioUrl returns directory entry when speaker is found.
 *   - resolveBioUrl falls back to slug-guessing on directory miss.
 *   - resolveBioUrl returns null when both directory and HEAD-check fail.
 *   - Fetch failure (mock 500) returns empty map without throwing.
 *   - Directory is fetched exactly once across multiple resolveBioUrl calls.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { ConferenceScraper, normaliseSpeakerName, __retryTuning } from '../src/scraper.js';

const originalTuning = { ...__retryTuning };

beforeEach(() => {
  // Single attempt so tests are instant.
  __retryTuning.backoffBaseMs = 1;
  __retryTuning.jitterMaxMs = 1;
  __retryTuning.maxRetries = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(__retryTuning, originalTuning);
});

// ---------------------------------------------------------------------------
// Synthetic directory HTML fixture
// ---------------------------------------------------------------------------

/**
 * Minimal directory page HTML with three real-looking speaker entries:
 *   - Elder Kevin G. Brown
 *   - Sister Kristin M. Yee
 *   - Elder Jeffrey R. Holland
 */
const DIRECTORY_HTML = `
<!DOCTYPE html>
<html>
<head><title>Global Leadership</title></head>
<body>
  <div class="leaders">
    <a href="/learn/kevin-g-brown?lang=eng">
      <span>Elder Kevin G. Brown</span>
    </a>
    <a href="/learn/kristin-m-yee?lang=eng">
      <span>Sister Kristin M. Yee</span>
    </a>
    <a href="/learn/jeffrey-r-holland?lang=eng">
      <span>Elder Jeffrey R. Holland</span>
    </a>
  </div>
</body>
</html>
`;

function makeTextResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html' },
  });
}

function makeEmptyResponse(status: number): Response {
  return new Response(null, { status });
}

// ---------------------------------------------------------------------------
// normaliseSpeakerName
// ---------------------------------------------------------------------------

describe('normaliseSpeakerName', () => {
  it('lowercases the name', () => {
    expect(normaliseSpeakerName('Kevin G. Brown')).toBe('kevin g. brown');
  });

  it('strips leading "Elder"', () => {
    expect(normaliseSpeakerName('Elder Kevin G. Brown')).toBe('kevin g. brown');
  });

  it('strips leading "Sister"', () => {
    expect(normaliseSpeakerName('Sister Kristin M. Yee')).toBe('kristin m. yee');
  });

  it('strips leading "President"', () => {
    expect(normaliseSpeakerName('President Russell M. Nelson')).toBe('russell m. nelson');
  });

  it('strips leading "Brother"', () => {
    expect(normaliseSpeakerName('Brother John Doe')).toBe('john doe');
  });

  it('strips leading "Bishop"', () => {
    expect(normaliseSpeakerName('Bishop W. Christopher Waddell')).toBe('w. christopher waddell');
  });

  it('strips leading "Dr."', () => {
    expect(normaliseSpeakerName('Dr. John Smith')).toBe('john smith');
  });

  it('collapses multiple interior spaces', () => {
    expect(normaliseSpeakerName('Jeffrey  R.  Holland')).toBe('jeffrey r. holland');
    // trim + collapse leading/trailing + honorific strip
    expect(normaliseSpeakerName('  Elder   Jeffrey   R. Holland  ')).toBe('jeffrey r. holland');
  });

  it('trims trailing whitespace', () => {
    expect(normaliseSpeakerName('Kevin G. Brown   ')).toBe('kevin g. brown');
  });

  it('is case-insensitive for honorifics', () => {
    expect(normaliseSpeakerName('ELDER Kevin G. Brown')).toBe('kevin g. brown');
    expect(normaliseSpeakerName('elder Kevin G. Brown')).toBe('kevin g. brown');
  });

  it('handles name with no honorific unchanged (other than lowercase)', () => {
    expect(normaliseSpeakerName('Dallin H. Oaks')).toBe('dallin h. oaks');
  });
});

// ---------------------------------------------------------------------------
// fetchAuthoritativeDirectory parsing
// ---------------------------------------------------------------------------

describe('fetchAuthoritativeDirectory', () => {
  it('parses 3 speakers from fixture HTML', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeTextResponse(DIRECTORY_HTML)));
    const scraper = new ConferenceScraper({ useCache: false });
    const map = await scraper.fetchAuthoritativeDirectory();

    expect(map.size).toBe(3);
  });

  it('maps normalised "kevin g. brown" to the correct bio URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeTextResponse(DIRECTORY_HTML)));
    const scraper = new ConferenceScraper({ useCache: false });
    const map = await scraper.fetchAuthoritativeDirectory();

    expect(map.get('kevin g. brown')).toBe(
      'https://www.churchofjesuschrist.org/learn/kevin-g-brown?lang=eng'
    );
  });

  it('maps normalised "kristin m. yee" (stripped "Sister") to correct URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeTextResponse(DIRECTORY_HTML)));
    const scraper = new ConferenceScraper({ useCache: false });
    const map = await scraper.fetchAuthoritativeDirectory();

    // The anchor text is "Sister Kristin M. Yee"; after normalisation: "kristin m. yee"
    expect(map.get('kristin m. yee')).toBe(
      'https://www.churchofjesuschrist.org/learn/kristin-m-yee?lang=eng'
    );
  });

  it('maps normalised "jeffrey r. holland" (stripped "Elder") to correct URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeTextResponse(DIRECTORY_HTML)));
    const scraper = new ConferenceScraper({ useCache: false });
    const map = await scraper.fetchAuthoritativeDirectory();

    expect(map.get('jeffrey r. holland')).toBe(
      'https://www.churchofjesuschrist.org/learn/jeffrey-r-holland?lang=eng'
    );
  });

  it('returns empty map (does not throw) when fetch returns 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeEmptyResponse(500)));
    const scraper = new ConferenceScraper({ useCache: false });
    // Must not throw
    const map = await scraper.fetchAuthoritativeDirectory();
    expect(map.size).toBe(0);
  });

  it('returns empty map (does not throw) on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network failure')));
    const scraper = new ConferenceScraper({ useCache: false });
    const map = await scraper.fetchAuthoritativeDirectory();
    expect(map.size).toBe(0);
  });

  it('fetches directory exactly once across multiple calls', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeTextResponse(DIRECTORY_HTML));
    vi.stubGlobal('fetch', mockFetch);
    const scraper = new ConferenceScraper({ useCache: false });

    await scraper.fetchAuthoritativeDirectory();
    await scraper.fetchAuthoritativeDirectory();
    await scraper.fetchAuthoritativeDirectory();

    // Only one fetch to the directory URL.
    const directoryCalls = mockFetch.mock.calls.filter(
      (call) =>
        typeof call[0] === 'string' &&
        (call[0] as string).includes('global-leadership-of-the-church')
    );
    expect(directoryCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// resolveBioUrl
// ---------------------------------------------------------------------------

describe('resolveBioUrl', () => {
  it('returns directory URL when speaker is in the authoritative directory', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeTextResponse(DIRECTORY_HTML)));
    const scraper = new ConferenceScraper({ useCache: false });

    // "Elder Kevin G. Brown" is in the directory
    const result = await scraper.resolveBioUrl('Kevin G. Brown');
    expect(result).toBe(
      'https://www.churchofjesuschrist.org/learn/kevin-g-brown?lang=eng'
    );
  });

  it('returns directory URL when input name has honorific prefix', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeTextResponse(DIRECTORY_HTML)));
    const scraper = new ConferenceScraper({ useCache: false });

    // Query with "Elder " prefix — should still match "Elder Kevin G. Brown" entry
    const result = await scraper.resolveBioUrl('Elder Kevin G. Brown');
    expect(result).toBe(
      'https://www.churchofjesuschrist.org/learn/kevin-g-brown?lang=eng'
    );
  });

  it('falls back to slug-guessing when speaker not in directory (HEAD 200)', async () => {
    // Directory fetch succeeds but contains no matching entry for this speaker.
    // Slug-guess HEAD-check returns 200.
    const mockFetch = vi
      .fn()
      // First call: directory fetch
      .mockResolvedValueOnce(makeTextResponse(DIRECTORY_HTML))
      // Second call: HEAD check for slug-guessed URL
      .mockResolvedValueOnce(makeEmptyResponse(200));
    vi.stubGlobal('fetch', mockFetch);
    const scraper = new ConferenceScraper({ useCache: false });

    const result = await scraper.resolveBioUrl('Russell M. Nelson');
    // Slug for "Russell M. Nelson" → "russell-m-nelson"
    expect(result).toBe(
      'https://www.churchofjesuschrist.org/learn/russell-m-nelson?lang=eng'
    );
  });

  it('returns null when directory miss AND HEAD-check fails for both slug variants', async () => {
    const mockFetch = vi
      .fn()
      // Directory fetch — returns HTML with no matching entry
      .mockResolvedValueOnce(makeTextResponse(DIRECTORY_HTML))
      // HEAD check primary slug: 404
      .mockResolvedValueOnce(makeEmptyResponse(404))
      // HEAD check alt slug: 404
      .mockResolvedValueOnce(makeEmptyResponse(404));
    vi.stubGlobal('fetch', mockFetch);
    const scraper = new ConferenceScraper({ useCache: false });

    // "Dallin H. Oaks" is not in our fixture directory; HEAD checks both 404
    const result = await scraper.resolveBioUrl('Dallin H. Oaks');
    expect(result).toBeNull();
  });

  it('returns null for an empty speaker name', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeTextResponse(DIRECTORY_HTML)));
    const scraper = new ConferenceScraper({ useCache: false });
    const result = await scraper.resolveBioUrl('');
    expect(result).toBeNull();
  });

  it('fetches directory only once across multiple resolveBioUrl calls', async () => {
    // All HEAD checks return 200 so resolveBioUrl completes quickly.
    const mockFetch = vi
      .fn()
      // Directory call
      .mockResolvedValueOnce(makeTextResponse(DIRECTORY_HTML))
      // HEAD checks for any slug-fallback calls
      .mockResolvedValue(makeEmptyResponse(200));
    vi.stubGlobal('fetch', mockFetch);
    const scraper = new ConferenceScraper({ useCache: false });

    await scraper.resolveBioUrl('Russell M. Nelson');
    await scraper.resolveBioUrl('Dallin H. Oaks');
    await scraper.resolveBioUrl('Henry B. Eyring');

    const directoryCalls = mockFetch.mock.calls.filter(
      (call) =>
        typeof call[0] === 'string' &&
        (call[0] as string).includes('global-leadership-of-the-church')
    );
    expect(directoryCalls).toHaveLength(1);
  });
});
