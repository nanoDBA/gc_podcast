/**
 * CLI to generate podcast RSS feed from scraped conference data
 */

import { generateAndSaveFeed } from './rss-generator.js';

async function main() {
  const args = process.argv.slice(2);

  let outputDir = './output';
  let feedPath = './docs/gc-audio.xml';
  let feedBaseUrl = 'https://your-username.github.io/gc_podcast';
  let includeSessions = true;
  let includeTalks = true;
  let language = 'eng';
  let generateAll = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--output' || arg === '-o') {
      outputDir = args[++i];
    } else if (arg === '--feed' || arg === '-f') {
      feedPath = args[++i];
    } else if (arg === '--base-url' || arg === '-b') {
      feedBaseUrl = args[++i];
    } else if (arg === '--no-sessions') {
      includeSessions = false;
    } else if (arg === '--no-talks') {
      includeTalks = false;
    } else if (arg === '--language' || arg === '-l') {
      language = args[++i];
    } else if (arg === '--all-languages') {
      generateAll = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  if (generateAll) {
    // Generate feeds for all languages
    const languages = [
      { code: 'eng', file: 'gc-audio.xml' },
      { code: 'spa', file: 'gc-audio-es.xml' },
      { code: 'por', file: 'gc-audio-pt.xml' },
    ];

    console.log('Generating RSS feeds for all languages...');
    console.log(`  Input directory: ${outputDir}`);
    console.log(`  Base URL: ${feedBaseUrl}`);

    for (const lang of languages) {
      const langFeedPath = feedPath.replace('gc-audio.xml', lang.file);
      console.log(`\nGenerating ${lang.code.toUpperCase()} feed: ${langFeedPath}`);

      try {
        await generateAndSaveFeed(outputDir, langFeedPath, {
          feedBaseUrl,
          includeSessions,
          includeTalks,
          language: lang.code,
        });
        console.log(`  Done!`);
      } catch (error) {
        console.error(`  Error: ${error}`);
      }
    }

    console.log('\nAll feeds generated!');
  } else {
    // Generate single feed
    console.log('Generating RSS feed...');
    console.log(`  Input directory: ${outputDir}`);
    console.log(`  Output feed: ${feedPath}`);
    console.log(`  Base URL: ${feedBaseUrl}`);
    console.log(`  Language: ${language}`);
    console.log(`  Include sessions: ${includeSessions}`);
    console.log(`  Include talks: ${includeTalks}`);

    try {
      await generateAndSaveFeed(outputDir, feedPath, {
        feedBaseUrl,
        includeSessions,
        includeTalks,
        language,
      });
      console.log('\nFeed generated successfully!');
    } catch (error) {
      console.error('Error generating feed:', error);
      process.exit(1);
    }
  }
}

function printHelp() {
  console.log(`
Generate Podcast RSS Feed

Usage: npx tsx src/generate-feed.ts [options]

Options:
  -o, --output <dir>     Directory with conference JSON files (default: ./output)
  -f, --feed <path>      Output feed file path (default: ./docs/feed.xml)
  -b, --base-url <url>   Base URL where feed will be hosted
  -l, --language <code>  Language code: eng, spa, por (default: eng)
  --all-languages        Generate feeds for all languages (feed.xml, feed-spa.xml, feed-por.xml)
  --no-sessions          Exclude full session recordings
  --no-talks             Exclude individual talk recordings
  -h, --help             Show this help message

Examples:
  npx tsx src/generate-feed.ts
  npx tsx src/generate-feed.ts -b https://myuser.github.io/gc_podcast
  npx tsx src/generate-feed.ts --all-languages
  npx tsx src/generate-feed.ts -l spa -f ./docs/feed-spa.xml
`);
}

main();
