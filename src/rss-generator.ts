/**
 * RSS Feed Generator for General Conference Podcast
 * Generates iTunes-compatible podcast RSS feeds from scraped conference data
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { ConferenceOutput, Conference, Session, Talk } from './types.js';
import { LANGUAGES, LanguageCode } from './languages.js';
import { uuidv5 } from './uuid.js';
import { GENERATOR_STRING } from './version.js';
import { validateVersion, VersionMismatchError } from './migrations.js';

/**
 * Podcasting 2.0 namespace UUID for `<podcast:guid>` derivation.
 * Per spec: https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/1.0.md#guid
 */
const PODCAST_NAMESPACE_UUID = 'ead4c236-bf58-58c6-a2c6-a6b28d128cb6';

/**
 * Normalize a feed URL per the podcast:guid spec: strip protocol, trailing
 * slash, and lowercase the host portion. Used as the `name` input to v5.
 */
function normalizeFeedUrlForGuid(url: string): string {
  let s = url.replace(/^https?:\/\//i, '');
  s = s.replace(/\/$/, '');
  const slash = s.indexOf('/');
  if (slash === -1) return s.toLowerCase();
  return s.slice(0, slash).toLowerCase() + s.slice(slash);
}

// Podcast metadata
const PODCAST_CONFIG = {
  title: 'General Conference - The Church of Jesus Christ of Latter-day Saints',
  description:
    'Audio recordings from General Conference of The Church of Jesus Christ of Latter-day Saints. Includes talks from Church leaders delivered during the semi-annual worldwide broadcasts.',
  author: 'The Church of Jesus Christ of Latter-day Saints',
  email: 'noreply@churchofjesuschrist.org',
  language: 'en',
  category: 'Religion & Spirituality',
  subcategory: 'Christianity',
  explicit: false,
  // Hand-curated channel art: Conference Center exterior from the Saturday
  // Morning Session page's og:image (gc_podcast-fho follow-up). This is
  // visually distinct from the per-cycle conference paintings and represents
  // the physical venue of General Conference — an evergreen "brand" for the
  // feed. Native source is 1920x1080, so 1080x1080 is the max square crop
  // supported by the Church's IIIF endpoint (the server rejects 1400+ since
  // it cannot upscale). This is under Apple Podcasts' 1400x1400 spec minimum
  // but most readers accept it.
  imageUrl:
    'https://www.churchofjesuschrist.org/imgs/k1fqj0dhdmlvazviec1fi2d8vug406va413iel1a/square/1080,1080/0/default',
  websiteUrl: 'https://www.churchofjesuschrist.org/study/general-conference',
  copyright: `© ${new Date().getFullYear()} by Intellectual Reserve, Inc. All rights reserved.`,
};

interface RssGeneratorOptions {
  /** Include full session audio as episodes */
  includeSessions?: boolean;
  /** Include individual talk audio as episodes */
  includeTalks?: boolean;
  /** Base URL where the feed will be hosted */
  feedBaseUrl?: string;
  /** Custom podcast title */
  title?: string;
  /** Custom podcast description */
  description?: string;
  /** Custom artwork URL */
  imageUrl?: string;
  /** Language filter (eng, spa, por) */
  language?: string;
  /** Minimum conference year to include (e.g. 2026) */
  minYear?: number;
}

/**
 * Per-language RSS channel metadata — sourced from `./languages.js` as the
 * single source of truth. Do not hardcode language-specific values here;
 * extend `LANGUAGES` instead.
 */
function getLanguageRssConfig(code: string): {
  language: string;
  title: string;
  description: string;
} {
  const cfg = LANGUAGES[code as LanguageCode] ?? LANGUAGES.eng;
  return {
    language: cfg.rssLanguageTag,
    title: cfg.channelTitle,
    description: cfg.channelDescription,
  };
}

// Month names by language
const MONTH_NAMES: Record<string, { 4: string; 10: string }> = {
  eng: { 4: 'April', 10: 'October' },
  spa: { 4: 'Abril', 10: 'Octubre' },
  por: { 4: 'Abril', 10: 'Outubro' },
};

const DEFAULT_OPTIONS: RssGeneratorOptions = {
  includeSessions: true,
  includeTalks: true,
  feedBaseUrl: 'https://nanodba.github.io/gc_podcast',
};

/**
 * Escape XML special characters
 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Wrap arbitrary content in a CDATA section, safely handling content that
 * itself contains the CDATA terminator `]]>`. The classic XML trick is to
 * split the terminator across two CDATA sections: `]]]]><![CDATA[>` — the
 * first `]]>` closes the section, then a new CDATA reopens with the
 * remaining `>` character.
 */
export function wrapCdata(content: string): string {
  return '<![CDATA[' + content.replace(/\]\]>/g, ']]]]><![CDATA[>') + ']]>';
}

/**
 * Format duration in HH:MM:SS for iTunes
 */
function formatDuration(ms?: number): string {
  if (!ms) return '00:00:00';
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Generate RFC 2822 date string
 */
function formatRfc2822Date(date: Date): string {
  return date.toUTCString();
}

/**
 * Estimate file size from duration (128kbps = 16KB/sec)
 */
function estimateFileSize(durationMs?: number): number {
  if (!durationMs) return 0;
  // 128kbps = 16,000 bytes per second
  return Math.floor((durationMs / 1000) * 16000);
}

/**
 * General Conference session schedule (Mountain Daylight Time, UTC-6).
 *
 * Each entry maps a canonical session-order index (1-based, matching
 * Session.order) to { dayOffset, hourUtc } where:
 *   - dayOffset: days after the first Saturday of the conference weekend
 *     (0 = Saturday, 1 = Sunday)
 *   - hourUtc: wall-clock start hour in UTC (MDT = UTC-6)
 *
 * Known GC schedule (subject to occasional changes):
 *   1 – Saturday Morning   10:00 MDT → 16:00 UTC, day+0
 *   2 – Saturday Afternoon 14:00 MDT → 20:00 UTC, day+0
 *   3 – Saturday Evening   18:00 MDT → 00:00 UTC, day+1 (midnight crossing)
 *   4 – Sunday Morning     10:00 MDT → 16:00 UTC, day+1
 *   5 – Sunday Afternoon   14:00 MDT → 20:00 UTC, day+1
 *
 * Sessions beyond order 5 (rare) fall back to Sunday Afternoon + their
 * excess order as an extra hour offset so they remain unique.
 */
const SESSION_SCHEDULE: Record<number, { dayOffset: number; hourUtc: number }> = {
  1: { dayOffset: 0, hourUtc: 16 }, // Saturday Morning
  2: { dayOffset: 0, hourUtc: 20 }, // Saturday Afternoon
  3: { dayOffset: 1, hourUtc: 0 }, // Saturday Evening (midnight UTC)
  4: { dayOffset: 1, hourUtc: 16 }, // Sunday Morning
  5: { dayOffset: 1, hourUtc: 20 }, // Sunday Afternoon
};

/**
 * Compute the UTC timestamp for the start of a specific session.
 *
 * The first Saturday of the conference weekend is used as the anchor.
 * Per-talk pubDates are derived by adding `(talk.order * 60)` seconds to
 * this session-start timestamp, giving each talk a unique, strictly
 * monotonically increasing time within the session.
 *
 * Invariant: pubDate must be strictly monotonically DECREASING when items
 * are emitted newest-to-oldest (top item in the feed has the highest
 * pubDate). This function provides the per-session anchor; callers are
 * responsible for emitting items in descending pubDate order.
 */
function getSessionStartUtc(year: number, month: 4 | 10, sessionOrder: number): Date {
  // Find the first Saturday of the conference month (UTC midnight).
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  // getUTCDay(): 0=Sun, 6=Sat
  const dayOfWeek = firstOfMonth.getUTCDay();
  const daysUntilSaturday = dayOfWeek === 6 ? 0 : (6 - dayOfWeek + 7) % 7;
  const firstSaturdayMs = firstOfMonth.getTime() + daysUntilSaturday * 24 * 60 * 60 * 1000;

  const schedule = SESSION_SCHEDULE[sessionOrder] ?? {
    // Fallback for unexpected session orders: Sunday afternoon + extra hours
    dayOffset: 1,
    hourUtc: 20 + (sessionOrder - 5),
  };

  return new Date(
    firstSaturdayMs + schedule.dayOffset * 24 * 60 * 60 * 1000 + schedule.hourUtc * 60 * 60 * 1000,
  );
}

/**
 * Generate episode GUID from talk/session info
 */
function generateGuid(conference: Conference, session: Session, talk?: Talk): string {
  if (talk) {
    return `gc-${conference.year}-${conference.month}-${session.slug}-${talk.slug}`;
  }
  return `gc-${conference.year}-${conference.month}-${session.slug}-full`;
}

/**
 * Format conference name for display (e.g., "October 2025" or "April 1974")
 */
function formatConferenceShortName(conference: Conference): string {
  const monthName = conference.month === 4 ? 'April' : 'October';
  return `${monthName} ${conference.year}`;
}

/**
 * Generate RSS item for a talk
 */
function generateTalkItem(
  conference: Conference,
  session: Session,
  talk: Talk,
  pubDate: Date,
): string {
  if (!talk.audio?.url) return '';

  const guid = generateGuid(conference, session, talk);
  const confName = formatConferenceShortName(conference);
  // Format: "Speaker Name | Talk Title | October 2025"
  const title = `${talk.speaker.name} | ${talk.title} | ${confName}`;
  const description = buildTalkDescription(conference, session, talk);
  const duration = formatDuration(talk.duration_ms);
  const fileSize = estimateFileSize(talk.duration_ms);
  // Per-item artwork: prefer talk-level, fall back to speaker portrait.
  // Phase 4 populates these fields; for now they're typically absent.
  const itemImageUrl = talk.image_url ?? talk.speaker.image_url;
  const itemImageTag = itemImageUrl
    ? `\n      <itunes:image href="${escapeXml(itemImageUrl)}"/>`
    : '';

  return `
    <item>
      <title>${escapeXml(title)}</title>
      <description>${wrapCdata(description)}</description>
      <enclosure url="${escapeXml(talk.audio.url)}" length="${fileSize}" type="audio/mpeg"/>
      <guid isPermaLink="false">${guid}</guid>
      <pubDate>${formatRfc2822Date(pubDate)}</pubDate>
      <itunes:title>${escapeXml(title)}</itunes:title>
      <itunes:author>${escapeXml(talk.speaker.name)}</itunes:author>
      <itunes:duration>${duration}</itunes:duration>
      <itunes:summary>${wrapCdata(description)}</itunes:summary>
      <itunes:episodeType>full</itunes:episodeType>
      <itunes:season>${conference.year}</itunes:season>
      <itunes:episode>${talk.order}</itunes:episode>
      <link>${escapeXml(talk.url)}</link>${itemImageTag}
    </item>`;
}

/**
 * Generate RSS item for a full session
 */
function generateSessionItem(conference: Conference, session: Session, pubDate: Date): string {
  if (!session.audio?.url) return '';

  const guid = generateGuid(conference, session);
  const title = `${session.name} (Full Session) - ${conference.name}`;
  const description = buildSessionDescription(conference, session);
  const duration = formatDuration(session.duration_ms);
  const fileSize = estimateFileSize(session.duration_ms);
  // Per-item artwork: session-level only (no fallback). Phase 4 may
  // populate this; for now it's typically absent.
  const itemImageTag = session.image_url
    ? `\n      <itunes:image href="${escapeXml(session.image_url)}"/>`
    : '';

  return `
    <item>
      <title>${escapeXml(title)}</title>
      <description>${wrapCdata(description)}</description>
      <enclosure url="${escapeXml(session.audio.url)}" length="${fileSize}" type="audio/mpeg"/>
      <guid isPermaLink="false">${guid}</guid>
      <pubDate>${formatRfc2822Date(pubDate)}</pubDate>
      <itunes:title>${escapeXml(session.name)} (Full Session)</itunes:title>
      <itunes:author>${escapeXml(PODCAST_CONFIG.author)}</itunes:author>
      <itunes:duration>${duration}</itunes:duration>
      <itunes:summary>${wrapCdata(description)}</itunes:summary>
      <itunes:episodeType>full</itunes:episodeType>
      <itunes:season>${conference.year}</itunes:season>
      <itunes:episode>${session.order * 100}</itunes:episode>
      <link>${escapeXml(session.url)}</link>${itemImageTag}
    </item>`;
}

/**
 * Build description for a talk
 */
function buildTalkDescription(conference: Conference, session: Session, talk: Talk): string {
  let desc = `<p><strong>${talk.title}</strong></p>`;
  desc += `<p>By ${talk.speaker.name}`;
  if (talk.speaker.calling) {
    desc += `<br/><em>${talk.speaker.calling}</em>`;
  }
  desc += `</p>`;
  desc += `<p>${conference.name} - ${session.name}</p>`;
  if (talk.speaker.role_tag) {
    const roleLabel =
      talk.speaker.role_tag === 'first-presidency'
        ? 'First Presidency'
        : 'Quorum of the Twelve Apostles';
    desc += `<p><small>Speaker: ${roleLabel}</small></p>`;
  }
  return desc;
}

/**
 * Build description for a session
 */
function buildSessionDescription(conference: Conference, session: Session): string {
  let desc = `<p><strong>${session.name}</strong></p>`;
  desc += `<p>${conference.name}</p>`;
  desc += `<p>Full session recording including all talks and musical numbers.</p>`;
  desc += `<p><strong>Speakers:</strong></p><ul>`;
  for (const talk of session.talks) {
    desc += `<li>${talk.speaker.name} - "${talk.title}"</li>`;
  }
  desc += `</ul>`;
  return desc;
}

/**
 * Generate complete RSS feed from conferences
 */
export function generateRssFeed(
  conferences: ConferenceOutput[],
  options: RssGeneratorOptions = {},
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const langConfig = getLanguageRssConfig(opts.language || 'eng');
  const config = {
    ...PODCAST_CONFIG,
    language: langConfig.language,
    title: opts.title || langConfig.title,
    description: opts.description || langConfig.description,
    imageUrl: opts.imageUrl || PODCAST_CONFIG.imageUrl,
  };

  // Filter by minimum year if specified
  const filtered = opts.minYear
    ? conferences.filter((c) => c.conference.year >= opts.minYear!)
    : conferences;

  // Sort conferences by date (newest first)
  const sortedConferences = [...filtered].sort((a, b) => {
    const dateA = a.conference.year * 100 + a.conference.month;
    const dateB = b.conference.year * 100 + b.conference.month;
    return dateB - dateA;
  });

  // Channel artwork is hardcoded to the Conference Center image in
  // PODCAST_CONFIG.imageUrl (see comment on that field). The per-conference
  // painting rotation (gc_podcast-8t0) is intentionally disabled — subscribers
  // wanted a single recognisable brand image, not a painting that changes
  // every six months. conference_image_url is still scraped and used for
  // per-item artwork on session episodes where talk-level image is absent.

  // Generate items — newest first (conferences descending, sessions descending,
  // talks descending) so that <pubDate> is strictly monotonically decreasing
  // from the top item to the bottom item of the feed.
  //
  // Per-item pubDate invariant: each item receives
  //   sessionStart + (talk.order * 60 s)
  // The session item itself receives sessionStart (talk.order offset = 0).
  // Because sessions are scheduled at distinct UTC hours, and talks within a
  // session each get a unique +60 s offset, every pubDate in the feed is unique.
  const items: string[] = [];

  for (const confOutput of sortedConferences) {
    const conf = confOutput.conference;

    // Sort sessions DESCENDING so the last session of the conference (highest
    // pubDate) is emitted first, preserving newest-to-oldest feed order.
    const sortedSessions = [...conf.sessions].sort((a, b) => b.order - a.order);

    for (const session of sortedSessions) {
      const sessionStart = getSessionStartUtc(conf.year, conf.month as 4 | 10, session.order);

      // Add talk episodes sorted DESCENDING — last talk first in feed,
      // highest pubDate first.
      if (opts.includeTalks) {
        const sortedTalks = [...session.talks].sort((a, b) => b.order - a.order);
        for (const talk of sortedTalks) {
          if (talk.audio?.url) {
            // Each talk's pubDate = sessionStart + (order × 60 s).
            // Order is 1-based, so talk 1 → +60 s, talk 2 → +120 s, etc.
            const talkDate = new Date(sessionStart.getTime() + talk.order * 60 * 1000);
            items.push(generateTalkItem(conf, session, talk, talkDate));
          }
        }
      }

      // Add session episode AFTER all talks so it appears after (lower pubDate
      // than) any individual talk from this session when emitted in order.
      // The session item uses sessionStart with no additional offset.
      if (opts.includeSessions && session.audio?.url) {
        items.push(generateSessionItem(conf, session, sessionStart));
      }
    }
  }

  // Build RSS feed
  const langSuffix =
    opts.language === 'eng' ? '' : `-${getLanguageRssConfig(opts.language || 'eng').language}`;
  const feedUrl = `${opts.feedBaseUrl}/audio${langSuffix}.xml`;
  const buildDate = formatRfc2822Date(new Date());
  const podcastGuid = uuidv5(normalizeFeedUrlForGuid(feedUrl), PODCAST_NAMESPACE_UUID);

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <title>${escapeXml(config.title)}</title>
    <description>${wrapCdata(config.description)}</description>
    <link>${escapeXml(config.websiteUrl)}</link>
    <language>${config.language}</language>
    <copyright>${escapeXml(config.copyright)}</copyright>
    <lastBuildDate>${buildDate}</lastBuildDate>
    <generator>${escapeXml(GENERATOR_STRING)}</generator>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>
    <podcast:guid>${podcastGuid}</podcast:guid>

    <itunes:author>${escapeXml(config.author)}</itunes:author>
    <itunes:summary>${wrapCdata(config.description)}</itunes:summary>
    <itunes:type>episodic</itunes:type>
    <itunes:owner>
      <itunes:name>${escapeXml(config.author)}</itunes:name>
      <itunes:email>${escapeXml(config.email)}</itunes:email>
    </itunes:owner>
    <itunes:explicit>${config.explicit ? 'yes' : 'no'}</itunes:explicit>
    <itunes:category text="${escapeXml(config.category)}">
      <itunes:category text="${escapeXml(config.subcategory)}"/>
    </itunes:category>
    <itunes:image href="${escapeXml(config.imageUrl)}"/>
    <image>
      <url>${escapeXml(config.imageUrl)}</url>
      <title>${escapeXml(config.title)}</title>
      <link>${escapeXml(config.websiteUrl)}</link>
    </image>
${items.join('\n')}
  </channel>
</rss>`;
}

/**
 * Load all conference JSON files from a directory
 * @param language - Filter by language code (eng, spa, por). If not specified, loads only English.
 */
export async function loadConferences(
  outputDir: string,
  language: string = 'eng',
): Promise<ConferenceOutput[]> {
  const files = await fs.readdir(outputDir);
  // Filter by language: gc-2025-10-eng.json, gc-2025-10-spa.json, etc.
  const langSuffix = `-${language}.json`;
  const jsonFiles = files.filter((f) => f.endsWith(langSuffix) && f.startsWith('gc-'));

  const conferences: ConferenceOutput[] = [];
  for (const file of jsonFiles) {
    const filePath = path.join(outputDir, file);
    const content = await fs.readFile(filePath, 'utf-8');
    const raw = JSON.parse(content);

    // Enforce schema version at runtime (gc_podcast-hjq). A file with a
    // wrong version and no registered migration is skipped with a warning
    // rather than silently consumed, so a future breaking-change bump will
    // surface immediately instead of producing a subtly-wrong feed.
    let conf: ConferenceOutput;
    try {
      conf = validateVersion(raw) as unknown as ConferenceOutput;
    } catch (err) {
      if (err instanceof VersionMismatchError) {
        console.warn(`  skipping ${file}: ${err.message}`);
        continue;
      }
      throw err;
    }

    // Only include conferences that have sessions (skip empty ones)
    if (conf.conference?.sessions?.length > 0) {
      conferences.push(conf);
    }
  }

  return conferences;
}

/**
 * Generate and save RSS feed
 */
export async function generateAndSaveFeed(
  outputDir: string,
  feedPath: string,
  options?: RssGeneratorOptions,
): Promise<void> {
  const language = options?.language || 'eng';
  const conferences = await loadConferences(outputDir, language);
  const feed = generateRssFeed(conferences, options);
  await fs.writeFile(feedPath, feed, 'utf-8');
  const filteredCount = options?.minYear
    ? conferences.filter((c) => c.conference.year >= options.minYear!).length
    : conferences.length;
  console.log(`  ${filteredCount} conferences, feed written to ${feedPath}`);
}
