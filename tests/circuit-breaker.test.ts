/**
 * Circuit-breaker tests for gc_podcast-hll (Phase 1: Fail loud when all parser
 * fallbacks return empty sessions).
 *
 * These tests exercise the orchestrator that runs the three parser strategies
 * in src/scraper.ts. They assert:
 *   1. A large-but-broken conference page trips ParserCircuitBreakerError
 *      and attaches the full diagnostic context we need to triage upstream
 *      markup changes.
 *   2. A small / 404-like body does NOT trip the breaker — that is an
 *      expected non-match, not a contract break, and the orchestrator must
 *      stay quiet so we do not mask legitimate fetch failures.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  __parsersForTesting,
  ParserCircuitBreakerError,
  MIN_PARSEABLE_HTML_BYTES,
} from '../src/scraper.js';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf-8');
}

describe('parser circuit breaker', () => {
  const parsers = __parsersForTesting();

  it('throws ParserCircuitBreakerError with full context when a large conference page matches no parser', () => {
    const html = loadFixture('broken-modern.html');
    // Sanity: the fixture must be above the threshold, otherwise we're
    // testing the wrong branch.
    expect(html.length).toBeGreaterThanOrEqual(MIN_PARSEABLE_HTML_BYTES);

    let caught: unknown = null;
    try {
      parsers.withCircuitBreaker(
        html,
        2026,
        '04',
        'eng',
        'https://www.churchofjesuschrist.org/study/general-conference/2026/04?lang=eng',
        200
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ParserCircuitBreakerError);
    const err = caught as ParserCircuitBreakerError;
    expect(err.url).toContain('/general-conference/2026/04');
    expect(err.httpStatus).toBe(200);
    expect(err.htmlLength).toBe(html.length);
    // All three parsers must have been attempted and recorded as 0 sessions.
    const names = err.parsersTried.map((p) => p.parser).sort();
    expect(names).toEqual(['class-names', 'data-content-type', 'doc-map']);
    expect(err.parsersTried.every((p) => p.sessionCount === 0)).toBe(true);
    // Message should carry enough context to grep logs with.
    expect(err.message).toContain('circuit breaker');
    expect(err.message).toContain('doc-map=0');
  });

  it('does NOT throw the circuit-breaker error for a tiny 404-like body', () => {
    // Well under MIN_PARSEABLE_HTML_BYTES — this simulates a 404 page, an
    // unreleased conference stub, or a redirect landing page.
    const tinyHtml = '<html><body><h1>Not Found</h1></body></html>';
    expect(tinyHtml.length).toBeLessThan(MIN_PARSEABLE_HTML_BYTES);

    const result = parsers.withCircuitBreaker(
      tinyHtml,
      2099,
      '04',
      'eng',
      'https://www.churchofjesuschrist.org/study/general-conference/2099/04?lang=eng',
      404
    );

    // Expected non-match — returns empty, must not throw.
    expect(result).toEqual([]);
  });

  it('returns sessions without throwing when at least one parser succeeds', () => {
    // Regression guard: the breaker must stay out of the way on healthy input.
    const html = loadFixture('doc-map-2026-04.html');
    const result = parsers.withCircuitBreaker(
      html,
      2026,
      '04',
      'eng',
      'https://www.churchofjesuschrist.org/study/general-conference/2026/04?lang=eng',
      200
    );
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].talks.length).toBeGreaterThan(0);
  });
});
