/**
 * Tests for cache TTL enforcement (gc_podcast-6te).
 *
 * checkCacheTtl is a pure async helper that stats a file and compares its
 * mtime to the configured TTL in days. We test it by creating real temporary
 * files and manipulating their mtime via utimes.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  checkCacheTtl,
  resolveCacheTtlDays,
  DEFAULT_CACHE_TTL_DAYS,
} from '../src/scraper.js';

// We write real temp files so utimes actually works across platforms.
let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-cache-ttl-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

async function writeCacheFile(name: string, ageDays: number): Promise<string> {
  const filePath = path.join(tmpDir, name);
  await fs.writeFile(filePath, 'cached-content', 'utf-8');
  // Set mtime to ageDays ago.
  const mtimeMs = Date.now() - ageDays * 24 * 60 * 60 * 1000;
  const mtime = new Date(mtimeMs);
  await fs.utimes(filePath, mtime, mtime);
  return filePath;
}

describe('checkCacheTtl', () => {
  it('returns null when the file does not exist', async () => {
    const result = await checkCacheTtl(path.join(tmpDir, 'nonexistent.html'), 30);
    expect(result).toBeNull();
  });

  it('returns hit=false (miss) when cache entry is older than TTL', async () => {
    // File mtime is 60 days ago; TTL is 30 days → expired.
    const filePath = await writeCacheFile('old.html', 60);
    const result = await checkCacheTtl(filePath, 30);
    expect(result).not.toBeNull();
    expect(result!.hit).toBe(false);
    expect(result!.ageDays).toBeGreaterThan(59); // at least 59 days old
  });

  it('returns hit=true when cache entry is within TTL', async () => {
    // File mtime is 5 minutes ago; TTL is 30 days → fresh.
    const filePath = await writeCacheFile('fresh.html', 5 / (24 * 60)); // 5 minutes
    const result = await checkCacheTtl(filePath, 30);
    expect(result).not.toBeNull();
    expect(result!.hit).toBe(true);
    expect(result!.ageDays).toBeLessThan(1);
  });

  it('returns hit=true when TTL is 0 (disabled) even for ancient files', async () => {
    // TTL=0 means no expiry — any cached file is a hit regardless of age.
    const filePath = await writeCacheFile('ancient.html', 3650); // ~10 years
    const result = await checkCacheTtl(filePath, 0);
    expect(result).not.toBeNull();
    expect(result!.hit).toBe(true);
  });

  it('returns hit=false when file is exactly at the TTL boundary (strictly older)', async () => {
    // 30.001 days old with a 30-day TTL should be a miss.
    const filePath = await writeCacheFile('boundary.html', 30.001);
    const result = await checkCacheTtl(filePath, 30);
    expect(result).not.toBeNull();
    expect(result!.hit).toBe(false);
  });
});

describe('resolveCacheTtlDays', () => {
  it('returns DEFAULT_CACHE_TTL_DAYS when env var is unset', () => {
    vi.unstubAllEnvs();
    delete process.env.CACHE_TTL_DAYS;
    expect(resolveCacheTtlDays()).toBe(DEFAULT_CACHE_TTL_DAYS);
  });

  it('returns the numeric value from CACHE_TTL_DAYS when set', () => {
    vi.stubEnv('CACHE_TTL_DAYS', '7');
    expect(resolveCacheTtlDays()).toBe(7);
  });

  it('falls back to default for non-numeric CACHE_TTL_DAYS', () => {
    vi.stubEnv('CACHE_TTL_DAYS', 'never');
    expect(resolveCacheTtlDays()).toBe(DEFAULT_CACHE_TTL_DAYS);
  });

  it('falls back to default for negative CACHE_TTL_DAYS', () => {
    vi.stubEnv('CACHE_TTL_DAYS', '-5');
    expect(resolveCacheTtlDays()).toBe(DEFAULT_CACHE_TTL_DAYS);
  });

  it('returns 0 when CACHE_TTL_DAYS=0 (disables TTL)', () => {
    vi.stubEnv('CACHE_TTL_DAYS', '0');
    expect(resolveCacheTtlDays()).toBe(0);
  });
});
