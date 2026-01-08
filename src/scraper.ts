/**
 * General Conference Scraper
 * Extracts conference metadata and audio links from churchofjesuschrist.org
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  findAll,
  findByDataContentType,
  extractTitle,
  findHrefs,
  getText,
  findTextByClass,
  extractJsonValue,
  extractJsonNumber,
  getAttr,
} from './html-parser.js';
import {
  Conference,
  Session,
  Talk,
  Speaker,
  AudioAsset,
  SpeakerRoleTag,
  Language,
  ScraperConfig,
  DEFAULT_CONFIG,
} from './types.js';

const BASE_URL = 'https://www.churchofjesuschrist.org';
const API_BASE = 'https://www.churchofjesuschrist.org/study/api/v3/language-pages/type/content';

// Language code mapping for URLs and audio files
const LANG_URL_MAP: Record<Language, string> = {
  eng: 'eng',
  spa: 'spa',
  por: 'por',
};

const LANG_AUDIO_MAP: Record<Language, string> = {
  eng: 'en',
  spa: 'es',
  por: 'pt',
};

// API response interfaces
interface ApiAudioEntry {
  mediaUrl: string;
  variant: string;
}

interface ApiResponse {
  meta: {
    title: string;
    audio?: ApiAudioEntry[];
    pageAttributes?: Record<string, string>;
  };
  content: {
    body: string;
  };
}

/**
 * Main scraper class
 */
export class ConferenceScraper {
  private config: ScraperConfig;
  private lastRequestTime = 0;

  constructor(config: Partial<ScraperConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Scrape a complete conference
   */
  async scrapeConference(year: number, month: 4 | 10): Promise<Conference> {
    const langCode = LANG_URL_MAP[this.config.language];
    const monthStr = month.toString().padStart(2, '0');
    const conferenceUrl = `${BASE_URL}/study/general-conference/${year}/${monthStr}?lang=${langCode}`;

    console.log(`Scraping conference: ${conferenceUrl}`);

    // Fetch and parse the conference index page
    const html = await this.fetchWithRateLimit(conferenceUrl);

    // Extract conference name
    const conferenceName = this.extractConferenceName(html, year, month);

    // Extract sessions and talks from the index
    const sessions = await this.extractSessionsFromIndex(html, year, monthStr, langCode);

    // Optionally fetch audio for each session and talk
    if (this.config.includeSessionAudio || this.config.includeTalkAudio) {
      await this.enrichWithAudio(sessions);
    }

    return {
      year,
      month,
      name: conferenceName,
      url: conferenceUrl,
      language: this.config.language,
      sessions,
    };
  }

  /**
   * Extract conference name from page
   */
  private extractConferenceName(html: string, year: number, month: number): string {
    // Try to find h1 title
    const h1Match = html.match(/<h1[^>]*>([^<]+)</i);
    if (h1Match) {
      return h1Match[1].trim();
    }

    // Try title tag
    const titleMatch = html.match(/<title[^>]*>([^<]+)</i);
    if (titleMatch) {
      return titleMatch[1].replace(/\s*[-|].*$/, '').trim();
    }

    // Fallback to constructed name
    const monthName = month === 4 ? 'April' : 'October';
    return `${monthName} ${year} General Conference`;
  }

  /**
   * Extract sessions and talks from the conference index page
   */
  private async extractSessionsFromIndex(
    html: string,
    year: number,
    monthStr: string,
    langCode: string
  ): Promise<Session[]> {
    const sessions: Session[] = [];
    let currentSession: Session | null = null;
    let sessionOrder = 0;
    let talkOrder = 0;

    // Find session elements
    const sessionElements = findByDataContentType(html, 'general-conference-session');
    const talkElements = findByDataContentType(html, 'general-conference-talk');

    // Build a map of position in HTML to element type
    interface IndexItem {
      type: 'session' | 'talk';
      position: number;
      element: { content: string; outerHtml: string; attrs: Record<string, string> };
    }

    const items: IndexItem[] = [];

    for (const el of sessionElements) {
      const pos = html.indexOf(el.outerHtml);
      items.push({ type: 'session', position: pos, element: el });
    }

    for (const el of talkElements) {
      const pos = html.indexOf(el.outerHtml);
      items.push({ type: 'talk', position: pos, element: el });
    }

    // Sort by position in document
    items.sort((a, b) => a.position - b.position);

    // Process in document order
    for (const item of items) {
      if (item.type === 'session') {
        // Save previous session if exists
        if (currentSession) {
          sessions.push(currentSession);
        }

        sessionOrder++;
        talkOrder = 0;

        const sessionTitle = extractTitle(item.element) || `Session ${sessionOrder}`;
        const hrefs = findHrefs(item.element.content, 'session');
        const sessionLink = hrefs[0] || '';
        const sessionSlug = this.extractSlugFromUrl(sessionLink);

        currentSession = {
          name: sessionTitle,
          slug: sessionSlug || `session-${sessionOrder}`,
          order: sessionOrder,
          url: sessionLink ? this.normalizeUrl(sessionLink, langCode) : '',
          talks: [],
        };
      } else if (item.type === 'talk' && currentSession) {
        talkOrder++;

        const talkTitle = extractTitle(item.element) || `Talk ${talkOrder}`;
        const hrefs = findHrefs(item.element.content);
        // Find the talk link (not session link)
        const talkLink = hrefs.find(h => !h.includes('session')) || hrefs[0] || '';
        const talkSlug = this.extractSlugFromUrl(talkLink);

        // Try to extract speaker name from the element
        const speakerName = this.extractSpeakerNameFromElement(item.element.content);

        const talk: Talk = {
          title: talkTitle,
          slug: talkSlug || `talk-${talkOrder}`,
          order: talkOrder,
          url: talkLink ? this.normalizeUrl(talkLink, langCode) : '',
          speaker: {
            name: speakerName || 'Unknown Speaker',
            role_tag: null,
          },
        };

        currentSession.talks.push(talk);
      }
    }

    // Don't forget the last session
    if (currentSession) {
      sessions.push(currentSession);
    }

    return sessions;
  }

  /**
   * Extract speaker name from element content
   */
  private extractSpeakerNameFromElement(content: string): string {
    // Look for author/speaker classes
    let name = findTextByClass(content, 'author');
    if (name && !name.includes('Session')) return name;

    name = findTextByClass(content, 'speaker');
    if (name && !name.includes('Session')) return name;

    // Look for second line of text (title is usually first, speaker second)
    const textContent = getText(content);
    const lines = textContent.split(/\s{2,}/).filter(l => l.length > 0);
    if (lines.length >= 2) {
      // The second part might be the speaker
      const potential = lines[1];
      if (potential && !potential.includes('Session') && potential.length < 50) {
        return potential;
      }
    }

    return '';
  }

  /**
   * Enrich sessions and talks with audio information
   */
  private async enrichWithAudio(sessions: Session[]): Promise<void> {
    for (const session of sessions) {
      // Fetch session audio if configured
      if (this.config.includeSessionAudio && session.url) {
        try {
          const sessionData = await this.extractPageData(session.url);
          if (sessionData.audio) {
            session.audio = sessionData.audio;
            session.duration_ms = sessionData.audio.duration_ms;
          }
        } catch (error) {
          console.warn(`  Failed to fetch session audio for ${session.name}:`, error);
        }
      }

      // Fetch talk audio and speaker details if configured
      if (this.config.includeTalkAudio) {
        for (const talk of session.talks) {
          if (talk.url) {
            try {
              const talkData = await this.extractPageData(talk.url);
              if (talkData.audio) {
                talk.audio = talkData.audio;
                talk.duration_ms = talkData.audio.duration_ms;
              }
              if (talkData.speaker) {
                talk.speaker = talkData.speaker;
              }
            } catch (error) {
              console.warn(`  Failed to fetch talk details for ${talk.title}:`, error);
            }
          }
        }
      }
    }
  }

  /**
   * Extract audio and speaker data from a page using the API
   */
  private async extractPageData(url: string): Promise<{
    audio?: AudioAsset;
    speaker?: Speaker;
  }> {
    // Convert page URL to API URL
    // e.g., /study/general-conference/2025/10/12stevenson?lang=eng
    // becomes: /study/api/v3/language-pages/type/content?lang=eng&uri=/general-conference/2025/10/12stevenson
    const urlObj = new URL(url);
    const pathMatch = urlObj.pathname.match(/\/study(.+)/);
    if (!pathMatch) {
      // Fall back to HTML scraping if URL doesn't match expected pattern
      const html = await this.fetchWithRateLimit(url);
      return {
        audio: this.extractAudioFromHtml(html),
        speaker: this.extractSpeakerFromHtml(html),
      };
    }

    const uri = pathMatch[1];
    const lang = urlObj.searchParams.get('lang') || this.config.language;
    const apiUrl = `${API_BASE}?lang=${lang}&uri=${uri}`;

    try {
      const jsonStr = await this.fetchWithRateLimit(apiUrl);
      const apiResponse: ApiResponse = JSON.parse(jsonStr);

      const audio = this.extractAudioFromApi(apiResponse);
      const speaker = this.extractSpeakerFromApi(apiResponse);

      return { audio, speaker };
    } catch (error) {
      console.warn(`  API failed for ${url}, falling back to HTML scraping`);
      const html = await this.fetchWithRateLimit(url);
      return {
        audio: this.extractAudioFromHtml(html),
        speaker: this.extractSpeakerFromHtml(html),
      };
    }
  }

  /**
   * Extract audio information from API response
   */
  private extractAudioFromApi(apiResponse: ApiResponse): AudioAsset | undefined {
    // Get audio URL from meta.audio array
    const audioEntry = apiResponse.meta.audio?.find(a => a.variant === 'audio');
    if (!audioEntry?.mediaUrl) {
      return undefined;
    }

    // Get duration from video tag in body HTML
    const duration = this.extractDuration(apiResponse.content.body);

    return {
      url: audioEntry.mediaUrl,
      quality: '128k',
      language: LANG_AUDIO_MAP[this.config.language],
      duration_ms: duration,
    };
  }

  /**
   * Extract speaker information from API response
   */
  private extractSpeakerFromApi(apiResponse: ApiResponse): Speaker {
    const html = apiResponse.content.body;

    let name = '';
    let calling = '';

    // Extract from author-name class
    const nameMatch = html.match(/<p[^>]*class\s*=\s*["'][^"']*author-name[^"']*["'][^>]*>([^<]+)/i);
    if (nameMatch) {
      name = nameMatch[1].trim();
      // Remove "By " prefix
      name = name.replace(/^By\s+/i, '');
    }

    // Extract from author-role class
    const roleMatch = html.match(/<p[^>]*class\s*=\s*["'][^"']*author-role[^"']*["'][^>]*>([^<]+)/i);
    if (roleMatch) {
      calling = roleMatch[1].trim();
    }

    // Determine role_tag
    const role_tag = this.classifyRole(calling);

    // Construct bio URL from clean name
    const bio_url = name ? this.constructBioUrl(name) : undefined;

    return {
      name: name || apiResponse.meta.title || 'Unknown Speaker',
      role_tag,
      calling: calling || undefined,
      bio_url,
    };
  }

  /**
   * Extract audio information from HTML
   */
  private extractAudioFromHtml(html: string): AudioAsset | undefined {
    const mp3Url = this.findMp3Url(html);
    if (!mp3Url) {
      return undefined;
    }

    const duration = this.extractDuration(html);

    return {
      url: mp3Url,
      quality: '128k',
      language: LANG_AUDIO_MAP[this.config.language],
      duration_ms: duration,
    };
  }

  /**
   * Find MP3 URL in HTML
   */
  private findMp3Url(html: string): string | undefined {
    // Method 1: Look for assets.churchofjesuschrist.org MP3 URLs with language suffix
    const langSuffix = LANG_AUDIO_MAP[this.config.language];
    const specificMp3Regex = new RegExp(
      `https://assets\\.churchofjesuschrist\\.org/[a-z0-9]+-128k-${langSuffix}\\.mp3`,
      'gi'
    );
    const specificMatches = html.match(specificMp3Regex);
    if (specificMatches && specificMatches.length > 0) {
      return specificMatches[0];
    }

    // Method 2: Look for any assets.churchofjesuschrist.org MP3
    const assetsMp3Regex = /https:\/\/assets\.churchofjesuschrist\.org\/[a-z0-9-]+\.mp3/gi;
    const assetsMatches = html.match(assetsMp3Regex);
    if (assetsMatches && assetsMatches.length > 0) {
      return assetsMatches[0];
    }

    // Method 3: Look in source tags
    const sourceMatch = html.match(/source[^>]*src\s*=\s*["']([^"']+\.mp3)["']/i);
    if (sourceMatch) {
      return sourceMatch[1];
    }

    // Method 4: Look for any MP3 URL
    const genericMp3Regex = /https?:\/\/[^\s"'<>]+\.mp3/gi;
    const genericMatches = html.match(genericMp3Regex);
    if (genericMatches && genericMatches.length > 0) {
      return genericMatches[0];
    }

    return undefined;
  }

  /**
   * Extract duration from HTML
   */
  private extractDuration(html: string): number | undefined {
    // Look for duration in various JSON formats
    const patterns = [
      /"duration"\s*:\s*(\d+)/,
      /"durationMs"\s*:\s*(\d+)/,
      /data-duration\s*=\s*["'](\d+)["']/,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        return parseInt(match[1], 10);
      }
    }

    return undefined;
  }

  /**
   * Extract speaker information from HTML
   */
  private extractSpeakerFromHtml(html: string): Speaker {
    let name = '';
    let calling = '';

    // Try to find speaker name in HTML elements
    const namePatterns = [
      /class\s*=\s*["'][^"']*author-name[^"']*["'][^>]*>([^<]+)/i,
      /class\s*=\s*["'][^"']*byline[^"']*["'][^>]*>([^<]+)/i,
      /class\s*=\s*["'][^"']*speaker[^"']*["'][^>]*>([^<]+)/i,
    ];

    for (const pattern of namePatterns) {
      const match = html.match(pattern);
      if (match && match[1].trim()) {
        name = match[1].trim();
        break;
      }
    }

    // Try to find role/calling
    const rolePatterns = [
      /class\s*=\s*["'][^"']*author-role[^"']*["'][^>]*>([^<]+)/i,
      /class\s*=\s*["'][^"']*role[^"']*["'][^>]*>([^<]+)/i,
    ];

    for (const pattern of rolePatterns) {
      const match = html.match(pattern);
      if (match && match[1].trim()) {
        calling = match[1].trim();
        break;
      }
    }

    // Try JSON data if HTML parsing failed
    if (!name) {
      const jsonName = extractJsonValue(html, 'authorName') || extractJsonValue(html, 'author');
      if (jsonName) name = jsonName;
    }

    if (!calling) {
      const jsonRole = extractJsonValue(html, 'authorRole') || extractJsonValue(html, 'role');
      if (jsonRole) calling = jsonRole;
    }

    // Determine role_tag
    const role_tag = this.classifyRole(calling);

    // Construct bio URL
    const bio_url = name ? this.constructBioUrl(name) : undefined;

    return {
      name: name || 'Unknown Speaker',
      role_tag,
      calling: calling || undefined,
      bio_url,
    };
  }

  /**
   * Classify speaker role based on calling text
   *
   * Note on apostolic interregnum: When a Church President dies, the First
   * Presidency is dissolved. The President of the Quorum of the Twelve
   * becomes the presiding authority until a new First Presidency is organized.
   * Former counselors return to their seniority in the Twelve. This logic
   * correctly handles that case since callings reflect "Quorum of the Twelve"
   * or "President of the Quorum" during that period, not "First Presidency".
   */
  private classifyRole(calling: string): SpeakerRoleTag {
    if (!calling) return null;

    const lowerCalling = calling.toLowerCase();

    // First Presidency - must be specifically "The First Presidency" or "President of The Church"
    if (
      lowerCalling.includes('president of the church') ||
      lowerCalling.includes('the first presidency') ||
      // Counselors in THE First Presidency (not Primary, Young Women, etc.)
      ((lowerCalling.includes('first counselor') || lowerCalling.includes('second counselor')) &&
        lowerCalling.includes('first presidency'))
    ) {
      return 'first-presidency';
    }

    // Quorum of the Twelve (includes "President of the Quorum" during interregnum)
    if (
      lowerCalling.includes('quorum of the twelve') ||
      lowerCalling.includes('twelve apostles') ||
      lowerCalling.includes('acting president of the quorum') ||
      lowerCalling.includes('president of the quorum')
    ) {
      return 'quorum-of-the-twelve';
    }

    return null;
  }

  /**
   * Construct bio URL from speaker name
   */
  private constructBioUrl(name: string): string {
    // Convert "Jeffrey R. Holland" to "jeffrey-r-holland"
    const slug = name
      .toLowerCase()
      .replace(/[.]/g, '')
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');

    return `${BASE_URL}/learn/${slug}?lang=${LANG_URL_MAP[this.config.language]}`;
  }

  /**
   * Extract slug from URL
   */
  private extractSlugFromUrl(url: string): string {
    if (!url) return '';

    // Remove query params
    const cleanUrl = url.split('?')[0];

    // Get the last path segment
    const parts = cleanUrl.split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
  }

  /**
   * Normalize URL to full URL with language param
   */
  private normalizeUrl(url: string, langCode: string): string {
    let fullUrl = url;

    // Add base URL if relative
    if (url.startsWith('/')) {
      fullUrl = `${BASE_URL}${url}`;
    }

    // Ensure language param
    if (!fullUrl.includes('lang=')) {
      fullUrl += fullUrl.includes('?') ? `&lang=${langCode}` : `?lang=${langCode}`;
    }

    return fullUrl;
  }

  /**
   * Fetch URL with rate limiting and caching
   */
  private async fetchWithRateLimit(url: string): Promise<string> {
    // Check cache first
    if (this.config.useCache) {
      const cached = await this.readFromCache(url);
      if (cached) {
        console.log(`  [cache] ${this.truncateUrl(url)}`);
        return cached;
      }
    }

    // Rate limit
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.config.rateLimitMs) {
      await this.sleep(this.config.rateLimitMs - timeSinceLastRequest);
    }

    console.log(`  [fetch] ${this.truncateUrl(url)}`);
    this.lastRequestTime = Date.now();

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();

    // Cache the response
    if (this.config.useCache) {
      await this.writeToCache(url, html);
    }

    return html;
  }

  /**
   * Truncate URL for logging
   */
  private truncateUrl(url: string): string {
    const maxLen = 80;
    if (url.length <= maxLen) return url;
    return url.substring(0, maxLen - 3) + '...';
  }

  /**
   * Generate cache key from URL
   */
  private getCacheKey(url: string): string {
    // Create a filesystem-safe key
    const key = url
      .replace(/^https?:\/\//, '')
      .replace(/[^a-z0-9]/gi, '_')
      .substring(0, 150);
    return `${key}.html`;
  }

  /**
   * Read from cache
   */
  private async readFromCache(url: string): Promise<string | null> {
    if (!this.config.cacheDir) return null;

    try {
      const cacheFile = path.join(this.config.cacheDir, this.getCacheKey(url));
      const content = await fs.readFile(cacheFile, 'utf-8');
      return content;
    } catch {
      return null;
    }
  }

  /**
   * Write to cache
   */
  private async writeToCache(url: string, content: string): Promise<void> {
    if (!this.config.cacheDir) return;

    try {
      await fs.mkdir(this.config.cacheDir, { recursive: true });
      const cacheFile = path.join(this.config.cacheDir, this.getCacheKey(url));
      await fs.writeFile(cacheFile, content, 'utf-8');
    } catch (error) {
      // Silently ignore cache write errors (e.g., on Google Drive)
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Convenience function to scrape a conference
 */
export async function scrapeConference(
  year: number,
  month: 4 | 10,
  config: Partial<ScraperConfig> = {}
): Promise<Conference> {
  const scraper = new ConferenceScraper(config);
  return scraper.scrapeConference(year, month);
}
