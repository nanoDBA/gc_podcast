/**
 * Exponential-backoff retry tests for gc_podcast-hzb.
 *
 * Verifies fetchWithRetry:
 *   - Retries on transient 5xx up to the configured budget.
 *   - Surfaces FetchRetryExhaustedError with full context when the budget
 *     is blown.
 *   - Does NOT retry permanent 4xx (404/410/etc) — those are returned
 *     straight to the caller so higher layers can decide what to do.
 *   - Honors Retry-After on 429 when present.
 *
 * Backoff is shrunk via __retryTuning so the full suite stays sub-second
 * even with multiple retry rounds.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchWithRetry, FetchRetryExhaustedError, __retryTuning } from '../src/scraper.js';

const originalTuning = { ...__retryTuning };

function makeResponse(status: number, body = '', headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

beforeEach(() => {
  // Shrink backoffs so the suite stays fast. Leave jitter tiny but nonzero
  // so we still exercise the jitter path.
  __retryTuning.backoffBaseMs = 5;
  __retryTuning.jitterMaxMs = 5;
  __retryTuning.maxRetries = 3;
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(__retryTuning, originalTuning);
});

describe('fetchWithRetry', () => {
  it('returns a 200 after two 503 responses (within budget)', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(503))
      .mockResolvedValueOnce(makeResponse(503))
      .mockResolvedValueOnce(makeResponse(200, 'ok'));
    vi.stubGlobal('fetch', mock);

    const res = await fetchWithRetry('https://example.test/a');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it('returns a 200 after three 503 responses (exactly at budget: 4 attempts total)', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(503))
      .mockResolvedValueOnce(makeResponse(503))
      .mockResolvedValueOnce(makeResponse(503))
      .mockResolvedValueOnce(makeResponse(200, 'finally'));
    vi.stubGlobal('fetch', mock);

    const res = await fetchWithRetry('https://example.test/b');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('finally');
    expect(mock).toHaveBeenCalledTimes(4);
  });

  it('throws FetchRetryExhaustedError after four consecutive 503s (budget exceeded)', async () => {
    const mock = vi.fn().mockResolvedValue(makeResponse(503));
    vi.stubGlobal('fetch', mock);

    let caught: unknown = null;
    try {
      await fetchWithRetry('https://example.test/c');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(FetchRetryExhaustedError);
    const err = caught as FetchRetryExhaustedError;
    expect(err.url).toBe('https://example.test/c');
    expect(err.attempts).toBe(4);
    expect(err.lastStatus).toBe(503);
    expect(mock).toHaveBeenCalledTimes(4);
  });

  it('returns 404 immediately without retrying (permanent error)', async () => {
    const mock = vi.fn().mockResolvedValue(makeResponse(404, 'nope'));
    vi.stubGlobal('fetch', mock);

    const res = await fetchWithRetry('https://example.test/d');
    expect(res.status).toBe(404);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('honors Retry-After on 429 (short value so test stays fast)', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(429, '', { 'retry-after': '0.05' }))
      .mockResolvedValueOnce(makeResponse(200, 'ok'));
    vi.stubGlobal('fetch', mock);

    const started = Date.now();
    const res = await fetchWithRetry('https://example.test/e');
    const elapsed = Date.now() - started;

    expect(res.status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(2);
    // Retry-After was 50ms. Allow generous margin; just assert we didn't
    // instantly retry (which would mean we ignored the header).
    expect(elapsed).toBeGreaterThanOrEqual(40);
    // And that we didn't wait an absurd amount either.
    expect(elapsed).toBeLessThan(2000);
  });
});
