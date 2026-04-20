/**
 * Language configuration tests.
 *
 * Guards the single-source-of-truth invariants for `src/languages.ts`:
 *   - The supported set is exactly { eng, spa, por }
 *   - Every entry is fully populated (no blank metadata)
 *   - Per-language RSS tags are distinct (catches copy-paste regressions)
 */
import { describe, it, expect } from 'vitest';
import { LANGUAGES, LANGUAGE_CODES } from '../src/languages.js';

describe('LANGUAGES config', () => {
  it('has exactly the eng, spa, por entries', () => {
    expect(Object.keys(LANGUAGES).sort()).toEqual(['eng', 'por', 'spa']);
    expect(LANGUAGE_CODES.sort()).toEqual(['eng', 'por', 'spa']);
  });

  it('has every required field non-empty for each language', () => {
    for (const code of LANGUAGE_CODES) {
      const cfg = LANGUAGES[code];
      expect(cfg.code, `${code}.code`).toBe(code);
      expect(cfg.urlParam, `${code}.urlParam`).not.toBe('');
      expect(cfg.audioSuffix, `${code}.audioSuffix`).not.toBe('');
      expect(cfg.displayName, `${code}.displayName`).not.toBe('');
      expect(cfg.rssLanguageTag, `${code}.rssLanguageTag`).not.toBe('');
      expect(cfg.channelTitle, `${code}.channelTitle`).not.toBe('');
      expect(cfg.channelDescription, `${code}.channelDescription`).not.toBe('');
    }
  });

  it('has distinct rssLanguageTag values across entries', () => {
    const tags = LANGUAGE_CODES.map((c) => LANGUAGES[c].rssLanguageTag);
    expect(new Set(tags).size).toBe(tags.length);
  });
});
