# General Conference Podcast

Podcast RSS feed generator for General Conference audio from The Church of Jesus Christ of Latter-day Saints.

## Subscribe

Add a feed URL to your podcast app:

**English:**
```
https://nanodba.github.io/gc_podcast/audio.xml
```

**Spanish:**
```
https://nanodba.github.io/gc_podcast/audio-es.xml
```

**Portuguese:**
```
https://nanodba.github.io/gc_podcast/audio-pt.xml
```

Works with Apple Podcasts, Overcast, Pocket Casts, Castro, and any RSS reader.

> **Note:** If you fork this repo, your feed URLs will be at `https://YOUR_USERNAME.github.io/gc_podcast/audio.xml`

## What's Included

- **Full Sessions**: Complete 2-hour session recordings with all talks and music
- **Individual Talks**: Each speaker's talk separately (10-20 min)
- **Per-Episode Artwork**: Speaker portraits appear next to each talk in supported podcast clients (`<itunes:image>` per item)
- **Conference-Branded Channel Art**: Channel artwork rotates each April/October to match the current conference's hero imagery
- **Podcasting 2.0 compliant**: Stable `<podcast:guid>` derived from the feed URL so clients can track you across URL changes
- **Three Languages**: English, Spanish, Portuguese — each a separate feed with its own audio
- **Recent Conferences**: The feed auto-updates as new conferences are published; default window is 2026+

## Setup Your Own Feed

### 1. Fork and Configure

1. Fork this repository
2. Enable GitHub Pages: Settings > Pages > Build and deployment > Source: `GitHub Actions`
3. Your feed will be at `https://YOUR_USERNAME.github.io/gc_podcast/audio.xml`

### 2. Scrape Conferences

```bash
npm install

# Scrape recent conferences (last 2 years)
npm run scrape-all -- --recent

# Or scrape a specific range
npm run scrape-all -- -s 2020 -e 2025

# Or scrape all available (1971+)
npm run scrape-all -- --all
```

### 3. Generate Feeds

```bash
# Generate all language feeds
npm run feed -- --all-languages -b https://YOUR_USERNAME.github.io/gc_podcast

# Or single language
npm run feed -- -l eng -b https://YOUR_USERNAME.github.io/gc_podcast
```

### 4. Commit and Push

```bash
git add output/ docs/
git commit -m "Update conference data"
git push
```

## Automated Updates

The GitHub Actions workflow automatically checks for new conference content:

- **Conference window (Apr/Oct 1-13):** Checks 3x daily (8 AM, 12 PM, 8 PM MDT)
- **Rest of year:** Monthly check on the 15th

This schedule aligns with the Church's [official release timeline](https://www.churchofjesuschrist.org/learn/ways-to-watch-general-conference?lang=eng):

- **Full session audio:** Gospel Library within 24 hours of each session
- **Individual talks:** Gospel Library by Wednesday after conference weekend
- **All languages:** Text within 2 weeks (audio varies)

To trigger manually: Actions > "Update Podcast Feed" > Run workflow

## CLI Reference

### Scrape Single Conference

```bash
npm run dev -- -y 2024 -m 4           # April 2024
npm run dev -- -y 2025 -m 10 -l spa   # October 2025, Spanish
```

### Scrape Multiple Conferences

```bash
npm run scrape-all                    # Last 5 years
npm run scrape-all -- --recent        # Last 2 years
npm run scrape-all -- --all           # All (1971+)
npm run scrape-all -- -s 2020 -e 2025 # Specific range
npm run scrape-all -- -l spa          # Spanish
```

### Generate Feed

```bash
npm run feed                                    # English only
npm run feed -- --all-languages                 # All languages
npm run feed -- -l spa -f ./docs/feed-spa.xml   # Custom output
npm run feed -- --no-sessions                   # Talks only
npm run feed -- --no-talks                      # Sessions only
```

## Project Structure

```
gc_podcast/
├── src/
│   ├── index.ts            # CLI for single-conference scrape
│   ├── scraper.ts          # Conference scraping (API-first w/ HTML fallbacks)
│   ├── scrape-all.ts       # Batch scraping across year ranges
│   ├── rss-generator.ts    # RSS / Podcasting 2.0 feed generator
│   ├── generate-feed.ts    # CLI for feed generation
│   ├── generate-index.ts   # CLI that builds docs/index.html from feed data
│   ├── image-extractor.ts  # IIIF hash parsing + canonical image URL builder
│   ├── html-parser.ts      # HTML parsing utilities
│   ├── languages.ts        # Per-language channel config (eng/spa/por)
│   ├── logger.ts           # Structured JSON logging
│   ├── migrations.ts       # Schema version enforcement + migration registry
│   ├── schemas.ts          # zod runtime validation for scraped data
│   ├── types.ts            # TypeScript types
│   ├── uuid.ts             # UUID v5 (for podcast:guid)
│   └── version.ts          # Package version → RSS <generator> tag
├── output/                 # Scraped conference JSON (one file per conf × language)
├── docs/                   # GitHub Pages (auto-generated, committed)
│   ├── audio.xml           # English feed
│   ├── audio-es.xml        # Spanish feed
│   ├── audio-pt.xml        # Portuguese feed
│   └── index.html          # Landing page (generate-index.ts)
├── tests/                  # vitest unit + integration tests
├── SPEC.md                 # Authoritative data-format & stability spec
└── .github/workflows/
    ├── update-feed.yml     # Scheduled scrape + feed regeneration
    ├── codeql.yml          # CodeQL security scanning
    └── dependency-review.yml  # PR dependency review
```

See [SPEC.md](./SPEC.md) for the authoritative data-format specification, stability guarantees, and change log.

## Data Format

Conference data is stored as JSON. See [SPEC.md](./SPEC.md) for the authoritative schema and stability guarantees.

```json
{
  "scraped_at": "2026-04-20T12:00:00.000Z",
  "version": "1.0",
  "conference": {
    "year": 2026,
    "month": 4,
    "name": "April 2026 general conference",
    "conference_image_url": "https://www.churchofjesuschrist.org/imgs/<hash>/square/3000,3000/0/default",
    "sessions": [
      {
        "name": "Saturday Morning Session",
        "audio": { "url": "...", "duration_ms": 7032458 },
        "talks": [
          {
            "title": "Talk Title",
            "image_url": "https://www.churchofjesuschrist.org/imgs/<hash>/full/!1400,1400/0/default.jpg",
            "speaker": {
              "name": "Elder Name",
              "role_tag": "quorum-of-the-twelve",
              "calling": "Of the Quorum of the Twelve Apostles",
              "role_observed": "current",
              "bio_url": "https://www.churchofjesuschrist.org/learn/elder-name?lang=eng",
              "image_url": "https://www.churchofjesuschrist.org/imgs/<hash>/full/!1400,1400/0/default.jpg"
            },
            "audio": { "url": "...", "duration_ms": 795561 }
          }
        ]
      }
    ]
  }
}
```

### Speaker Role Tags

| Role Tag | Description |
|----------|-------------|
| `first-presidency` | President, First/Second Counselor |
| `quorum-of-the-twelve` | Members of the Quorum of the Twelve |
| `null` | All other speakers |

### Speaker `role_observed` semantics

| Value | Meaning |
|-------|---------|
| `"current"` (default) | `role_tag` / `calling` reflect what the church page shows *today*. For older talks this may not match the speaker's role at the time they gave the talk. |
| `"at-time-of-talk"` | Role resolved to the calling active at the conference date (reserved for future enrichment). |

See [SPEC.md §12.9](./SPEC.md) for the full temporal-role discussion.

### Schema version

The `version` field (currently `"1.0"`) is enforced at runtime. A mismatched version causes both the scraper and the feed generator to refuse the file rather than silently consuming stale data. Add migrations under `src/migrations.ts` to support future bumps.

## Development

### Testing

```bash
npm test              # Run the full test suite (vitest)
npm run test:watch    # Watch mode
npm run lint          # ESLint (src + tests)
npm run format        # Prettier write
npm run format:check  # Prettier check (CI)
```

### Quality gates

Every push runs in CI:
- TypeScript type-check (`tsc --noEmit`)
- ESLint
- Full vitest suite
- CodeQL static analysis (JavaScript/TypeScript)
- Dependency review (pull requests)

See [.github/SECURITY.md](./.github/SECURITY.md) for security-reporting posture.

## License

MIT

## Disclaimer

Unofficial project. This repository hosts code that generates podcast-friendly RSS feeds pointing at audio hosted by The Church of Jesus Christ of Latter-day Saints. Audio and imagery remain the property of their rightful owners; all URLs in the generated feeds hotlink back to `churchofjesuschrist.org` and/or CDNs.