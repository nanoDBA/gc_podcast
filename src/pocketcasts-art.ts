/**
 * Does Pocket Casts show the channel art our feed publishes?
 *
 * Pocket Casts' apps never load the feed's image URL: they show Pocket Casts'
 * own server copy, keyed by its podcast UUID
 * (static.pocketcasts.com/discover/images/<size>/<uuid>.jpg; see the
 * Automattic pocket-casts-ios / -android clients). So the only real check is
 * to compare that server copy with our art, picture to picture.
 *
 * Endpoints are the ones the apps themselves call: "add by URL" search to map
 * feed URL -> UUID, and pull-to-refresh (update_podcast) as a one-shot nudge
 * when the copy is stale. Pocket Casts outages are reported, never failed.
 */
import { fingerprintDistance, fingerprintJpeg } from './image-fingerprint.js';

/** Our published feeds. */
export const POCKETCASTS_FEED_FILES = ['audio.xml', 'audio-es.xml', 'audio-pt.xml'];

/**
 * Same picture re-encoded by Pocket Casts at 400px scores ~0.2; different
 * pictures score 40-55 (calibrated 2026-10-04 on our art vs their copies).
 */
export const SAME_ART_MAX_DISTANCE = 10;

const SEARCH_URL = 'https://refresh.pocketcasts.com/podcasts/search';
const REFRESH_URL = 'https://refresh.pocketcasts.com/api/v1/update_podcast';
const SERVER_ART = (uuid: string) =>
  `https://static.pocketcasts.com/discover/images/400/${uuid}.jpg`;

export interface PocketCastsArtResult {
  file: string;
  /** true = matches, false = mismatch (a real problem), undefined = could not tell. */
  matches?: boolean;
  detail: string;
}

/** Channel-level <itunes:image href> of a feed (items stripped first). */
export function channelImageUrl(xml: string): string | undefined {
  const channel = xml.split('<item>')[0];
  return /<itunes:image href="([^"]+)"/.exec(channel)?.[1];
}

/** Pure verdict from a fingerprint distance. */
export function sameArt(distance: number): boolean {
  return distance <= SAME_ART_MAX_DISTANCE;
}

/** Cloudflare lifetime for Pocket Casts artwork when the header is absent. */
const DEFAULT_CDN_MAX_AGE = 604800;

export function maxAgeSeconds(cacheControl: string | null): number {
  const m = /max-age=(\d+)/.exec(cacheControl ?? '');
  return m ? Number(m[1]) : DEFAULT_CDN_MAX_AGE;
}

export interface CdnVerdict {
  state: 'mismatch' | 'propagating' | 'ok';
  /** When every CDN edge is guaranteed to serve the origin's copy. */
  allEdgesFreshBy?: Date;
}

/**
 * Pocket Casts serves artwork through Cloudflare (max-age 7 days). An edge
 * matching our art proves nothing for listeners on other edges, so judge the
 * ORIGIN copy, and treat a correct origin as "propagating" until origin
 * update + max-age, when every edge has had to re-fetch it.
 */
export function cdnVerdict(input: {
  originDistance: number;
  originLastModified: Date;
  maxAgeSeconds: number;
  now: Date;
}): CdnVerdict {
  if (!sameArt(input.originDistance)) return { state: 'mismatch' };
  const allEdgesFreshBy = new Date(input.originLastModified.getTime() + input.maxAgeSeconds * 1000);
  return { state: input.now < allEdgesFreshBy ? 'propagating' : 'ok', allEdgesFreshBy };
}

async function bytes(
  url: string,
): Promise<{ data: Uint8Array; lastModified: string; cacheControl: string | null; cache: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return {
    data: new Uint8Array(await res.arrayBuffer()),
    lastModified: res.headers.get('last-modified') ?? 'unknown',
    cacheControl: res.headers.get('cache-control'),
    cache: res.headers.get('cf-cache-status') ?? '?',
  };
}

async function resolveUuid(feedUrl: string): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const body = new URLSearchParams({ q: feedUrl, dt: '2', v: '1', l: 'en', c: 'US' });
    const res = await fetch(SEARCH_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json()) as {
      status?: string;
      result?: { podcast?: { uuid?: string } };
    };
    const uuid = json.result?.podcast?.uuid;
    if (json.status === 'ok' && uuid) return uuid;
    await new Promise((r) => setTimeout(r, 5_000)); // "poll": Pocket Casts is fetching the feed
  }
  throw new Error('Pocket Casts did not resolve the feed URL');
}

export async function checkPocketCastsArt(
  baseUrl: string,
  file: string,
): Promise<PocketCastsArtResult> {
  const feedUrl = `${baseUrl}/${file}`;
  let oursUrl: string | undefined;
  try {
    const feedRes = await fetch(feedUrl, { signal: AbortSignal.timeout(30_000) });
    oursUrl = channelImageUrl(await feedRes.text());
    if (!oursUrl) return { file, detail: 'feed has no channel <itunes:image>' };
  } catch (err) {
    return { file, detail: `could not read feed: ${String(err)}` };
  }
  try {
    const uuid = await resolveUuid(feedUrl);
    // The origin copy (a unique query bypasses Cloudflare's cache) is the truth;
    // the plain URL is what apps on THIS runner's edge would get right now.
    const [ours, origin, edge] = await Promise.all([
      bytes(oursUrl),
      bytes(`${SERVER_ART(uuid)}?origin=${Date.now()}`),
      bytes(SERVER_ART(uuid)),
    ]);
    const oursFp = fingerprintJpeg(ours.data);
    const originDistance = fingerprintDistance(oursFp, fingerprintJpeg(origin.data));
    const edgeDistance = fingerprintDistance(oursFp, fingerprintJpeg(edge.data));
    const verdict = cdnVerdict({
      originDistance,
      originLastModified: new Date(origin.lastModified),
      maxAgeSeconds: maxAgeSeconds(edge.cacheControl ?? origin.cacheControl),
      now: new Date(),
    });
    const where = `uuid ${uuid}; origin updated ${origin.lastModified} (distance ${originDistance.toFixed(1)}); this runner's edge ${edge.cache}, updated ${edge.lastModified} (distance ${edgeDistance.toFixed(1)})`;
    if (verdict.state === 'ok') return { file, matches: true, detail: where };
    if (verdict.state === 'propagating') {
      return {
        file,
        matches: false,
        detail: `Pocket Casts has the new art, but CDN edges may serve the old copy until ${verdict.allEdgesFreshBy?.toISOString()} (7-day cache); "Refresh artwork" in the app cannot bypass it. ${where}`,
      };
    }
    // Same request as the app's pull-to-refresh; a one-shot nudge per run.
    await fetch(`${REFRESH_URL}?podcast_uuid=${uuid}`, {
      signal: AbortSignal.timeout(30_000),
    }).catch(() => undefined);
    return {
      file,
      matches: false,
      detail: `Pocket Casts has different channel art at its origin (${where}); refresh requested. Expect a lag of hours after an art change.`,
    };
  } catch (err) {
    return { file, detail: `Pocket Casts unreachable or unexpected response: ${String(err)}` };
  }
}
