/**
 * Schema drift detection tests.
 *
 * Exercises detectApiDrift against the ApiResponseSchema to ensure:
 *   - a clean, expected shape reports no drift
 *   - an extra top-level field still parses (zod strips) but is surfaced
 *     via unknownKeys so operators see the drift signal
 *   - a structurally wrong payload fails safeParse and reports issues
 */
import { describe, it, expect } from 'vitest';
import { ApiResponseSchema, IGNORED_API_KEYS, detectApiDrift } from '../src/schemas.js';

const MINIMAL_VALID = () => ({
  meta: {
    title: 'Saturday Morning Session',
    audio: [{ mediaUrl: 'https://example.com/a.mp3', variant: 'audio' }],
  },
  content: {
    body: '<html></html>',
  },
});

describe('detectApiDrift', () => {
  it('known shape with no extras reports zero drift signals', () => {
    const report = detectApiDrift(MINIMAL_VALID(), ApiResponseSchema);
    expect(report.ok).toBe(true);
    expect(report.unknownKeys).toHaveLength(0);
    expect(report.softSignals).toHaveLength(0);
    expect(report.issues).toHaveLength(0);
    expect(report.data).toBeDefined();
  });

  it('flags unknown top-level AND unknown meta keys when upstream adds fields', () => {
    const raw = MINIMAL_VALID() as Record<string, unknown>;
    raw.newTopLevelField = 'hello';
    (raw.meta as Record<string, unknown>).newMetaField = { anything: true };

    const report = detectApiDrift(raw, ApiResponseSchema);
    expect(report.ok).toBe(true);
    expect(report.unknownKeys).toContain('newTopLevelField');
    expect(report.unknownKeys).toContain('meta.newMetaField');
  });

  it('does not flag the fields the live API already sends but we never read', () => {
    // gc_podcast drift-baseline: these keys arrived on every response as of
    // 2026-10-03, so warning on them every run buried any real drift signal.
    const raw = MINIMAL_VALID() as Record<string, unknown>;
    for (const key of IGNORED_API_KEYS) {
      const [head, tail] = key.split('.');
      if (tail) (raw[head] as Record<string, unknown>)[tail] = 'x';
      else raw[head] = 'x';
    }
    const report = detectApiDrift(raw, ApiResponseSchema);
    expect(report.unknownKeys).toEqual([]);
  });

  it('completely wrong shape fails safeParse and reports zod issues', () => {
    const wrong = { not: 'even', close: 'to the shape' };
    const report = detectApiDrift(wrong, ApiResponseSchema);
    expect(report.ok).toBe(false);
    expect(report.issues.length).toBeGreaterThan(0);
    expect(report.data).toBeUndefined();
  });
});
