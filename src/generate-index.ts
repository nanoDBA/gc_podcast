/**
 * CLI to generate docs/index.html from feed metadata
 *
 * Reads all output/gc-*.json files + feed XML files in docs/ and produces
 * docs/index.html with feed URLs, recent conferences, and subscribe buttons.
 */

import fs from 'fs';
import path from 'path';
import { Conference } from './types.js';
import { LANGUAGES, LANGUAGE_CODES } from './languages.js';
import { SESSION_HOURS_TEXT, TALK_MINUTES_TEXT } from './episode-lengths.js';

const REPOSITORY_URL = 'https://github.com/nanoDBA/gc_podcast';
const BASE_FEED_URL = 'https://nanodba.github.io/gc_podcast';

interface RecentConference {
  year: number;
  month: number;
  name: string;
  sessionCount: number;
}

async function loadConferenceData(outputDir: string): Promise<RecentConference[]> {
  const conferences: RecentConference[] = [];
  const files = fs.readdirSync(outputDir);

  // Find all gc-*.json files
  const confFiles = files.filter(
    (f) => f.startsWith('gc-') && f.endsWith('-eng.json'), // Only read English to get unique conferences
  );

  for (const file of confFiles) {
    try {
      const content = fs.readFileSync(path.join(outputDir, file), 'utf-8');
      const data = JSON.parse(content);
      const conf = data.conference as Conference;

      conferences.push({
        year: conf.year,
        month: conf.month,
        name: conf.name,
        sessionCount: conf.sessions.length,
      });
    } catch (error) {
      console.warn(`Failed to load ${file}:`, error);
    }
  }

  // Sort by date descending (most recent first)
  conferences.sort((a, b) => {
    const dateA = a.year * 100 + a.month;
    const dateB = b.year * 100 + b.month;
    return dateB - dateA;
  });

  return conferences;
}

function getMonthName(month: number): string {
  const months = [
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
  return months[month - 1] || '';
}

// Without a min-year the list is capped at the 5 newest; with one it shows every
// conference the feeds contain (gc_podcast-qxr).
function generateRecentConferencesHtml(conferences: RecentConference[], minYear?: number): string {
  const recent =
    minYear === undefined ? conferences.slice(0, 5) : conferences.filter((c) => c.year >= minYear);

  let html = '  <h2>Recent Conferences</h2>\n  <div class="conferences">\n';

  for (const conf of recent) {
    html += `    <div class="conference-item">
      <div class="conference-header">
        <strong>${getMonthName(conf.month)} ${conf.year}</strong>
        <span class="session-count">${conf.sessionCount} session${conf.sessionCount !== 1 ? 's' : ''}</span>
      </div>
      <p>${conf.name}</p>
    </div>\n`;
  }

  html += '  </div>\n';
  return html;
}

function generateFeedListHtml(): string {
  let html = '  <h2>Available Feeds</h2>\n  <div class="feed-list">\n';

  for (const lang of LANGUAGE_CODES) {
    const langConfig = LANGUAGES[lang];
    const feedFile = lang === 'eng' ? 'audio.xml' : `audio-${langConfig.audioSuffix}.xml`;

    html += `    <div class="feed-item">
      <strong>${langConfig.displayName}</strong>
      <span class="feed-url-small" id="feed${lang.toUpperCase()}">${feedFile}</span>
      <button class="btn-copy" onclick="copyFeed('feed${lang.toUpperCase()}', this)">Copy</button>
    </div>\n`;
  }

  html += '  </div>\n';
  return html;
}

function generateSubscribeButtonsHtml(): string {
  // Links are filled in by client-side JavaScript for the chosen language.
  const picker = LANGUAGE_CODES.map((lang) => {
    const file = lang === 'eng' ? 'audio.xml' : `audio-${LANGUAGES[lang].audioSuffix}.xml`;
    return `<button type="button" class="lang-btn" data-file="${file}" data-tag="${LANGUAGES[lang].rssLanguageTag}" onclick="setSubscribeFeed(this)">${LANGUAGES[lang].nativeName}</button>`;
  }).join('\n    ');
  return `  <h2>One-Click Subscribe</h2>
  <div class="lang-picker" role="group" aria-label="Feed language">
    ${picker}
  </div>
  <div class="subscribe-buttons" id="subscribeButtons">
    <a class="subscribe-btn apple" href="#" id="appleLink">Apple Podcasts</a>
    <a class="subscribe-btn overcast" href="#" id="overcastLink">Overcast</a>
    <a class="subscribe-btn pocketcasts" href="#" id="pocketcastsLink">Pocket Casts</a>
    <a class="subscribe-btn castro" href="#" id="castroLink">Castro</a>
    <a class="subscribe-btn rss" href="#" id="rssLink">RSS Feed</a>
  </div>
`;
}

function generateHtml(conferences: RecentConference[], minYear?: number): string {
  const lastUpdated = new Date().toISOString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <title>General Conference Podcast</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Subscribe to General Conference audio from The Church of Jesus Christ of Latter-day Saints">
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
      line-height: 1.6;
      color: #333;
      background: #fafafa;
    }
    h1 { color: #1a3a5c; margin-bottom: 10px; }
    h2 { color: #2c5282; margin-top: 40px; }
    a { color: #0066cc; }
    .subtitle { color: #666; margin-bottom: 30px; font-size: 1.1em; }
    .feed-box {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 25px;
      margin: 30px 0;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .feed-url {
      background: #f7fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 12px 15px;
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 14px;
      word-break: break-all;
      margin: 15px 0;
    }
    .btn {
      display: inline-block;
      background: #0066cc;
      color: white;
      padding: 12px 24px;
      border-radius: 6px;
      text-decoration: none;
      font-weight: 500;
      margin-right: 10px;
      margin-top: 10px;
    }
    .btn:hover { background: #0052a3; }
    .btn-secondary {
      background: #fff;
      color: #0066cc;
      border: 1px solid #0066cc;
    }
    .btn-secondary:hover { background: #f0f7ff; }
    .feed-list { margin: 20px 0; }
    .feed-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      margin-bottom: 10px;
    }
    .feed-item strong { min-width: 90px; }
    .feed-url, .feed-url-small { -webkit-user-select: all; user-select: all; }
    .feed-url-small {
      flex: 1;
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 13px;
      color: #4a5568;
      background: #f7fafc;
      padding: 6px 10px;
      border-radius: 4px;
      word-break: break-all;
    }
    .btn-copy {
      background: #0066cc;
      color: white;
      border: none;
      padding: 6px 14px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
    }
    .btn-copy:hover { background: #0052a3; }
    .btn-copy.copied { background: #38a169; }
    .lang-picker { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 0; }
    .lang-btn {
      padding: 8px 14px;
      border: 1px solid #c3cfe2;
      border-radius: 999px;
      background: #fff;
      color: #2c5282;
      font-size: 15px;
      cursor: pointer;
    }
    .lang-btn.active { background: #2c5282; color: #fff; border-color: #2c5282; }
    .subscribe-buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin: 20px 0;
    }
    .subscribe-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 20px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 500;
      font-size: 14px;
      color: white;
      transition: opacity 0.2s;
    }
    .subscribe-btn:hover { opacity: 0.9; }
    .subscribe-btn.apple { background: linear-gradient(135deg, #9b4dca, #d64292); }
    .subscribe-btn.overcast { background: #fc7e0f; }
    .subscribe-btn.pocketcasts { background: #f43e37; }
    .subscribe-btn.castro { background: linear-gradient(135deg, #00ccbf, #00b265); }
    .subscribe-btn.rss { background: #f26522; }
    .features {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin: 30px 0;
    }
    .feature {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 20px;
    }
    .feature h3 { margin-top: 0; color: #2c5282; }
    .conferences {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 15px;
      margin: 20px 0;
    }
    .conference-item {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 15px;
    }
    .conference-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }
    .session-count {
      background: #edf2f7;
      color: #2c5282;
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
    }
    .conference-item p { margin: 8px 0 0 0; color: #666; font-size: 0.95em; }
    /* Custom numbered circles replace the native markers (Safari showed both). */
    .steps { counter-reset: step; list-style: none; padding-left: 0; }
    .steps li {
      counter-increment: step;
      margin: 15px 0;
      padding-left: 35px;
      position: relative;
    }
    .steps li::before {
      content: counter(step);
      position: absolute;
      left: 0;
      top: 0;
      width: 24px;
      height: 24px;
      background: #0066cc;
      color: white;
      border-radius: 50%;
      font-size: 14px;
      font-weight: bold;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    footer {
      margin-top: 60px;
      padding-top: 20px;
      border-top: 1px solid #e2e8f0;
      color: #666;
      font-size: 0.9em;
    }
    .last-updated {
      color: #999;
      font-size: 0.85em;
      margin-top: 20px;
    }
    @media (max-width: 600px) {
      body { padding: 20px 15px; }
      .feed-url { font-size: 12px; }
      .conferences {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <h1>General Conference Podcast</h1>
  <p class="subtitle">Audio recordings from General Conference of The Church of Jesus Christ of Latter-day Saints</p>

  <div class="feed-box">
    <strong>Podcast Feed URL:</strong>
    <div class="feed-url" id="feedUrl">${BASE_FEED_URL}/audio.xml</div>
    <a href="audio.xml" class="btn">View Feed</a>
    <button class="btn btn-secondary" onclick="copyFeed('feedUrl', this)">Copy URL</button>
  </div>

  <div class="features">
    <div class="feature">
      <h3>Full Sessions</h3>
      <p>Complete session recordings (about ${SESSION_HOURS_TEXT} hours) including all talks and music</p>
    </div>
    <div class="feature">
      <h3>Individual Talks</h3>
      <p>Each talk available separately (about ${TALK_MINUTES_TEXT} minutes each)</p>
    </div>
    <div class="feature">
      <h3>Per-Episode Artwork</h3>
      <p>Speaker portraits appear beside every talk in supported apps</p>
    </div>
    <div class="feature">
      <h3>Multi-Language</h3>
      <p>English, Spanish, and Portuguese feeds</p>
    </div>
    <div class="feature">
      <h3>Podcasting 2.0</h3>
      <p>Stable <code>&lt;podcast:guid&gt;</code> so your subscription survives URL changes</p>
    </div>
    <div class="feature">
      <h3>Seasonal Channel Art</h3>
      <p>Channel image rotates each April and October to match the current conference</p>
    </div>
  </div>

${generateRecentConferencesHtml(conferences, minYear)}

${generateFeedListHtml()}

${generateSubscribeButtonsHtml()}

  <h2>Manual Subscribe</h2>
  <ol class="steps">
    <li>Copy a feed URL above</li>
    <li>Open your podcast app</li>
    <li>Look for "Add by URL" or "Add RSS Feed"</li>
    <li>Paste the URL and confirm</li>
  </ol>
  <p><strong>Apple Podcasts:</strong> the Search tab only finds shows listed in Apple's directory, and these feeds are not listed, so a pasted URL shows "No Results". Use <strong>Library &rarr; &hellip; (top right) &rarr; Follow a Show by URL</strong> instead, or tap the Apple Podcasts button above after choosing your language.</p>

  <h2>Episode Types</h2>
  <p>The feed includes two types of episodes:</p>
  <ul>
    <li><strong>Full Session</strong> - Complete session recording (about ${SESSION_HOURS_TEXT} hours). Great for listening to an entire session.</li>
    <li><strong>Individual Talks</strong> - Each speaker's talk separately (about ${TALK_MINUTES_TEXT} min). Perfect for focused study.</li>
  </ul>

  <h2>Supported Apps</h2>
  <p>This feed works with any podcast app that supports RSS:</p>
  <ul>
    <li>Apple Podcasts</li>
    <li>Overcast</li>
    <li>Pocket Casts</li>
    <li>Castro</li>
    <li>Spotify (via RSS)</li>
    <li>Any RSS reader</li>
  </ul>

  <footer>
    <p>
      Audio content from <a href="https://www.churchofjesuschrist.org/study/general-conference">churchofjesuschrist.org</a>.
      This is an unofficial feed for personal use.
    </p>
    <p>
      <a href="${REPOSITORY_URL}">View on GitHub</a>
    </p>
    <div class="last-updated">Last updated: <span id="lastUpdated">${lastUpdated}</span> UTC</div>
  </footer>

  <script>
    const baseUrl = window.location.hostname !== 'localhost'
      ? window.location.origin + window.location.pathname.replace(/\\/[^\\/]*$/, '')
      : '${BASE_FEED_URL}';

    // Update all feed URLs
    document.getElementById('feedUrl').textContent = baseUrl + '/audio.xml';
    document.getElementById('feedENG').textContent = baseUrl + '/audio.xml';
    document.getElementById('feedSPA').textContent = baseUrl + '/audio-es.xml';
    document.getElementById('feedPOR').textContent = baseUrl + '/audio-pt.xml';

    // Copy that works on iOS Safari and in-app browsers (gc_podcast iOS copy
    // bug): async Clipboard API first, then a selection + execCommand fallback
    // done the way WebKit requires, then select the text and ask for a long-press.
    function copyFeed(id, btn) {
      const el = document.getElementById(id);
      const text = el.textContent.trim();
      const done = (ok) => {
        const original = btn.dataset.label || btn.textContent;
        btn.dataset.label = original;
        btn.textContent = ok ? 'Copied!' : 'Press and hold to copy';
        btn.classList.toggle('copied', ok);
        if (!ok) selectText(el);
        setTimeout(() => {
          btn.textContent = original;
          btn.classList.remove('copied');
        }, ok ? 1500 : 4000);
      };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => done(true), () => done(legacyCopy(text)));
      } else {
        done(legacyCopy(text));
      }
    }

    function legacyCopy(text) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.contentEditable = 'true';
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.opacity = '0';
      ta.style.fontSize = '16px'; // below 16px iOS zooms the page on focus
      document.body.appendChild(ta);
      const range = document.createRange();
      range.selectNodeContents(ta);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      ta.setSelectionRange(0, text.length); // iOS ignores ta.select()
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (e) {
        ok = false;
      }
      document.body.removeChild(ta);
      sel.removeAllRanges();
      return ok;
    }

    function selectText(el) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }

    // One-click subscribe links for the chosen language's feed.
    // Reference: https://github.com/nathangathright/podcast-platform-links
    function setSubscribeFeed(btn) {
      const feedUrl = baseUrl + '/' + btn.dataset.file;
      const feedUrlNoProtocol = feedUrl.replace(/^https?:\\/\\//, '');
      const encodedFeed = encodeURIComponent(feedUrl);
      // Apple Podcasts - podcast:// with URL (no protocol)
      document.getElementById('appleLink').href = 'podcast://' + feedUrlNoProtocol;
      // Overcast - the one app that needs the full URL with protocol
      document.getElementById('overcastLink').href = 'overcast://x-callback-url/add?url=' + encodedFeed;
      // Pocket Casts - pktc://subscribe/ with URL (no protocol)
      document.getElementById('pocketcastsLink').href = 'pktc://subscribe/' + feedUrlNoProtocol;
      // Castro - castros:// (note the 's') with URL (no protocol)
      document.getElementById('castroLink').href = 'castros://subscribe/' + feedUrlNoProtocol;
      // RSS Feed (direct link)
      document.getElementById('rssLink').href = feedUrl;
      document.querySelectorAll('.lang-btn').forEach((b) => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
    }

    // Default to the visitor's language when we have a feed for it.
    const langButtons = Array.from(document.querySelectorAll('.lang-btn'));
    const preferred = (navigator.language || 'en').slice(0, 2).toLowerCase();
    setSubscribeFeed(langButtons.find((b) => b.dataset.tag === preferred) || langButtons[0]);
  </script>
</body>
</html>
`;
}

async function main() {
  const args = process.argv.slice(2);

  let outputDir = './output';
  let indexPath = './docs/index.html';
  let minYear: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--output' || arg === '-o') {
      outputDir = args[++i];
    } else if (arg === '--index' || arg === '-i') {
      indexPath = args[++i];
    } else if (arg === '--min-year') {
      minYear = parseInt(args[++i], 10);
      if (!Number.isInteger(minYear)) {
        console.error('--min-year needs a year such as 2025');
        process.exit(1);
      }
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  try {
    // Load conference data
    const conferences = await loadConferenceData(outputDir);

    if (conferences.length === 0) {
      console.warn('No conference data found in', outputDir);
    }

    // Generate HTML
    const html = generateHtml(conferences, minYear);

    // Ensure docs directory exists
    const docsDir = path.dirname(indexPath);
    if (!fs.existsSync(docsDir)) {
      fs.mkdirSync(docsDir, { recursive: true });
    }

    // Write HTML file
    fs.writeFileSync(indexPath, html, 'utf-8');
    console.log(`Generated ${indexPath}`);
  } catch (error) {
    console.error('Failed to generate index:', error);
    process.exit(1);
  }
}

function printHelp() {
  console.log(`
Usage: npx tsx src/generate-index.ts [options]

Options:
  --output, -o <dir>     Path to output directory with JSON files (default: ./output)
  --index, -i <path>     Path to output index.html file (default: ./docs/index.html)
  --min-year <year>      Only list conferences from this year onward (match generate-feed.ts)
  --help, -h             Show this help message
`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
