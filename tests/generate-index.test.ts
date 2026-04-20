/**
 * Tests for generate-index.ts
 *
 * Validates that the HTML index generation:
 * - Produces valid HTML structure
 * - Includes all language feed URLs
 * - Contains recent conference information
 * - Includes subscribe buttons for all platforms
 * - Last-updated timestamp is present
 * - Language display names from LANGUAGES config are used
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { LANGUAGES, LANGUAGE_CODES } from '../src/languages.js';

describe('generate-index.ts', () => {
  // Get the project root by resolving from the test directory.
  // Use fileURLToPath to correctly convert file:// URLs on Windows (avoids /C:/... -> C:\C:\... bug).
  const testFileDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(testFileDir, '..');
  const tempOutputDir = path.join(projectRoot, 'tests', '_temp');

  beforeEach(() => {
    // Create temp directory
    if (!fs.existsSync(tempOutputDir)) {
      fs.mkdirSync(tempOutputDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up temp directory
    if (fs.existsSync(tempOutputDir)) {
      fs.rmSync(tempOutputDir, { recursive: true, force: true });
    }
  });

  it('generates valid HTML structure', () => {
    // Create test fixture data
    const fixtureConf = {
      scraped_at: '2026-04-20T00:00:00.000Z',
      version: '1.0',
      conference: {
        year: 2026,
        month: 4,
        name: 'April 2026 general conference',
        url: 'https://www.churchofjesuschrist.org/study/general-conference/2026/04?lang=eng',
        language: 'eng',
        sessions: [
          {
            name: 'Saturday Morning Session',
            slug: 'saturday-morning-session',
            order: 1,
            url: 'https://www.churchofjesuschrist.org/study/general-conference/2026/04/saturday-morning-session?lang=eng',
            talks: [
              {
                title: 'Test Talk',
                slug: '11test',
                order: 1,
                url: 'https://www.churchofjesuschrist.org/study/general-conference/2026/04/11test?lang=eng',
                speaker: {
                  name: 'Test Speaker',
                  role_tag: null,
                  calling: 'Test Role',
                },
              },
            ],
          },
        ],
      },
    };

    const outputDir = path.join(tempOutputDir, 'output');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'gc-2026-04-eng.json'), JSON.stringify(fixtureConf));

    const indexPath = path.join(tempOutputDir, 'index.html');

    // Run generate-index
    execSync(`npx tsx src/generate-index.ts --output "${outputDir}" --index "${indexPath}"`, {
      cwd: projectRoot,
    });

    // Verify file was created
    expect(fs.existsSync(indexPath)).toBe(true);

    const html = fs.readFileSync(indexPath, 'utf-8');

    // Basic HTML structure
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('</html>');
    expect(html).toContain('<head>');
    expect(html).toContain('</head>');
    expect(html).toContain('<body>');
    expect(html).toContain('</body>');
  });

  it('includes all language feed URLs', () => {
    const fixtureConf = {
      scraped_at: '2026-04-20T00:00:00.000Z',
      version: '1.0',
      conference: {
        year: 2026,
        month: 4,
        name: 'April 2026 general conference',
        url: 'https://www.churchofjesuschrist.org/study/general-conference/2026/04?lang=eng',
        language: 'eng',
        sessions: [],
      },
    };

    const outputDir = path.join(tempOutputDir, 'output');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'gc-2026-04-eng.json'), JSON.stringify(fixtureConf));

    const indexPath = path.join(tempOutputDir, 'index.html');

    execSync(`npx tsx src/generate-index.ts --output "${outputDir}" --index "${indexPath}"`, {
      cwd: projectRoot,
    });

    const html = fs.readFileSync(indexPath, 'utf-8');

    // Check all language display names
    for (const lang of LANGUAGE_CODES) {
      const displayName = LANGUAGES[lang].displayName;
      expect(html).toContain(displayName);
    }

    // Check feed URLs
    expect(html).toContain('audio.xml');
    expect(html).toContain('audio-es.xml');
    expect(html).toContain('audio-pt.xml');
  });

  it('includes recent conference information', () => {
    const confs = [
      {
        year: 2026,
        month: 4,
        sessions: [
          { name: 'Sat Morning', slug: 'sat-morning', order: 1, talks: [] },
          { name: 'Sat Afternoon', slug: 'sat-afternoon', order: 2, talks: [] },
          { name: 'Sun Morning', slug: 'sun-morning', order: 3, talks: [] },
          { name: 'Sun Afternoon', slug: 'sun-afternoon', order: 4, talks: [] },
        ],
      },
      {
        year: 2025,
        month: 10,
        sessions: [
          { name: 'Sat Morning', slug: 'sat-morning', order: 1, talks: [] },
          { name: 'Sat Afternoon', slug: 'sat-afternoon', order: 2, talks: [] },
          { name: 'Sat Evening', slug: 'sat-evening', order: 3, talks: [] },
          { name: 'Sun Morning', slug: 'sun-morning', order: 4, talks: [] },
          { name: 'Sun Afternoon', slug: 'sun-afternoon', order: 5, talks: [] },
        ],
      },
    ];

    const outputDir = path.join(tempOutputDir, 'output');
    fs.mkdirSync(outputDir, { recursive: true });

    for (const conf of confs) {
      const fixture = {
        scraped_at: '2026-04-20T00:00:00.000Z',
        version: '1.0',
        conference: {
          year: conf.year,
          month: conf.month,
          name: `${conf.month === 4 ? 'April' : 'October'} ${conf.year} general conference`,
          url: `https://www.churchofjesuschrist.org/study/general-conference/${conf.year}/${String(conf.month).padStart(2, '0')}?lang=eng`,
          language: 'eng',
          sessions: conf.sessions,
        },
      };

      fs.writeFileSync(
        path.join(outputDir, `gc-${conf.year}-${String(conf.month).padStart(2, '0')}-eng.json`),
        JSON.stringify(fixture),
      );
    }

    const indexPath = path.join(tempOutputDir, 'index.html');

    execSync(`npx tsx src/generate-index.ts --output "${outputDir}" --index "${indexPath}"`, {
      cwd: projectRoot,
    });

    const html = fs.readFileSync(indexPath, 'utf-8');

    // Check for conference years
    expect(html).toContain('2026');
    expect(html).toContain('2025');

    // Check for session counts
    expect(html).toContain('4 sessions');
    expect(html).toContain('5 sessions');

    // Check for month names
    expect(html).toContain('April');
    expect(html).toContain('October');
  });

  it('includes subscribe buttons for all platforms', () => {
    const fixtureConf = {
      scraped_at: '2026-04-20T00:00:00.000Z',
      version: '1.0',
      conference: {
        year: 2026,
        month: 4,
        name: 'April 2026 general conference',
        url: 'https://www.churchofjesuschrist.org/study/general-conference/2026/04?lang=eng',
        language: 'eng',
        sessions: [],
      },
    };

    const outputDir = path.join(tempOutputDir, 'output');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'gc-2026-04-eng.json'), JSON.stringify(fixtureConf));

    const indexPath = path.join(tempOutputDir, 'index.html');

    execSync(`npx tsx src/generate-index.ts --output "${outputDir}" --index "${indexPath}"`, {
      cwd: projectRoot,
    });

    const html = fs.readFileSync(indexPath, 'utf-8');

    // Check for subscribe buttons
    expect(html).toContain('Apple Podcasts');
    expect(html).toContain('Overcast');
    expect(html).toContain('Pocket Casts');
    expect(html).toContain('Castro');
    expect(html).toContain('id="appleLink"');
    expect(html).toContain('id="overcastLink"');
    expect(html).toContain('id="pocketcastsLink"');
    expect(html).toContain('id="castroLink"');
    expect(html).toContain('id="rssLink"');
  });

  it('includes last-updated timestamp', () => {
    const fixtureConf = {
      scraped_at: '2026-04-20T00:00:00.000Z',
      version: '1.0',
      conference: {
        year: 2026,
        month: 4,
        name: 'April 2026 general conference',
        url: 'https://www.churchofjesuschrist.org/study/general-conference/2026/04?lang=eng',
        language: 'eng',
        sessions: [],
      },
    };

    const outputDir = path.join(tempOutputDir, 'output');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'gc-2026-04-eng.json'), JSON.stringify(fixtureConf));

    const indexPath = path.join(tempOutputDir, 'index.html');

    execSync(`npx tsx src/generate-index.ts --output "${outputDir}" --index "${indexPath}"`, {
      cwd: projectRoot,
    });

    const html = fs.readFileSync(indexPath, 'utf-8');

    // Check for timestamp
    expect(html).toContain('Last updated:');
    expect(html).toContain('UTC');
    expect(html).toContain('id="lastUpdated"');
  });

  it('uses language config for display names', () => {
    const fixtureConf = {
      scraped_at: '2026-04-20T00:00:00.000Z',
      version: '1.0',
      conference: {
        year: 2026,
        month: 4,
        name: 'April 2026 general conference',
        url: 'https://www.churchofjesuschrist.org/study/general-conference/2026/04?lang=eng',
        language: 'eng',
        sessions: [],
      },
    };

    const outputDir = path.join(tempOutputDir, 'output');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'gc-2026-04-eng.json'), JSON.stringify(fixtureConf));

    const indexPath = path.join(tempOutputDir, 'index.html');

    execSync(`npx tsx src/generate-index.ts --output "${outputDir}" --index "${indexPath}"`, {
      cwd: projectRoot,
    });

    const html = fs.readFileSync(indexPath, 'utf-8');

    // Verify language display names are from LANGUAGES config
    expect(html).toContain(LANGUAGES.eng.displayName);
    expect(html).toContain(LANGUAGES.spa.displayName);
    expect(html).toContain(LANGUAGES.por.displayName);

    // Should NOT have hardcoded language names not in config
    expect(html).not.toContain('French');
    expect(html).not.toContain('German');
  });

  it('handles empty output directory gracefully', () => {
    const outputDir = path.join(tempOutputDir, 'empty-output');
    fs.mkdirSync(outputDir, { recursive: true });

    const indexPath = path.join(tempOutputDir, 'index.html');

    // Should not fail with empty directory
    execSync(`npx tsx src/generate-index.ts --output "${outputDir}" --index "${indexPath}"`, {
      cwd: projectRoot,
    });

    expect(fs.existsSync(indexPath)).toBe(true);

    const html = fs.readFileSync(indexPath, 'utf-8');

    // Should still have structure even with no conferences
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('General Conference Podcast');
    expect(html).toContain('Recent Conferences');
  });

  it('creates output directory if it does not exist', () => {
    const fixtureConf = {
      scraped_at: '2026-04-20T00:00:00.000Z',
      version: '1.0',
      conference: {
        year: 2026,
        month: 4,
        name: 'April 2026 general conference',
        url: 'https://www.churchofjesuschrist.org/study/general-conference/2026/04?lang=eng',
        language: 'eng',
        sessions: [],
      },
    };

    const outputDir = path.join(tempOutputDir, 'output');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'gc-2026-04-eng.json'), JSON.stringify(fixtureConf));

    const indexDir = path.join(tempOutputDir, 'new-docs-dir');
    const indexPath = path.join(indexDir, 'index.html');

    // index directory doesn't exist yet
    expect(fs.existsSync(indexDir)).toBe(false);

    execSync(`npx tsx src/generate-index.ts --output "${outputDir}" --index "${indexPath}"`, {
      cwd: projectRoot,
    });

    // Should create directory and file
    expect(fs.existsSync(indexPath)).toBe(true);
    expect(fs.existsSync(indexDir)).toBe(true);
  });

  it('sorts conferences by date (most recent first)', () => {
    const confs = [
      { year: 2024, month: 10 },
      { year: 2025, month: 4 },
      { year: 2025, month: 10 },
      { year: 2026, month: 4 },
      { year: 2024, month: 4 },
    ];

    const outputDir = path.join(tempOutputDir, 'output');
    fs.mkdirSync(outputDir, { recursive: true });

    for (const conf of confs) {
      const fixture = {
        scraped_at: '2026-04-20T00:00:00.000Z',
        version: '1.0',
        conference: {
          year: conf.year,
          month: conf.month,
          name: `${conf.month === 4 ? 'April' : 'October'} ${conf.year} general conference`,
          url: `https://www.churchofjesuschrist.org/study/general-conference/${conf.year}/${String(conf.month).padStart(2, '0')}?lang=eng`,
          language: 'eng',
          sessions: [{ name: 'Sat Morning', slug: 'sat-morning', order: 1, talks: [] }],
        },
      };

      fs.writeFileSync(
        path.join(outputDir, `gc-${conf.year}-${String(conf.month).padStart(2, '0')}-eng.json`),
        JSON.stringify(fixture),
      );
    }

    const indexPath = path.join(tempOutputDir, 'index.html');

    execSync(`npx tsx src/generate-index.ts --output "${outputDir}" --index "${indexPath}"`, {
      cwd: projectRoot,
    });

    const html = fs.readFileSync(indexPath, 'utf-8');

    // Most recent (2026-04) should appear before older ones
    const pos2026 = html.indexOf('April 2026');
    const pos2025Oct = html.indexOf('October 2025');
    const pos2025Apr = html.indexOf('April 2025');

    expect(pos2026).toBeGreaterThan(-1);
    expect(pos2025Oct).toBeGreaterThan(-1);
    expect(pos2026 < pos2025Oct).toBe(true);
    expect(pos2025Oct < pos2025Apr).toBe(true);
  });
});
