/**
 * Tiny perceptual fingerprint for comparing two renditions of the same
 * artwork (e.g. our 1400px JPEG vs Pocket Casts' 400px re-encode): decode,
 * average into a GRID x GRID grayscale grid, compare by mean absolute
 * difference (0-255). Re-encoding and resizing barely move it; a different
 * picture moves it a lot.
 */
import jpeg from 'jpeg-js';

export const GRID = 16;

export function fingerprintJpeg(data: Uint8Array): number[] {
  const img = jpeg.decode(data, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 256 });
  const sums = new Array<number>(GRID * GRID).fill(0);
  const counts = new Array<number>(GRID * GRID).fill(0);
  for (let y = 0; y < img.height; y++) {
    const gy = Math.min(GRID - 1, Math.floor((y * GRID) / img.height));
    for (let x = 0; x < img.width; x++) {
      const gx = Math.min(GRID - 1, Math.floor((x * GRID) / img.width));
      const i = (y * img.width + x) * 4;
      const gray = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
      sums[gy * GRID + gx] += gray;
      counts[gy * GRID + gx] += 1;
    }
  }
  return sums.map((s, k) => s / Math.max(1, counts[k]));
}

/** Mean absolute difference between two fingerprints (0 = identical, 255 = opposite). */
export function fingerprintDistance(a: readonly number[], b: readonly number[]): number {
  let total = 0;
  for (let k = 0; k < a.length; k++) total += Math.abs(a[k] - b[k]);
  return total / a.length;
}
