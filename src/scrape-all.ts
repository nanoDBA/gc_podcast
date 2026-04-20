/**
 * Scrape all conferences or a range of conferences
 * Useful for initial setup and periodic updates
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { scrapeConference, ParserCircuitBreakerError } from './scraper.js';
import { ConferenceOutput, Language } from './types.js';
import { ConferenceOutputSchema } from './schemas.js';
import { log } from './logger.js';

const SPEC_VERSION = '1.0';

/**
 * Write a file atomically by writing to `<path>.tmp` first, then renaming
 * into place. Prevents partial-write corruption of the destination file.
 * On failure, attempts to clean up the temp file and rethrows.
 */
function atomicWriteFileSync(filePath: string, content: string): void {
  const tmpPath = `${filePath}.tmp`;
  try {
    fsSync.writeFileSync(tmpPath, content, 'utf-8');
    fsSync.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      if (fsSync.existsSync(tmpPath)) {
        fsSync.unlinkSync(tmpPath);
      }
    } catch {
      // best-effort cleanup; swallow to surface original error
    }
    throw err;
  }
}

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

/**
 * Minimum number of sessions for a conference to be considered plausibly
 * complete. A General Conference typically has 5 sessions; fewer than 3 is
 * almost certainly the result of a partial scrape. Fewer than 5 is a soft
 * signal but tolerated for older conferences, so 3 is the hard floor.
 */
const MIN_SESSIONS_HARD_FLOOR = 3;

/**
 * Result of the `isIncomplete` check. When `incomplete` is true, `reasons`
 * contains one or more human-readable strings describing why.
 */
export interface IncompleteResult {
  incomplete: boolean;
  reasons: string[];
}

/**
 * Check if a scraped conference file is incomplete. A conference is flagged
 * as incomplete if any of the following hold:
 *   - the persisted JSON fails zod schema validation
 *   - the conference has fewer than MIN_SESSIONS_HARD_FLOOR sessions
 *   - any session has an empty talks array (talks not yet published)
 *   - any session is missing an `audio.url` or the url is empty/whitespace
 *   - any talk is missing `audio.url` or `audio.duration_ms`
 *
 * All matching reasons are collected and returned together so callers can
 * log WHY a file is being re-scraped.
 */
export async function isIncomplete(filePath: string): Promise<IncompleteResult> {
  const reasons: string[] = [];
  let data: ConferenceOutput;

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    data = JSON.parse(content);
  } catch (err) {
    return {
      incomplete: true,
      reasons: [
        `failed to read or parse file: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }

  // Validate persisted JSON against the current schema. If it fails, flag
  // it as a reason rather than short-circuiting; we still collect any other
  // partial-scrape indicators so the caller sees the full picture.
  const validation = ConferenceOutputSchema.safeParse(data);
  if (!validation.success) {
    reasons.push(
      `schema validation failed: ${validation.error.issues
        .map(i => `${i.path.join('.') || '<root>'}: ${i.message}`)
        .join('; ')}`,
    );
  }

  const sessions = data?.conference?.sessions;
  if (!sessions || sessions.length === 0) {
    reasons.push('conference has no sessions');
  } else {
    if (sessions.length < MIN_SESSIONS_HARD_FLOOR) {
      reasons.push(
        `conference has only ${sessions.length} session(s); below hard floor of ${MIN_SESSIONS_HARD_FLOOR}`,
      );
    }

    sessions.forEach((session, sIdx) => {
      const sLabel = `session[${sIdx}]${session?.name ? ` "${session.name}"` : ''}`;

      if (!session.talks || session.talks.length === 0) {
        reasons.push(`${sLabel}: talks array is empty`);
        return;
      }

      const sessionAudioUrl = session.audio?.url;
      if (!sessionAudioUrl || sessionAudioUrl.trim() === '') {
        reasons.push(`${sLabel}: missing session-level audio.url`);
      }

      session.talks.forEach((talk, tIdx) => {
        const tLabel = `${sLabel} talk[${tIdx}]${talk?.title ? ` "${talk.title}"` : ''}`;
        const talkAudioUrl = talk.audio?.url;
        if (!talkAudioUrl || talkAudioUrl.trim() === '') {
          reasons.push(`${tLabel}: missing audio.url`);
        }
        if (
          talk.audio?.duration_ms === undefined ||
          talk.audio?.duration_ms === null
        ) {
          reasons.push(`${tLabel}: missing audio.duration_ms`);
        }
      });
    });
  }

  return { incomplete: reasons.length > 0, reasons };
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
    // Conference is first weekend of the month; use the 1st as cutoff
    // so we start scraping as soon as conference weekend arrives
    const aprilDate = new Date(year, 3, 1); // April 1
    if (aprilDate <= new Date()) {
      conferences.push({ year, month: 4 });
    }

    // October conference (skip if in future)
    const octoberDate = new Date(year, 9, 1); // October 1
    if (octoberDate <= new Date()) {
      conferences.push({ year, month: 10 });
    }
  }

  console.log(`Found ${conferences.length} conferences to process\n`);

  let scraped = 0;
  let skipped = 0;
  let failed = 0;
  const startTime = Date.now();

  for (const conf of conferences) {
    const monthStr = conf.month.toString().padStart(2, '0');
    const filename = `gc-${conf.year}-${monthStr}-${config.language}.json`;
    const outputPath = path.join(config.outputDir, filename);

    // Skip if file exists and skipExisting is true
    // But re-scrape incomplete files (missing talks, audio, or too few sessions)
    let disableCache = false;
    if (config.skipExisting && await fileExists(outputPath)) {
      const result = await isIncomplete(outputPath);
      if (result.incomplete) {
        log.warn('Conference flagged as incomplete, will re-scrape', {
          year: conf.year,
          month: conf.month,
          language: config.language,
          reasons: result.reasons,
        });
        console.log(
          `[rescrape] ${filename} (incomplete: ${result.reasons[0]}${result.reasons.length > 1 ? `; +${result.reasons.length - 1} more` : ''})`,
        );
        disableCache = true;
      } else {
        console.log(`[skip] ${filename} (already exists)`);
        skipped++;
        continue;
      }
    }

    console.log(`[scrape] ${conf.year} ${conf.month === 4 ? 'April' : 'October'}...`);

    try {
      const conference = await scrapeConference(conf.year, conf.month, {
        language: config.language,
        useCache: !disableCache,
        cacheDir: '.cache',
      });

      const output: ConferenceOutput = {
        scraped_at: new Date().toISOString(),
        version: SPEC_VERSION,
        conference,
      };

      atomicWriteFileSync(outputPath, JSON.stringify(output, null, 2));
      console.log(`  → ${conference.sessions.length} sessions, ${conference.sessions.reduce((t, s) => t + s.talks.length, 0)} talks`);
      scraped++;
    } catch (error) {
      if (error instanceof ParserCircuitBreakerError) {
        // Contract break with the upstream site markup. We deliberately do
        // NOT write an output file — any existing JSON for this conference
        // stays on disk untouched (atomic-write in -hv7 further guarantees
        // we never corrupt it). Log with full context and continue.
        log.error('Parser circuit breaker tripped — skipping conference output', {
          year: conf.year,
          month: conf.month,
          url: error.url,
          httpStatus: error.httpStatus,
          htmlLength: error.htmlLength,
          parsersTried: error.parsersTried,
          outputPreserved: outputPath,
        });
        console.error(`  [circuit-breaker] ${error.message}`);
      } else {
        log.error('Conference scrape failed', {
          year: conf.year,
          month: conf.month,
          language: config.language,
          outputPath,
          ...(error instanceof Error
            ? { error: error.message, stack: error.stack, name: error.name }
            : { error: String(error) }),
        });
        console.error(`  [error] Failed: ${error}`);
      }
      failed++;
    }
  }

  const duration_ms = Date.now() - startTime;

  console.log('\n=== Summary ===');
  console.log(`Scraped: ${scraped}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);

  log.info('Scrape run complete', {
    scraped,
    skipped,
    failed,
    duration_ms,
    startYear: config.startYear,
    endYear: config.endYear,
    language: config.language,
    outputDir: config.outputDir,
  });
}

main().catch((err) => {
  log.error('Fatal error in scrape-all main', {
    ...(err instanceof Error
      ? { error: err.message, stack: err.stack, name: err.name }
      : { error: String(err) }),
  });
  console.error(err);
});
