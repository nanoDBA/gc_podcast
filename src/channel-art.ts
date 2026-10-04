/**
 * Channel-art policy: the feed's channel image only changes deliberately.
 *
 * Pocket Casts locks the first channel art it sees for a feed URL and never
 * refreshes it, so an automatic switch to the Church's new conference image
 * (scraped as soon as a conference starts) puts permanently wrong art into
 * that app. Channel art therefore comes from ONE place only:
 * config/conference-image-overrides.json. Each language uses its newest entry
 * (by YYYY-MM in the key), independent of which conferences are in the feed
 * window. A language with no entry gets DEFAULT_CHANNEL_ART. Scraped Church
 * images (conference_image_url) and talk heroes are never used for the channel.
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

/** Fixed channel art for a language with no override entry (never scraped). */
export const DEFAULT_CHANNEL_ART =
  'https://www.churchofjesuschrist.org/imgs/5uahv05h1s6416y49vw745z70juiiffhiq0vn8a2/full/!1400,/0/default';

export interface ChannelArt {
  url: string;
  /** `YYYY-MM` of the override key the art came from (artwork cache-bust). */
  cycle: string;
}

/** Newest override entry for `language`, or undefined when it has none. */
export function selectChannelArt(
  overrides: ImageOverrides,
  language: string,
): ChannelArt | undefined {
  let best: ChannelArt | undefined;
  for (const [key, url] of Object.entries(overrides)) {
    const m = /^(\d{4})-(\d{2})-([a-z]+)$/.exec(key);
    if (!m || m[3] !== language) continue;
    const cycle = `${m[1]}-${m[2]}`;
    if (!best || cycle > best.cycle) best = { url, cycle };
  }
  return best;
}
