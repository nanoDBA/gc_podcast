/**
 * Tests for audio URL HEAD-check validation (gc_podcast-7fq).
 *
 * checkAudioUrl is tested with a mocked global fetch so no real network
 * requests are issued. The tests verify:
 *   - 404 response → invalid (entry should be dropped)
 *   - 200 + audio/mpeg → valid
 *   - 200 + text/html (error page) → invalid
 *   - Network error (TypeError) → valid (keep entry, transient failure)
 *   - 5xx response → invalid
 *   - isAudioValidationEnabled respects the env var
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
  checkAudioUrl,
  isAudioValidationEnabled,
  __retryTuning,
} from '../src/scraper.js';

const originalTuning = { ...__retryTuning };

function makeResponse(
  status: number,
  headers: Record<string, string> = {}
): Response {
  return new Response(null, { status, headers });
}

beforeEach(() => {
  // Shrink backoffs so retry-exhaustion tests stay fast.
  __retryTuning.backoffBaseMs = 1;
  __retryTuning.jitterMaxMs = 1;
  __retryTuning.maxRetries = 0; // only 1 attempt total for most tests
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  Object.assign(__retryTuning, originalTuning);
});

describe('checkAudioUrl', () => {
  it('returns valid=false for a 404 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(404)));
    const result = await checkAudioUrl('https://assets.example.test/talk.mp3');
    expect(result.valid).toBe(false);
    expect(result.status).toBe(404);
  });

  it('returns valid=true for a 200 response with audio/mpeg content-type', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeResponse(200, { 'content-type': 'audio/mpeg' }))
    );
    const result = await checkAudioUrl('https://assets.example.test/talk.mp3');
    expect(result.valid).toBe(true);
    expect(result.status).toBe(200);
    expect(result.contentType).toBe('audio/mpeg');
  });

  it('returns valid=false for a 200 response with text/html (error page)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeResponse(200, { 'content-type': 'text/html; charset=utf-8' }))
    );
    const result = await checkAudioUrl('https://assets.example.test/talk.mp3');
    expect(result.valid).toBe(false);
    expect(result.status).toBe(200);
  });

  it('returns valid=true with networkError set on fetch TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network failure')));
    const result = await checkAudioUrl('https://assets.example.test/talk.mp3');
    expect(result.valid).toBe(true);
    expect(result.networkError).toBeDefined();
    expect(result.networkError).toContain('Network failure');
  });

  it('returns valid=false for a 500 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(500)));
    const result = await checkAudioUrl('https://assets.example.test/talk.mp3');
    expect(result.valid).toBe(false);
    expect(result.status).toBe(500);
  });

  it('returns valid=true for a 200 with no content-type (binary response)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(200, {})));
    const result = await checkAudioUrl('https://assets.example.test/talk.mp3');
    expect(result.valid).toBe(true);
  });

  it('returns valid=false for 200 with application/json content-type', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeResponse(200, { 'content-type': 'application/json' }))
    );
    const result = await checkAudioUrl('https://assets.example.test/talk.mp3');
    expect(result.valid).toBe(false);
  });

  it('passes method=HEAD to fetch', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeResponse(200, { 'content-type': 'audio/mpeg' }));
    vi.stubGlobal('fetch', mockFetch);
    await checkAudioUrl('https://assets.example.test/talk.mp3');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://assets.example.test/talk.mp3',
      expect.objectContaining({ method: 'HEAD' })
    );
  });
});

describe('isAudioValidationEnabled', () => {
  it('returns false when VALIDATE_AUDIO_URLS is unset', () => {
    delete process.env.VALIDATE_AUDIO_URLS;
    expect(isAudioValidationEnabled()).toBe(false);
  });

  it('returns true when VALIDATE_AUDIO_URLS=1', () => {
    vi.stubEnv('VALIDATE_AUDIO_URLS', '1');
    expect(isAudioValidationEnabled()).toBe(true);
  });

  it('returns true when VALIDATE_AUDIO_URLS=true', () => {
    vi.stubEnv('VALIDATE_AUDIO_URLS', 'true');
    expect(isAudioValidationEnabled()).toBe(true);
  });

  it('returns false when VALIDATE_AUDIO_URLS=0', () => {
    vi.stubEnv('VALIDATE_AUDIO_URLS', '0');
    expect(isAudioValidationEnabled()).toBe(false);
  });

  it('returns false when VALIDATE_AUDIO_URLS=false', () => {
    vi.stubEnv('VALIDATE_AUDIO_URLS', 'false');
    expect(isAudioValidationEnabled()).toBe(false);
  });
});
