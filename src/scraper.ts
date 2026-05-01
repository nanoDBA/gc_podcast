/**
 * General Conference Scraper
 * Extracts conference metadata and audio links from churchofjesuschrist.org
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  findAll,
  findByDataContentType,
  extractTitle,
  findHrefs,
  getText,
  findTextByClass,
  extractJsonValue,
  extractJsonNumber,
  getAttr,
  ParsedElement,
} from './html-parser.js';
import {
  Conference,
  Session,
  Talk,
  Speaker,
  AudioAsset,
  SpeakerRoleTag,
  ScraperConfig,
  DEFAULT_CONFIG,
} from './types.js';

// ---------------------------------------------------------------------------
// Cache TTL helpers (gc_podcast-6te)
// ---------------------------------------------------------------------------

/**
 * Default cache TTL in days. Override with the CACHE_TTL_DAYS env var.
 * A value of 0 disables TTL enforcement (never expire).
 */
export const DEFAULT_CACHE_TTL_DAYS = 30;

/**
 * Resolve the effective cache TTL in days from the environment, falling back
 * to DEFAULT_CACHE_TTL_DAYS. Returns 0 if TTL is disabled.
 */
export function resolveCacheTtlDays(): number {
  const raw = process.env.CACHE_TTL_DAYS;
  if (raw === undefined) return DEFAULT_CACHE_TTL_DAYS;
  const parsed = parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_CACHE_TTL_DAYS;
  return parsed;
}

/**
 * Check whether a cache file has exceeded the TTL.
 * Returns { hit: false, ageDays: number } when the file is too old,
 * Returns { hit: true,  ageDays: number } when fresh.
 * Returns null when the file does not exist or stat fails.
 */
export async function checkCacheTtl(
  cacheFile: string,
  ttlDays: number,
): Promise<{ hit: boolean; ageDays: number } | null> {
  try {
    const stat = await fs.stat(cacheFile);
    const ageMs = Date.now() - stat.mtimeMs;
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ttlDays > 0 && ageDays > ttlDays) {
      return { hit: false, ageDays };
    }
    return { hit: true, ageDays };
  } catch {
    return null;
  }
}
import { LANGUAGES } from './languages.js';
import { ApiResponseSchema, detectApiDrift } from './schemas.js';
import { log } from './logger.js';
import {
  extractImageFromTalkHtml,
  extractImageFromBioHtml,
  extractOgImageHash,
  buildConferenceSquareImageUrl,
  extractHash,
  buildCanonicalImageUrl,
  isCanonicalChannelImageHash,
} from './image-extractor.js';

/**
 * Per-run dedup of API drift warnings. Keyed on the JSON-stringified union
 * of unknownKeys + softSignals so the same signal fires at most once per
 * process lifetime, keeping logs readable during backfills that hit the
 * same endpoint shape hundreds of times.
 */
const __driftWarningSeen = new Set<string>();

/** Test-only: clear the drift dedup cache between runs. */
export function __resetDriftWarningCache(): void {
  __driftWarningSeen.clear();
}

/**
 * Central helper: validate an API response with zod AND report drift signals
 * (unknown keys, soft signals) via log.warn, rate-limited to once per signal
 * signature per run.
 */
function reportApiDrift(url: string, apiResponse: unknown): void {
  const report = detectApiDrift(apiResponse, ApiResponseSchema);
  if (!report.ok) {
    log.warn('API response failed schema validation', {
      url,
      issues: report.issues,
    });
    return;
  }
  if (report.unknownKeys.length === 0 && report.softSignals.length === 0) {
    return;
  }
  const signature = JSON.stringify({
    unknownKeys: report.unknownKeys.slice().sort(),
    softSignals: report.softSignals.slice().sort(),
  });
  if (__driftWarningSeen.has(signature)) return;
  __driftWarningSeen.add(signature);
  log.warn('API response has unknown fields (possible drift)', {
    url,
    unknownKeys: report.unknownKeys,
    softSignals: report.softSignals,
  });
}

const BASE_URL = 'https://www.churchofjesuschrist.org';
const API_BASE = 'https://www.churchofjesuschrist.org/study/api/v3/language-pages/type/content';

/**
 * Minimum HTML body size (bytes) below which we assume the response is a 404,
 * stub, redirect, or otherwise not a real conference page. We do NOT trip the
 * circuit breaker for such responses; they represent a different failure mode
 * (expected non-match) rather than a parser contract break.
 */
export const MIN_PARSEABLE_HTML_BYTES = 5 * 1024;

/**
 * Per-parser result record used by the circuit breaker to record which
 * strategies were attempted and how many sessions each one produced.
 */
export interface ParserAttempt {
  parser: string;
  sessionCount: number;
}

/**
 * Thrown when every parser strategy returned zero sessions for an HTML body
 * that was large enough to plausibly be a conference index page. This masks
 * a contract break between the scraper and the upstream site markup, so we
 * fail loudly rather than silently writing an empty JSON output.
 */
export class ParserCircuitBreakerError extends Error {
  public readonly url: string;
  public readonly httpStatus: number;
  public readonly htmlLength: number;
  public readonly parsersTried: ParserAttempt[];

  constructor(params: {
    url: string;
    httpStatus: number;
    htmlLength: number;
    parsersTried: ParserAttempt[];
  }) {
    const parserSummary = params.parsersTried
      .map((p) => `${p.parser}=${p.sessionCount}`)
      .join(', ');
    super(
      `Parser circuit breaker tripped for ${params.url}: all parsers returned 0 sessions ` +
        `(status=${params.httpStatus}, htmlLength=${params.htmlLength}, tried: ${parserSummary})`,
    );
    this.name = 'ParserCircuitBreakerError';
    this.url = params.url;
    this.httpStatus = params.httpStatus;
    this.htmlLength = params.htmlLength;
    this.parsersTried = params.parsersTried;
  }
}

/**
 * Thrown when {@link fetchWithRetry} has exhausted all retry attempts against
 * a transient failure class (HTTP 429/5xx or network error). Carries the full
 * context required to triage the outage from logs alone.
 */
export class FetchRetryExhaustedError extends Error {
  public readonly url: string;
  public readonly attempts: number;
  public readonly lastStatus: number | undefined;
  public readonly lastError: string | undefined;

  constructor(params: { url: string; attempts: number; lastStatus?: number; lastError?: string }) {
    const tail =
      params.lastStatus !== undefined
        ? `HTTP ${params.lastStatus}`
        : (params.lastError ?? 'unknown error');
    super(`Fetch failed for ${params.url} after ${params.attempts} attempt(s): ${tail}`);
    this.name = 'FetchRetryExhaustedError';
    this.url = params.url;
    this.attempts = params.attempts;
    this.lastStatus = params.lastStatus;
    this.lastError = params.lastError;
  }
}

/**
 * Exponential-backoff base (ms) used by {@link fetchWithRetry}. Exported as a
 * mutable ref object so tests can shrink the delay to keep the suite fast
 * without exposing a private setter.
 */
export const __retryTuning = {
  /** Base backoff in ms. delay = BASE * 2^attempt + jitter. */
  backoffBaseMs: 500,
  /** Additional uniform jitter bound in ms. */
  jitterMaxMs: 250,
  /** Maximum retry attempts (total requests = maxRetries + 1). */
  maxRetries: 3,
};

/** HTTP statuses we treat as transient and worth retrying. */
const RETRYABLE_STATUSES = new Set<number>([429, 500, 502, 503, 504]);

/** Node/undici error codes we treat as transient network blips. */
const RETRYABLE_ERROR_CODES = new Set<string>([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

function isRetryableNetworkError(err: unknown): boolean {
  // The fetch() spec surfaces network failures as TypeError. Node's undici
  // also attaches a `cause` with an errno-style code we can whitelist.
  if (err instanceof TypeError) return true;
  if (err && typeof err === 'object') {
    const maybeCode = (err as { code?: unknown }).code;
    if (typeof maybeCode === 'string' && RETRYABLE_ERROR_CODES.has(maybeCode)) {
      return true;
    }
    const cause = (err as { cause?: unknown }).cause;
    if (cause && typeof cause === 'object') {
      const causeCode = (cause as { code?: unknown }).code;
      if (typeof causeCode === 'string' && RETRYABLE_ERROR_CODES.has(causeCode)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Parse a `Retry-After` header value. Supports both the delta-seconds form
 * and the HTTP-date form per RFC 7231 §7.1.3. Returns ms, or undefined if the
 * header is missing/unparseable.
 */
function parseRetryAfter(headerValue: string | null): number | undefined {
  if (!headerValue) return undefined;
  const trimmed = headerValue.trim();
  if (trimmed === '') return undefined;
  // delta-seconds: a non-negative decimal integer
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const seconds = parseFloat(trimmed);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.round(seconds * 1000);
    }
    return undefined;
  }
  // HTTP-date
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now();
    return delta > 0 ? delta : 0;
  }
  return undefined;
}

function computeBackoffMs(attempt: number): number {
  const exp = __retryTuning.backoffBaseMs * Math.pow(2, attempt);
  const jitter = Math.random() * __retryTuning.jitterMaxMs;
  return Math.round(exp + jitter);
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Perform a single HTTP GET (or HEAD) with exponential-backoff retry on
 * transient failures. Retries on HTTP 429 and 5xx (500/502/503/504) and on
 * network errors (TypeError from fetch, ECONNRESET/ETIMEDOUT, etc). Permanent
 * 4xx responses (404/410/etc) are NOT retried.
 *
 * On 429, honors a `Retry-After` header (seconds or HTTP-date) when present
 * and uses that instead of the computed backoff, ensuring we don't hammer a
 * server that's explicitly asking for a pause.
 *
 * Exhausting retries throws {@link FetchRetryExhaustedError} with full
 * context (url, attempts, lastStatus, lastError).
 *
 * The optional `method` parameter defaults to `"GET"`. Pass `"HEAD"` for
 * lightweight existence checks where the response body is not needed.
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit & { method?: string },
): Promise<Response> {
  const maxAttempts = __retryTuning.maxRetries + 1;
  let lastStatus: number | undefined;
  let lastError: string | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    log.debug('fetch attempt', { url, attempt: attempt + 1, maxAttempts });
    let response: Response | undefined;
    try {
      response = await fetch(url, init);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastError = message;
      lastStatus = undefined;
      if (!isRetryableNetworkError(err) || attempt === maxAttempts - 1) {
        if (attempt === maxAttempts - 1) {
          log.error('fetch exhausted retries (network)', {
            url,
            attempts: attempt + 1,
            lastError: message,
          });
          throw new FetchRetryExhaustedError({
            url,
            attempts: attempt + 1,
            lastError: message,
          });
        }
        // Non-retryable network error: surface unchanged.
        throw err;
      }
      const delay = computeBackoffMs(attempt);
      log.warn('fetch failed, retrying', {
        url,
        attempt: attempt + 1,
        error: message,
        nextDelayMs: delay,
      });
      await sleepMs(delay);
      continue;
    }

    if (response.ok) {
      return response;
    }

    lastStatus = response.status;
    lastError = `HTTP ${response.status} ${response.statusText}`;

    if (!RETRYABLE_STATUSES.has(response.status)) {
      // Permanent failure — do NOT retry (404/410/400/401/403/etc).
      return response;
    }

    if (attempt === maxAttempts - 1) {
      log.error('fetch exhausted retries (status)', {
        url,
        attempts: attempt + 1,
        lastStatus,
      });
      throw new FetchRetryExhaustedError({
        url,
        attempts: attempt + 1,
        lastStatus,
        lastError,
      });
    }

    // Honor Retry-After on 429.
    let delay = computeBackoffMs(attempt);
    if (response.status === 429) {
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
      if (retryAfterMs !== undefined) {
        delay = retryAfterMs;
      }
    }
    log.warn('fetch failed, retrying', {
      url,
      attempt: attempt + 1,
      status: response.status,
      nextDelayMs: delay,
    });
    await sleepMs(delay);
  }

  // Loop invariant: we either return a Response or throw above. This is a
  // safety net for TS's control-flow analysis.
  throw new FetchRetryExhaustedError({
    url,
    attempts: maxAttempts,
    lastStatus,
    lastError,
  });
}

// API response interfaces
interface ApiAudioEntry {
  mediaUrl: string;
  variant: string;
}

interface ApiResponse {
  meta: {
    title: string;
    audio?: ApiAudioEntry[];
    pageAttributes?: Record<string, string>;
    /**
     * og:image URL exposed by the API (mirrors the HTML <head> meta tag).
     * Lets extractPageData reach the talk hero image without fetching the
     * full HTML page (gc_podcast-e62).
     */
    ogTagImageUrl?: string;
  };
  content: {
    body: string;
  };
}

// ---------------------------------------------------------------------------
// Audio URL validation helpers (gc_podcast-7fq)
// ---------------------------------------------------------------------------

/**
 * Whether audio URL validation via HEAD request is enabled. Controlled by
 * the VALIDATE_AUDIO_URLS env var. Disabled by default so local dev and CI
 * without network access are unaffected; set VALIDATE_AUDIO_URLS=1 (or any
 * truthy string) to enable.
 */
export function isAudioValidationEnabled(): boolean {
  const v = process.env.VALIDATE_AUDIO_URLS;
  if (!v) return false;
  return v !== '0' && v.toLowerCase() !== 'false';
}

/**
 * Validated result for a single audio URL HEAD check.
 *
 * - `valid: true`  — 200 + content-length > 0 (or no content-length header
 *                    but status is 200/206, e.g. servers that omit it)
 * - `valid: false` — 4xx/5xx response; caller should DROP the audio entry
 * - `valid: true`  on network error — treat as transient, KEEP the entry
 */
export interface AudioUrlCheckResult {
  url: string;
  valid: boolean;
  /** Set when the check was skipped due to a network error (keep entry). */
  networkError?: string;
  /** HTTP status code when a response was received. */
  status?: number;
  /** Content-Type header value. */
  contentType?: string;
}

/**
 * Issue a HEAD request against an audio URL and decide whether to keep it.
 *
 * Policy:
 *   - 200/206 + audio content-type OR no content-type → valid
 *   - 200/206 + clearly wrong content-type (text/html, application/json) → invalid
 *   - 404/4xx/5xx → invalid
 *   - Network error → valid (transient; log warn)
 */
export async function checkAudioUrl(url: string): Promise<AudioUrlCheckResult> {
  try {
    const response = await fetchWithRetry(url, { method: 'HEAD' });
    const status = response.status;
    const contentType = response.headers.get('content-type') ?? '';

    if (status === 200 || status === 206) {
      // Reject clearly wrong content types (HTML error pages, JSON, etc.).
      const lct = contentType.toLowerCase();
      if (
        lct.startsWith('text/html') ||
        lct.startsWith('application/json') ||
        lct.startsWith('application/xml') ||
        lct.startsWith('text/xml')
      ) {
        return { url, valid: false, status, contentType };
      }
      return { url, valid: true, status, contentType };
    }

    // Any other status (404, 403, 5xx, etc.) → invalid.
    return { url, valid: false, status, contentType };
  } catch (err) {
    // fetchWithRetry throws FetchRetryExhaustedError in two scenarios:
    //   1. Retryable HTTP status (5xx/429) exhausted: lastStatus is set.
    //      That's a definitive server failure → invalid (drop the entry).
    //   2. Network-level failure exhausted (TypeError, ECONNRESET, etc.):
    //      lastError is set, lastStatus is undefined.
    //      That's a transient connectivity issue → keep the entry.
    if (err instanceof FetchRetryExhaustedError) {
      if (err.lastStatus !== undefined) {
        // HTTP error (5xx/429 exhausted) → invalid.
        return { url, valid: false, status: err.lastStatus };
      }
      // Network error (DNS, socket, etc.) → transient, keep entry.
      return { url, valid: true, networkError: err.lastError ?? err.message };
    }
    // Any other thrown error is also treated as a transient network failure.
    const message = err instanceof Error ? err.message : String(err);
    return { url, valid: true, networkError: message };
  }
}

// ---------------------------------------------------------------------------
// Bio URL validation helpers (gc_podcast-0ta)
// ---------------------------------------------------------------------------

/**
 * Generate one alternative slug from a speaker display name.
 *
 * Covers the most common reasons that a primary slug 404s:
 *   - Name suffixes like "-jr", "-sr", "-ii", "-iii" that the church site
 *     sometimes omits from the slug.
 *   - Middle initials (e.g. "jeffrey-r-holland" → "jeffrey-holland").
 *   - Accented characters that should be normalised to ASCII equivalents
 *     (e.g. "dieter-f-uchtdorf" already works; "jose-a-teixeira" → ok).
 *
 * If none of the transforms produce a different slug, returns undefined
 * (indicating no useful alternative exists).
 */
export function generateAltBioSlug(primarySlug: string): string | undefined {
  // 1. Strip common suffixes: -jr, -sr, -ii, -iii, -iv
  const suffixRemoved = primarySlug.replace(/-(?:jr|sr|ii|iii|iv)$/, '');
  if (suffixRemoved !== primarySlug) return suffixRemoved;

  // 2. Remove a single-character middle segment (e.g. "jeffrey-r-holland" → "jeffrey-holland")
  const middleRemoved = primarySlug.replace(/-[a-z]-/, '-');
  if (middleRemoved !== primarySlug) return middleRemoved;

  // 3. Remove trailing single-character segment (e.g. "name-a" → "name")
  const trailingRemoved = primarySlug.replace(/-[a-z]$/, '');
  if (trailingRemoved !== primarySlug) return trailingRemoved;

  return undefined;
}

/**
 * HEAD-check a bio URL and attempt one alternative slug variant if the
 * primary URL returns 404. Returns the first URL that returns 2xx, or
 * undefined if neither succeeds.
 *
 * On network error: returns the primary URL unchanged (assume transient;
 * let the image-extractor path decide whether to retry).
 */
export async function validateBioUrl(primaryUrl: string): Promise<string | undefined> {
  // Extract the slug from the path: /learn/<slug>?lang=...
  const urlObj = new URL(primaryUrl);
  const pathParts = urlObj.pathname.split('/').filter(Boolean);
  const primarySlug = pathParts[pathParts.length - 1] ?? '';

  async function headCheck(url: string): Promise<boolean> {
    try {
      const response = await fetchWithRetry(url, { method: 'HEAD' });
      // 2xx is a hit; everything else is a miss.
      return response.status >= 200 && response.status < 300;
    } catch (err) {
      if (err instanceof FetchRetryExhaustedError && err.lastStatus !== undefined) {
        // HTTP failure (e.g. 404 exhausted) → miss.
        return false;
      }
      // Network error → treat primary URL as valid (transient).
      return true;
    }
  }

  if (await headCheck(primaryUrl)) {
    return primaryUrl;
  }

  const altSlug = generateAltBioSlug(primarySlug);
  if (!altSlug) return undefined;

  // Build the alt URL by replacing the slug in the path.
  const altUrl = primaryUrl.replace(`/learn/${primarySlug}`, `/learn/${altSlug}`);
  if (await headCheck(altUrl)) {
    return altUrl;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Authoritative speaker directory helpers (gc_podcast-3wj)
// ---------------------------------------------------------------------------

const DIRECTORY_URL =
  'https://www.churchofjesuschrist.org/learn/global-leadership-of-the-church?lang=eng';

/**
 * Honorific prefixes stripped from speaker names when building the normalised
 * lookup key for the authoritative directory map.
 */
const HONORIFIC_RE = /^(?:President|Elder|Bishop|Sister|Brother|Dr\.)\s+/i;

/**
 * Normalise a speaker display name for directory lookup.
 *
 * Steps applied (in order):
 *   1. Trim leading/trailing whitespace.
 *   2. Collapse interior runs of whitespace to a single space.
 *   3. Lowercase.
 *   4. Strip a leading honorific (President|Elder|Bishop|Sister|Brother|Dr.).
 *
 * Both the directory keys and the `resolveBioUrl` query are normalised the
 * same way so the comparison is always apples-to-apples.
 */
export function normaliseSpeakerName(name: string): string {
  let n = name.trim().replace(/\s+/g, ' ').toLowerCase();
  n = n.replace(HONORIFIC_RE, '');
  return n.trim();
}

/**
 * Main scraper class
 */
export class ConferenceScraper {
  private config: ScraperConfig;
  private lastRequestTime = 0;
  /**
   * Per-run bio image dedup cache. Keyed on speaker name; value is a Promise
   * that resolves to the canonical image URL (or undefined on 404/no-image).
   * Each speaker's bio page is fetched at most once per scraper instance.
   */
  private bioImageCache = new Map<string, Promise<string | undefined>>();

  /**
   * Lazy singleton Promise for the authoritative speaker directory (gc_podcast-3wj).
   * Set on the first call to fetchAuthoritativeDirectory(); reused on all
   * subsequent calls within the same scraper run.
   */
  private directoryPromise: Promise<Map<string, string>> | null = null;

  constructor(config: Partial<ScraperConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Scrape a complete conference
   */
  async scrapeConference(year: number, month: 4 | 10): Promise<Conference> {
    const langCode = LANGUAGES[this.config.language].urlParam;
    const monthStr = month.toString().padStart(2, '0');
    const conferenceUrl = `${BASE_URL}/study/general-conference/${year}/${monthStr}?lang=${langCode}`;

    console.log(`Scraping conference: ${conferenceUrl}`);

    // Try API-first approach for discovery, fall back to direct HTML
    let conferenceName: string;
    let sessions: Session[];

    const apiResult = await this.discoverViaApi(year, monthStr, langCode);
    if (apiResult) {
      conferenceName = apiResult.name;
      sessions = apiResult.sessions;
    } else {
      console.log('  [fallback] API discovery failed, using direct HTML scraping');
      const html = await this.fetchWithRateLimit(conferenceUrl);
      conferenceName = this.extractConferenceName(html, year, month);
      sessions = this.extractSessionsWithCircuitBreaker(
        html,
        year,
        monthStr,
        langCode,
        conferenceUrl,
        200,
      );
    }

    // Optionally fetch audio for each session and talk
    if (this.config.includeSessionAudio || this.config.includeTalkAudio) {
      await this.enrichWithAudio(sessions);
    }

    // Fetch conference hero image (gc_podcast-8t0). Non-fatal — null on failure.
    const conference_image_url = await this.fetchConferenceImage(year, month);

    return {
      year,
      month,
      name: conferenceName,
      url: conferenceUrl,
      language: this.config.language,
      sessions,
      conference_image_url,
    };
  }

  /**
   * API-first discovery: fetch conference index via the content API and parse
   * the body HTML. Returns null if the API call fails or yields no sessions.
   */
  private async discoverViaApi(
    year: number,
    monthStr: string,
    langCode: string,
  ): Promise<{ name: string; sessions: Session[] } | null> {
    const uri = `/general-conference/${year}/${monthStr}`;
    const apiUrl = `${API_BASE}?lang=${langCode}&uri=${uri}`;

    try {
      const jsonStr = await this.fetchWithRateLimit(apiUrl);
      const apiResponse: ApiResponse = JSON.parse(jsonStr);

      // Runtime schema check + drift signals — warn but continue; HTML
      // fallback still kicks in downstream if the shape is unusable.
      reportApiDrift(apiUrl, apiResponse);

      const name =
        apiResponse.meta.title ||
        `${monthStr === '04' ? 'April' : 'October'} ${year} General Conference`;
      const bodyHtml = apiResponse.content.body;

      if (!bodyHtml) {
        return null;
      }

      // Parse the API body HTML with the circuit breaker. When the API hands
      // us a non-trivial body but all parsers return zero sessions, that's a
      // contract break — bubble ParserCircuitBreakerError up to the caller so
      // the orchestrator can mark this conference as failed rather than
      // writing an empty JSON file.
      const sessions = this.extractSessionsWithCircuitBreaker(
        bodyHtml,
        year,
        monthStr,
        langCode,
        apiUrl,
        200,
      );
      if (sessions.length === 0) {
        return null;
      }

      console.log(`  [api] Discovered ${sessions.length} sessions via API`);
      return { name, sessions };
    } catch (error) {
      if (error instanceof ParserCircuitBreakerError) {
        // Contract break — do not silently fall back to the HTML page. Let
        // the top-level orchestrator decide the policy (fail this conference,
        // preserve existing output, continue the run).
        throw error;
      }
      log.warn('API discovery failed, will fall back to HTML', {
        url: apiUrl,
        year,
        month: monthStr,
        language: langCode,
        ...(error instanceof Error
          ? { error: error.message, stack: error.stack, name: error.name }
          : { error: String(error) }),
      });
      return null;
    }
  }

  /**
   * Extract conference name from page
   */
  private extractConferenceName(html: string, year: number, month: number): string {
    // Try to find h1 title
    const h1Match = html.match(/<h1[^>]*>([^<]+)</i);
    if (h1Match) {
      return h1Match[1].trim();
    }

    // Try title tag
    const titleMatch = html.match(/<title[^>]*>([^<]+)</i);
    if (titleMatch) {
      return titleMatch[1].replace(/\s*[-|].*$/, '').trim();
    }

    // Fallback to constructed name
    const monthName = month === 4 ? 'April' : 'October';
    return `${monthName} ${year} General Conference`;
  }

  /**
   * Extract sessions and talks from the conference index page.
   * Tries multiple strategies in order: doc-map (API body), data-content-type, class-based.
   *
   * Preserved for backwards compatibility and the test harness. Prefer
   * `extractSessionsWithCircuitBreaker` from production call sites so we can
   * surface contract breaks loudly.
   */
  private extractSessionsFromIndex(
    html: string,
    year: number,
    monthStr: string,
    langCode: string,
  ): Session[] {
    return this.runParsers(html, year, monthStr, langCode).sessions;
  }

  /**
   * Run every parser strategy in order, recording per-parser session counts.
   * Returns the first non-empty result along with the attempt log so the
   * caller can log parser-success / parser-empty telemetry and trip the
   * circuit breaker when needed.
   */
  private runParsers(
    html: string,
    year: number,
    monthStr: string,
    langCode: string,
  ): { sessions: Session[]; attempts: ParserAttempt[]; successParser: string | null } {
    const attempts: ParserAttempt[] = [];

    // Strategy 1: doc-map / list-tile structure (API body and newer site markup)
    const docMapSessions = this.extractSessionsViaDocMap(html, langCode);
    attempts.push({ parser: 'doc-map', sessionCount: docMapSessions.length });
    if (docMapSessions.length > 0) {
      return { sessions: docMapSessions, attempts, successParser: 'doc-map' };
    }

    // Strategy 2: data-content-type attributes (older conferences)
    const dctSessions = this.extractSessionsViaDataContentType(html, langCode);
    attempts.push({ parser: 'data-content-type', sessionCount: dctSessions.length });
    if (dctSessions.length > 0) {
      return { sessions: dctSessions, attempts, successParser: 'data-content-type' };
    }

    // Strategy 3: class-based navigation structure (2026+ rendered page)
    const classSessions = this.extractSessionsViaClassNames(html, year, monthStr, langCode);
    attempts.push({ parser: 'class-names', sessionCount: classSessions.length });
    if (classSessions.length > 0) {
      return { sessions: classSessions, attempts, successParser: 'class-names' };
    }

    return { sessions: [], attempts, successParser: null };
  }

  /**
   * Run parsers with a circuit breaker. When every parser returns zero
   * sessions AND the HTML body is large enough to plausibly be a conference
   * index page (>= MIN_PARSEABLE_HTML_BYTES), throws
   * ParserCircuitBreakerError so callers can fail loudly rather than writing
   * empty output. Small bodies (404s, redirects) fall through quietly as an
   * empty array — that's a different, expected failure mode.
   */
  private extractSessionsWithCircuitBreaker(
    html: string,
    year: number,
    monthStr: string,
    langCode: string,
    url: string,
    httpStatus: number,
  ): Session[] {
    const { sessions, attempts, successParser } = this.runParsers(html, year, monthStr, langCode);

    const talkCount = sessions.reduce((sum, s) => sum + s.talks.length, 0);

    // Emit per-attempt telemetry: warn on zero-session parsers, info on the
    // one that finally produced data (if any).
    for (const attempt of attempts) {
      if (attempt.sessionCount === 0) {
        log.warn('Parser returned zero sessions', {
          url,
          parser: attempt.parser,
          htmlLength: html.length,
        });
      }
    }

    if (successParser) {
      log.info('Parser success', {
        url,
        parser: successParser,
        sessionCount: sessions.length,
        talkCount,
      });
      return sessions;
    }

    // Every parser returned empty. Decide: contract break, or just a tiny /
    // non-conference body?
    if (html.length >= MIN_PARSEABLE_HTML_BYTES) {
      throw new ParserCircuitBreakerError({
        url,
        httpStatus,
        htmlLength: html.length,
        parsersTried: attempts,
      });
    }

    // Small body — treat as an expected non-match, not a contract break.
    return sessions;
  }

  /**
   * Extract sessions from doc-map / list-tile structure.
   * This is the structure returned by the content API for both old and new conferences.
   * Pattern: <nav class="manifest"> > <ul class="doc-map"> > <li> per session
   *   Each session has <h2 class="label"><p class="title">Session Name</p></h2>
   *   followed by nested <ul class="doc-map"> with <a class="list-tile"> per talk.
   */
  private extractSessionsViaDocMap(html: string, langCode: string): Session[] {
    const sessions: Session[] = [];

    // Match top-level session blocks: <li> containing <h2 class="label"> and a nested doc-map
    // Split by session headings
    const sessionHeaderPattern =
      /<h2\s+class="label"[^>]*>\s*<p\s+class="title"[^>]*>([^<]+)<\/p>/g;
    const headers: Array<{ title: string; position: number }> = [];
    let match;

    while ((match = sessionHeaderPattern.exec(html)) !== null) {
      headers.push({ title: match[1].trim(), position: match.index });
    }

    if (headers.length === 0) return sessions;

    for (let i = 0; i < headers.length; i++) {
      const header = headers[i];
      const nextPos = i + 1 < headers.length ? headers[i + 1].position : html.length;
      const sectionHtml = html.substring(header.position, nextPos);

      // Extract talks via list-tile links within this section
      const talkPattern = /<a\s+href="([^"]+)"\s+class="list-tile"[^>]*>([\s\S]*?)<\/a>/g;
      const talks: Talk[] = [];
      let sessionSlug = '';
      let sessionUrl = '';
      let talkOrder = 0;
      let talkMatch;

      while ((talkMatch = talkPattern.exec(sectionHtml)) !== null) {
        const href = talkMatch[1];
        const tileContent = talkMatch[2];

        // The first list-tile with "session" in the URL is the session link itself
        if (href.includes('session')) {
          sessionSlug = this.extractSlugFromUrl(href);
          sessionUrl = this.normalizeUrl(href, langCode);
          continue;
        }

        talkOrder++;
        const speakerMatch = tileContent.match(/<p\s+class="primaryMeta"[^>]*>([^<]+)<\/p>/);
        const titleMatch = tileContent.match(/<p\s+class="title"[^>]*>([^<]+)<\/p>/);

        talks.push({
          title: titleMatch ? titleMatch[1].trim() : `Talk ${talkOrder}`,
          slug: this.extractSlugFromUrl(href),
          order: talkOrder,
          url: this.normalizeUrl(href, langCode),
          speaker: {
            name: speakerMatch ? speakerMatch[1].trim() : 'Unknown Speaker',
            role_tag: null,
          },
        });
      }

      if (talks.length > 0) {
        sessions.push({
          name: header.title,
          slug: sessionSlug || `session-${i + 1}`,
          order: i + 1,
          url: sessionUrl,
          talks,
        });
      }
    }

    return sessions;
  }

  /**
   * Original extraction using data-content-type attributes
   */
  private extractSessionsViaDataContentType(html: string, langCode: string): Session[] {
    const sessions: Session[] = [];
    let currentSession: Session | null = null;
    let sessionOrder = 0;
    let talkOrder = 0;

    // Find session elements
    const sessionElements = findByDataContentType(html, 'general-conference-session');
    const talkElements = findByDataContentType(html, 'general-conference-talk');

    // Build a map of position in HTML to element type
    interface IndexItem {
      type: 'session' | 'talk';
      position: number;
      element: ParsedElement;
    }

    const items: IndexItem[] = [];

    for (const el of sessionElements) {
      const pos = html.indexOf(el.outerHtml);
      items.push({ type: 'session', position: pos, element: el });
    }

    for (const el of talkElements) {
      const pos = html.indexOf(el.outerHtml);
      items.push({ type: 'talk', position: pos, element: el });
    }

    // Sort by position in document
    items.sort((a, b) => a.position - b.position);

    // Process in document order
    for (const item of items) {
      if (item.type === 'session') {
        // Save previous session if exists
        if (currentSession) {
          sessions.push(currentSession);
        }

        sessionOrder++;
        talkOrder = 0;

        const sessionTitle = extractTitle(item.element) || `Session ${sessionOrder}`;
        const hrefs = findHrefs(item.element.content, 'session');
        const sessionLink = hrefs[0] || '';
        const sessionSlug = this.extractSlugFromUrl(sessionLink);

        currentSession = {
          name: sessionTitle,
          slug: sessionSlug || `session-${sessionOrder}`,
          order: sessionOrder,
          url: sessionLink ? this.normalizeUrl(sessionLink, langCode) : '',
          talks: [],
        };
      } else if (item.type === 'talk' && currentSession) {
        talkOrder++;

        const talkTitle = extractTitle(item.element) || `Talk ${talkOrder}`;
        const hrefs = findHrefs(item.element.content);
        // Find the talk link (not session link)
        const talkLink = hrefs.find((h) => !h.includes('session')) || hrefs[0] || '';
        const talkSlug = this.extractSlugFromUrl(talkLink);

        // Try to extract speaker name from the element
        const speakerName = this.extractSpeakerNameFromElement(item.element.content);

        const talk: Talk = {
          title: talkTitle,
          slug: talkSlug || `talk-${talkOrder}`,
          order: talkOrder,
          url: talkLink ? this.normalizeUrl(talkLink, langCode) : '',
          speaker: {
            name: speakerName || 'Unknown Speaker',
            role_tag: null,
          },
        };

        currentSession.talks.push(talk);
      }
    }

    // Don't forget the last session
    if (currentSession) {
      sessions.push(currentSession);
    }

    return sessions;
  }

  /**
   * Fallback extraction using class-based navigation (sectionTitle / item classes)
   * Handles the 2026+ site redesign where data-content-type is no longer on elements
   */
  private extractSessionsViaClassNames(
    html: string,
    year: number,
    monthStr: string,
    langCode: string,
  ): Session[] {
    const sessions: Session[] = [];
    const confPath = `/general-conference/${year}/${monthStr}/`;

    // Find all sectionTitle links that point to session pages
    const sectionPattern =
      /<a\s+class="sectionTitle[^"]*"\s+href="([^"]+)"[^>]*>[\s\S]*?<span>([^<]+)<\/span>/g;
    const sessionMatches: Array<{ url: string; title: string; position: number }> = [];
    let match;

    while ((match = sectionPattern.exec(html)) !== null) {
      const href = match[1];
      const title = match[2].trim();
      // Only include links that are session pages (contain "session" in URL)
      if (href.includes(confPath) && href.includes('session')) {
        sessionMatches.push({ url: href, title, position: match.index });
      }
    }

    if (sessionMatches.length === 0) return sessions;

    // For each session, extract talks between this session and the next
    for (let i = 0; i < sessionMatches.length; i++) {
      const sessionMatch = sessionMatches[i];
      const nextSessionPos =
        i + 1 < sessionMatches.length ? sessionMatches[i + 1].position : html.length;
      const sectionHtml = html.substring(sessionMatch.position, nextSessionPos);
      const sessionSlug = this.extractSlugFromUrl(sessionMatch.url);

      const session: Session = {
        name: sessionMatch.title,
        slug: sessionSlug || `session-${i + 1}`,
        order: i + 1,
        url: this.normalizeUrl(sessionMatch.url, langCode),
        talks: [],
      };

      // Find talk items within this session's section
      // Talk links are <a class="item-..." href="/study/general-conference/YYYY/MM/slug">
      // with <span>Title</span> and <p class="subtitle-...">Speaker</p>
      const talkPattern =
        /<a\s+class="item[^"]*"\s+href="([^"]+)"[^>]*>[\s\S]*?<span>([^<]+)<\/span>(?:[\s\S]*?<p\s+class="subtitle[^"]*">([^<]+)<\/p>)?/g;
      let talkMatch;
      let talkOrder = 0;

      while ((talkMatch = talkPattern.exec(sectionHtml)) !== null) {
        const talkHref = talkMatch[1];
        const talkTitle = talkMatch[2].trim();
        const speakerName = talkMatch[3]?.trim() || '';

        // Only include links within this conference that aren't session links
        if (talkHref.includes(confPath) && !talkHref.includes('session')) {
          talkOrder++;
          const talkSlug = this.extractSlugFromUrl(talkHref);

          session.talks.push({
            title: talkTitle,
            slug: talkSlug || `talk-${talkOrder}`,
            order: talkOrder,
            url: this.normalizeUrl(talkHref, langCode),
            speaker: {
              name: speakerName || 'Unknown Speaker',
              role_tag: null,
            },
          });
        }
      }

      sessions.push(session);
    }

    return sessions;
  }

  /**
   * Extract speaker name from element content
   */
  private extractSpeakerNameFromElement(content: string): string {
    // Look for author/speaker classes
    let name = findTextByClass(content, 'author');
    if (name && !name.includes('Session')) return name;

    name = findTextByClass(content, 'speaker');
    if (name && !name.includes('Session')) return name;

    // Look for second line of text (title is usually first, speaker second)
    const textContent = getText(content);
    const lines = textContent.split(/\s{2,}/).filter((l) => l.length > 0);
    if (lines.length >= 2) {
      // The second part might be the speaker
      const potential = lines[1];
      if (potential && !potential.includes('Session') && potential.length < 50) {
        return potential;
      }
    }

    return '';
  }

  /**
   * Enrich sessions and talks with audio information and talk/speaker images.
   *
   * Image enrichment strategy (per decision gc_podcast-gbt):
   *   1. extractPageData returns an image_url extracted from the talk page
   *      (og:image > __INITIAL_STATE__ > body-img).
   *   2. If the talk page yields no image, fall back to the speaker bio page
   *      (og:image > body-img). Bio pages are deduplicated within this run via
   *      bioImageCache — each speaker is fetched at most once.
   *
   * After enrichment, if VALIDATE_AUDIO_URLS is set, each audio URL is
   * HEAD-checked (gc_podcast-7fq). Invalid entries (404/5xx/wrong content-type)
   * are dropped from the output so downstream feed generation never emits
   * broken enclosures. Network errors are logged at warn but the entry is kept
   * (assume transient failure).
   */
  private async enrichWithAudio(sessions: Session[]): Promise<void> {
    const enrichLog = log.child({ language: this.config.language });
    for (const session of sessions) {
      const sessionLog = enrichLog.child({
        sessionName: session.name,
        sessionSlug: session.slug,
        sessionUrl: session.url,
      });
      // Fetch session audio if configured
      if (this.config.includeSessionAudio && session.url) {
        try {
          const sessionData = await this.extractPageData(session.url);
          if (sessionData.audio) {
            session.audio = sessionData.audio;
            session.duration_ms = sessionData.audio.duration_ms;
          }
        } catch (error) {
          sessionLog.warn('Failed to fetch session audio', {
            ...(error instanceof Error
              ? { error: error.message, stack: error.stack, name: error.name }
              : { error: String(error) }),
          });
        }
      }

      // Fetch talk audio, speaker details, and images if configured
      if (this.config.includeTalkAudio) {
        for (const talk of session.talks) {
          if (talk.url) {
            try {
              const talkData = await this.extractPageData(talk.url);
              if (talkData.audio) {
                talk.audio = talkData.audio;
                talk.duration_ms = talkData.audio.duration_ms;
              }
              if (talkData.speaker) {
                talk.speaker = talkData.speaker;
              }
              if (talkData.image_url) {
                talk.image_url = talkData.image_url;
              }
            } catch (error) {
              sessionLog.warn('Failed to fetch talk details', {
                talkTitle: talk.title,
                talkSlug: talk.slug,
                talkUrl: talk.url,
                speakerName: talk.speaker?.name,
                ...(error instanceof Error
                  ? { error: error.message, stack: error.stack, name: error.name }
                  : { error: String(error) }),
              });
            }

            // Bio URL resolution (gc_podcast-3wj / gc_podcast-0ta):
            // resolveBioUrl() tries the authoritative directory first, then
            // falls back to slug-guessing with HEAD-check (and alt-slug
            // variant). If both fail, bio_url is cleared so the image-
            // extractor fallback does not fire against a dead URL.
            if (talk.speaker?.name) {
              const resolvedBioUrl = await this.resolveBioUrl(talk.speaker.name);
              if (resolvedBioUrl === null) {
                if (talk.speaker.bio_url) {
                  log.debug('bio URL unresolvable, clearing', {
                    speakerName: talk.speaker.name,
                    originalBioUrl: talk.speaker.bio_url,
                  });
                }
                talk.speaker.bio_url = undefined;
              } else {
                if (resolvedBioUrl !== talk.speaker.bio_url) {
                  log.debug('bio URL resolved', {
                    speakerName: talk.speaker.name,
                    originalBioUrl: talk.speaker.bio_url,
                    resolvedBioUrl,
                  });
                }
                talk.speaker.bio_url = resolvedBioUrl;
              }
            }

            // Bio fallback: if talk page yielded no image, try speaker bio.
            if (!talk.image_url && talk.speaker?.name && talk.speaker.bio_url) {
              const bioImageUrl = await this.fetchBioImageCached(
                talk.speaker.name,
                talk.speaker.bio_url,
                sessionLog,
              );
              if (bioImageUrl) {
                // Populate both the talk (for the itunes:image emission) and
                // the speaker (so the same portrait is reusable downstream).
                talk.image_url = bioImageUrl;
                talk.speaker.image_url = bioImageUrl;
              }
            }
          }
        }
      }
    }

    // Optional HEAD-check of audio URLs (gc_podcast-7fq).
    if (isAudioValidationEnabled()) {
      await this.validateAudioUrls(sessions);
    }
  }

  /**
   * HEAD-check every audio URL in the enriched session/talk tree and drop
   * invalid entries (404/5xx/wrong content-type) from output JSON.
   *
   * Called only when VALIDATE_AUDIO_URLS is truthy. Network errors are
   * logged at warn but the entry is kept (assume transient failure).
   */
  private async validateAudioUrls(sessions: Session[]): Promise<void> {
    const validateLog = log.child({ phase: 'audio-validation' });
    for (const session of sessions) {
      if (session.audio?.url) {
        const result = await checkAudioUrl(session.audio.url);
        if (result.networkError) {
          validateLog.warn('audio HEAD check: network error (keeping entry)', {
            url: result.url,
            error: result.networkError,
            context: 'session',
            sessionName: session.name,
          });
        } else if (!result.valid) {
          validateLog.warn('audio HEAD check: invalid URL, dropping entry', {
            url: result.url,
            status: result.status,
            contentType: result.contentType,
            context: 'session',
            sessionName: session.name,
          });
          session.audio = undefined;
          session.duration_ms = undefined;
        }
      }

      for (const talk of session.talks) {
        if (talk.audio?.url) {
          const result = await checkAudioUrl(talk.audio.url);
          if (result.networkError) {
            validateLog.warn('audio HEAD check: network error (keeping entry)', {
              url: result.url,
              error: result.networkError,
              context: 'talk',
              talkTitle: talk.title,
            });
          } else if (!result.valid) {
            validateLog.warn('audio HEAD check: invalid URL, dropping entry', {
              url: result.url,
              status: result.status,
              contentType: result.contentType,
              context: 'talk',
              talkTitle: talk.title,
            });
            talk.audio = undefined;
            talk.duration_ms = undefined;
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Conference hero image (gc_podcast-8t0)
  // ---------------------------------------------------------------------------

  /**
   * Fetch the conference-branded hero image for a specific conference.
   *
   * Source: `https://www.churchofjesuschrist.org/media/collection/<month>-<year>-general-conference?lang=eng`
   *
   * Returns an Apple-compliant 3000×3000 square IIIF URL (built via
   * buildConferenceSquareImageUrl), or null on failure (non-fatal).
   *
   * Only months 4 (April) and 10 (October) are valid GC months. Any other
   * month value short-circuits to null without fetching.
   *
   * gc_podcast-vce: no longer falls back to `/feature/general-conference`
   * when the per-conference collection page 404s. That fallback page's
   * og:image is an evergreen banner (Good Shepherd) that is NOT specific
   * to any particular conference, so using it defeats the purpose of
   * per-cycle rotation in generateRssFeed. When a collection page is
   * missing — typically because the cycle hasn't yet been published by
   * the Church — we return null and let rotation pick the previous
   * conference's branded art instead.
   */
  async fetchConferenceImage(year: number, month: number): Promise<string | null> {
    if (month !== 4 && month !== 10) {
      return null;
    }

    const monthName = month === 4 ? 'april' : 'october';
    const collectionUrl = `${BASE_URL}/media/collection/${monthName}-${year}-general-conference?lang=eng`;

    try {
      const response = await fetchWithRetry(collectionUrl);
      if (response.ok) {
        const html = await response.text();
        const hash = extractOgImageHash(html);
        if (hash && isCanonicalChannelImageHash(hash)) {
          log.info('conference image extracted from collection page', {
            collectionUrl,
            hash,
          });
          return buildConferenceSquareImageUrl(hash);
        }
        if (hash) {
          // gc_podcast-fpx: reject non-canonical (SHA-1-style hex) hashes.
          // These typically refer to evergreen banners or undersized assets
          // that fail the /square/1500,1500 IIIF crop.
          log.warn('conference image: rejected non-canonical hash from collection page', {
            collectionUrl,
            hash,
          });
        }
      }
    } catch {
      // fall through to null below
    }

    // Fallback: the /media/collection page may not exist yet for recent
    // conferences, but the main GC landing page lists all conferences with
    // thumbnail IIIF images. Scrape the landing page and look for the img
    // associated with this conference's year/month (gc_podcast-gx9).
    const monthPad = month.toString().padStart(2, '0');
    const landingUrl = `${BASE_URL}/study/general-conference?lang=eng`;
    try {
      const landingResp = await fetchWithRetry(landingUrl);
      if (landingResp.ok) {
        const landingHtml = await landingResp.text();
        // Find a chunk of HTML surrounding a link to this conference
        // e.g. /study/general-conference/2026/04
        const confPattern = `/study/general-conference/${year}/${monthPad}`;
        const idx = landingHtml.indexOf(confPattern);
        if (idx !== -1) {
          // Extract a window of HTML around the match to find the nearby img
          const windowStart = Math.max(0, idx - 1000);
          const windowEnd = Math.min(landingHtml.length, idx + 1000);
          const windowHtml = landingHtml.slice(windowStart, windowEnd);
          // Look for an IIIF hash in any img src in this window
          const hashMatch = windowHtml.match(
            /churchofjesuschrist\.org\/imgs\/([a-z0-9]+)\/full\//i,
          );
          if (hashMatch?.[1]) {
            const hash = hashMatch[1].toLowerCase();
            if (isCanonicalChannelImageHash(hash)) {
              log.info('conference image extracted from GC landing page fallback', {
                year,
                month,
                hash,
              });
              return buildConferenceSquareImageUrl(hash);
            }
            // gc_podcast-fpx: reject non-canonical (SHA-1-style hex) hashes.
            log.warn('conference image: rejected non-canonical hash from landing page', {
              year,
              month,
              hash,
            });
          }
        }
      }
    } catch {
      // fall through to null below
    }

    log.warn('conference image unavailable from both collection and landing pages', {
      collectionUrl,
      year,
      month,
    });
    return null;
  }

  // ---------------------------------------------------------------------------
  // Authoritative speaker → bio URL directory (gc_podcast-3wj)
  // ---------------------------------------------------------------------------

  /**
   * Fetch the Church's authoritative speaker directory ONCE per scraper run.
   *
   * The directory page lists every current General Authority with a link to
   * their /learn/<slug> bio page. We parse all `<a href="/learn/<slug>?lang=eng">`
   * links and build a Map keyed by the normalised speaker display name.
   *
   * Failure is non-fatal: if the page returns non-200 or parsing fails we log
   * a warning and return an empty Map so callers fall back to slug-guessing.
   *
   * The result is memoised — subsequent calls within the same scraper instance
   * return the same Promise without making a second network request.
   */
  fetchAuthoritativeDirectory(): Promise<Map<string, string>> {
    if (this.directoryPromise !== null) {
      return this.directoryPromise;
    }

    this.directoryPromise = this._loadAuthoritativeDirectory();
    return this.directoryPromise;
  }

  private async _loadAuthoritativeDirectory(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    try {
      const response = await fetchWithRetry(DIRECTORY_URL);
      if (!response.ok) {
        log.warn('authoritative directory fetch returned non-200', {
          url: DIRECTORY_URL,
          status: response.status,
        });
        return map;
      }
      const html = await response.text();
      if (!html) {
        log.warn('authoritative directory response was empty', { url: DIRECTORY_URL });
        return map;
      }

      // Parse every <a href="/learn/<slug>?lang=eng">…name text…</a> anchor.
      // The href may include ?lang=eng or similar query params.
      const linkRe = /<a\s[^>]*href\s*=\s*["'](\/learn\/[^"'?]+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let m: RegExpExecArray | null;
      while ((m = linkRe.exec(html)) !== null) {
        const href = m[1];
        const innerHtml = m[2];
        // Strip tags from inner HTML to get the display name text.
        const rawName = innerHtml.replace(/<[^>]+>/g, '').trim();
        if (!rawName) continue;

        // Build the full URL. The href is already absolute-path, so prepend base.
        let bioUrl = href;
        if (!bioUrl.startsWith('http')) {
          bioUrl = `${BASE_URL}${bioUrl}`;
        }
        // Ensure lang param is present.
        if (!bioUrl.includes('lang=')) {
          const langCode = LANGUAGES[this.config.language]?.urlParam ?? 'eng';
          bioUrl += `?lang=${langCode}`;
        }

        const key = normaliseSpeakerName(rawName);
        if (key) {
          map.set(key, bioUrl);
        }
      }

      log.info('authoritative directory loaded', {
        url: DIRECTORY_URL,
        speakerCount: map.size,
      });
    } catch (err) {
      log.warn('authoritative directory fetch failed', {
        url: DIRECTORY_URL,
        ...(err instanceof Error ? { error: err.message } : { error: String(err) }),
      });
    }
    return map;
  }

  /**
   * Resolve the bio URL for a speaker.
   *
   * Look-up order:
   *   1. Authoritative directory (fetched once per run via fetchAuthoritativeDirectory).
   *   2. Slug-generated URL (existing constructBioUrl logic), HEAD-checked via
   *      validateBioUrl (which also tries an alt-slug variant).
   *
   * Returns null when both paths fail (no directory match AND HEAD-check fails
   * for both primary and alt slug). Returns null for empty/falsy names.
   */
  async resolveBioUrl(speakerName: string): Promise<string | null> {
    if (!speakerName) return null;

    // 1. Check the authoritative directory.
    const directory = await this.fetchAuthoritativeDirectory();
    const key = normaliseSpeakerName(speakerName);
    const directoryUrl = directory.get(key);
    if (directoryUrl) {
      return directoryUrl;
    }

    // 2. Fall back to slug-guessing with HEAD-check.
    const slugUrl = this.constructBioUrl(speakerName);
    const validated = await validateBioUrl(slugUrl);
    return validated ?? null;
  }

  /**
   * Fetch a speaker's bio page and extract a portrait image URL.
   *
   * Results are memoized in bioImageCache (keyed on speaker name) so each
   * speaker is fetched at most once per scraper run regardless of how many
   * talks they give.
   *
   * Returns undefined on 404, parse failure, or when no IIIF image is found.
   */
  private fetchBioImageCached(
    speakerName: string,
    bioUrl: string,
    parentLog: ReturnType<typeof log.child>,
  ): Promise<string | undefined> {
    const cached = this.bioImageCache.get(speakerName);
    if (cached !== undefined) {
      return cached;
    }

    const promise = this.fetchBioImage(speakerName, bioUrl, parentLog);
    this.bioImageCache.set(speakerName, promise);
    return promise;
  }

  /**
   * Perform the actual bio page fetch and image extraction.
   * Never throws — returns undefined on any failure.
   */
  private async fetchBioImage(
    speakerName: string,
    bioUrl: string,
    parentLog: ReturnType<typeof log.child>,
  ): Promise<string | undefined> {
    const imgLog = parentLog.child({ module: 'image-extractor', speakerName, bioUrl });
    try {
      const html = await this.fetchWithRateLimit(bioUrl);
      // fetchWithRateLimit throws on non-OK responses that are permanent
      // (404 etc.), so reaching here means we have response body text.
      const extracted = extractImageFromBioHtml(html);
      if (extracted) {
        imgLog.debug('speaker bio image extracted', {
          source: extracted.source,
          hash: extracted.hash,
        });
        return extracted.canonicalUrl;
      }
      imgLog.debug('speaker bio page had no IIIF image');
      return undefined;
    } catch (error) {
      // 404 for deceased speakers is expected — log at debug, not warn.
      const isNotFound = error instanceof Error && error.message.startsWith('HTTP 404');
      if (isNotFound) {
        imgLog.debug('speaker bio page returned 404 (likely deceased)');
      } else {
        imgLog.warn('failed to fetch speaker bio image', {
          ...(error instanceof Error ? { error: error.message } : { error: String(error) }),
        });
      }
      return undefined;
    }
  }

  /**
   * Extract audio, speaker data, and talk image from a page using the API.
   *
   * image_url extraction strategy:
   *   - API path: prefer apiResponse.meta.ogTagImageUrl (mirrors the page's
   *     <meta property="og:image">); this is the talk hero image the user
   *     sees on the page. If absent, fall back to scanning content.body for
   *     an IIIF <img> tag (body-img). og:image and __INITIAL_STATE__ live in
   *     the <head> of the full HTML and are not present in the body fragment.
   *   - HTML path: we have the full rendered page, so all three strategies
   *     (og:image, __INITIAL_STATE__, body-img) are tried.
   */
  private async extractPageData(url: string): Promise<{
    audio?: AudioAsset;
    speaker?: Speaker;
    image_url?: string;
  }> {
    const imgLog = log.child({ module: 'image-extractor' });

    // Convert page URL to API URL
    // e.g., /study/general-conference/2025/10/12stevenson?lang=eng
    // becomes: /study/api/v3/language-pages/type/content?lang=eng&uri=/general-conference/2025/10/12stevenson
    const urlObj = new URL(url);
    const pathMatch = urlObj.pathname.match(/\/study(.+)/);
    if (!pathMatch) {
      // Fall back to HTML scraping if URL doesn't match expected pattern
      const html = await this.fetchWithRateLimit(url);
      const extracted = extractImageFromTalkHtml(html);
      if (extracted) {
        imgLog.debug('talk image extracted (html-fallback)', {
          url,
          source: extracted.source,
          hash: extracted.hash,
        });
      }
      return {
        audio: this.extractAudioFromHtml(html),
        speaker: this.extractSpeakerFromHtml(html),
        image_url: extracted?.canonicalUrl,
      };
    }

    const uri = pathMatch[1];
    const lang = urlObj.searchParams.get('lang') || this.config.language;
    const apiUrl = `${API_BASE}?lang=${lang}&uri=${uri}`;

    try {
      const jsonStr = await this.fetchWithRateLimit(apiUrl);
      const apiResponse: ApiResponse = JSON.parse(jsonStr);

      reportApiDrift(apiUrl, apiResponse);

      const audio = this.extractAudioFromApi(apiResponse);
      const speaker = this.extractSpeakerFromApi(apiResponse);

      // Prefer the API's meta.ogTagImageUrl — this is the same URL emitted in
      // the HTML <head>'s og:image tag and reliably points at the talk hero
      // image. The article fragment at content.body omits the <head>, so
      // without this we would miss the hero image for every talk whose body
      // has no inline IIIF <img> (gc_podcast-e62).
      let imageUrl: string | undefined;
      const metaOgUrl = apiResponse.meta.ogTagImageUrl;
      if (metaOgUrl) {
        const hash = extractHash(metaOgUrl);
        if (hash) {
          imageUrl = buildCanonicalImageUrl(hash);
          imgLog.debug('talk image extracted (api-meta-og)', {
            url,
            apiUrl,
            hash,
          });
        }
      }

      // Fallback: scan the body fragment for an IIIF <img> tag. Needed for
      // older content where meta.ogTagImageUrl is missing or points at a
      // non-Church URL (og:image and __INITIAL_STATE__ are head-only, so
      // those strategies always no-op against a body fragment).
      if (!imageUrl) {
        const extracted = extractImageFromTalkHtml(apiResponse.content.body);
        if (extracted) {
          imageUrl = extracted.canonicalUrl;
          imgLog.debug('talk image extracted (api-body)', {
            url,
            apiUrl,
            source: extracted.source,
            hash: extracted.hash,
          });
        }
      }

      return { audio, speaker, image_url: imageUrl };
    } catch (error) {
      log.warn('API fetch failed, falling back to HTML scraping', {
        url,
        apiUrl,
        language: lang,
        ...(error instanceof Error
          ? { error: error.message, stack: error.stack, name: error.name }
          : { error: String(error) }),
      });
      const html = await this.fetchWithRateLimit(url);
      const extracted = extractImageFromTalkHtml(html);
      if (extracted) {
        imgLog.debug('talk image extracted (api-fallback-html)', {
          url,
          source: extracted.source,
          hash: extracted.hash,
        });
      }
      return {
        audio: this.extractAudioFromHtml(html),
        speaker: this.extractSpeakerFromHtml(html),
        image_url: extracted?.canonicalUrl,
      };
    }
  }

  /**
   * Extract audio information from API response
   */
  private extractAudioFromApi(apiResponse: ApiResponse): AudioAsset | undefined {
    // Get audio URL from meta.audio array
    const audioEntry = apiResponse.meta.audio?.find((a) => a.variant === 'audio');
    if (!audioEntry?.mediaUrl) {
      return undefined;
    }

    // Get duration from video tag in body HTML
    const duration = this.extractDuration(apiResponse.content.body);

    return {
      url: audioEntry.mediaUrl,
      quality: '128k',
      language: LANGUAGES[this.config.language].audioSuffix,
      duration_ms: duration,
    };
  }

  /**
   * Extract speaker information from API response
   */
  private extractSpeakerFromApi(apiResponse: ApiResponse): Speaker {
    const html = apiResponse.content.body;

    let name = '';
    let calling = '';

    // Extract from author-name class
    const nameMatch = html.match(
      /<p[^>]*class\s*=\s*["'][^"']*author-name[^"']*["'][^>]*>([^<]+)/i,
    );
    if (nameMatch) {
      name = nameMatch[1].trim();
      // Remove "By " prefix
      name = name.replace(/^By\s+/i, '');
    }

    // Extract from author-role class
    const roleMatch = html.match(
      /<p[^>]*class\s*=\s*["'][^"']*author-role[^"']*["'][^>]*>([^<]+)/i,
    );
    if (roleMatch) {
      calling = roleMatch[1].trim();
    }

    // Determine role_tag
    const role_tag = this.classifyRole(calling);

    // Construct bio URL from clean name
    const bio_url = name ? this.constructBioUrl(name) : undefined;

    return {
      name: name || apiResponse.meta.title || 'Unknown Speaker',
      role_tag,
      calling: calling || undefined,
      bio_url,
    };
  }

  /**
   * Extract audio information from HTML
   */
  private extractAudioFromHtml(html: string): AudioAsset | undefined {
    const mp3Url = this.findMp3Url(html);
    if (!mp3Url) {
      return undefined;
    }

    const duration = this.extractDuration(html);

    return {
      url: mp3Url,
      quality: '128k',
      language: LANGUAGES[this.config.language].audioSuffix,
      duration_ms: duration,
    };
  }

  /**
   * Find MP3 URL in HTML
   */
  private findMp3Url(html: string): string | undefined {
    // Method 1: Look for assets.churchofjesuschrist.org MP3 URLs with language suffix
    const langSuffix = LANGUAGES[this.config.language].audioSuffix;
    const specificMp3Regex = new RegExp(
      `https://assets\\.churchofjesuschrist\\.org/[a-z0-9]+-128k-${langSuffix}\\.mp3`,
      'gi',
    );
    const specificMatches = html.match(specificMp3Regex);
    if (specificMatches && specificMatches.length > 0) {
      return specificMatches[0];
    }

    // Method 2: Look for any assets.churchofjesuschrist.org MP3
    const assetsMp3Regex = /https:\/\/assets\.churchofjesuschrist\.org\/[a-z0-9-]+\.mp3/gi;
    const assetsMatches = html.match(assetsMp3Regex);
    if (assetsMatches && assetsMatches.length > 0) {
      return assetsMatches[0];
    }

    // Method 3: Look in source tags
    const sourceMatch = html.match(/source[^>]*src\s*=\s*["']([^"']+\.mp3)["']/i);
    if (sourceMatch) {
      return sourceMatch[1];
    }

    // Method 4: Look for any MP3 URL
    const genericMp3Regex = /https?:\/\/[^\s"'<>]+\.mp3/gi;
    const genericMatches = html.match(genericMp3Regex);
    if (genericMatches && genericMatches.length > 0) {
      return genericMatches[0];
    }

    return undefined;
  }

  /**
   * Extract duration from HTML
   */
  private extractDuration(html: string): number | undefined {
    // Look for duration in various JSON formats
    const patterns = [
      /"duration"\s*:\s*(\d+)/,
      /"durationMs"\s*:\s*(\d+)/,
      /data-duration\s*=\s*["'](\d+)["']/,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        return parseInt(match[1], 10);
      }
    }

    return undefined;
  }

  /**
   * Extract speaker information from HTML
   */
  private extractSpeakerFromHtml(html: string): Speaker {
    let name = '';
    let calling = '';

    // Try to find speaker name in HTML elements
    const namePatterns = [
      /class\s*=\s*["'][^"']*author-name[^"']*["'][^>]*>([^<]+)/i,
      /class\s*=\s*["'][^"']*byline[^"']*["'][^>]*>([^<]+)/i,
      /class\s*=\s*["'][^"']*speaker[^"']*["'][^>]*>([^<]+)/i,
    ];

    for (const pattern of namePatterns) {
      const match = html.match(pattern);
      if (match && match[1].trim()) {
        name = match[1].trim();
        break;
      }
    }

    // Try to find role/calling
    const rolePatterns = [
      /class\s*=\s*["'][^"']*author-role[^"']*["'][^>]*>([^<]+)/i,
      /class\s*=\s*["'][^"']*role[^"']*["'][^>]*>([^<]+)/i,
    ];

    for (const pattern of rolePatterns) {
      const match = html.match(pattern);
      if (match && match[1].trim()) {
        calling = match[1].trim();
        break;
      }
    }

    // Try JSON data if HTML parsing failed
    if (!name) {
      const jsonName = extractJsonValue(html, 'authorName') || extractJsonValue(html, 'author');
      if (jsonName) name = jsonName;
    }

    if (!calling) {
      const jsonRole = extractJsonValue(html, 'authorRole') || extractJsonValue(html, 'role');
      if (jsonRole) calling = jsonRole;
    }

    // Determine role_tag
    const role_tag = this.classifyRole(calling);

    // Construct bio URL
    const bio_url = name ? this.constructBioUrl(name) : undefined;

    return {
      name: name || 'Unknown Speaker',
      role_tag,
      calling: calling || undefined,
      bio_url,
    };
  }

  /**
   * Classify speaker role based on calling text
   *
   * Note on apostolic interregnum: When a Church President dies, the First
   * Presidency is dissolved. The President of the Quorum of the Twelve
   * becomes the presiding authority until a new First Presidency is organized.
   * Former counselors return to their seniority in the Twelve. This logic
   * correctly handles that case since callings reflect "Quorum of the Twelve"
   * or "President of the Quorum" during that period, not "First Presidency".
   */
  private classifyRole(calling: string): SpeakerRoleTag {
    if (!calling) return null;

    const lowerCalling = calling.toLowerCase();

    // First Presidency - must be specifically "The First Presidency" or "President of The Church"
    if (
      lowerCalling.includes('president of the church') ||
      lowerCalling.includes('the first presidency') ||
      // Counselors in THE First Presidency (not Primary, Young Women, etc.)
      ((lowerCalling.includes('first counselor') || lowerCalling.includes('second counselor')) &&
        lowerCalling.includes('first presidency'))
    ) {
      return 'first-presidency';
    }

    // Quorum of the Twelve (includes "President of the Quorum" during interregnum)
    if (
      lowerCalling.includes('quorum of the twelve') ||
      lowerCalling.includes('twelve apostles') ||
      lowerCalling.includes('acting president of the quorum') ||
      lowerCalling.includes('president of the quorum')
    ) {
      return 'quorum-of-the-twelve';
    }

    return null;
  }

  /**
   * Construct bio URL from speaker name
   */
  private constructBioUrl(name: string): string {
    // Convert "Jeffrey R. Holland" to "jeffrey-r-holland"
    const slug = name
      .toLowerCase()
      .replace(/[.]/g, '')
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');

    return `${BASE_URL}/learn/${slug}?lang=${LANGUAGES[this.config.language].urlParam}`;
  }

  /**
   * Extract slug from URL
   */
  private extractSlugFromUrl(url: string): string {
    if (!url) return '';

    // Remove query params
    const cleanUrl = url.split('?')[0];

    // Get the last path segment
    const parts = cleanUrl.split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
  }

  /**
   * Normalize URL to full URL with language param
   */
  private normalizeUrl(url: string, langCode: string): string {
    let fullUrl = url;

    // Add base URL if relative
    if (url.startsWith('/')) {
      fullUrl = `${BASE_URL}${url}`;
    }

    // Ensure language param
    if (!fullUrl.includes('lang=')) {
      fullUrl += fullUrl.includes('?') ? `&lang=${langCode}` : `?lang=${langCode}`;
    }

    return fullUrl;
  }

  /**
   * Fetch URL with rate limiting and caching
   */
  private async fetchWithRateLimit(url: string): Promise<string> {
    // Check cache first
    if (this.config.useCache) {
      const cached = await this.readFromCache(url);
      if (cached) {
        console.log(`  [cache] ${this.truncateUrl(url)}`);
        return cached;
      }
    }

    // Rate limit
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.config.rateLimitMs) {
      await this.sleep(this.config.rateLimitMs - timeSinceLastRequest);
    }

    console.log(`  [fetch] ${this.truncateUrl(url)}`);
    this.lastRequestTime = Date.now();

    const response = await fetchWithRetry(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    if (!response.ok) {
      // Permanent failure (non-retryable status): surface as before so
      // callers see the same error shape they always have.
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();

    // Cache the response
    if (this.config.useCache) {
      await this.writeToCache(url, html);
    }

    return html;
  }

  /**
   * Truncate URL for logging
   */
  private truncateUrl(url: string): string {
    const maxLen = 80;
    if (url.length <= maxLen) return url;
    return url.substring(0, maxLen - 3) + '...';
  }

  /**
   * Generate cache key from URL
   */
  private getCacheKey(url: string): string {
    // Create a filesystem-safe key
    const key = url
      .replace(/^https?:\/\//, '')
      .replace(/[^a-z0-9]/gi, '_')
      .substring(0, 150);
    return `${key}.html`;
  }

  /**
   * Read from cache.
   *
   * Applies the effective TTL (CACHE_TTL_DAYS env var, default 30 days). If
   * the cache file is older than the TTL it is treated as a miss so the caller
   * refetches fresh content. Every hit and miss is logged at debug level with
   * the URL and the measured cache age in days so operators can reason about
   * cache hygiene without grepping through network logs.
   */
  private async readFromCache(url: string): Promise<string | null> {
    if (!this.config.cacheDir) return null;

    try {
      const cacheFile = path.join(this.config.cacheDir, this.getCacheKey(url));
      const ttlDays = resolveCacheTtlDays();
      const ttlResult = await checkCacheTtl(cacheFile, ttlDays);

      if (ttlResult === null) {
        // File does not exist — this is a normal cold-cache miss; no log needed.
        return null;
      }

      const ageDaysRounded = Math.round(ttlResult.ageDays * 10) / 10;

      if (!ttlResult.hit) {
        log.debug('cache miss (expired)', { url, ageDays: ageDaysRounded, ttlDays });
        return null;
      }

      // File is fresh — read it.
      const content = await fs.readFile(cacheFile, 'utf-8');
      log.debug('cache hit', { url, ageDays: ageDaysRounded, ttlDays });
      return content;
    } catch {
      return null;
    }
  }

  /**
   * Write to cache
   */
  private async writeToCache(url: string, content: string): Promise<void> {
    if (!this.config.cacheDir) return;

    try {
      await fs.mkdir(this.config.cacheDir, { recursive: true });
      const cacheFile = path.join(this.config.cacheDir, this.getCacheKey(url));
      await fs.writeFile(cacheFile, content, 'utf-8');
    } catch (error) {
      // Silently ignore cache write errors (e.g., on Google Drive)
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Convenience function to scrape a conference
 */
export async function scrapeConference(
  year: number,
  month: 4 | 10,
  config: Partial<ScraperConfig> = {},
): Promise<Conference> {
  const scraper = new ConferenceScraper(config);
  return scraper.scrapeConference(year, month);
}

/**
 * Test-only export: exposes the three index-page parser strategies so smoke
 * tests can invoke each one directly against an HTML fixture. Not part of the
 * public API — do not rely on this from production code.
 */
export function __parsersForTesting(config: Partial<ScraperConfig> = {}) {
  const scraper = new ConferenceScraper(config) as unknown as {
    extractSessionsViaDocMap(html: string, langCode: string): Session[];
    extractSessionsViaDataContentType(html: string, langCode: string): Session[];
    extractSessionsViaClassNames(
      html: string,
      year: number,
      monthStr: string,
      langCode: string,
    ): Session[];
    extractSessionsWithCircuitBreaker(
      html: string,
      year: number,
      monthStr: string,
      langCode: string,
      url: string,
      httpStatus: number,
    ): Session[];
  };
  return {
    viaDocMap: (html: string, langCode = 'eng') => scraper.extractSessionsViaDocMap(html, langCode),
    viaDataContentType: (html: string, langCode = 'eng') =>
      scraper.extractSessionsViaDataContentType(html, langCode),
    viaClassNames: (html: string, year: number, monthStr: string, langCode = 'eng') =>
      scraper.extractSessionsViaClassNames(html, year, monthStr, langCode),
    withCircuitBreaker: (
      html: string,
      year: number,
      monthStr: string,
      langCode = 'eng',
      url = 'https://example.test/fixture',
      httpStatus = 200,
    ) => scraper.extractSessionsWithCircuitBreaker(html, year, monthStr, langCode, url, httpStatus),
  };
}
