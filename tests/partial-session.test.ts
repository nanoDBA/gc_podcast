/**
 * Partial-session detection tests for gc_podcast-spr (Phase 2).
 *
 * `isIncomplete()` in src/scrape-all.ts is the gate that decides whether a
 * persisted conference JSON file should be trusted or re-scraped. Previously
 * it only checked for empty talks arrays; these tests pin down the expanded
 * detection surface:
 *   - missing session-level audio url
 *   - missing talk audio.url or audio.duration_ms
 *   - conferences below the 3-session hard floor
 *
 * Tests write synthetic ConferenceOutput objects to a temp file and call
 * isIncomplete() against them — no network, no real scraping.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isIncomplete } from '../src/scrape-all.js';
import { ConferenceOutput, Session, Talk } from '../src/types.js';

function makeTalk(overrides: Partial<Talk> = {}): Talk {
  return {
    title: 'Sample Talk',
    slug: 'sample',
    order: 1,
    url: 'https://example.com/talk',
    speaker: {
      name: 'Jane Speaker',
      role_tag: null,
    },
    audio: {
      url: 'https://example.com/talk.mp3',
      duration_ms: 600000,
    },
    duration_ms: 600000,
    ...overrides,
  };
}

function makeSession(idx: number, overrides: Partial<Session> = {}): Session {
  return {
    name: `Session ${idx}`,
    slug: `session-${idx}`,
    order: idx,
    url: `https://example.com/session-${idx}`,
    audio: {
      url: `https://example.com/session-${idx}.mp3`,
      duration_ms: 3_600_000,
    },
    duration_ms: 3_600_000,
    talks: [makeTalk({ order: 1, slug: `t${idx}-1` })],
    ...overrides,
  };
}

function makeOutput(sessions: Session[]): ConferenceOutput {
  return {
    scraped_at: new Date().toISOString(),
    version: '1.0',
    conference: {
      year: 2025,
      month: 10,
      name: 'October 2025 general conference',
      url: 'https://example.com/conf',
      language: 'eng',
      sessions,
    },
  };
}

let tmpDir: string;
let tmpFile: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'partial-session-'));
  tmpFile = path.join(tmpDir, 'conf.json');
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

function writeOutput(data: ConferenceOutput): void {
  fs.writeFileSync(tmpFile, JSON.stringify(data), 'utf-8');
}

describe('isIncomplete — partial session detection', () => {
  it('returns { incomplete: false, reasons: [] } for a complete 5-session conference', async () => {
    const sessions = [1, 2, 3, 4, 5].map(i => makeSession(i));
    writeOutput(makeOutput(sessions));
    const result = await isIncomplete(tmpFile);
    expect(result).toEqual({ incomplete: false, reasons: [] });
  });

  it('flags a conference where one session has an empty talks array', async () => {
    const sessions = [1, 2, 3, 4, 5].map(i => makeSession(i));
    sessions[2].talks = [];
    writeOutput(makeOutput(sessions));
    const result = await isIncomplete(tmpFile);
    expect(result.incomplete).toBe(true);
    // Reason must reference the session by index and/or name
    const reasonText = result.reasons.join(' | ');
    expect(reasonText).toMatch(/session\[2\]/);
    expect(reasonText).toMatch(/empty/i);
  });

  it('flags a conference where a talk is missing audio.url', async () => {
    const sessions = [1, 2, 3, 4, 5].map(i => makeSession(i));
    // Wipe the audio.url on the second talk of session 0 (add a 2nd talk first)
    sessions[0].talks.push(
      makeTalk({ order: 2, slug: 's1-t2', audio: { url: '', duration_ms: 500 } }),
    );
    writeOutput(makeOutput(sessions));
    const result = await isIncomplete(tmpFile);
    expect(result.incomplete).toBe(true);
    const reasonText = result.reasons.join(' | ');
    expect(reasonText).toMatch(/audio\.url/);
  });

  it('flags a conference where a talk is missing audio.duration_ms', async () => {
    const sessions = [1, 2, 3, 4, 5].map(i => makeSession(i));
    // Replace the talk in session 1 with one missing duration_ms
    sessions[1].talks = [
      makeTalk({
        order: 1,
        slug: 's2-t1',
        audio: { url: 'https://example.com/a.mp3' }, // no duration_ms
      }),
    ];
    writeOutput(makeOutput(sessions));
    const result = await isIncomplete(tmpFile);
    expect(result.incomplete).toBe(true);
    const reasonText = result.reasons.join(' | ');
    expect(reasonText).toMatch(/duration_ms/);
  });

  it('flags a conference with only 2 sessions (below the 3-session hard floor)', async () => {
    const sessions = [1, 2].map(i => makeSession(i));
    writeOutput(makeOutput(sessions));
    const result = await isIncomplete(tmpFile);
    expect(result.incomplete).toBe(true);
    const reasonText = result.reasons.join(' | ');
    expect(reasonText).toMatch(/2 session/);
    expect(reasonText).toMatch(/floor/i);
  });
});
