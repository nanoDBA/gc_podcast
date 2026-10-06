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

// Each test spawns `npx tsx src/generate-index.ts` (~2-12s on a loaded machine
// or CI runner). The 5s default timed out intermittently; update-feed runs this
// suite before publishing, so a slow runner must not block the feeds.
describe('generate-index.ts', { timeout: 30_000 }, () => {
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

  // iOS Safari / in-app browsers: copy must not depend on the deprecated global
  // `event`, and must fall back when the async Clipboard API is missing or refuses.
  it('copy buttons pass their button and have an iOS-safe fallback', () => {
    const outputDir = path.join(tempOutputDir, 'output');
    fs.mkdirSync(outputDir, { recursive: true });
    const indexPath = path.join(tempOutputDir, 'index.html');
    execSync(`npx tsx src/generate-index.ts --output "${outputDir}" --index "${indexPath}"`, {
      cwd: projectRoot,
    });
    const html = fs.readFileSync(indexPath, 'utf-8');
    expect(html).not.toContain('event.target');
    expect(html).toContain(`onclick="copyFeed('feedUrl', this)"`);
    for (const lang of LANGUAGE_CODES) {
      expect(html).toContain(`onclick="copyFeed('feed${lang.toUpperCase()}', this)"`);
    }
    expect(html).toContain("document.execCommand('copy')");
    expect(html).toContain('setSelectionRange');
    expect(html).toContain('Press and hold to copy');
    // The page script is emitted from a TS template literal, which silently
    // eats backslashes; a mangled regex once turned into a // comment and the
    // whole script failed to parse (copy + subscribe links dead everywhere).
    const script = html.split('<script>')[1].split('</script>')[0];
    expect(() => new Function(script)).not.toThrow();
  }, 20000);

  // Spanish/Portuguese listeners need one-click subscribe for THEIR feed.
  it('has a language picker that drives one-click subscribe for every feed', () => {
    const outputDir = path.join(tempOutputDir, 'output');
    fs.mkdirSync(outputDir, { recursive: true });
    const indexPath = path.join(tempOutputDir, 'index.html');
    execSync(`npx tsx src/generate-index.ts --output "${outputDir}" --index "${indexPath}"`, {
      cwd: projectRoot,
    });
    const html = fs.readFileSync(indexPath, 'utf-8');
    for (const file of ['audio.xml', 'audio-es.xml', 'audio-pt.xml']) {
      expect(html).toContain(`data-file="${file}"`);
    }
    for (const lang of LANGUAGE_CODES) expect(html).toContain(LANGUAGES[lang].nativeName);
    expect(html).toContain('function setSubscribeFeed(btn)');
    expect(html).toContain('Follow a Show by URL');
    const script = html.split('<script>')[1].split('</script>')[0];
    expect(() => new Function(script)).not.toThrow();
  }, 20000);

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

  describe('--min-year window (gc_podcast-qxr)', () => {
    const writeConfs = (): { outputDir: string; indexPath: string } => {
      const outputDir = path.join(tempOutputDir, 'output');
      fs.mkdirSync(outputDir, { recursive: true });
      for (const [year, month] of [
        [2024, 10],
        [2025, 4],
        [2025, 10],
        [2026, 4],
        [2026, 10],
      ]) {
        const mm = String(month).padStart(2, '0');
        const fixture = {
          scraped_at: '2026-10-20T00:00:00.000Z',
          version: '1.0',
          conference: {
            year,
            month,
            name: `${month === 4 ? 'April' : 'October'} ${year} general conference`,
            url: `https://www.churchofjesuschrist.org/study/general-conference/${year}/${mm}?lang=eng`,
            language: 'eng',
            sessions: [],
          },
        };
        fs.writeFileSync(
          path.join(outputDir, `gc-${year}-${mm}-eng.json`),
          JSON.stringify(fixture),
        );
      }
      return { outputDir, indexPath: path.join(tempOutputDir, 'index.html') };
    };

    it('lists only conferences from min-year onward', () => {
      const { outputDir, indexPath } = writeConfs();
      execSync(
        `npx tsx src/generate-index.ts --output "${outputDir}" --index "${indexPath}" --min-year 2025`,
        { cwd: projectRoot },
      );
      const html = fs.readFileSync(indexPath, 'utf-8');
      for (const label of ['April 2025', 'October 2025', 'April 2026', 'October 2026']) {
        expect(html).toContain(`<strong>${label}</strong>`);
      }
      expect(html).not.toContain('<strong>October 2024</strong>');
      const script = html.split('<script>')[1].split('</script>')[0];
      expect(() => new Function(script)).not.toThrow();
    }, 20000);

    it('without the flag keeps the 5 newest', () => {
      const { outputDir, indexPath } = writeConfs();
      execSync(`npx tsx src/generate-index.ts --output "${outputDir}" --index "${indexPath}"`, {
        cwd: projectRoot,
      });
      const html = fs.readFileSync(indexPath, 'utf-8');
      expect(html).toContain('<strong>October 2024</strong>');
      expect(html.match(/class="conference-item"/g)).toHaveLength(5);
    }, 20000);
  });
  // Site i18n: one page per feed language, wording from src/site-strings.ts.
  describe('language pages (/, /es/, /pt/)', () => {
    const generate = (): Record<'eng' | 'spa' | 'por', string> => {
      const outputDir = path.join(tempOutputDir, 'output');
      fs.mkdirSync(outputDir, { recursive: true });
      const names = {
        eng: 'October 2026 general conference',
        spa: 'Conferencia General de octubre de 2026',
        por: 'Conferência Geral de Outubro de 2026',
      };
      for (const [lang, name] of Object.entries(names)) {
        fs.writeFileSync(
          path.join(outputDir, `gc-2026-10-${lang}.json`),
          JSON.stringify({
            scraped_at: '2026-10-06T00:00:00.000Z',
            version: '1.0',
            conference: { year: 2026, month: 10, name, url: 'x', language: lang, sessions: [] },
          }),
        );
      }
      const indexPath = path.join(tempOutputDir, 'site', 'index.html');
      execSync(`npx tsx src/generate-index.ts --output "${outputDir}" --index "${indexPath}"`, {
        cwd: projectRoot,
      });
      const read = (rel: string) => fs.readFileSync(path.join(tempOutputDir, 'site', rel), 'utf-8');
      return { eng: read('index.html'), spa: read('es/index.html'), por: read('pt/index.html') };
    };

    it('writes a page per language with its lang tag and hreflang links to all three', () => {
      const pages = generate();
      expect(pages.eng).toContain('<html lang="en">');
      expect(pages.spa).toContain('<html lang="es">');
      expect(pages.por).toContain('<html lang="pt-BR">');
      for (const html of Object.values(pages)) {
        expect(html).toContain('hreflang="en" href="https://nanodba.github.io/gc_podcast/"');
        expect(html).toContain('hreflang="es" href="https://nanodba.github.io/gc_podcast/es/"');
        expect(html).toContain('hreflang="pt-BR" href="https://nanodba.github.io/gc_podcast/pt/"');
        expect(html).toContain('hreflang="x-default"');
        const script = html.split('<script>')[1].split('</script>')[0];
        expect(() => new Function(script)).not.toThrow();
      }
    }, 30000);

    it('es and pt pages carry no English interface text', () => {
      const pages = generate();
      for (const html of [pages.spa, pages.por]) {
        for (const english of [
          'Recent Conferences',
          'Manual Subscribe',
          'Episode Types',
          'Copy URL',
          'Last updated',
        ]) {
          expect(html).not.toContain(english);
        }
      }
      expect(pages.spa).toContain('la reunión mundial de La Iglesia de Jesucristo');
      expect(pages.por).toContain('uma reunião mundial de A Igreja de Jesus Cristo');
    }, 30000);

    it('each page leads with its own feed and links between languages', () => {
      const pages = generate();
      expect(pages.eng).toContain('href="audio.xml" class="btn"');
      expect(pages.spa).toContain('href="../audio-es.xml" class="btn"');
      expect(pages.por).toContain('href="../audio-pt.xml" class="btn"');
      expect(pages.spa).toContain("const PAGE_FEED_TAG = 'es'");
      expect(pages.por).toContain("const PAGE_FEED_TAG = 'pt'");
      expect(pages.spa).toContain('<a href="../pt/" hreflang="pt-BR" lang="pt-BR">Português</a>');
      expect(pages.eng).toContain('<a href="es/" hreflang="es" lang="es">Español</a>');
      expect(pages.spa).toContain('study/general-conference?lang=spa');
    }, 30000);

    it("uses the Church's own conference name from each language's data", () => {
      const pages = generate();
      expect(pages.spa).toContain('<p>Conferencia General de octubre de 2026</p>');
      expect(pages.spa).toContain('<strong>Octubre de 2026</strong>');
      expect(pages.por).toContain('<p>Conferência Geral de Outubro de 2026</p>');
      expect(pages.eng).toContain('<p>October 2026 general conference</p>');
    }, 30000);
  });
});

// The publish workflow commits docs/ with `git add docs/`; a page that
// .gitignore swallows (the repo ignores *.html) would never go live.
// --no-index: without it git skips files it already tracks, so the check could
// never fail once the pages are committed (review of #88).
describe('published language pages are not git-ignored', () => {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  it('docs/index.html and every language folder page can be committed', () => {
    const pages = [
      'docs/index.html',
      ...LANGUAGE_CODES.filter((l) => l !== 'eng').map(
        (l) => `docs/${LANGUAGES[l].audioSuffix}/index.html`,
      ),
    ];
    for (const page of pages) {
      // Exit 0 = ignored, 1 = not ignored, anything else = git itself failed.
      let status = 0;
      try {
        execSync(`git check-ignore -q --no-index "${page}"`, { cwd: projectRoot, stdio: 'ignore' });
      } catch (err) {
        status = (err as { status?: number }).status ?? -1;
      }
      expect(status, `${page}: 0 means git-ignored, other non-1 means git failed`).toBe(1);
    }
  });
});
