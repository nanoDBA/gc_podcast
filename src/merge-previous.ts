/**
 * Never-regress merge for re-scrapes.
 *
 * During conference weekend the same file is re-scraped many times while the
 * site publishes content progressively. A transient fetch failure (or the
 * site briefly dropping a field) must not erase audio, artwork or speaker data
 * that an earlier scrape already captured, because the RSS feed is generated
 * straight from these files and a vanished enclosure removes the episode.
 *
 * Fresh data always wins; previous data only fills fields the new scrape lacks.
 * Sessions/talks are matched by slug; nothing is added that the new scrape
 * does not list.
 */
import type { Conference, Session, Talk } from './types.js';

const UNKNOWN_SPEAKER = 'Unknown Speaker';

function hasUrl(audio: { url?: string } | undefined): boolean {
  return !!audio?.url && audio.url.trim() !== '';
}

function mergeTalk(prev: Talk | undefined, next: Talk): Talk {
  if (!prev) return next;
  const merged: Talk = { ...next };
  if (!hasUrl(next.audio) && hasUrl(prev.audio)) {
    merged.audio = prev.audio;
    merged.duration_ms = prev.duration_ms ?? prev.audio?.duration_ms;
  }
  if (!next.image_url && prev.image_url) merged.image_url = prev.image_url;
  if (next.speaker.name === UNKNOWN_SPEAKER && prev.speaker.name !== UNKNOWN_SPEAKER) {
    merged.speaker = prev.speaker;
  }
  return merged;
}

function mergeSession(prev: Session | undefined, next: Session): Session {
  if (!prev) return next;
  const prevTalks = new Map(prev.talks.map((t) => [t.slug, t]));
  const merged: Session = {
    ...next,
    talks: next.talks.map((t) => mergeTalk(prevTalks.get(t.slug), t)),
  };
  if (!hasUrl(next.audio) && hasUrl(prev.audio)) {
    merged.audio = prev.audio;
    merged.duration_ms = prev.duration_ms ?? prev.audio?.duration_ms;
  }
  if (!next.image_url && prev.image_url) merged.image_url = prev.image_url;
  return merged;
}

export function mergePreviousScrape(prev: Conference, next: Conference): Conference {
  const prevSessions = new Map(prev.sessions.map((s) => [s.slug, s]));
  const merged: Conference = {
    ...next,
    sessions: next.sessions.map((s) => mergeSession(prevSessions.get(s.slug), s)),
  };
  if (!next.conference_image_url && prev.conference_image_url) {
    merged.conference_image_url = prev.conference_image_url;
  }
  return merged;
}
