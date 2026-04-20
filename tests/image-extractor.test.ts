/**
 * Unit tests for src/image-extractor.ts
 *
 * All tests are pure over HTML fixtures — no network I/O.
 * Fixtures live in tests/fixtures/ and contain only the tags under test.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import {
  extractHash,
  unwrapDoubleEncoded,
  buildCanonicalImageUrl,
  extractImageFromTalkHtml,
  extractImageFromBioHtml,
} from '../src/image-extractor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function fixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf-8');
}

// ---------------------------------------------------------------------------
// extractHash
// ---------------------------------------------------------------------------

describe('extractHash', () => {
  it('returns the hash for a plain IIIF URL', () => {
    const url =
      'https://www.churchofjesuschrist.org/imgs/abc123def456abc1/full/%21800%2C/0/default';
    expect(extractHash(url)).toBe('abc123def456abc1');
  });

  it('returns the inner hash for a double-encoded URL', () => {
    // Outer URL wraps the inner as a percent-encoded path segment.
    const inner = 'mno901pqr234mno9';
    const url =
      `https://www.churchofjesuschrist.org/imgs/` +
      `https%3A%2F%2Fwww.churchofjesuschrist.org%2Fimgs%2F${inner}%2Ffull%2F%21800%252C%2F0%2Fdefault` +
      `/full/%21800%2C/0/default`;
    expect(extractHash(url)).toBe(inner);
  });

  it('returns undefined for a non-church URL', () => {
    expect(extractHash('https://example.com/images/foo.jpg')).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(extractHash('')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// unwrapDoubleEncoded
// ---------------------------------------------------------------------------

describe('unwrapDoubleEncoded', () => {
  it('decodes a double-encoded URL', () => {
    const encoded =
      'https://www.churchofjesuschrist.org/imgs/' +
      'https%3A%2F%2Fwww.churchofjesuschrist.org%2Fimgs%2Fabc%2Ffull%2F' +
      '/full/%21800%2C/0/default';
    const result = unwrapDoubleEncoded(encoded);
    expect(result).toContain('https://www.churchofjesuschrist.org/imgs/abc/full/');
  });

  it('returns plain URLs unchanged', () => {
    const plain =
      'https://www.churchofjesuschrist.org/imgs/abc123/full/%21800%2C/0/default';
    expect(unwrapDoubleEncoded(plain)).toBe(plain);
  });
});

// ---------------------------------------------------------------------------
// buildCanonicalImageUrl
// ---------------------------------------------------------------------------

describe('buildCanonicalImageUrl', () => {
  it('produces exact !1400%2C1400 encoding', () => {
    const hash = 'abc123def456abc1';
    const url = buildCanonicalImageUrl(hash);
    expect(url).toBe(
      `https://www.churchofjesuschrist.org/imgs/${hash}/full/!1400%2C1400/0/default.jpg`
    );
  });

  it('does not use a decoded comma', () => {
    const url = buildCanonicalImageUrl('testhash');
    expect(url).not.toContain('1400,1400');
    expect(url).toContain('!1400%2C1400');
  });
});

// ---------------------------------------------------------------------------
// extractImageFromTalkHtml
// ---------------------------------------------------------------------------

describe('extractImageFromTalkHtml', () => {
  it('prefers og:image when present', () => {
    const html = fixture('talk-og-image.html');
    const result = extractImageFromTalkHtml(html);
    expect(result).toBeDefined();
    expect(result!.source).toBe('og-image');
    expect(result!.hash).toBe('abc123def456abc1');
    expect(result!.canonicalUrl).toBe(
      'https://www.churchofjesuschrist.org/imgs/abc123def456abc1/full/!1400%2C1400/0/default.jpg'
    );
  });

  it('falls back to __INITIAL_STATE__ when og:image is absent', () => {
    const html = fixture('talk-initial-state.html');
    const result = extractImageFromTalkHtml(html);
    expect(result).toBeDefined();
    expect(result!.source).toBe('initial-state');
    expect(result!.hash).toBe('def789abc012def7');
    expect(result!.canonicalUrl).toContain('def789abc012def7');
  });

  it('falls back to body img when og:image and __INITIAL_STATE__ are absent', () => {
    const html = fixture('talk-body-only.html');
    const result = extractImageFromTalkHtml(html);
    expect(result).toBeDefined();
    expect(result!.source).toBe('body-img');
    expect(result!.hash).toBe('ghi345jkl678ghi3');
    expect(result!.canonicalUrl).toContain('ghi345jkl678ghi3');
  });

  it('returns undefined when no imagery is present', () => {
    const html = '<html><head><title>No images</title></head><body><p>Text only</p></body></html>';
    expect(extractImageFromTalkHtml(html)).toBeUndefined();
  });

  it('extracts the inner hash from a double-encoded og:image URL', () => {
    const html = fixture('talk-double-encoded.html');
    const result = extractImageFromTalkHtml(html);
    expect(result).toBeDefined();
    expect(result!.source).toBe('og-image');
    expect(result!.hash).toBe('mno901pqr234mno9');
    expect(result!.canonicalUrl).toContain('mno901pqr234mno9');
  });
});

// ---------------------------------------------------------------------------
// extractImageFromBioHtml
// ---------------------------------------------------------------------------

describe('extractImageFromBioHtml', () => {
  it('prefers og:image when present', () => {
    const html = fixture('bio-og.html');
    const result = extractImageFromBioHtml(html);
    expect(result).toBeDefined();
    expect(result!.source).toBe('bio-og');
    expect(result!.hash).toBe('stu567vwx890stu5');
    expect(result!.canonicalUrl).toContain('stu567vwx890stu5');
  });

  it('falls back to body img when og:image is absent', () => {
    const html = fixture('bio-body-only.html');
    const result = extractImageFromBioHtml(html);
    expect(result).toBeDefined();
    expect(result!.source).toBe('bio-body');
    expect(result!.hash).toBe('yza123bcd456yza1');
    expect(result!.canonicalUrl).toContain('yza123bcd456yza1');
  });

  it('returns undefined when no Church imagery is present', () => {
    const html = '<html><head><meta property="og:image" content="https://example.com/pic.jpg"></head><body></body></html>';
    expect(extractImageFromBioHtml(html)).toBeUndefined();
  });
});
