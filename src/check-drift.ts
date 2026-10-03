/**
 * Site-drift canary.
 *
 * Re-scrapes a conference that is already committed (cache disabled) and
 * compares the live result with the committed JSON. If the Church website
 * changed its markup or API, a fresh scrape of an old conference degrades
 * (fewer talks, missing audio) while the committed data still looks fine.
 *
 * Usage: npx tsx src/check-drift.ts [--year Y --month M] [-l eng|spa|por|all] [--output ./output]
 * Exit code 1 on drift failures; image URL changes are warnings only.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { scrapeConference } from './scraper.js';
import { Conference, ConferenceOutput, Language, Talk } from './types.js';
import { LANGUAGE_CODES } from './languages.js';
import { log } from './logger.js';

/** Fraction of talks whose audio URL shape may change before we fail. */
export const DEFAULT_SHAPE_CHANGE_THRESHOLD = 0.1;

/** A conference with fewer sessions than this is treated as in progress. */
const MIN_COMPLETE_SESSIONS = 3;

export interface DriftResult {
  ok: boolean;
  failures: string[];
  warnings: string[];
  stats: {
    referenceSessions: number;
    liveSessions: number;
    referenceTalks: number;
    liveTalks: number;
    audioShapeChanged: number;
    imageChanged: number;
  };
}

export interface CompareOptions {
  shapeChangeThreshold?: number;
}

function allTalks(conf: Conference): Talk[] {
  return conf.sessions.flatMap((s) => s.talks);
}

/**
 * Reduce an audio URL to host + path shape: long opaque tokens become `H`.
 * A new CDN host or a different filename pattern changes the shape; a new
 * hash for the same file does not.
 */
export function audioUrlShape(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname.replace(/[a-z0-9]{20,}/gi, 'H')}`;
  } catch {
    return 'invalid';
  }
}

/** Pure comparison of a committed (reference) conference against a live scrape. */
export function compareConferences(
  reference: Conference,
  live: Conference,
  options: CompareOptions = {},
): DriftResult {
  const threshold = options.shapeChangeThreshold ?? DEFAULT_SHAPE_CHANGE_THRESHOLD;
  const failures: string[] = [];
  const warnings: string[] = [];

  const refTalks = allTalks(reference);
  const liveTalks = allTalks(live);

  if (live.sessions.length < reference.sessions.length) {
    failures.push(`session count dropped: ${reference.sessions.length} -> ${live.sessions.length}`);
  }
  if (liveTalks.length < refTalks.length) {
    failures.push(`talk count dropped: ${refTalks.length} -> ${liveTalks.length}`);
  }

  const liveBySlug = new Map(liveTalks.map((t) => [t.slug, t]));
  let compared = 0;
  let shapeChanged = 0;
  let imageChanged = 0;

  for (const ref of refTalks) {
    const cur = liveBySlug.get(ref.slug);
    if (!cur) {
      failures.push(`talk missing from live scrape: ${ref.slug}`);
      continue;
    }
    if (ref.audio?.url) {
      if (!cur.audio?.url) {
        failures.push(`talk lost audio.url: ${ref.slug}`);
      } else {
        compared++;
        if (audioUrlShape(cur.audio.url) !== audioUrlShape(ref.audio.url)) shapeChanged++;
      }
    }
    if (ref.audio?.duration_ms != null && cur.audio?.url && cur.audio.duration_ms == null) {
      failures.push(`talk lost audio.duration_ms: ${ref.slug}`);
    }
    if (ref.image_url && cur.image_url !== ref.image_url) {
      imageChanged++;
      warnings.push(`image URL changed (normal upstream photo swap): ${ref.slug}`);
    }
  }

  if (compared > 0 && shapeChanged / compared > threshold) {
    failures.push(
      `audio URL host/shape changed for ${shapeChanged}/${compared} talks (> ${Math.round(threshold * 100)}%)`,
    );
  }

  return {
    ok: failures.length === 0,
    failures,
    warnings,
    stats: {
      referenceSessions: reference.sessions.length,
      liveSessions: live.sessions.length,
      referenceTalks: refTalks.length,
      liveTalks: liveTalks.length,
      audioShapeChanged: shapeChanged,
      imageChanged,
    },
  };
}

/** A committed conference is complete when it has enough sessions and every talk has audio. */
export function isCompleteConference(conf: Conference): boolean {
  const talks = allTalks(conf);
  return (
    conf.sessions.length >= MIN_COMPLETE_SESSIONS &&
    talks.length > 0 &&
    conf.sessions.every((s) => s.talks.length > 0) &&
    talks.every((t) => !!t.audio?.url)
  );
}

async function readCommitted(
  outputDir: string,
  year: number,
  month: number,
  language: Language,
): Promise<Conference> {
  const file = path.join(
    outputDir,
    `gc-${year}-${String(month).padStart(2, '0')}-${language}.json`,
  );
  const data = JSON.parse(await fs.readFile(file, 'utf-8')) as ConferenceOutput;
  return data.conference;
}

/** Find the most recent complete conference for a language in the output dir. */
export async function findReferenceConference(
  outputDir: string,
  language: Language,
): Promise<{ year: number; month: 4 | 10 } | null> {
  const re = new RegExp(`^gc-(\\d{4})-(04|10)-${language}\\.json$`);
  const candidates = (await fs.readdir(outputDir))
    .map((f) => re.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ year: Number(m[1]), month: Number(m[2]) as 4 | 10 }))
    .sort((a, b) => b.year - a.year || b.month - a.month);

  for (const c of candidates) {
    const conf = await readCommitted(outputDir, c.year, c.month, language);
    if (isCompleteConference(conf)) return c;
  }
  return null;
}

interface Args {
  year?: number;
  month?: 4 | 10;
  languages: Language[];
  outputDir: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { languages: ['eng'], outputDir: './output' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--year' || a === '-y') args.year = parseInt(argv[++i], 10);
    else if (a === '--month' || a === '-m') {
      const m = parseInt(argv[++i], 10);
      if (m !== 4 && m !== 10) throw new Error('--month must be 4 or 10');
      args.month = m;
    } else if (a === '--lang' || a === '-l') {
      const l = argv[++i];
      if (l === 'all') args.languages = [...LANGUAGE_CODES];
      else if ((LANGUAGE_CODES as readonly string[]).includes(l)) args.languages = [l as Language];
      else throw new Error(`Unknown language: ${l}`);
    } else if (a === '--output' || a === '-o') args.outputDir = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  if ((args.year === undefined) !== (args.month === undefined)) {
    throw new Error('--year and --month must be given together');
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-drift-'));
  let failed = false;

  try {
    for (const language of args.languages) {
      let target = args.year && args.month ? { year: args.year, month: args.month } : null;
      target ??= await findReferenceConference(args.outputDir, language);
      if (!target) {
        log.error('No complete reference conference found', { language });
        console.log(`[${language}] FAIL: no complete reference conference in ${args.outputDir}`);
        failed = true;
        continue;
      }

      const label = `${target.year}-${String(target.month).padStart(2, '0')} ${language}`;
      const reference = await readCommitted(args.outputDir, target.year, target.month, language);

      let result: DriftResult;
      try {
        const live = await scrapeConference(target.year, target.month, {
          language,
          cacheDir,
          useCache: false,
        });
        result = compareConferences(reference, live);
      } catch (err) {
        result = {
          ok: false,
          failures: [`live scrape threw: ${err instanceof Error ? err.message : String(err)}`],
          warnings: [],
          stats: {
            referenceSessions: reference.sessions.length,
            liveSessions: 0,
            referenceTalks: allTalks(reference).length,
            liveTalks: 0,
            audioShapeChanged: 0,
            imageChanged: 0,
          },
        };
      }

      const s = result.stats;
      console.log(
        `[${label}] ${result.ok ? 'PASS' : 'FAIL'}: sessions ${s.referenceSessions}->${s.liveSessions}, ` +
          `talks ${s.referenceTalks}->${s.liveTalks}, audio shape changes ${s.audioShapeChanged}, ` +
          `image changes ${s.imageChanged} (warn only)`,
      );
      result.failures.slice(0, 20).forEach((f) => console.log(`  FAIL: ${f}`));
      result.warnings.slice(0, 5).forEach((w) => console.log(`  warn: ${w}`));
      if (result.warnings.length > 5) console.log(`  warn: ... ${result.warnings.length - 5} more`);

      const ctx = {
        conference: label,
        ok: result.ok,
        failures: result.failures.slice(0, 20),
        warning_count: result.warnings.length,
        ...s,
      };
      if (result.ok) log.info('drift check', ctx);
      else log.error('drift check', ctx);
      if (!result.ok) failed = true;
    }
  } finally {
    await fs.rm(cacheDir, { recursive: true, force: true });
  }

  process.exit(failed ? 1 : 0);
}

// Only run when executed directly, so tests can import the pure functions.
if (process.argv[1] && /check-drift\.[tj]s$/.test(process.argv[1])) {
  main().catch((err) => {
    log.error('check-drift crashed', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
}
