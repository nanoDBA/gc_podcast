/**
 * General Conference Data Types
 * Based on SPEC.md v1.0
 */

// Supported languages
export type Language = 'eng' | 'spa' | 'por';

// Simplified role classification for filtering/display purposes
export type SpeakerRoleTag = 'first-presidency' | 'quorum-of-the-twelve' | null;

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
