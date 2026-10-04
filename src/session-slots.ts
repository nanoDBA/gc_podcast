/**
 * Church session slots: when each conference session happened and how its
 * items are numbered in the feed.
 *
 * The Church numbers sessions with FIXED slots, whether or not a Saturday
 * Evening session is held (April 2026 had none, yet its Sunday talks are
 * still coded 4x/5x):
 *   1 – Saturday Morning   10:00 MDT → 16:00 UTC, day+0
 *   2 – Saturday Afternoon 14:00 MDT → 20:00 UTC, day+0
 *   3 – Saturday Evening   18:00 MDT → 00:00 UTC, day+1 (midnight crossing)
 *   4 – Sunday Morning     10:00 MDT → 16:00 UTC, day+1
 *   5 – Sunday Afternoon   14:00 MDT → 20:00 UTC, day+1
 *
 * Session slugs are English in every language, so the slot is read from the
 * slug. Historical conferences with other sessions (Friday, priesthood,
 * welfare...) keep the old position-based numbering (slot = session.order)
 * for the whole conference so their pubDates stay unique.
 */

import { Conference, Session, Talk } from './types.js';

const SLOT_BY_SLUG_PREFIX: ReadonlyArray<readonly [string, number]> = [
  ['saturday-morning-session', 1],
  ['saturday-afternoon-session', 2],
  ['saturday-evening-session', 3],
  ['sunday-morning-session', 4],
  ['sunday-afternoon-session', 5],
];

const SLOT_SCHEDULE: Record<number, { dayOffset: number; hourUtc: number }> = {
  1: { dayOffset: 0, hourUtc: 16 },
  2: { dayOffset: 0, hourUtc: 20 },
  3: { dayOffset: 1, hourUtc: 0 },
  4: { dayOffset: 1, hourUtc: 16 },
  5: { dayOffset: 1, hourUtc: 20 },
};

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function slotFromSlug(slug: string): number | undefined {
  return SLOT_BY_SLUG_PREFIX.find(([prefix]) => slug.startsWith(prefix))?.[1];
}

/**
 * Assign each session of one conference its Church slot (1..5).
 *
 * All sessions recognized with distinct slots → slug-based slots.
 * Otherwise → position-based (session.order) for every session, which is
 * the pre-fix behaviour and keeps odd historical conferences unchanged.
 */
export function assignSessionSlots(sessions: readonly Session[]): Map<Session, number> {
  const fromSlug = sessions.map((s) => slotFromSlug(s.slug));
  const allKnown = fromSlug.every((slot) => slot !== undefined);
  const distinct = new Set(fromSlug).size === sessions.length;
  return new Map(
    sessions.map((s, i) => [s, allKnown && distinct ? (fromSlug[i] as number) : s.order]),
  );
}

/**
 * UTC start of a session slot. Anchored on the first Saturday of the
 * conference month. Slots beyond 5 (rare, historical) fall back to Sunday
 * afternoon plus one hour per extra slot so they remain unique.
 */
export function getSlotStartUtc(year: number, month: number, slot: number): Date {
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const daysUntilSaturday = (6 - firstOfMonth.getUTCDay() + 7) % 7;
  const firstSaturdayMs = firstOfMonth.getTime() + daysUntilSaturday * DAY_MS;
  const schedule = SLOT_SCHEDULE[slot] ?? { dayOffset: 1, hourUtc: 20 + (slot - 5) };
  return new Date(firstSaturdayMs + schedule.dayOffset * DAY_MS + schedule.hourUtc * HOUR_MS);
}

/** itunes:season — year*100 + month (202604, 202610) so April and October differ. */
export function seasonNumber(conference: Conference): number {
  return conference.year * 100 + conference.month;
}

/**
 * itunes:episode for a talk — the Church talk code (leading digits of the
 * slug: 11oaks → 11, 210soares → 210). Slugs without a code fall back to
 * slot*100 + talk.order.
 */
export function talkEpisodeNumber(talk: Talk, slot: number): number {
  const code = /^\d+/.exec(talk.slug);
  return code ? parseInt(code[0], 10) : slot * 100 + talk.order;
}

/** itunes:episode for a full session — slot*100 (100..500). */
export function sessionEpisodeNumber(slot: number): number {
  return slot * 100;
}
