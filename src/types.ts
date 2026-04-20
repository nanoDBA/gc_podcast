/**
 * General Conference Data Types
 * Based on SPEC.md v1.0
 */

// Supported languages — re-exported from ./languages.js as the single source of truth.
// New callers should import LanguageCode directly from ./languages.js.
import type { LanguageCode } from './languages.js';
export type Language = LanguageCode;

// Simplified role classification for filtering/display purposes
export type SpeakerRoleTag = 'first-presidency' | 'quorum-of-the-twelve' | null;

/**
 * Indicates whether `role_tag` and `calling` reflect the speaker's role at
 * the time the talk was delivered or their current role as of the last scrape.
 *
 * - `"current"` (default): role was read from the church page during scraping
 *   and reflects whatever role text the page shows today. For talks older than
 *   a few years this is almost always the speaker's *current* calling, not
 *   their calling when they gave the talk (e.g. a Seventy who later became an
 *   Apostle will show "Apostle" in old talks).
 *
 * - `"at-time-of-talk"`: role was explicitly resolved to the calling the
 *   speaker held at the conference date (e.g. via bio calling-history
 *   enrichment). Currently not implemented; reserved for a future enrichment
 *   pass. See gc_podcast-5tz and SPEC.md §12.9.
 *
 * Consumers who need historically accurate role data should treat `"current"`
 * values for pre-2010 talks with caution.
 */
export type SpeakerRoleObserved = 'at-time-of-talk' | 'current';

/**
 * Audio asset with URL and metadata
 */
export interface AudioAsset {
  url: string;                     // Full MP3 URL
  quality?: string;                // "128k"
  language?: string;               // "en", "es", "pt"
  duration_ms?: number;            // Duration in milliseconds
}

/**
 * Speaker information as displayed on talk page
 */
export interface Speaker {
  name: string;                    // "Gary E. Stevenson"
  role_tag: SpeakerRoleTag;        // Simplified classification for filtering
  calling?: string;                // Full calling text: "Of the Quorum of the Twelve Apostles"
  bio_url?: string;                // Link to speaker bio page
  image_url?: string;              // Speaker portrait URL, populated by Phase 4 bio page scraping.
  /**
   * Semantic provenance of `role_tag` / `calling`. Defaults to `"current"`
   * (role as of scrape time). See SpeakerRoleObserved and SPEC.md §12.9.
   */
  role_observed?: SpeakerRoleObserved;
}

/**
 * Individual talk within a session
 */
export interface Talk {
  title: string;                   // "Blessed Are the Peacemakers"
  slug: string;                    // "12stevenson"
  order: number;                   // 1-based position in session
  url: string;                     // Full URL to talk page
  speaker: Speaker;
  audio?: AudioAsset;              // Individual talk audio
  duration_ms?: number;            // Talk duration in milliseconds
  image_url?: string;              // Episode-level artwork. Optional. See SPEC.md.
}

/**
 * Session containing multiple talks
 */
export interface Session {
  name: string;                    // "Saturday Morning Session"
  slug: string;                    // "saturday-morning-session"
  order: number;                   // 1-based position in conference
  url: string;                     // Full URL to session page
  audio?: AudioAsset;              // Full session audio (if available)
  duration_ms?: number;            // Total session duration
  talks: Talk[];
  image_url?: string;              // Episode-level artwork. Optional. See SPEC.md.
}

/**
 * Full conference data
 */
export interface Conference {
  year: number;                    // e.g., 2025
  month: number;                   // 4 or 10
  name: string;                    // "October 2025 General Conference"
  ordinal?: string;                // "195th Semiannual" (if available)
  url: string;                     // Full URL to conference index
  language: Language;              // "eng", "spa", "por"
  sessions: Session[];
  /**
   * Conference hero image URL, sourced from the Church's media-collection
   * page for this conference (gc_podcast-8t0). Apple-compliant 1500×1500
   * square crop via the IIIF square region parameter. null when the
   * collection page (and fallback) were unavailable at scrape time.
   */
  conference_image_url?: string | null;
}

/**
 * Calling record from speaker bio page
 */
export interface CallingRecord {
  title: string;                   // "President of the Quorum of the Twelve Apostles"
  organization: string;            // "Quorum of the Twelve Apostles"
  call_date: string;               // ISO date: "2025-10-14"
  call_date_ms?: number;           // Milliseconds timestamp
  is_current: boolean;             // true if under "Calling(s)", false if "Last Held"
}

/**
 * Extended speaker bio data (optional enrichment)
 */
export interface SpeakerBio {
  name: string;                    // Display name: "Jeffrey R. Holland"
  full_name?: string;              // Legal name: "Jeffrey Roy Holland"
  bio_url: string;                 // URL to bio page
  birth_date?: string;             // ISO date: "1940-12-03"
  death_date?: string;             // ISO date if deceased: "2025-12-27"
  birthplace?: string;             // "St. George, Utah, United States"
  callings: CallingRecord[];       // Calling history
  is_deceased: boolean;            // Derived from presence of death_date
}

/**
 * Output file structure
 */
export interface ConferenceOutput {
  scraped_at: string;              // ISO timestamp of when data was scraped
  version: string;                 // Spec version used
  conference: Conference;
}

/**
 * Scraper configuration options
 */
export interface ScraperConfig {
  language: Language;
  includeSessionAudio: boolean;
  includeTalkAudio: boolean;
  rateLimitMs: number;             // Delay between requests
  maxConcurrent: number;           // Max concurrent requests
  cacheDir?: string;               // Directory for caching responses
  useCache: boolean;               // Whether to use cached responses
}

/**
 * Default scraper configuration
 */
export const DEFAULT_CONFIG: ScraperConfig = {
  language: 'eng',
  includeSessionAudio: true,
  includeTalkAudio: true,
  rateLimitMs: 500,
  maxConcurrent: 2,
  cacheDir: '.cache',
  useCache: true,
};
