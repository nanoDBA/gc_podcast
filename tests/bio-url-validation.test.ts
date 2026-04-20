/**
 * Tests for bio URL HEAD-check + fallback slug (gc_podcast-0ta).
 *
 * Tests generateAltBioSlug (pure function) and validateBioUrl (async,
 * uses mocked fetch). The integration point — validateBioUrl being called
 * in enrichWithAudio — is verified via the exported helpers.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { generateAltBioSlug, validateBioUrl, __retryTuning } from '../src/scraper.js';

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

function makeResponse(status: number): Response {
  return new Response(null, { status });
}

describe('generateAltBioSlug', () => {
  it('removes -jr suffix', () => {
    expect(generateAltBioSlug('jeffrey-r-holland-jr')).toBe('jeffrey-r-holland');
  });

  it('removes -sr suffix', () => {
    expect(generateAltBioSlug('john-doe-sr')).toBe('john-doe');
  });

  it('removes middle initial (single char segment)', () => {
    expect(generateAltBioSlug('jeffrey-r-holland')).toBe('jeffrey-holland');
  });

  it('removes trailing single-char segment', () => {
    expect(generateAltBioSlug('david-a')).toBe('david');
  });

  it('returns undefined when no transform applies', () => {
    // Plain name, no suffix, no middle initial.
    expect(generateAltBioSlug('dallin-oaks')).toBeUndefined();
  });

  it('prioritises suffix removal over middle-initial removal', () => {
    // "henry-b-eyring-jr" → suffix removed first → "henry-b-eyring"
    expect(generateAltBioSlug('henry-b-eyring-jr')).toBe('henry-b-eyring');
  });
});

describe('validateBioUrl', () => {
  it('returns the primary URL when HEAD returns 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(200)));
    const url = 'https://www.churchofjesuschrist.org/learn/jeffrey-r-holland?lang=eng';
    const result = await validateBioUrl(url);
    expect(result).toBe(url);
  });

  it('returns the alt URL when primary 404s but alt 200s', async () => {
    const mockFetch = vi
      .fn()
      // Primary slug: 404
      .mockResolvedValueOnce(makeResponse(404))
      // Alt slug: 200
      .mockResolvedValueOnce(makeResponse(200));
    vi.stubGlobal('fetch', mockFetch);

    const primaryUrl = 'https://www.churchofjesuschrist.org/learn/jeffrey-r-holland?lang=eng';
    const expectedAltUrl = 'https://www.churchofjesuschrist.org/learn/jeffrey-holland?lang=eng';

    const result = await validateBioUrl(primaryUrl);
    expect(result).toBe(expectedAltUrl);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns undefined when both primary and alt slug 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(404)));
    const url = 'https://www.churchofjesuschrist.org/learn/henry-b-eyring?lang=eng';
    const result = await validateBioUrl(url);
    // No alt slug exists for this plain name → undefined
    expect(result).toBeUndefined();
  });

  it('returns primary URL on network error (transient keep)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network failure')));
    const url = 'https://www.churchofjesuschrist.org/learn/russell-m-nelson?lang=eng';
    const result = await validateBioUrl(url);
    // Network error → treat as valid, keep original URL.
    expect(result).toBe(url);
  });

  it('returns undefined when primary 404s, alt slug exists but also 404s', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(404)));
    // "dieter-f-uchtdorf" has a middle initial → alt "dieter-uchtdorf"
    const url = 'https://www.churchofjesuschrist.org/learn/dieter-f-uchtdorf?lang=eng';
    const result = await validateBioUrl(url);
    expect(result).toBeUndefined();
  });
});
