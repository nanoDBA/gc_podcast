# General Conference Podcast

A podcast RSS feed generator for General Conference talks from The Church of Jesus Christ of Latter-day Saints.

## Features

- **Podcast RSS Feed**: iTunes-compatible RSS feed with full metadata
- **Full Sessions**: Complete 2-hour session recordings
- **Individual Talks**: Each talk available separately (10-20 minutes)
- **Historical Archives**: Conferences dating back to the 1970s
- **Multi-Language Support**: English, Spanish, Portuguese
- **Auto-Updates**: GitHub Actions workflow updates the feed automatically

## Subscribe to the Podcast

Copy the feed URL and add it to your podcast app:

```
https://YOUR_USERNAME.github.io/gc_podcast/feed.xml
```

Works with:
- Apple Podcasts
- Overcast
- Pocket Casts
- Castro
- Google Podcasts
- Any RSS reader

## Usage

### Prerequisites

- Node.js 18+
- npm

### Installation

```bash
npm install
```

### Scrape a Conference

```bash
# Scrape October 2025 (default)
npm run dev

# Scrape a specific conference
npm run dev -- -y 2024 -m 4

# Scrape in Spanish
npm run dev -- -y 2025 -m 10 -l spa
```

### Scrape Multiple Conferences

```bash
# Last 5 years (default)
npm run scrape-all

# Last 2 years
npm run scrape-all -- --recent

# All available conferences (1971+)
npm run scrape-all -- --all

# Specific range
npm run scrape-all -- -s 2020 -e 2025
```

### Generate RSS Feed

```bash
# Generate feed from scraped data
npm run feed

# With custom base URL
npm run feed -- -b https://myuser.github.io/gc_podcast
```

### Full Update

```bash
# Scrape recent conferences and regenerate feed
npm run update
```

## Deployment

### GitHub Pages (Recommended)

1. Fork this repository
2. Enable GitHub Pages in repository settings (source: `docs` folder)
3. Update the feed URL in `docs/index.html`
4. The GitHub Action will automatically update the feed monthly

### Manual Deployment

1. Run `npm run update` to scrape conferences and generate the feed
2. Deploy the `docs/` folder to any static hosting service

## Project Structure

```
gc_podcast/
├── src/
│   ├── index.ts           # CLI entry point for single conference
│   ├── scraper.ts         # Conference scraping logic
│   ├── scrape-all.ts      # Batch scraping multiple conferences
│   ├── rss-generator.ts   # RSS/podcast feed generator
│   ├── generate-feed.ts   # CLI for feed generation
│   ├── html-parser.ts     # HTML parsing utilities
│   └── types.ts           # TypeScript type definitions
├── output/                # Scraped conference JSON files
├── docs/                  # GitHub Pages site
│   ├── feed.xml          # Podcast RSS feed
│   └── index.html        # Landing page
├── .github/workflows/
│   └── update-feed.yml   # Auto-update workflow
├── SPEC.md               # Data specification
└── package.json
```

## Data Format

Each conference is saved as JSON with this structure:

```json
{
  "scraped_at": "2026-01-08T12:00:00.000Z",
  "version": "1.0",
  "conference": {
    "year": 2025,
    "month": 10,
    "name": "October 2025 general conference",
    "sessions": [
      {
        "name": "Saturday Morning Session",
        "audio": {
          "url": "https://assets.churchofjesuschrist.org/...-128k-en.mp3",
          "duration_ms": 7032458
        },
        "talks": [
          {
            "title": "Blessed Are the Peacemakers",
            "speaker": {
              "name": "Elder Gary E. Stevenson",
              "role_tag": "quorum-of-the-twelve",
              "calling": "Of the Quorum of the Twelve Apostles"
            },
            "audio": {
              "url": "https://assets.churchofjesuschrist.org/...-128k-en.mp3",
              "duration_ms": 795561
            }
          }
        ]
      }
    ]
  }
}
```

## Speaker Role Tags

Speakers are classified by role at the time of their talk:

| Role Tag | Description |
|----------|-------------|
| `first-presidency` | President, First/Second Counselor |
| `quorum-of-the-twelve` | Members of the Quorum of the Twelve |
| `null` | All other speakers (Seventies, Relief Society, etc.) |

## API

The scraper uses the Church's content API:

```
https://www.churchofjesuschrist.org/study/api/v3/language-pages/type/content?lang=eng&uri=/general-conference/2025/10/12stevenson
```

This returns JSON with:
- `meta.audio[]` - Audio MP3 URLs
- `meta.title` - Talk title
- `content.body` - HTML with speaker info and duration

## License

MIT License - See LICENSE file for details.

## Disclaimer

This is an unofficial project for personal use. Audio content is sourced from and hosted by The Church of Jesus Christ of Latter-day Saints at churchofjesuschrist.org.
