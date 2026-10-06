/**
 * CLI to generate docs/index.html from feed metadata
 *
 * Reads all output/gc-*.json files + feed XML files in docs/ and produces
 * docs/index.html with feed URLs, recent conferences, and subscribe buttons.
 */

import fs from 'fs';
import path from 'path';
import { Conference } from './types.js';
import { LANGUAGES, LANGUAGE_CODES, type LanguageCode } from './languages.js';
import { SITE_STRINGS, type SiteStrings } from './site-strings.js';

const REPOSITORY_URL = 'https://github.com/nanoDBA/gc_podcast';
const BASE_FEED_URL = 'https://nanodba.github.io/gc_podcast';

interface RecentConference {
  year: number;
  month: number;
  /** The Church's own conference name per language, from the scraped data. */
  names: Partial<Record<LanguageCode, string>>;
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

      const names: Partial<Record<LanguageCode, string>> = { eng: conf.name };
      for (const lang of LANGUAGE_CODES) {
        if (lang === 'eng') continue;
        const sibling = path.join(outputDir, file.replace(/-eng\.json$/, `-${lang}.json`));
        if (!fs.existsSync(sibling)) continue;
        try {
          names[lang] = (
            JSON.parse(fs.readFileSync(sibling, 'utf-8')).conference as Conference
          ).name;
        } catch {
          // fall back to the page language's own wording
        }
      }
      conferences.push({
        year: conf.year,
        month: conf.month,
        names,
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

// Without a min-year the list is capped at the 5 newest; with one it shows every
// conference the feeds contain (gc_podcast-qxr).
function generateRecentConferencesHtml(
  t: SiteStrings,
  lang: LanguageCode,
  conferences: RecentConference[],
  minYear?: number,
): string {
  const recent =
    minYear === undefined ? conferences.slice(0, 5) : conferences.filter((c) => c.year >= minYear);

  let html = `  <h2>${t.recentConferences}</h2>\n  <div class="conferences">\n`;

  for (const conf of recent) {
    html += `    <div class="conference-item">
      <div class="conference-header">
        <strong>${t.conferenceDate(conf.month, conf.year)}</strong>
        <span class="session-count">${t.sessionCount(conf.sessionCount)}</span>
      </div>
      <p>${conf.names[lang] ?? t.conferenceName(conf.month, conf.year)}</p>
    </div>\n`;
  }

  html += '  </div>\n';
  return html;
}

function generateFeedListHtml(t: SiteStrings): string {
  let html = `  <h2>${t.availableFeeds}</h2>\n  <div class="feed-list">\n`;

  for (const lang of LANGUAGE_CODES) {
    const langConfig = LANGUAGES[lang];
    const feedFile = lang === 'eng' ? 'audio.xml' : `audio-${langConfig.audioSuffix}.xml`;

    html += `    <div class="feed-item">
      <strong>${t.languageNames[lang]}</strong>
      <span class="feed-url-small" id="feed${lang.toUpperCase()}">${feedFile}</span>
      <button class="btn-copy" onclick="copyFeed('feed${lang.toUpperCase()}', this)">${t.copy}</button>
    </div>\n`;
  }

  html += '  </div>\n';
  return html;
}

function generateSubscribeButtonsHtml(t: SiteStrings): string {
  // Links are filled in by client-side JavaScript for the chosen language.
  const picker = LANGUAGE_CODES.map((lang) => {
    const file = lang === 'eng' ? 'audio.xml' : `audio-${LANGUAGES[lang].audioSuffix}.xml`;
    return `<button type="button" class="lang-btn" data-file="${file}" data-tag="${LANGUAGES[lang].rssLanguageTag}" onclick="setSubscribeFeed(this)">${LANGUAGES[lang].nativeName}</button>`;
  }).join('\n    ');
  return `  <h2>${t.oneClickSubscribe}</h2>
  <div class="lang-picker" role="group" aria-label="${t.feedLanguageLabel}">
    ${picker}
  </div>
  <div class="subscribe-buttons" id="subscribeButtons">
    <a class="subscribe-btn apple" href="#" id="appleLink">Apple Podcasts</a>
    <a class="subscribe-btn overcast" href="#" id="overcastLink">Overcast</a>
    <a class="subscribe-btn pocketcasts" href="#" id="pocketcastsLink">Pocket Casts</a>
    <a class="subscribe-btn castro" href="#" id="castroLink">Castro</a>
    <a class="subscribe-btn rss" href="#" id="rssLink">${t.rssFeed}</a>
  </div>
`;
}

function generateHtml(
  lang: LanguageCode,
  conferences: RecentConference[],
  minYear?: number,
): string {
  const t = SITE_STRINGS[lang]!;
  const lastUpdated = new Date().toISOString();

  return `<!DOCTYPE html>
<html lang="${t.htmlLang}">
<head>
  <title>${t.title}</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${t.metaDescription}">
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
  <h1>${t.title}</h1>
  <p class="subtitle">${t.subtitle}</p>

  <div class="feed-box">
    <strong>${t.feedUrlLabel}</strong>
    <div class="feed-url" id="feedUrl">${BASE_FEED_URL}/audio.xml</div>
    <a href="audio.xml" class="btn">${t.viewFeed}</a>
    <button class="btn btn-secondary" onclick="copyFeed('feedUrl', this)">${t.copyUrl}</button>
  </div>

  <div class="features">
${t.features
  .map(
    (f) => `    <div class="feature">
      <h3>${f.title}</h3>
      <p>${f.html}</p>
    </div>`,
  )
  .join('\n')}
  </div>

${generateRecentConferencesHtml(t, lang, conferences, minYear)}

${generateFeedListHtml(t)}

${generateSubscribeButtonsHtml(t)}

  <h2>${t.manualSubscribe}</h2>
  <ol class="steps">
${t.manualSteps.map((step) => `    <li>${step}</li>`).join('\n')}
  </ol>
  <p>${t.appleNoteHtml}</p>

  <h2>${t.episodeTypes}</h2>
  <p>${t.episodeTypesIntro}</p>
  <ul>
${t.episodeTypeItemsHtml.map((item) => `    <li>${item}</li>`).join('\n')}
  </ul>

  <h2>${t.supportedApps}</h2>
  <p>${t.supportedAppsIntro}</p>
  <ul>
${t.supportedAppItems.map((app) => `    <li>${app}</li>`).join('\n')}
  </ul>

  <footer>
    <p>
      ${t.footerSourceHtml('https://www.churchofjesuschrist.org/study/general-conference')}
    </p>
    <p>
      <a href="${REPOSITORY_URL}">${t.viewOnGitHub}</a>
    </p>
    <div class="last-updated">${t.lastUpdated} <span id="lastUpdated">${lastUpdated}</span> UTC</div>
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
        btn.textContent = ok ? ${JSON.stringify(t.copied)} : ${JSON.stringify(t.pressAndHoldToCopy)};
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
    const html = generateHtml('eng', conferences, minYear);

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
