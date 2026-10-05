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

describe('scrapeExitCode', () => {
  it('returns 0 when nothing failed', () => {
    expect(scrapeExitCode({ failures: [], newestKey: NEWEST, fatal: false })).toBe(0);
  });

  it('returns 0 when only an older conference failed, with a warning annotation', () => {
    const outcome = {
      failures: [{ key: OLD, circuitBreaker: false, error: 'HTTP 503' }],
      newestKey: NEWEST,
      fatal: false,
    };
    expect(scrapeExitCode(outcome)).toBe(0);
    const lines = failureAnnotations(outcome);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^::warning::/);
    expect(lines[0]).toContain(OLD);
    expect(lines[0]).toContain('HTTP 503');
  });

  it('returns 1 when the newest conference failed', () => {
    const outcome = {
      failures: [{ key: NEWEST, circuitBreaker: false, error: 'timeout' }],
      newestKey: NEWEST,
      fatal: false,
    };
    expect(scrapeExitCode(outcome)).toBe(1);
    expect(failureAnnotations(outcome)[0]).toMatch(/^::error::.*gc-2026-10-eng/);
  });

  it('returns 1 when the circuit breaker tripped, even on an older conference', () => {
    const outcome = {
      failures: [{ key: OLD, circuitBreaker: true, error: 'all parsers empty' }],
      newestKey: NEWEST,
      fatal: false,
    };
    expect(scrapeExitCode(outcome)).toBe(1);
    expect(failureAnnotations(outcome)[0]).toMatch(/^::error::.*circuit breaker/i);
  });

  it('returns 1 on a fatal error', () => {
    expect(scrapeExitCode({ failures: [], newestKey: null, fatal: true })).toBe(1);
  });

  it('escapes newlines and percent signs so one failure is one annotation line', () => {
    const [line] = failureAnnotations({
      failures: [{ key: OLD, circuitBreaker: false, error: '50% done\nthen died' }],
      newestKey: NEWEST,
      fatal: false,
    });
    expect(line).not.toContain('\n');
    expect(line).toContain('50%25 done%0Athen died');
  });
});
