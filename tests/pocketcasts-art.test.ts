/**
 * Pocket Casts artwork check: pure parts only (no network).
 */
import { describe, it, expect } from 'vitest';
import jpeg from 'jpeg-js';
import { fingerprintDistance, fingerprintJpeg } from '../src/image-fingerprint.js';
import { SAME_ART_MAX_DISTANCE, channelImageUrl, sameArt } from '../src/pocketcasts-art.js';

/** Synthetic picture: `kind` picks the scene, rendered at any size/quality. */
function picture(kind: 'sunset' | 'temple', size: number, quality: number): Uint8Array {
  const data = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const i = (y * size + x) * 4;
      if (kind === 'sunset') {
        // warm sky fading into a dark shoreline
        data[i] = 240 - 120 * v;
        data[i + 1] = 150 - 100 * v;
        data[i + 2] = 60;
      } else {
        // bright tower in the middle on a blue-grey city
        const tower = Math.abs(u - 0.5) < 0.18 && v > 0.15;
        data[i] = tower ? 235 : 70 + 60 * u;
        data[i + 1] = tower ? 235 : 90 + 40 * v;
        data[i + 2] = tower ? 240 : 130;
      }
      data[i + 3] = 255;
    }
  }
  return jpeg.encode({ data, width: size, height: size }, quality).data;
}

describe('image fingerprint', () => {
  it('same picture at 1400px/q90 vs 400px/q60 (a Pocket Casts re-encode) matches', () => {
    const d = fingerprintDistance(
      fingerprintJpeg(picture('temple', 1400, 90)),
      fingerprintJpeg(picture('temple', 400, 60)),
    );
    expect(d).toBeLessThan(SAME_ART_MAX_DISTANCE);
    expect(sameArt(d)).toBe(true);
  });

  it('a different picture does not match', () => {
    const d = fingerprintDistance(
      fingerprintJpeg(picture('temple', 1400, 90)),
      fingerprintJpeg(picture('sunset', 400, 60)),
    );
    expect(d).toBeGreaterThan(SAME_ART_MAX_DISTANCE * 2);
    expect(sameArt(d)).toBe(false);
  });
});

describe('channelImageUrl', () => {
  it('reads the channel image, not an item image', () => {
    const xml = `<rss><channel><title>t</title>
      <itunes:image href="https://example.test/channel.jpg?v=2026-10"/>
      <item><itunes:image href="https://example.test/talk.jpg"/></item></channel></rss>`;
    expect(channelImageUrl(xml)).toBe('https://example.test/channel.jpg?v=2026-10');
  });

  it('returns undefined when the channel has no image', () => {
    expect(
      channelImageUrl('<rss><channel><item><itunes:image href="x"/></item></channel></rss>'),
    ).toBe(undefined);
  });
});
