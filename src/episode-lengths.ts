/**
 * Episode lengths the landing page and README promise listeners. One source,
 * checked against the published feeds by tests/episode-lengths.test.ts, so
 * the copy fails CI instead of drifting from the audio.
 *
 * Measured 2026-10-06: talks 7.6-17.4 min (2025 ran 10-17, 2026 ran 7.6-13.6);
 * full sessions 89-124 min. Sustainings, the audit report, introductions and
 * closing remarks (2-8 min) are talk episodes too, but are not "talks".
 */
export const TALK_MINUTES = { min: 7, max: 17 } as const;
export const SESSION_HOURS_TEXT = '1½–2';

export const TALK_MINUTES_TEXT = `${TALK_MINUTES.min}–${TALK_MINUTES.max}`;
