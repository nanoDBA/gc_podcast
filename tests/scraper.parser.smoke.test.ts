/**
 * Smoke tests only — deeper parsing correctness tests belong to Phase 1
 * circuit-breaker work (gc_podcast-hll).
 *
 * One smoke test per parser strategy in src/scraper.ts. Each test loads an
 * HTML fixture that exercises the corresponding parser and asserts that at
 * least one session with at least one talk is returned.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { __parsersForTesting } from '../src/scraper.js';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf-8');
}

describe('scraper parser smoke tests', () => {
  const parsers = __parsersForTesting();

  it('doc-map parser extracts sessions and talks from 2026-04 API body', () => {
    const html = loadFixture('doc-map-2026-04.html');
    const sessions = parsers.viaDocMap(html);
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0].talks.length).toBeGreaterThan(0);
  });

  it('data-content-type parser extracts sessions and talks from 2018-04 index', () => {
    const html = loadFixture('data-content-type-2018-04.html');
    const sessions = parsers.viaDataContentType(html);
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0].talks.length).toBeGreaterThan(0);
  });

  it('class-based parser extracts sessions and talks from 2010-04 index', () => {
    const html = loadFixture('class-based-2010-04.html');
    const sessions = parsers.viaClassNames(html, 2010, '04');
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0].talks.length).toBeGreaterThan(0);
  });
});
