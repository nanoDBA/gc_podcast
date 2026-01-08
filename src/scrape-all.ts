/**
 * Scrape all conferences or a range of conferences
 * Useful for initial setup and periodic updates
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { scrapeConference } from './scraper.js';
import { ConferenceOutput, Language } from './types.js';

const SPEC_VERSION = '1.0';

interface ScrapeConfig {
  startYear: number;
  endYear: number;
  language: Language;
  outputDir: string;
  skipExisting: boolean;
}

function parseArgs(): ScrapeConfig {
  const args = process.argv.slice(2);
  const currentYear = new Date().getFullYear();

  let config: ScrapeConfig = {
    startYear: currentYear - 5, // Last 5 years by default
    endYear: currentYear,
    language: 'eng',
    outputDir: './output',
    skipExisting: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--start' || arg === '-s') {
      config.startYear = parseInt(args[++i], 10);
    } else if (arg === '--end' || arg === '-e') {
      config.endYear = parseInt(args[++i], 10);
    } else if (arg === '--lang' || arg === '-l') {
      config.language = args[++i] as Language;
    } else if (arg === '--output' || arg === '-o') {
      config.outputDir = args[++i];
    } else if (arg === '--force' || arg === '-f') {
      config.skipExisting = false;
    } else if (arg === '--all') {
      config.startYear = 1971; // First conference with audio
    } else if (arg === '--recent') {
      config.startYear = currentYear - 2;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return config;
}

function printHelp() {
  console.log(`
Scrape All Conferences

Usage: npx tsx src/scrape-all.ts [options]

Options:
  -s, --start <year>     Start year (default: 5 years ago)
  -e, --end <year>       End year (default: current year)
  -l, --lang <lang>      Language: eng, spa, por (default: eng)
  -o, --output <dir>     Output directory (default: ./output)
  -f, --force            Re-scrape even if file exists
  --all                  Scrape all available conferences (from 1971)
  --recent               Scrape last 2 years only
  -h, --help             Show this help message

Examples:
  npx tsx src/scrape-all.ts                    # Last 5 years
  npx tsx src/scrape-all.ts --recent           # Last 2 years
  npx tsx src/scrape-all.ts --all              # All conferences since 1971
  npx tsx src/scrape-all.ts -s 2020 -e 2025    # Specific range
  npx tsx src/scrape-all.ts -l spa             # Spanish
`);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const config = parseArgs();

  console.log('\n=== Scrape All Conferences ===');
  console.log(`Years: ${config.startYear} - ${config.endYear}`);
  console.log(`Language: ${config.language}`);
  console.log(`Output: ${config.outputDir}`);
  console.log(`Skip existing: ${config.skipExisting}\n`);

  await fs.mkdir(config.outputDir, { recursive: true });

  const conferences: Array<{ year: number; month: 4 | 10 }> = [];

  // Build list of conferences to scrape
  for (let year = config.startYear; year <= config.endYear; year++) {
    // April conference (skip if in future)
    const aprilDate = new Date(year, 3, 15); // Mid-April
    if (aprilDate <= new Date()) {
      conferences.push({ year, month: 4 });
    }

    // October conference (skip if in future)
    const octoberDate = new Date(year, 9, 15); // Mid-October
    if (octoberDate <= new Date()) {
      conferences.push({ year, month: 10 });
    }
  }

  console.log(`Found ${conferences.length} conferences to process\n`);

  let scraped = 0;
  let skipped = 0;
  let failed = 0;

  for (const conf of conferences) {
    const monthStr = conf.month.toString().padStart(2, '0');
    const filename = `gc-${conf.year}-${monthStr}-${config.language}.json`;
    const outputPath = path.join(config.outputDir, filename);

    // Skip if file exists and skipExisting is true
    if (config.skipExisting && await fileExists(outputPath)) {
      console.log(`[skip] ${filename} (already exists)`);
      skipped++;
      continue;
    }

    console.log(`[scrape] ${conf.year} ${conf.month === 4 ? 'April' : 'October'}...`);

    try {
      const conference = await scrapeConference(conf.year, conf.month, {
        language: config.language,
        useCache: true,
        cacheDir: '.cache',
      });

      const output: ConferenceOutput = {
        scraped_at: new Date().toISOString(),
        version: SPEC_VERSION,
        conference,
      };

      await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
      console.log(`  → ${conference.sessions.length} sessions, ${conference.sessions.reduce((t, s) => t + s.talks.length, 0)} talks`);
      scraped++;
    } catch (error) {
      console.error(`  [error] Failed: ${error}`);
      failed++;
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Scraped: ${scraped}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);
}

main().catch(console.error);
