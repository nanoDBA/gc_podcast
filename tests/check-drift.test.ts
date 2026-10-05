import { describe, it, expect } from 'vitest';
import {
  compareConferences,
  audioUrlShape,
  isCompleteConference,
  conferenceCandidates,
} from '../src/check-drift.js';
import type { Conference, Talk } from '../src/types.js';

const HASH = 'a'.repeat(40);

function talk(slug: string, over: Partial<Talk> = {}): Talk {
  return {
    title: slug,
    slug,
    order: 1,
    url: `https://example.org/${slug}`,
    speaker: { name: 'X', role_tag: null },
    audio: { url: `https://assets.churchofjesuschrist.org/${HASH}-128k-en.mp3`, duration_ms: 1000 },
    image_url: 'https://example.org/img/a/full/1500,/0/default.jpg',
    ...over,
  };
}

function conf(talksPerSession: string[][]): Conference {
  return {
    year: 2026,
    month: 4,
    name: 'c',
    url: 'u',
    language: 'eng',
    sessions: talksPerSession.map((slugs, i) => ({
      name: `S${i}`,
      slug: `s${i}`,
      order: i + 1,
      url: 'u',
      audio: { url: 'a' },
      talks: slugs.map((s) => talk(s)),
    })),
  };
}

const base = () => conf([['a', 'b'], ['c'], ['d']]);

describe('compareConferences', () => {
  it('passes on identical data', () => {
    const r = compareConferences(base(), base());
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('fails when a talk is dropped', () => {
    const r = compareConferences(base(), conf([['a', 'b'], ['c'], []]));
    expect(r.ok).toBe(false);
    expect(r.failures.join('\n')).toMatch(/talk count dropped/);
    expect(r.failures.join('\n')).toMatch(/talk missing.*: d/);
  });

  it('fails when a session is dropped', () => {
    const r = compareConferences(base(), conf([['a', 'b'], ['c']]));
    expect(r.failures.join('\n')).toMatch(/session count dropped/);
  });

  it('fails when a talk loses audio', () => {
    const live = base();
    live.sessions[0].talks[0].audio = undefined;
    const r = compareConferences(base(), live);
    expect(r.ok).toBe(false);
    expect(r.failures).toContain('talk lost audio.url: a');
  });

  it('fails when duration goes missing', () => {
    const live = base();
    live.sessions[0].talks[1].audio = { url: live.sessions[0].talks[1].audio!.url };
    const r = compareConferences(base(), live);
    expect(r.ok).toBe(false);
    expect(r.failures).toContain('talk lost duration: b');
  });

  it('fails when audio host changes for many talks', () => {
    const live = base();
    for (const s of live.sessions)
      for (const t of s.talks) t.audio!.url = `https://cdn.other.example/${HASH}-128k-en.mp3`;
    const r = compareConferences(base(), live);
    expect(r.ok).toBe(false);
    expect(r.failures.join('\n')).toMatch(/host\/shape changed/);
  });

  it('ignores a new hash with the same shape', () => {
    const live = base();
    live.sessions[0].talks[0].audio!.url = `https://assets.churchofjesuschrist.org/${'b'.repeat(40)}-128k-en.mp3`;
    expect(compareConferences(base(), live).ok).toBe(true);
  });

  it('matches reordered talks by slug', () => {
    const r = compareConferences(base(), conf([['d'], ['c', 'b'], ['a']]));
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it('only warns on image changes', () => {
    const live = base();
    live.sessions[0].talks[0].image_url = 'https://example.org/img/new/full/1500,/0/default.jpg';
    const r = compareConferences(base(), live);
    expect(r.ok).toBe(true);
    expect(r.warnings).toHaveLength(1);
    expect(r.stats.imageChanged).toBe(1);
  });
});

describe('helpers', () => {
  it('audioUrlShape collapses hashes', () => {
    expect(audioUrlShape(`https://h.example/${HASH}-128k-en.mp3`)).toBe('h.example/H-128k-en.mp3');
    expect(audioUrlShape('not a url')).toBe('invalid');
  });

  it('isCompleteConference rejects stubs and audio-less conferences', () => {
    expect(isCompleteConference(base())).toBe(true);
    expect(isCompleteConference(conf([[], [], [], []]))).toBe(false);
    const noAudio = base();
    noAudio.sessions[0].talks[0].audio = undefined;
    expect(isCompleteConference(noAudio)).toBe(false);
  });

  it('conferenceCandidates lists one language newest first', () => {
    const files = [
      'gc-2025-10-eng.json',
      'gc-2026-10-eng.json',
      'gc-2026-04-eng.json',
      'gc-2026-10-spa.json',
      'index.json',
    ];
    expect(conferenceCandidates(files, 'eng')).toEqual([
      { year: 2026, month: 10 },
      { year: 2026, month: 4 },
      { year: 2025, month: 10 },
    ]);
  });
});
