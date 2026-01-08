/**
 * RSS Feed Generator for General Conference Podcast
 * Generates iTunes-compatible podcast RSS feeds from scraped conference data
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { ConferenceOutput, Conference, Session, Talk } from './types.js';

// Podcast metadata
const PODCAST_CONFIG = {
  title: 'General Conference - The Church of Jesus Christ of Latter-day Saints',
  description: 'Audio recordings from General Conference of The Church of Jesus Christ of Latter-day Saints. Includes talks from Church leaders delivered during the semi-annual worldwide broadcasts.',
  author: 'The Church of Jesus Christ of Latter-day Saints',
  email: 'noreply@churchofjesuschrist.org',
  language: 'en',
  category: 'Religion & Spirituality',
  subcategory: 'Christianity',
  explicit: false,
  imageUrl: 'https://www.churchofjesuschrist.org/imgs/nivn2mb3of0ew2b7qthi5ra6etm2pupessmvzvqs/full/!500,/0/default',
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
}

const DEFAULT_OPTIONS: RssGeneratorOptions = {
  includeSessions: true,
  includeTalks: true,
  feedBaseUrl: 'https://your-username.github.io/gc_podcast',
};

/**
 * Escape XML special characters
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
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
 * Get conference date from year/month
 */
function getConferenceDate(year: number, month: 4 | 10, dayOffset: number = 0): Date {
  // General Conference is typically first weekend of April/October
  // Saturday of first full weekend
  const date = new Date(year, month - 1, 1);
  // Find first Saturday
  while (date.getDay() !== 6) {
    date.setDate(date.getDate() + 1);
  }
  date.setDate(date.getDate() + dayOffset);
  date.setHours(10, 0, 0, 0); // 10 AM MDT
  return date;
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
  pubDate: Date
): string {
  if (!talk.audio?.url) return '';

  const guid = generateGuid(conference, session, talk);
  const confName = formatConferenceShortName(conference);
  // Format: "Speaker Name | Talk Title | October 2025"
  const title = `${talk.speaker.name} | ${talk.title} | ${confName}`;
  const description = buildTalkDescription(conference, session, talk);
  const duration = formatDuration(talk.duration_ms);
  const fileSize = estimateFileSize(talk.duration_ms);

  return `
    <item>
      <title>${escapeXml(title)}</title>
      <description><![CDATA[${description}]]></description>
      <enclosure url="${escapeXml(talk.audio.url)}" length="${fileSize}" type="audio/mpeg"/>
      <guid isPermaLink="false">${guid}</guid>
      <pubDate>${formatRfc2822Date(pubDate)}</pubDate>
      <itunes:title>${escapeXml(title)}</itunes:title>
      <itunes:author>${escapeXml(talk.speaker.name)}</itunes:author>
      <itunes:duration>${duration}</itunes:duration>
      <itunes:summary><![CDATA[${description}]]></itunes:summary>
      <itunes:episodeType>full</itunes:episodeType>
      <itunes:season>${conference.year}</itunes:season>
      <itunes:episode>${talk.order}</itunes:episode>
      <link>${escapeXml(talk.url)}</link>
    </item>`;
}

/**
 * Generate RSS item for a full session
 */
function generateSessionItem(
  conference: Conference,
  session: Session,
  pubDate: Date
): string {
  if (!session.audio?.url) return '';

  const guid = generateGuid(conference, session);
  const title = `${session.name} (Full Session) - ${conference.name}`;
  const description = buildSessionDescription(conference, session);
  const duration = formatDuration(session.duration_ms);
  const fileSize = estimateFileSize(session.duration_ms);

  return `
    <item>
      <title>${escapeXml(title)}</title>
      <description><![CDATA[${description}]]></description>
      <enclosure url="${escapeXml(session.audio.url)}" length="${fileSize}" type="audio/mpeg"/>
      <guid isPermaLink="false">${guid}</guid>
      <pubDate>${formatRfc2822Date(pubDate)}</pubDate>
      <itunes:title>${escapeXml(session.name)} (Full Session)</itunes:title>
      <itunes:author>${escapeXml(PODCAST_CONFIG.author)}</itunes:author>
      <itunes:duration>${duration}</itunes:duration>
      <itunes:summary><![CDATA[${description}]]></itunes:summary>
      <itunes:episodeType>full</itunes:episodeType>
      <itunes:season>${conference.year}</itunes:season>
      <itunes:episode>${session.order * 100}</itunes:episode>
      <link>${escapeXml(session.url)}</link>
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
    const roleLabel = talk.speaker.role_tag === 'first-presidency'
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
  options: RssGeneratorOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const config = {
    ...PODCAST_CONFIG,
    title: opts.title || PODCAST_CONFIG.title,
    description: opts.description || PODCAST_CONFIG.description,
    imageUrl: opts.imageUrl || PODCAST_CONFIG.imageUrl,
  };

  // Sort conferences by date (newest first)
  const sortedConferences = [...conferences].sort((a, b) => {
    const dateA = a.conference.year * 100 + a.conference.month;
    const dateB = b.conference.year * 100 + b.conference.month;
    return dateB - dateA;
  });

  // Generate items
  const items: string[] = [];

  for (const confOutput of sortedConferences) {
    const conf = confOutput.conference;
    const baseDate = getConferenceDate(conf.year, conf.month as 4 | 10);

    for (const session of conf.sessions) {
      // Determine session day offset (Saturday = 0, Sunday = 1)
      const isSunday = session.name.toLowerCase().includes('sunday');
      const sessionDate = new Date(baseDate);
      if (isSunday) sessionDate.setDate(sessionDate.getDate() + 1);

      // Add session episode
      if (opts.includeSessions && session.audio?.url) {
        items.push(generateSessionItem(conf, session, sessionDate));
      }

      // Add talk episodes
      if (opts.includeTalks) {
        for (const talk of session.talks) {
          if (talk.audio?.url) {
            // Stagger talk times by order
            const talkDate = new Date(sessionDate);
            talkDate.setMinutes(talkDate.getMinutes() + talk.order * 15);
            items.push(generateTalkItem(conf, session, talk, talkDate));
          }
        }
      }
    }
  }

  // Build RSS feed
  const feedUrl = `${opts.feedBaseUrl}/feed.xml`;
  const buildDate = formatRfc2822Date(new Date());

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(config.title)}</title>
    <description><![CDATA[${config.description}]]></description>
    <link>${escapeXml(config.websiteUrl)}</link>
    <language>${config.language}</language>
    <copyright>${escapeXml(config.copyright)}</copyright>
    <lastBuildDate>${buildDate}</lastBuildDate>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>

    <itunes:author>${escapeXml(config.author)}</itunes:author>
    <itunes:summary><![CDATA[${config.description}]]></itunes:summary>
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
 */
export async function loadConferences(outputDir: string): Promise<ConferenceOutput[]> {
  const files = await fs.readdir(outputDir);
  const jsonFiles = files.filter(f => f.endsWith('.json') && f.startsWith('gc-'));

  const conferences: ConferenceOutput[] = [];
  for (const file of jsonFiles) {
    const content = await fs.readFile(path.join(outputDir, file), 'utf-8');
    conferences.push(JSON.parse(content));
  }

  return conferences;
}

/**
 * Generate and save RSS feed
 */
export async function generateAndSaveFeed(
  outputDir: string,
  feedPath: string,
  options?: RssGeneratorOptions
): Promise<void> {
  const conferences = await loadConferences(outputDir);
  const feed = generateRssFeed(conferences, options);
  await fs.writeFile(feedPath, feed, 'utf-8');
}
