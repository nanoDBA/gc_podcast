#!/usr/bin/env node
/**
 * Pre-commit guard for a PUBLIC repo: refuse commits that ADD machine-local
 * paths or private-network addresses (user home dirs, synced-drive roots,
 * RFC1918 / CGNAT / tailnet hosts). Only added lines in the staged diff are
 * checked, so existing content never blocks unrelated commits.
 *
 * Why: an agent sweep once pasted a local-path pointer block into CLAUDE.md
 * across many repos. Machine-local agent notes belong in CLAUDE.local.md
 * (gitignored). Bypass for a genuine false positive: fix the pattern here.
 */
import { execFileSync } from 'node:child_process';

// CI's automated feed commits also run this hook (npm ci installs husky).
// Never let a false positive in scraped data block the feed: guard local
// and agent commits only.
if (process.env.CI) process.exit(0);

const PATTERNS = [
  [/[A-Za-z]:[\\/]+Users[\\/]+/i, 'Windows user profile path'],
  [/(^|[\s"'`(])\/(c|mnt\/c)\/Users\//i, 'Git Bash / WSL user path'],
  [/(^|[\s"'`(])\/home\/[a-z_][\w-]*\//, 'Linux home path'],
  [/(^|[\s"'`(])\/Users\/[A-Za-z][\w.-]*\//, 'macOS home path'],
  [/!Repos[\\/]/, 'synced repo root'],
  [/My Drive[\\/]/, 'Google Drive root'],
  [/\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, 'private IP (10/8)'],
  [/\b192\.168\.\d{1,3}\.\d{1,3}\b/, 'private IP (192.168/16)'],
  [/\b172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/, 'private IP (172.16/12)'],
  [/\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/, 'CGNAT / tailnet IP'],
  [/\b[\w-]+\.ts\.net\b/i, 'tailnet hostname'],
];

const diff = execFileSync(
  'git',
  ['diff', '--cached', '--unified=0', '--no-color', '--diff-filter=ACMR'],
  {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  },
);

const hits = [];
let file = '';
for (const line of diff.split('\n')) {
  if (line.startsWith('+++ ')) {
    file = line.replace(/^\+\+\+ (b\/)?/, '');
    continue;
  }
  if (!line.startsWith('+') || line.startsWith('+++')) continue;
  // This guard's own pattern source is allowed to describe what it blocks.
  if (file === 'scripts/check-public-safety.mjs') continue;
  for (const [re, what] of PATTERNS) {
    if (re.test(line)) hits.push(`${file}: ${what}: ${line.slice(1, 160).trim()}`);
  }
}

if (hits.length > 0) {
  console.error('Blocked: this is a PUBLIC repo and the commit adds machine-local details:');
  for (const h of hits) console.error(`  ${h}`);
  console.error('Move machine-local notes to CLAUDE.local.md (gitignored) or remove them.');
  process.exit(1);
}
