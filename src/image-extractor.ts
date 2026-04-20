/**
 * Image extraction utilities for General Conference talk and speaker bio pages.
 *
 * All functions are pure over HTML strings — no I/O, no side effects.
 * They extract Church IIIF image hashes and build canonical 1400×1400 URLs.
 *
 * Extraction priority for talk pages:
 *   1. <meta property="og:image"> — most reliable, present on modern talks
 *   2. window.__INITIAL_STATE__ JSON "image" field — common API fallback
 *   3. First IIIF <img> in the article body — last resort
 *
 * Extraction priority for speaker bio pages:
 *   1. <meta property="og:image">
 *   2. First IIIF <img> in page body
 *
 * Decision gc_podcast-gbt: hotlink the church CDN at 1400×1400 best-fit.
 * No download, no transcode, no local hosting.
 */

export interface ExtractedImage {
  /** Which extraction strategy produced this result. */
  source: 'og-image' | 'initial-state' | 'body-img' | 'bio-og' | 'bio-body';
  /** The bare IIIF hash (alphanumeric, 32–40 chars). */
  hash: string;
  /** Canonical 1400×1400 best-fit URL ready for <itunes:image>. */
  canonicalUrl: string;
}

/**
 * Regex that matches the IIIF hash segment in any Church CDN image URL.
 *
 * Matches both plain and percent-encoded variants:
 *   https://www.churchofjesuschrist.org/imgs/<HASH>/full/…
 */
export const IIIF_HASH_RE = /churchofjesuschrist\.org\/imgs\/([a-z0-9]+)\/full\//i;

/**
 * Unwrap a double-encoded IIIF URL.
 *
 * The church CDN occasionally emits URLs of the form:
 *   /imgs/https%3A%2F%2Fwww.churchofjesuschrist.org%2Fimgs%2F<HASH>%2Ffull%2F…
 *
 * decodeURIComponent reveals the inner URL; we return that so the caller
 * can run the normal hash extraction on it.
 *
 * If the URL is not double-encoded this function returns it unchanged.
 */
export function unwrapDoubleEncoded(url: string): string {
  // A double-encoded URL will contain a percent-encoded "https%3A%2F%2F"
  // (or "http%3A%2F%2F") somewhere after the /imgs/ prefix.
  if (!/%3A%2F%2F/i.test(url)) {
    return url;
  }
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

/**
 * Extract the IIIF hash from a Church CDN image URL.
 *
 * Handles both plain and double-encoded URL forms.
 * Returns undefined for non-Church or unrecognised URLs.
 */
export function extractHash(url: string): string | undefined {
  const unwrapped = unwrapDoubleEncoded(url);
  const match = unwrapped.match(IIIF_HASH_RE);
  return match?.[1]?.toLowerCase();
}

/**
 * Build the canonical 1400×1400 best-fit IIIF URL for a given hash.
 *
 * The `!1400%2C1400` spec means "fit within 1400×1400, preserve aspect ratio".
 * The literal `%2C` is required — do not use a decoded comma.
 */
export function buildCanonicalImageUrl(hash: string): string {
  return `https://www.churchofjesuschrist.org/imgs/${hash}/full/!1400%2C1400/0/default.jpg`;
}

/**
 * Build an Apple-compliant 1500×1500 square IIIF URL for a conference hero
 * image (gc_podcast-8t0).
 *
 * Uses the IIIF `square` region parameter (geometric centre crop) followed by
 * a 1500×1500 size, meeting the iTunes channel artwork minimum of 1400×1400
 * with Apple's recommended 3000×3000 as the ceiling.
 *
 * This is intentionally DIFFERENT from buildCanonicalImageUrl: per-item images
 * use the `full` region with best-fit sizing; channel images use `square` crop
 * at a fixed 1500×1500.
 */
export function buildConferenceSquareImageUrl(hash: string): string {
  return `https://www.churchofjesuschrist.org/imgs/${hash}/square/1500,1500/0/default`;
}

/**
 * Extract the IIIF hash from any og:image meta tag in an HTML string.
 *
 * This is a thin public wrapper that combines extractOgImage + extractHash,
 * usable for any page type (collection pages, feature pages, etc.) where the
 * only goal is to retrieve the hash for downstream URL-building.
 *
 * Returns undefined when no Church IIIF og:image is present.
 */
export function extractOgImageHash(html: string): string | undefined {
  const ogUrl = extractOgImage(html);
  if (!ogUrl) return undefined;
  return extractHash(ogUrl);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Try to extract an og:image URL from an HTML string.
 * Returns the raw content attribute value or undefined.
 */
function extractOgImage(html: string): string | undefined {
  // <meta property="og:image" content="…">  (attribute order may vary)
  const match =
    html.match(
      /<meta\b[^>]*\bproperty\s*=\s*["']og:image["'][^>]*\bcontent\s*=\s*["']([^"']+)["']/i,
    ) ??
    html.match(
      /<meta\b[^>]*\bcontent\s*=\s*["']([^"']+)["'][^>]*\bproperty\s*=\s*["']og:image["']/i,
    );
  return match?.[1];
}

/**
 * Try to extract an IIIF URL from window.__INITIAL_STATE__ JSON embedded in
 * a <script> block.  Looks for a top-level `"image":"…"` field whose value
 * contains a Church CDN path.
 */
function extractInitialStateImage(html: string): string | undefined {
  // Find the __INITIAL_STATE__ assignment block.
  const stateMatch = html.match(
    /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})(?:\s*;|\s*<\/script>)/,
  );
  if (!stateMatch) return undefined;

  // Look for "image":"<url>" inside the JSON blob.
  // We do a targeted regex rather than JSON.parse to avoid issues with
  // incomplete / minified blobs.
  const imageMatch = stateMatch[1].match(/"image"\s*:\s*"([^"]+)"/);
  if (!imageMatch) return undefined;

  const raw = imageMatch[1];
  // Only accept URLs that look like Church CDN image paths.
  if (!raw.includes('churchofjesuschrist.org/imgs/') && !raw.includes('%2Fimgs%2F')) {
    return undefined;
  }
  return raw;
}

/**
 * Extract the first IIIF `<img src>` URL from within an article body.
 *
 * Looks for any <img> whose src points at the Church IIIF endpoint.
 */
function extractBodyImg(html: string): string | undefined {
  // Match <img … src="…/imgs/<hash>/full/…" …>
  const match = html.match(
    /<img\b[^>]*\bsrc\s*=\s*["']([^"']*churchofjesuschrist\.org\/imgs\/[^"']+\/full\/[^"']*)["']/i,
  );
  return match?.[1];
}

// ---------------------------------------------------------------------------
// Public extraction functions
// ---------------------------------------------------------------------------

/**
 * Extract an image from the full HTML of a General Conference talk page.
 *
 * Priority: og:image > __INITIAL_STATE__ > body img
 * Returns undefined when no Church IIIF image can be found.
 */
export function extractImageFromTalkHtml(html: string): ExtractedImage | undefined {
  // 1. og:image (most reliable)
  const ogUrl = extractOgImage(html);
  if (ogUrl) {
    const hash = extractHash(ogUrl);
    if (hash) {
      return { source: 'og-image', hash, canonicalUrl: buildCanonicalImageUrl(hash) };
    }
  }

  // 2. window.__INITIAL_STATE__
  const stateUrl = extractInitialStateImage(html);
  if (stateUrl) {
    const hash = extractHash(stateUrl);
    if (hash) {
      return { source: 'initial-state', hash, canonicalUrl: buildCanonicalImageUrl(hash) };
    }
  }

  // 3. First IIIF <img> in article body
  const bodyUrl = extractBodyImg(html);
  if (bodyUrl) {
    const hash = extractHash(bodyUrl);
    if (hash) {
      return { source: 'body-img', hash, canonicalUrl: buildCanonicalImageUrl(hash) };
    }
  }

  return undefined;
}

/**
 * Extract an image from the HTML of a speaker bio page.
 *
 * Priority: og:image > body img
 * Returns undefined when no Church IIIF image can be found.
 */
export function extractImageFromBioHtml(html: string): ExtractedImage | undefined {
  // 1. og:image
  const ogUrl = extractOgImage(html);
  if (ogUrl) {
    const hash = extractHash(ogUrl);
    if (hash) {
      return { source: 'bio-og', hash, canonicalUrl: buildCanonicalImageUrl(hash) };
    }
  }

  // 2. First IIIF <img> in page body
  const bodyUrl = extractBodyImg(html);
  if (bodyUrl) {
    const hash = extractHash(bodyUrl);
    if (hash) {
      return { source: 'bio-body', hash, canonicalUrl: buildCanonicalImageUrl(hash) };
    }
  }

  return undefined;
}
