/**
 * Every phrase on the landing page, per site language (gc_podcast site i18n).
 * generate-index.ts owns structure; this file owns wording. The type makes a
 * missing translation a compile error.
 *
 * Spanish and Portuguese follow the Church's own usage on churchofjesuschrist.org
 * and its newsroom: lowercase "general conference" in running text, the Church's
 * full name with its capitalized article.
 */
import type { LanguageCode } from './languages.js';
import { SESSION_HOURS_TEXT, TALK_MINUTES_TEXT } from './episode-lengths.js';

export interface SiteStrings {
  /** BCP 47 tag for <html lang> and hreflang. */
  htmlLang: string;
  title: string;
  metaDescription: string;
  subtitle: string;
  /** Names of the three feed languages, in this page's language. */
  languageNames: Record<LanguageCode, string>;
  languageNavLabel: string;
  feedUrlLabel: string;
  viewFeed: string;
  copyUrl: string;
  copy: string;
  copied: string;
  pressAndHoldToCopy: string;
  features: { title: string; html: string }[];
  recentConferences: string;
  monthNames: string[];
  /** Heading for one conference, e.g. "April 2026". */
  conferenceDate: (month: number, year: number) => string;
  /** Line under the heading, e.g. "April 2026 General Conference". */
  conferenceName: (month: number, year: number) => string;
  sessionCount: (n: number) => string;
  availableFeeds: string;
  oneClickSubscribe: string;
  feedLanguageLabel: string;
  rssFeed: string;
  manualSubscribe: string;
  manualSteps: string[];
  appleNoteHtml: string;
  episodeTypes: string;
  episodeTypesIntro: string;
  episodeTypeItemsHtml: string[];
  supportedApps: string;
  supportedAppsIntro: string;
  supportedAppItems: string[];
  footerSourceHtml: (churchLink: string) => string;
  viewOnGitHub: string;
  lastUpdated: string;
}

const EN_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const eng: SiteStrings = {
  htmlLang: 'en',
  title: 'General Conference Podcast',
  metaDescription:
    'Subscribe to general conference audio from The Church of Jesus Christ of Latter-day Saints',
  subtitle:
    'Audio from general conference, the worldwide gathering of The Church of Jesus Christ of Latter-day Saints',
  languageNames: { eng: 'English', spa: 'Spanish', por: 'Portuguese' },
  languageNavLabel: 'Page language',
  feedUrlLabel: 'Podcast Feed URL:',
  viewFeed: 'View Feed',
  copyUrl: 'Copy URL',
  copy: 'Copy',
  copied: 'Copied!',
  pressAndHoldToCopy: 'Press and hold to copy',
  features: [
    {
      title: 'Full Sessions',
      html: `Complete session recordings (about ${SESSION_HOURS_TEXT} hours) including all talks and music`,
    },
    {
      title: 'Individual Talks',
      html: `Each talk available separately (about ${TALK_MINUTES_TEXT} minutes each)`,
    },
    {
      title: 'Per-Episode Artwork',
      html: 'Speaker portraits appear beside every talk in supported apps',
    },
    { title: 'Multi-Language', html: 'English, Spanish, and Portuguese feeds' },
    {
      title: 'Podcasting 2.0',
      html: 'Stable <code>&lt;podcast:guid&gt;</code> so your subscription survives URL changes',
    },
    {
      title: 'Seasonal Channel Art',
      html: 'Channel image rotates each April and October to match the current conference',
    },
  ],
  recentConferences: 'Recent Conferences',
  monthNames: EN_MONTHS,
  conferenceDate: (month, year) => `${EN_MONTHS[month - 1]} ${year}`,
  conferenceName: (month, year) => `${EN_MONTHS[month - 1]} ${year} General Conference`,
  sessionCount: (n) => `${n} session${n !== 1 ? 's' : ''}`,
  availableFeeds: 'Available Feeds',
  oneClickSubscribe: 'One-Click Subscribe',
  feedLanguageLabel: 'Feed language',
  rssFeed: 'RSS Feed',
  manualSubscribe: 'Manual Subscribe',
  manualSteps: [
    'Copy a feed URL above',
    'Open your podcast app',
    'Look for "Add by URL" or "Add RSS Feed"',
    'Paste the URL and confirm',
  ],
  appleNoteHtml:
    '<strong>Apple Podcasts:</strong> the Search tab only finds shows listed in Apple\'s directory, and these feeds are not listed, so a pasted URL shows "No Results". Use <strong>Library &rarr; &hellip; (top right) &rarr; Follow a Show by URL</strong> instead, or tap the Apple Podcasts button above after choosing your language.',
  episodeTypes: 'Episode Types',
  episodeTypesIntro: 'The feed includes two types of episodes:',
  episodeTypeItemsHtml: [
    `<strong>Full Session</strong> - Complete session recording (about ${SESSION_HOURS_TEXT} hours). Great for listening to an entire session.`,
    `<strong>Individual Talks</strong> - Each speaker's talk separately (about ${TALK_MINUTES_TEXT} min). Perfect for focused study.`,
  ],
  supportedApps: 'Supported Apps',
  supportedAppsIntro: 'This feed works with any podcast app that supports RSS:',
  supportedAppItems: [
    'Apple Podcasts',
    'Overcast',
    'Pocket Casts',
    'Castro',
    'Spotify (via RSS)',
    'Any RSS reader',
  ],
  footerSourceHtml: (link) =>
    `Audio content from <a href="${link}">churchofjesuschrist.org</a>.
      This is an unofficial feed for personal use.`,
  viewOnGitHub: 'View on GitHub',
  lastUpdated: 'Last updated:',
};

export const SITE_STRINGS: Partial<Record<LanguageCode, SiteStrings>> = { eng };
