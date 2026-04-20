/**
 * Minimal RFC 4122 v5 UUID implementation (SHA-1, name-based).
 *
 * v5 UUIDs are deterministic: `uuidv5(name, namespace)` returns the same
 * UUID for the same `(name, namespace)` pair. Used here to derive a
 * Podcasting 2.0 `<podcast:guid>` from the feed URL per spec:
 *   https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/1.0.md#guid
 */
import { createHash } from 'crypto';

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/-/g, '');
  if (clean.length !== 32) throw new Error(`Invalid UUID: ${hex}`);
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function uuidv5(name: string, namespace: string): string {
  const nsBytes = hexToBytes(namespace);
  const nameBytes = Buffer.from(name, 'utf8');
  const hash = createHash('sha1');
  hash.update(nsBytes);
  hash.update(nameBytes);
  const digest = hash.digest();
  const bytes = new Uint8Array(digest.subarray(0, 16));
  // Set version (5) in byte 6, high nibble
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  // Set RFC 4122 variant in byte 8, top two bits = 10
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytesToUuid(bytes);
}
