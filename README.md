# General Conference Podcast

Podcast RSS feed generator for General Conference audio from The Church of Jesus Christ of Latter-day Saints.

## Subscribe

Add one of these feed URLs to your podcast app:

| Language | Feed URL |
|----------|----------|
| English | `https://nanodba.github.io/gc_podcast/audio.xml` |
| Spanish | `https://nanodba.github.io/gc_podcast/audio-es.xml` |
| Portuguese | `https://nanodba.github.io/gc_podcast/audio-pt.xml` |

Works with Apple Podcasts, Overcast, Pocket Casts, Castro, and any RSS reader.

> **Note:** If you fork this repo, your feed URLs will be at `https://YOUR_USERNAME.github.io/gc_podcast/audio.xml`

## What's Included

- **Full Sessions**: Complete 2-hour session recordings with all talks and music
- **Individual Talks**: Each speaker's talk separately (10-20 min)
- **Recent Conferences**: 2024-2025 currently available

## Setup Your Own Feed

### 1. Fork and Configure

1. Fork this repository
2. Enable GitHub Pages: Settings > Pages > Source: `Deploy from a branch` > Branch: `main`, folder: `/docs`
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

The included GitHub Actions workflow (`.github/workflows/update-feed.yml`) can update feeds automatically. It runs on the 15th of April and October to catch new conferences.

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
│   ├── index.ts           # CLI for single conference
│   ├── scraper.ts         # Conference scraping logic
│   ├── scrape-all.ts      # Batch scraping
│   ├── rss-generator.ts   # RSS feed generator
│   ├── generate-feed.ts   # CLI for feed generation
│   ├── html-parser.ts     # HTML parsing utilities
│   └── types.ts           # TypeScript types
├── output/                # Scraped conference JSON
├── docs/                  # GitHub Pages
│   ├── audio.xml      # English feed
│   ├── audio-es.xml   # Spanish feed
│   ├── audio-pt.xml   # Portuguese feed
│   └── index.html                # Landing page
└── .github/workflows/
    └── update-feed.yml    # Auto-update workflow
```

## Data Format

Conference data is stored as JSON:

```json
{
  "scraped_at": "2025-01-08T12:00:00.000Z",
  "version": "1.0",
  "conference": {
    "year": 2025,
    "month": 4,
    "name": "April 2025 general conference",
    "sessions": [
      {
        "name": "Saturday Morning Session",
        "audio": { "url": "...", "duration_ms": 7032458 },
        "talks": [
          {
            "title": "Talk Title",
            "speaker": {
              "name": "Elder Name",
              "role_tag": "quorum-of-the-twelve",
              "calling": "Of the Quorum of the Twelve Apostles"
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

## License

MIT

## Disclaimer

Unofficial project for personal use. Audio content is from churchofjesuschrist.org.
