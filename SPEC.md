# General Conference Data Extraction Specification

## Overview

This specification defines the data structures and extraction logic for retrieving metadata and audio links from The Church of Jesus Christ of Latter-day Saints General Conference website.

## 1. Conference Cadence

General Conference occurs **semi-annually**:
- **April** (first weekend)
- **October** (first weekend)

### URL Pattern
```
https://www.churchofjesuschrist.org/study/general-conference/{YEAR}/{MONTH}?lang=eng
```

| Month | Code |
|-------|------|
| April | `04` |
| October | `10` |

**Example:** `https://www.churchofjesuschrist.org/study/general-conference/2025/10?lang=eng`

---

## 2. Session Types

Sessions have evolved over time. The system must dynamically detect sessions rather than hardcoding.

### Current Format (2019-present)
| Order | Session Name | Slug |
|-------|--------------|------|
| 1 | Saturday Morning Session | `saturday-morning-session` |
| 2 | Saturday Afternoon Session | `saturday-afternoon-session` |
| 3 | Saturday Evening Session | `saturday-evening-session` |
| 4 | Sunday Morning Session | `sunday-morning-session` |
| 5 | Sunday Afternoon Session | `sunday-afternoon-session` |

### Historical Sessions (may appear in older conferences)
| Session Name | Slug | Era |
|--------------|------|-----|
| General Priesthood Session | `general-priesthood-session` | Pre-2018 |
| General Women's Session | `general-womens-session` | 2014-2019 |
| Relief Society Session | `relief-society-session` | Pre-2014 |
| Young Women Session | `young-women-session` | Historical |

### Session Count Variations
- **4 sessions**: April 2026+ (announced format)
- **5 sessions**: October 2025, standard 2019-2025
- **6 sessions**: Pre-2018 (included Priesthood + Women's)

---

## 3. URL Structures

### 3.1 Conference Index Page
```
/study/general-conference/{YEAR}/{MONTH}?lang=eng
```

### 3.2 Session Page
```
/study/general-conference/{YEAR}/{MONTH}/{session-slug}?lang=eng
```

### 3.3 Individual Talk Page
```
/study/general-conference/{YEAR}/{MONTH}/{talk-slug}?lang=eng
```

#### Talk Slug Convention
The talk slug follows a pattern but has variations:

**Standard Pattern:** `{session-digit}{sequence-digit(s)}{speaker-lastname}`

| Component | Description | Example |
|-----------|-------------|---------|
| Session digit | 1-6, indicating session order | `1` = Sat AM |
| Sequence | Talk order within session | `1`, `2`, ... `9` |
| Lastname | Speaker's surname (lowercase) | `oaks`, `eyring` |

**Examples from October 2025:**
| Slug | Session | Order | Speaker |
|------|---------|-------|---------|
| `19oaks` | 1 (Sat AM) | Special* | Dallin H. Oaks |
| `11eyring` | 1 (Sat AM) | 1 | Henry B. Eyring |
| `12stevenson` | 1 (Sat AM) | 2 | Gary E. Stevenson |
| `21rasband` | 2 (Sat PM) | 1 | Ronald A. Rasband |
| `31kearon` | 3 (Sat Eve) | 1 | Patrick Kearon |
| `41holland` | 4 (Sun AM) | 1 | Jeffrey R. Holland |
| `51bednar` | 5 (Sun PM) | 1 | David A. Bednar |

*Note: `19oaks` uses `9` for introductory/opening remarks (non-standard)

**Important:** Slug patterns are NOT guaranteed to be consistent. The system should extract slugs directly from the conference index page rather than generating them.

---

## 4. Audio Asset URLs

### 4.1 Pattern
```
https://assets.churchofjesuschrist.org/{asset-hash}-{quality}-{language}.mp3
```

| Component | Values | Description |
|-----------|--------|-------------|
| `asset-hash` | Alphanumeric string | Unique identifier per audio file |
| `quality` | `128k` | Bitrate (128 kbps standard) |
| `language` | `en`, `es`, `pt`, etc. | ISO language code |

**Example:**
```
https://assets.churchofjesuschrist.org/q3xnzwtyx9ne5jkpb6l9rtnrqrsxjgi9w2jgpja-128k-en.mp3
```

### 4.2 Audio Types

| Type | Description | Source |
|------|-------------|--------|
| Session Audio | Full session recording | Session page |
| Talk Audio | Individual speaker recording | Talk page |

### 4.3 Extraction Method
Audio URLs must be extracted from page HTML/metadata. They are NOT predictable from the talk URL.

Look for:
- `<source>` tags with `type="audio/mpeg"`
- JSON-LD metadata
- Data attributes on media players

---

## 5. Data Structures

### 5.1 Conference Object

```typescript
interface Conference {
  year: number;                    // e.g., 2025
  month: number;                   // 4 or 10
  name: string;                    // "October 2025 General Conference"
  ordinal?: string;                // "195th Semiannual" (if available)
  url: string;                     // Full URL to conference index
  language: string;                // "eng", "spa", etc.
  sessions: Session[];
}
```

### 5.2 Session Object

```typescript
interface Session {
  name: string;                    // "Saturday Morning Session"
  slug: string;                    // "saturday-morning-session"
  order: number;                   // 1-based position in conference
  url: string;                     // Full URL to session page
  audio?: AudioAsset;              // Full session audio (if available)
  duration_ms?: number;            // Total session duration
  talks: Talk[];
}
```

### 5.3 Talk Object

```typescript
interface Talk {
  title: string;                   // "Blessed Are the Peacemakers"
  slug: string;                    // "12stevenson"
  order: number;                   // 1-based position in session
  url: string;                     // Full URL to talk page
  speaker: Speaker;
  audio?: AudioAsset;              // Individual talk audio
  duration_ms?: number;            // Talk duration in milliseconds
}
```

### 5.4 Speaker Object

```typescript
interface Speaker {
  name: string;                    // "Gary E. Stevenson"
  role_tag?: SpeakerRoleTag;       // Simplified classification for filtering
  calling?: string;                // Full calling text: "Of the Quorum of the Twelve Apostles"
  bio_url?: string;                // Link to speaker bio page
}

/**
 * Simplified role classification for filtering/display purposes.
 * Assigned based on calling AT THE TIME the talk was given.
 */
type SpeakerRoleTag =
  | "first-presidency"      // President, First Counselor, Second Counselor
  | "quorum-of-the-twelve"  // Members of the Quorum of the Twelve Apostles
  | null;                   // All other speakers (Seventies, Relief Society, Primary, etc.)
```

#### Speaker Role Classification Rules

The `role_tag` is a simplified classification used for filtering. It is determined by the speaker's calling **at the time the talk was given**, not their current calling.

| Calling (as stated on talk) | role_tag |
|-----------------------------|----------|
| President of The Church of Jesus Christ of Latter-day Saints | `"first-presidency"` |
| First Counselor in the First Presidency | `"first-presidency"` |
| Second Counselor in the First Presidency | `"first-presidency"` |
| President of the Quorum of the Twelve Apostles | `"quorum-of-the-twelve"` |
| Acting President of the Quorum of the Twelve Apostles | `"quorum-of-the-twelve"` |
| Of the Quorum of the Twelve Apostles | `"quorum-of-the-twelve"` |
| General Authority Seventy | `null` |
| Relief Society General President | `null` |
| General Primary President | `null` |
| Young Men General President | `null` |
| (any other calling) | `null` |

#### Temporal Considerations

1. **Role at time of talk**: The `calling` field captures what was displayed on the talk page, which reflects the speaker's role when they gave the talk.

2. **Apostle tenure assumption**: Members of the Quorum of the Twelve serve for life (until death). If a speaker was an Apostle at the time of a talk, they remained an Apostle unless:
   - They passed away
   - They were called to the First Presidency
   - (Extremely rare) They were released

3. **First Presidency changes**: When a Church President dies, counselors typically return to the Quorum of the Twelve. Historical talks should retain their role_tag as it was at the time of delivery.

4. **Bio URL**: The speaker bio page (e.g., `https://www.churchofjesuschrist.org/learn/john-d-amos?lang=eng`) contains structured JSON data with:
   - Full legal name
   - Birth date
   - Death date (if deceased)
   - Calling history with call dates
   - Current vs "Last Held" calling distinction

---

## 5.5 Speaker Bio Object (Optional Enrichment)

For applications requiring deeper speaker metadata, the bio page can be parsed to extract:

```typescript
interface SpeakerBio {
  name: string;                    // Display name: "Jeffrey R. Holland"
  full_name?: string;              // Legal name: "Jeffrey Roy Holland"
  bio_url: string;                 // URL to bio page
  birth_date?: string;             // ISO date: "1940-12-03"
  death_date?: string;             // ISO date if deceased: "2025-12-27"
  birthplace?: string;             // "St. George, Utah, United States"
  callings: CallingRecord[];       // Calling history
  is_deceased: boolean;            // Derived from presence of death_date
}

interface CallingRecord {
  title: string;                   // "President of the Quorum of the Twelve Apostles"
  organization: string;            // "Quorum of the Twelve Apostles"
  call_date: string;               // ISO date: "2025-10-14"
  call_date_ms?: number;           // Milliseconds: 1760414400000
  is_current: boolean;             // true if under "Calling(s)", false if "Last Held"
}
```

#### Bio Page URL Pattern

```
https://www.churchofjesuschrist.org/learn/{speaker-slug}?lang=eng
```

The `speaker-slug` is typically the speaker's name in lowercase with hyphens:
- `jeffrey-r-holland`
- `john-d-amos`
- `dallin-h-oaks`

#### Bio Page Data Structure

The bio page contains embedded JSON with these key fields:

| HTML Section | Data Available |
|--------------|----------------|
| "Born" | Full legal name, birth date, birthplace |
| "Died" | Death date (only if deceased) |
| "Calling(s)" | Current active callings with call dates |
| "Last Held Calling(s)" | Final callings for deceased leaders |

#### Example: Living Speaker (John D. Amos)

```json
{
  "name": "John D. Amos",
  "full_name": "John Davis Amos",
  "bio_url": "https://www.churchofjesuschrist.org/learn/john-d-amos?lang=eng",
  "birth_date": "1961-11-02",
  "death_date": null,
  "birthplace": "Lafayette, Louisiana, United States",
  "callings": [
    {
      "title": "General Authority Seventy",
      "organization": "General Authority Seventies",
      "call_date": "2025-04-05",
      "is_current": true
    }
  ],
  "is_deceased": false
}
```

#### Example: Deceased Speaker (Jeffrey R. Holland)

```json
{
  "name": "Jeffrey R. Holland",
  "full_name": "Jeffrey Roy Holland",
  "bio_url": "https://www.churchofjesuschrist.org/learn/jeffrey-r-holland?lang=eng",
  "birth_date": "1940-12-03",
  "death_date": "2025-12-27",
  "birthplace": "St. George, Utah, United States",
  "callings": [
    {
      "title": "President of the Quorum of the Twelve Apostles",
      "organization": "Quorum of the Twelve Apostles",
      "call_date": "2025-10-14",
      "is_current": false
    },
    {
      "title": "Quorum of the Twelve Apostles",
      "organization": "Quorum of the Twelve Apostles",
      "call_date": "1994-06-23",
      "is_current": false
    },
    {
      "title": "First Quorum of the Seventy",
      "organization": "First Quorum of the Seventy",
      "call_date": "1989-04-01",
      "is_current": false
    }
  ],
  "is_deceased": true
}
```

#### Determining role_tag from Bio Data

When enriching speaker data from bio pages, the `role_tag` can be derived:

```
IF any calling.title CONTAINS "First Presidency" OR "President of the Church"
  → role_tag = "first-presidency"
ELSE IF any calling.organization = "Quorum of the Twelve Apostles"
  → role_tag = "quorum-of-the-twelve"
ELSE
  → role_tag = null
```

**Important**: For historical talks, use the calling that was active at the time of the talk, not the most recent calling

#### Example Speaker Objects

**First Presidency member:**
```json
{
  "name": "Dallin H. Oaks",
  "role_tag": "first-presidency",
  "calling": "First Counselor in the First Presidency",
  "bio_url": "https://www.churchofjesuschrist.org/learn/dallin-h-oaks?lang=eng"
}
```

**Apostle:**
```json
{
  "name": "Gary E. Stevenson",
  "role_tag": "quorum-of-the-twelve",
  "calling": "Of the Quorum of the Twelve Apostles",
  "bio_url": "https://www.churchofjesuschrist.org/learn/gary-e-stevenson?lang=eng"
}
```

**General Authority Seventy:**
```json
{
  "name": "John D. Amos",
  "role_tag": null,
  "calling": "General Authority Seventy",
  "bio_url": "https://www.churchofjesuschrist.org/learn/john-d-amos?lang=eng"
}
```

**Relief Society leader:**
```json
{
  "name": "Camille N. Johnson",
  "role_tag": null,
  "calling": "Relief Society General President",
  "bio_url": "https://www.churchofjesuschrist.org/learn/camille-n-johnson?lang=eng"
}
```

### 5.5 AudioAsset Object

```typescript
interface AudioAsset {
  url: string;                     // Full MP3 URL
  quality?: string;                // "128k"
  language?: string;               // "en"
  duration_ms?: number;            // Duration in milliseconds
}
```

---

## 6. Extraction Logic

### 6.1 Phase 1: Conference Discovery

**Input:** Conference URL or year/month parameters

**Process:**
1. Construct conference index URL
2. Fetch HTML content
3. Parse session list from `data-content-type="general-conference-session"` elements
4. Parse talk list from `data-content-type="general-conference-talk"` elements
5. Associate talks with their parent sessions

**Output:** Conference object with session/talk metadata (without audio URLs)

### 6.2 Phase 2: Session Audio Extraction

**Input:** Session URLs from Phase 1

**Process:**
1. Fetch each session page
2. Extract audio source URL from media player
3. Extract duration from media metadata

**Output:** Updated Session objects with audio assets

### 6.3 Phase 3: Talk Audio Extraction

**Input:** Talk URLs from Phase 1

**Process:**
1. Fetch each talk page
2. Extract speaker role (not always on index page)
3. Extract audio source URL from media player
4. Extract duration from media metadata

**Output:** Updated Talk objects with full metadata and audio assets

### 6.4 Rate Limiting

To be respectful of the church's servers:
- Maximum **2 concurrent requests**
- Minimum **500ms delay** between requests
- Implement exponential backoff on errors
- Cache responses locally

---

## 7. HTML Parsing Selectors

### 7.1 Conference Index Page

**Sessions:**
```css
li[data-content-type="general-conference-session"]
```

**Session Title:**
```css
li[data-content-type="general-conference-session"] .title
```

**Session Link:**
```css
li[data-content-type="general-conference-session"] a[href*="session"]
```

**Talks:**
```css
li[data-content-type="general-conference-talk"]
```

**Talk Link:**
```css
li[data-content-type="general-conference-talk"] a[href]
```

**Talk Title:**
```css
li[data-content-type="general-conference-talk"] .title
```

### 7.2 Session/Talk Pages

**Audio Source:**
```css
source[type="audio/mpeg"]
audio source[src*=".mp3"]
```

**Speaker Name:**
```css
.author-name
.byline .name
```

**Speaker Role:**
```css
.author-role
.byline .role
```

**Duration (from video/audio element data):**
Look for `duration` attribute or parse from player metadata JSON.

---

## 8. Edge Cases & Error Handling

### 8.1 Missing Audio
Some historical talks may not have audio available. The `audio` field should be `undefined` in these cases.

### 8.2 Multiple Speakers
Rare talks feature multiple speakers (e.g., duets, joint presentations). Store as comma-separated names or array.

### 8.3 Non-Talk Items
Some session items are not traditional talks:
- Sustaining votes
- Statistical reports
- Auditing reports
- Musical numbers

These should still be captured with appropriate titles.

### 8.4 Slug Collisions
When two speakers share a surname in the same conference, slugs may include first initials or numbers. Parse from HTML, don't generate.

### 8.5 Language Variants
Audio is available in multiple languages. Default to English (`en`). Consider adding language parameter for future expansion.

---

## 9. Output Formats

### 9.1 JSON (Primary)

```json
{
  "conference": {
    "year": 2025,
    "month": 10,
    "name": "October 2025 General Conference",
    "url": "https://www.churchofjesuschrist.org/study/general-conference/2025/10?lang=eng",
    "language": "eng"
  },
  "sessions": [
    {
      "name": "Saturday Morning Session",
      "slug": "saturday-morning-session",
      "order": 1,
      "url": "https://www.churchofjesuschrist.org/study/general-conference/2025/10/saturday-morning-session?lang=eng",
      "audio": {
        "url": "https://assets.churchofjesuschrist.org/xxx-128k-en.mp3",
        "duration_ms": 7032000
      },
      "talks": [
        {
          "title": "Introduction",
          "slug": "19oaks",
          "order": 1,
          "url": "https://www.churchofjesuschrist.org/study/general-conference/2025/10/19oaks?lang=eng",
          "speaker": {
            "name": "Dallin H. Oaks",
            "role": "President of the Quorum of the Twelve Apostles"
          },
          "audio": {
            "url": "https://assets.churchofjesuschrist.org/yyy-128k-en.mp3",
            "duration_ms": 213780
          }
        }
      ]
    }
  ]
}
```

### 9.2 Flat CSV (Alternative)

For simpler integrations, a flattened format:

```csv
conference_year,conference_month,session_name,session_order,talk_title,talk_order,speaker_name,speaker_role,talk_audio_url,session_audio_url
2025,10,Saturday Morning Session,1,Introduction,1,Dallin H. Oaks,President of the Quorum of the Twelve Apostles,https://...,https://...
```

---

## 10. Future Considerations

### 10.1 API Discovery
The church website may expose a JSON API. Monitor network requests for potential direct data access.

### 10.2 Archive Support
Historical conferences back to 1971 are available. Older conferences may have different HTML structures.

### 10.3 Video Assets
Video URLs follow similar patterns and could be extracted for future podcast/video support.

### 10.4 Transcripts
Full talk text is available on each talk page and could be extracted for search/indexing.

### 10.5 Multi-Language Support
Structure supports `language` fields for future expansion to Spanish, Portuguese, etc.

---

## 11. Example Conference URLs

| Conference | URL |
|------------|-----|
| October 2025 | `/study/general-conference/2025/10?lang=eng` |
| April 2025 | `/study/general-conference/2025/04?lang=eng` |
| October 2024 | `/study/general-conference/2024/10?lang=eng` |
| April 2020 | `/study/general-conference/2020/04?lang=eng` |
| October 2017 | `/study/general-conference/2017/10?lang=eng` |

---

---

## 12. Data Format and Stability Guarantees

This section documents the stability guarantees that applications consuming this feed can rely upon.

### 12.1 Purpose

This document is the source of truth for developers consuming the `output/gc-*.json` feed data and the generated RSS feeds. It provides concrete guarantees that enable applications to cache and depend on URL stability, GUID immutability, and other critical properties.

**Audience:**
- Feed consumers (mobile apps, web apps, RSS readers)
- Contributors extending the scraper
- Anyone relying on feed URLs for bookmarks, subscriptions, or automation

### 12.2 Feed GUID Stability (STABILITY GUARANTEE)

**Guarantee:** The channel `<podcast:guid>` is a UUID v5 derived from the canonical feed URL. Removing a feed and re-adding it under the same URL produces the identical GUID.

**Implications:**
- Podcast apps use the GUID to detect when a feed URL changes but represents the same logical podcast
- The same feed can be hosted at multiple URLs with the same GUID (e.g., `audio.xml` and a CDN mirror)
- Changing the canonical feed URL produces a new GUID and will appear as a new podcast to subscribers
- Once a GUID is released publicly, it should be treated as immutable

**Example:**

```
English feed URL: https://nanodba.github.io/gc_podcast/audio.xml
Generated GUID: (deterministic UUID v5 based on above URL)

If the file moves to: https://cdn.example.com/gc_podcast/audio.xml
New URL = New GUID (treated as a different podcast)
```

**Non-breaking changes** (GUID unchanged):
- Adding new episodes
- Updating episode metadata (title, description, speaker info)
- Changing CDN hosting (if URL remains stable)

**Breaking changes** (GUID changes):
- Changing the canonical feed URL
- Splitting into multiple feeds (by language, time period, etc.)
- Merging multiple feeds

### 12.3 Item GUID Stability (STABILITY GUARANTEE)

**Guarantee:** Each `<item><guid>` is deterministically derived from the set `{conference_year, conference_month, session_order, item_slug}`. Re-scraping the same conference with the same scraper produces the same GUID.

**Implications:**
- Podcast apps use the item GUID to detect duplicate episodes when updating the feed
- Episodes can be identified by their GUID across app instances, devices, and backups
- Changing the scraper logic (e.g., slug format) may change GUIDs unintentionally — breaking subscriptions
- Once an episode GUID is published, it is permanent for that {year, month, session, slug} tuple

**Example:**

```
Conference: October 2025
Session 1 (Saturday Morning), Item 3 (slug: "12stevenson")
GUID: (deterministic hash of "2025-10-1-12stevenson")

Re-scraping October 2025 in March 2026:
Same GUID = Same episode (no duplicate created)
```

**Non-breaking changes** (GUID stable):
- Updating talk metadata (title, speaker name, duration)
- Fixing speaker role tags
- Adding/updating audio URLs
- Adding per-item artwork

**Breaking changes** (GUID changes):
- Changing the slug derivation logic
- Re-ordering sessions or talks
- Splitting/merging sessions
- Removing and re-adding a talk with a different slug

### 12.4 Audio URL Stability

**Guarantee:** Audio URLs point directly to the Church of Jesus Christ CDN (`assets.churchofjesuschrist.org`). These URLs are cache-friendly and stable within a release cycle, but may change if the Church re-hosts content.

**Implications:**
- Podcast clients that cache audio aggressively will continue playing cached episodes even if the URL changes
- Direct HTTP requests to these URLs are supported for duration detection and metadata extraction
- The URL format is `https://assets.churchofjesuschrist.org/{asset-hash}-{quality}-{language}.mp3`
- Asset hashes are content-addressed (same audio = same hash), so re-hosting produces the same URL

**Non-guaranteed:**
- Long-term availability (Church may re-host or remove content)
- Indefinite CDN presence (URLs may 404 after months/years)
- Multiple language versions of the same asset (some talks may only be available in one language)

### 12.5 Image URL Stability

**Guarantee:** Per-item `<itunes:image>` URLs are IIIF hashes on the Church CDN. They are content-addressed and stable per-revision. Populated from the talk page (primary) or speaker bio page (fallback).

**Implications:**
- Two instances of the same image (e.g., same speaker photo) produce the same URL
- Image URLs are permanent for their content; changing the image URL changes the content
- Once an image is published in a feed, the URL is immutable

**Non-guaranteed:**
- The image remains at that URL indefinitely (CDN garbage collection)
- Image versions track audio changes (an updated talk audio may have original artwork)

### 12.6 Schema Version

**Current version:** `1.0` (present in `output/gc-*.json`)

**Stability guarantee:** Within `1.0`, fields added are always additive (backward-compatible). Removing or renaming fields triggers a major version bump to `2.0`.

**Version bumps trigger:**
- Major version change (e.g., `1.0` → `2.0`): Breaking changes to structure
  - Removed fields
  - Renamed fields
  - Type changes
- Minor version change (e.g., `1.0` → `1.1`): Additive changes (new optional fields)
- Patch version change (e.g., `1.0` → `1.0.1`): Bug fixes, documentation updates (no schema changes)

**Breaking change process:**
1. Announce version 2.0 in README and GitHub releases
2. Publish migration guide with field mappings
3. Maintain 1.0 feeds for 1 release cycle
4. Archive 1.0 documentation in versioned branch

**Runtime enforcement (implemented in gc_podcast-0uc and gc_podcast-hjq):**

Every site that reads a persisted `output/gc-*.json` file routes through
`validateVersion()` in `src/migrations.ts`:

- `src/scrape-all.ts` `isIncomplete()` — a version mismatch flags the file as
  incomplete so the conference is re-scraped rather than silently consumed.
- `src/rss-generator.ts` `loadConferences()` — a version mismatch logs a
  warning and skips the file, so one bad file cannot silently corrupt a feed.

New migrations for future version bumps register in the `MIGRATIONS` map
keyed by `"fromVersion->toVersion"`. A migration must update the `version`
field on the object it returns so subsequent `validateVersion()` calls see
the new version. See `src/migrations.ts` for the registry and
`tests/migrations.test.ts` for the expected contract.

### 12.7 What is NOT Guaranteed

The following fields **may change without notice** because they reflect Church-published data:

| Field | Reason | Example |
|-------|--------|---------|
| `talk.title` | Church edits conference transcripts | "Blessed Are..." → "Blessed Are the Peacemakers" |
| `speaker.name` | Name corrections, canonicalization | "D. Todd Christofferson" → "President D. Todd Christofferson" |
| `speaker.calling` | Church restructures; callings change | "Apostle" → "First Presidency member" |
| `duration_ms` | Audio re-editing, remastering | Duration may shift by seconds |
| `audio.url` | Church re-hosts or removes content | CDN migration, takedowns |
| `speaker.bio_url` | Path changes if Church restructures | URL structure may change |

**Consequence for consumers:** Applications must be prepared to handle these changes gracefully (e.g., display "Calling updated" notices; re-fetch episodes periodically).

### 12.8 Guarantee Change Log

This section tracks breaking changes and major updates to the stability guarantees documented above.

| Date | Change | Reason |
|------|--------|--------|
| 2026-04-20 | Initial stability guarantees (v1.0) | Establish baseline for feed consumers |
| 2026-04-20 | Added `speaker.role_observed` field (§12.9) | Document temporal role semantics |
| 2026-04-20 | Added `talk.image_url` and `speaker.image_url` fields | Per-item `<itunes:image>` support |
| 2026-04-20 | Runtime schema enforcement wired into scrape-all and rss-generator | Fail-loud on version mismatch instead of silent acceptance |
| 2026-04-20 | RSS channel now emits `<generator>` tag with semver from package.json | Feed consumers can identify generator version for debugging |

---

### 12.9 Temporal Speaker-Role Semantics (role_observed)

**Context:** `speaker.role_tag` and `speaker.calling` are derived from the text
displayed on the church talk page at scrape time. For *recent* conferences (last
1–3 years) this is accurate. For *older* talks the church site may show the
speaker's **current** calling rather than the calling they held when the talk
was delivered.

**Example:** Jeffrey R. Holland gave talks as a Seventy in 1990. By 1994 he was
called as an Apostle. A scrape of his 1990 talks in 2026 will show his most
recently held calling (Quorum of the Twelve / First Presidency), not "First
Quorum of the Seventy."

**The `role_observed` field** makes this semantic explicit on the `Speaker` object:

| Value | Meaning |
|-------|---------|
| `"current"` (default) | role_tag / calling reflects what the church page shows *today* — may not match the speaker's role at conference time |
| `"at-time-of-talk"` | role_tag / calling was explicitly resolved to the calling active at the conference date (via bio calling-history enrichment) |

**Current implementation:** All scraped speakers default to `"current"` because
role enrichment from bio calling-history is not yet implemented. The `"at-time-of-talk"`
value is reserved for a future enrichment pass.

**Consumer guidance:**
- For any application where historical accuracy matters (e.g. listing a speaker's
  role when they gave a 1995 talk), treat `role_observed: "current"` values with
  caution for pre-2010 conferences.
- The `calling` field (raw text from the page) is the canonical source; `role_tag`
  is a derived classification that may be incorrect for historical talks.
- When `role_observed` is absent from persisted JSON (older scrapes), treat it as
  `"current"`.

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-08 | Initial specification |
| 1.1 | 2026-04-20 | Added Section 12: Data Format and Stability Guarantees |
| 1.2 | 2026-04-20 | Runtime schema enforcement (§12.6); image URL fields (§12.5); RSS `<generator>` tag |
| 1.2 | 2026-04-20 | Added §12.9: Temporal speaker-role semantics (role_observed) |
