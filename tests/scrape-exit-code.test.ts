/**
 * Exit-code policy for scrape-all (gc_podcast-1gl).
 *
 * The workflow's retry loop and failure alert only fire on a non-zero exit,
 * but the English step is required, so a single failing OLD conference must
 * not block feed generation. Non-zero only when it matters: fatal error,
 * the newest conference in the run failed, or the parser circuit breaker
 * tripped (the Church site changed structure).
 */
import { describe, it, expect } from 'vitest';
import { scrapeExitCode, failureAnnotations } from '../src/scrape-all.js';

const NEWEST = 'gc-2026-10-eng';
const OLD = 'gc-2025-04-eng';
// October 2026 conference starts Saturday 2026-10-03 (00:00 UTC).
const newest = { key: NEWEST, startsAt: new Date('2026-10-03T00:00:00Z') };
const AFTER_START = new Date('2026-10-15T12:00:00Z');
const BEFORE_START = new Date('2026-10-02T23:59:59Z');

describe('scrapeExitCode', () => {
  it('returns 0 when nothing failed', () => {
    expect(scrapeExitCode({ failures: [], newest, fatal: false })).toBe(0);
  });

  it('returns 0 when only an older conference failed, with a warning annotation', () => {
    const outcome = {
      failures: [{ key: OLD, circuitBreaker: false, error: 'HTTP 503' }],
      newest,
      fatal: false,
    };
    expect(scrapeExitCode(outcome, AFTER_START)).toBe(0);
    const lines = failureAnnotations(outcome, AFTER_START);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^::warning::/);
    expect(lines[0]).toContain(OLD);
    expect(lines[0]).toContain('HTTP 503');
  });

  it('returns 1 when the newest conference failed', () => {
    const outcome = {
      failures: [{ key: NEWEST, circuitBreaker: false, error: 'timeout' }],
      newest,
      fatal: false,
    };
    expect(scrapeExitCode(outcome, AFTER_START)).toBe(1);
    expect(failureAnnotations(outcome, AFTER_START)[0]).toMatch(/^::error::.*gc-2026-10-eng/);
  });

  it('returns 0 with a warning when the newest conference fails before its Saturday', () => {
    const outcome = {
      failures: [{ key: NEWEST, circuitBreaker: false, error: 'not published' }],
      newest,
      fatal: false,
    };
    expect(scrapeExitCode(outcome, BEFORE_START)).toBe(0);
    expect(failureAnnotations(outcome, BEFORE_START)[0]).toMatch(
      /^::warning::gc-2026-10-eng: .*not started/,
    );
  });

  it('returns 1 for a newest-conference failure from its Saturday 00:00 UTC on', () => {
    const outcome = {
      failures: [{ key: NEWEST, circuitBreaker: false, error: 'timeout' }],
      newest,
      fatal: false,
    };
    expect(scrapeExitCode(outcome, newest.startsAt)).toBe(1);
  });

  it('returns 1 for a circuit breaker on the upcoming conference before its Saturday', () => {
    const outcome = {
      failures: [{ key: NEWEST, circuitBreaker: true, error: 'all parsers empty' }],
      newest,
      fatal: false,
    };
    expect(scrapeExitCode(outcome, BEFORE_START)).toBe(1);
  });

  it('returns 1 when the circuit breaker tripped, even on an older conference', () => {
    const outcome = {
      failures: [{ key: OLD, circuitBreaker: true, error: 'all parsers empty' }],
      newest,
      fatal: false,
    };
    expect(scrapeExitCode(outcome, AFTER_START)).toBe(1);
    expect(failureAnnotations(outcome, AFTER_START)[0]).toMatch(/^::error::.*circuit breaker/i);
  });

  it('returns 1 on a fatal error', () => {
    expect(scrapeExitCode({ failures: [], newest: null, fatal: true })).toBe(1);
  });

  it('escapes newlines and percent signs so one failure is one annotation line', () => {
    const [line] = failureAnnotations({
      failures: [{ key: OLD, circuitBreaker: false, error: '50% done\nthen died' }],
      newest,
      fatal: false,
    });
    expect(line).not.toContain('\n');
    expect(line).toContain('50%25 done%0Athen died');
  });
});
