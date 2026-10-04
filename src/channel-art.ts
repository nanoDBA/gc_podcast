/**
 * Channel-art policy: the feed's channel image only changes deliberately.
 *
 * Pocket Casts locks the first channel art it sees for a feed URL and never
 * refreshes it, so an automatic switch to the Church's new conference image
 * (scraped as soon as a conference starts) puts permanently wrong art into
 * that app. A conference therefore contributes channel art only when someone
 * chose it:
 *   - a manual entry in config/conference-image-overrides.json, or
 *   - a conference_image_url self-hosted on the feed's own GitHub Pages site.
 * The scraper still records the Church URL as data; this module decides.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { Conference } from './types.js';

/** Manual channel images keyed by `${YYYY}-${MM}-${language}` (gc_podcast-uuc). */
export type ImageOverrides = Readonly<Record<string, string>>;

export const DEFAULT_OVERRIDES_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'config',
  'conference-image-overrides.json',
);

export function overrideKey(year: number, month: number, language: string): string {
  return `${year}-${String(month).padStart(2, '0')}-${language}`;
}

/** Conference cycle label used as the artwork cache-bust (`?v=YYYY-MM`). */
export function conferenceCycle(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Read the overrides file. A missing, empty or malformed file means "no
 * overrides"; `_`-prefixed keys and non-string / empty values are ignored.
 */
export async function loadImageOverrides(
  filePath: string = DEFAULT_OVERRIDES_PATH,
): Promise<ImageOverrides> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(filePath, 'utf-8'));
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (!k.startsWith('_') && typeof v === 'string' && v.length > 0) out[k] = v;
  }
  return out;
}

/**
 * True when `url` lives under the feed's own site. The host is compared
 * case-insensitively (CI passes the owner as "nanoDBA", art URLs use
 * "nanodba"); the path prefix must match exactly.
 */
export function isSelfHosted(url: string, siteBase: string): boolean {
  try {
    const u = new URL(url);
    const base = new URL(siteBase);
    const basePath = `${base.pathname.replace(/\/+$/, '')}/`;
    return u.origin === base.origin && u.pathname.startsWith(basePath);
  } catch {
    return false;
  }
}

export interface ChannelArt {
  url: string;
  /** `YYYY-MM` of the conference the art belongs to. */
  cycle: string;
}

/**
 * Pick the channel art of the newest conference whose art was chosen on
 * purpose. `conferences` must be sorted newest first. Returns undefined when
 * none qualifies, so the caller can apply its legacy fallback.
 */
export function selectDeliberateChannelArt(
  conferences: readonly Conference[],
  opts: { language: string; overrides: ImageOverrides; selfHostBase: string },
): ChannelArt | undefined {
  for (const c of conferences) {
    const cycle = conferenceCycle(c.year, c.month);
    const override = opts.overrides[overrideKey(c.year, c.month, opts.language)];
    if (override) return { url: override, cycle };
    if (c.conference_image_url && isSelfHosted(c.conference_image_url, opts.selfHostBase)) {
      return { url: c.conference_image_url, cycle };
    }
  }
  return undefined;
}
