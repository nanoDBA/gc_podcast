/**
 * General Conference Podcast Scraper
 * CLI entry point
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { scrapeConference } from './scraper.js';
import { ConferenceOutput, Language } from './types.js';

const SPEC_VERSION = '1.0';

/**
 * Parse command line arguments
 */
function parseArgs(): {
  year: number;
  month: 4 | 10;
  language: Language;
  outputDir: string;
} {
  const args = process.argv.slice(2);

  // Default to October 2025
  let year = 2025;
  let month: 4 | 10 = 10;
  let language: Language = 'eng';
  let outputDir = './output';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--year' || arg === '-y') {
      year = parseInt(args[++i], 10);
    } else if (arg === '--month' || arg === '-m') {
      const m = parseInt(args[++i], 10);
      if (m === 4 || m === 10) {
        month = m;
      } else {
        console.error('Month must be 4 (April) or 10 (October)');
        process.exit(1);
      }
    } else if (arg === '--lang' || arg === '-l') {
      const l = args[++i] as Language;
      if (['eng', 'spa', 'por'].includes(l)) {
        language = l;
      } else {
        console.error('Language must be eng, spa, or por');
        process.exit(1);
      }
    } else if (arg === '--output' || arg === '-o') {
      outputDir = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return { year, month, language, outputDir };
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
General Conference Podcast Scraper

Usage: npm run dev -- [options]

Options:
  -y, --year <year>     Conference year (default: 2025)
  -m, --month <month>   Conference month: 4 or 10 (default: 10)
  -l, --lang <lang>     Language: eng, spa, por (default: eng)
  -o, --output <dir>    Output directory (default: ./output)
  -h, --help            Show this help message

Examples:
  npm run dev                           # Scrape October 2025 English
  npm run dev -- -y 2024 -m 4           # Scrape April 2024 English
  npm run dev -- -y 1995 -m 10 -l spa   # Scrape October 1995 Spanish
`);
}

/**
 * Main function
 */
async function main(): Promise<void> {
  const { year, month, language, outputDir } = parseArgs();

  console.log(`\n=== General Conference Scraper ===`);
  console.log(`Year: ${year}`);
  console.log(`Month: ${month === 4 ? 'April' : 'October'}`);
  console.log(`Language: ${language}`);
  console.log(`Output: ${outputDir}\n`);

  try {
    // Scrape the conference
    const conference = await scrapeConference(year, month, {
      language,
      useCache: true,
      cacheDir: '.cache',
    });

    // Create output structure
    const output: ConferenceOutput = {
      scraped_at: new Date().toISOString(),
      version: SPEC_VERSION,
      conference,
    };

    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });

    // Generate output filename
    const monthStr = month.toString().padStart(2, '0');
    const filename = `gc-${year}-${monthStr}-${language}.json`;
    const outputPath = path.join(outputDir, filename);

    // Write output file
    await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');

    console.log(`\n=== Scraping Complete ===`);
    console.log(`Output: ${outputPath}`);
    console.log(`Sessions: ${conference.sessions.length}`);

    let totalTalks = 0;
    for (const session of conference.sessions) {
      console.log(`  ${session.name}: ${session.talks.length} talks`);
      totalTalks += session.talks.length;
    }
    console.log(`Total talks: ${totalTalks}`);

  } catch (error) {
    console.error('Error scraping conference:', error);
    process.exit(1);
  }
}

// Run main
main();
