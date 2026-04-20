/**
 * Tests for the RSS `<generator>` tag (gc_podcast-0xx) and schema-version
 * enforcement in loadConferences (gc_podcast-hjq).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { generateRssFeed, loadConferences } from '../src/rss-generator.js';
import { GENERATOR_STRING, PACKAGE_VERSION, PACKAGE_NAME } from '../src/version.js';
import { ConferenceOutput } from '../src/types.js';

function synthetic(): ConferenceOutput[] {
  return [
    {
      scraped_at: '2026-04-05T12:00:00Z',
      version: '1.0',
      conference: {
        year: 2026,
        month: 4,
        name: 'April 2026 General Conference',
        url: 'https://example.test/conf',
        language: 'eng',
        sessions: [
          {
            name: 'Saturday Morning Session',
            slug: 'saturday-morning-session',
            order: 1,
            url: 'https://example.test/conf/sat-am',
            talks: [
              {
                title: 'Synthetic Talk',
                slug: '01synthetic',
                order: 1,
                url: 'https://example.test/conf/sat-am/01',
                speaker: { name: 'Synthetic Speaker', role_tag: null },
                audio: {
                  url: 'https://example.test/audio/synthetic.mp3',
                  duration_ms: 600000,
                },
              },
            ],
          },
        ],
      },
    },
  ];
}

describe('version module', () => {
  it('exports a non-empty PACKAGE_VERSION', () => {
    expect(typeof PACKAGE_VERSION).toBe('string');
    expect(PACKAGE_VERSION.length).toBeGreaterThan(0);
  });

  it('exports a non-empty PACKAGE_NAME', () => {
    expect(typeof PACKAGE_NAME).toBe('string');
    expect(PACKAGE_NAME.length).toBeGreaterThan(0);
  });

  it('GENERATOR_STRING combines name and version', () => {
    expect(GENERATOR_STRING).toBe(`${PACKAGE_NAME}/${PACKAGE_VERSION}`);
  });
});

describe('RSS <generator> tag', () => {
  it('emits a <generator> tag with GENERATOR_STRING', () => {
    const feed = generateRssFeed(synthetic(), { feedBaseUrl: 'https://example.test' });
    expect(feed).toContain(`<generator>${GENERATOR_STRING}</generator>`);
  });

  it('escapes the generator string per XML rules', () => {
    const feed = generateRssFeed(synthetic(), { feedBaseUrl: 'https://example.test' });
    // Regardless of what characters happen to be in GENERATOR_STRING, the
    // output must not contain a raw unescaped ampersand or angle bracket
    // inside the tag (sanity check).
    const match = feed.match(/<generator>(.*?)<\/generator>/);
    expect(match).toBeTruthy();
    expect(match![1]).not.toMatch(/(?<!&[a-z]+);\?</);
  });

  it('places <generator> inside <channel>', () => {
    const feed = generateRssFeed(synthetic(), { feedBaseUrl: 'https://example.test' });
    const channelStart = feed.indexOf('<channel>');
    const channelEnd = feed.indexOf('</channel>');
    const genIdx = feed.indexOf('<generator>');
    expect(genIdx).toBeGreaterThan(channelStart);
    expect(genIdx).toBeLessThan(channelEnd);
  });
});

describe('loadConferences schema-version enforcement (gc_podcast-hjq)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-podcast-hjq-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('loads files whose version matches CURRENT_SCHEMA_VERSION', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'gc-2026-04-eng.json'),
      JSON.stringify(synthetic()[0]),
      'utf-8',
    );
    const loaded = await loadConferences(tmpDir, 'eng');
    expect(loaded).toHaveLength(1);
    expect(loaded[0].conference.year).toBe(2026);
  });

  it('skips files with a wrong version and no migration', async () => {
    const bad = { ...synthetic()[0], version: '99.0' };
    await fs.writeFile(path.join(tmpDir, 'gc-2026-04-eng.json'), JSON.stringify(bad), 'utf-8');
    const warn = console.warn;
    const warnings: string[] = [];
    console.warn = (msg: string) => warnings.push(msg);
    try {
      const loaded = await loadConferences(tmpDir, 'eng');
      expect(loaded).toHaveLength(0);
      expect(warnings.join('\n')).toMatch(/schema version mismatch|version/i);
    } finally {
      console.warn = warn;
    }
  });

  it('skips files with absent version field', async () => {
    const bad = synthetic()[0] as Partial<ConferenceOutput>;
    delete bad.version;
    await fs.writeFile(path.join(tmpDir, 'gc-2026-04-eng.json'), JSON.stringify(bad), 'utf-8');
    const warn = console.warn;
    console.warn = () => {};
    try {
      const loaded = await loadConferences(tmpDir, 'eng');
      expect(loaded).toHaveLength(0);
    } finally {
      console.warn = warn;
    }
  });

  it('loads valid files and skips invalid ones in the same directory', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'gc-2026-04-eng.json'),
      JSON.stringify(synthetic()[0]),
      'utf-8',
    );
    await fs.writeFile(
      path.join(tmpDir, 'gc-2025-10-eng.json'),
      JSON.stringify({ ...synthetic()[0], version: '0.5' }),
      'utf-8',
    );
    const warn = console.warn;
    console.warn = () => {};
    try {
      const loaded = await loadConferences(tmpDir, 'eng');
      expect(loaded).toHaveLength(1);
      expect(loaded[0].conference.year).toBe(2026);
    } finally {
      console.warn = warn;
    }
  });
});
