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
import { LANGUAGES } from './languages.js';
import { ApiResponseSchema, detectApiDrift } from './schemas.js';
import { log } from './logger.js';

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
        `(status=${params.httpStatus}, htmlLength=${params.htmlLength}, tried: ${parserSummary})`
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

  constructor(params: {
    url: string;
    attempts: number;
    lastStatus?: number;
    lastError?: string;
  }) {
    const tail =
      params.lastStatus !== undefined
        ? `HTTP ${params.lastStatus}`
        : (params.lastError ?? 'unknown error');
    super(
      `Fetch failed for ${params.url} after ${params.attempts} attempt(s): ${tail}`
    );
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
      if (
        typeof causeCode === 'string' &&
        RETRYABLE_ERROR_CODES.has(causeCode)
      ) {
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
 * Perform a single HTTP GET with exponential-backoff retry on transient
 * failures. Retries on HTTP 429 and 5xx (500/502/503/504) and on network
 * errors (TypeError from fetch, ECONNRESET/ETIMEDOUT, etc). Permanent 4xx
 * responses (404/410/etc) are NOT retried.
 *
 * On 429, honors a `Retry-After` header (seconds or HTTP-date) when present
 * and uses that instead of the computed backoff, ensuring we don't hammer a
 * server that's explicitly asking for a pause.
 *
 * Exhausting retries throws {@link FetchRetryExhaustedError} with full
 * context (url, attempts, lastStatus, lastError).
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit
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
  };
  content: {
    body: string;
  };
}

/**
 * Main scraper class
 */
export class ConferenceScraper {
  private config: ScraperConfig;
  private lastRequestTime = 0;

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
        200
      );
    }

    // Optionally fetch audio for each session and talk
    if (this.config.includeSessionAudio || this.config.includeTalkAudio) {
      await this.enrichWithAudio(sessions);
    }

    return {
      year,
      month,
      name: conferenceName,
      url: conferenceUrl,
      language: this.config.language,
      sessions,
    };
  }

  /**
   * API-first discovery: fetch conference index via the content API and parse
   * the body HTML. Returns null if the API call fails or yields no sessions.
   */
  private async discoverViaApi(
    year: number,
    monthStr: string,
    langCode: string
  ): Promise<{ name: string; sessions: Session[] } | null> {
    const uri = `/general-conference/${year}/${monthStr}`;
    const apiUrl = `${API_BASE}?lang=${langCode}&uri=${uri}`;

    try {
      const jsonStr = await this.fetchWithRateLimit(apiUrl);
      const apiResponse: ApiResponse = JSON.parse(jsonStr);

      // Runtime schema check + drift signals — warn but continue; HTML
      // fallback still kicks in downstream if the shape is unusable.
      reportApiDrift(apiUrl, apiResponse);

      const name = apiResponse.meta.title || `${monthStr === '04' ? 'April' : 'October'} ${year} General Conference`;
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
        200
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
    langCode: string
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
    langCode: string
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
    httpStatus: number
  ): Session[] {
    const { sessions, attempts, successParser } = this.runParsers(
      html,
      year,
      monthStr,
      langCode
    );

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
    const sessionHeaderPattern = /<h2\s+class="label"[^>]*>\s*<p\s+class="title"[^>]*>([^<]+)<\/p>/g;
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
        const talkLink = hrefs.find(h => !h.includes('session')) || hrefs[0] || '';
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
    langCode: string
  ): Session[] {
    const sessions: Session[] = [];
    const confPath = `/general-conference/${year}/${monthStr}/`;

    // Find all sectionTitle links that point to session pages
    const sectionPattern = /<a\s+class="sectionTitle[^"]*"\s+href="([^"]+)"[^>]*>[\s\S]*?<span>([^<]+)<\/span>/g;
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
      const nextSessionPos = i + 1 < sessionMatches.length ? sessionMatches[i + 1].position : html.length;
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
      const talkPattern = /<a\s+class="item[^"]*"\s+href="([^"]+)"[^>]*>[\s\S]*?<span>([^<]+)<\/span>(?:[\s\S]*?<p\s+class="subtitle[^"]*">([^<]+)<\/p>)?/g;
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
    const lines = textContent.split(/\s{2,}/).filter(l => l.length > 0);
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
   * Enrich sessions and talks with audio information
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

      // Fetch talk audio and speaker details if configured
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
          }
        }
      }
    }
  }

  /**
   * Extract audio and speaker data from a page using the API
   */
  private async extractPageData(url: string): Promise<{
    audio?: AudioAsset;
    speaker?: Speaker;
  }> {
    // Convert page URL to API URL
    // e.g., /study/general-conference/2025/10/12stevenson?lang=eng
    // becomes: /study/api/v3/language-pages/type/content?lang=eng&uri=/general-conference/2025/10/12stevenson
    const urlObj = new URL(url);
    const pathMatch = urlObj.pathname.match(/\/study(.+)/);
    if (!pathMatch) {
      // Fall back to HTML scraping if URL doesn't match expected pattern
      const html = await this.fetchWithRateLimit(url);
      return {
        audio: this.extractAudioFromHtml(html),
        speaker: this.extractSpeakerFromHtml(html),
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

      return { audio, speaker };
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
      return {
        audio: this.extractAudioFromHtml(html),
        speaker: this.extractSpeakerFromHtml(html),
      };
    }
  }

  /**
   * Extract audio information from API response
   */
  private extractAudioFromApi(apiResponse: ApiResponse): AudioAsset | undefined {
    // Get audio URL from meta.audio array
    const audioEntry = apiResponse.meta.audio?.find(a => a.variant === 'audio');
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
    const nameMatch = html.match(/<p[^>]*class\s*=\s*["'][^"']*author-name[^"']*["'][^>]*>([^<]+)/i);
    if (nameMatch) {
      name = nameMatch[1].trim();
      // Remove "By " prefix
      name = name.replace(/^By\s+/i, '');
    }

    // Extract from author-role class
    const roleMatch = html.match(/<p[^>]*class\s*=\s*["'][^"']*author-role[^"']*["'][^>]*>([^<]+)/i);
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
      'gi'
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
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
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
   * Read from cache
   */
  private async readFromCache(url: string): Promise<string | null> {
    if (!this.config.cacheDir) return null;

    try {
      const cacheFile = path.join(this.config.cacheDir, this.getCacheKey(url));
      const content = await fs.readFile(cacheFile, 'utf-8');
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
  config: Partial<ScraperConfig> = {}
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
      langCode: string
    ): Session[];
    extractSessionsWithCircuitBreaker(
      html: string,
      year: number,
      monthStr: string,
      langCode: string,
      url: string,
      httpStatus: number
    ): Session[];
  };
  return {
    viaDocMap: (html: string, langCode = 'eng') =>
      scraper.extractSessionsViaDocMap(html, langCode),
    viaDataContentType: (html: string, langCode = 'eng') =>
      scraper.extractSessionsViaDataContentType(html, langCode),
    viaClassNames: (
      html: string,
      year: number,
      monthStr: string,
      langCode = 'eng'
    ) => scraper.extractSessionsViaClassNames(html, year, monthStr, langCode),
    withCircuitBreaker: (
      html: string,
      year: number,
      monthStr: string,
      langCode = 'eng',
      url = 'https://example.test/fixture',
      httpStatus = 200
    ) =>
      scraper.extractSessionsWithCircuitBreaker(
        html,
        year,
        monthStr,
        langCode,
        url,
        httpStatus
      ),
  };
}
