/**
 * Language configuration — single source of truth.
 *
 * Adding a fourth language should only require:
 *   1. Extend the `code` union below
 *   2. Add a new entry to `LANGUAGES`
 *   3. Add the matching literal in `src/schemas.ts` (LanguageSchema)
 *
 * Do NOT hardcode per-language values elsewhere in the codebase. Reference
 * `LANGUAGES[code].<field>` instead.
 */

export interface LanguageConfig {
  /** Canonical three-letter code used throughout the codebase. */
  code: 'eng' | 'spa' | 'por';
  /** Value for the `?lang=` URL query parameter on churchofjesuschrist.org. */
  urlParam: string;
  /** Audio-file language suffix, e.g. `128k-eng.mp3`, `128k-es.mp3`. */
  audioSuffix: string;
  /** Human-readable English display name. */
  displayName: string;
  /** RSS `<language>` element value (BCP 47 style). */
  rssLanguageTag: string;
  /** Channel description used in the generated RSS feed. */
  channelDescription: string;
  /** Channel title used in the generated RSS feed. */
  channelTitle: string;
}

export const LANGUAGES: Record<LanguageConfig['code'], LanguageConfig> = {
  eng: {
    code: 'eng',
    urlParam: 'eng',
    audioSuffix: 'en',
    displayName: 'English',
    rssLanguageTag: 'en',
    channelTitle:
      'General Conference - The Church of Jesus Christ of Latter-day Saints',
    channelDescription:
      'Audio recordings from General Conference of The Church of Jesus Christ of Latter-day Saints. Includes talks from Church leaders delivered during the semi-annual worldwide broadcasts.',
  },
  spa: {
    code: 'spa',
    urlParam: 'spa',
    audioSuffix: 'es',
    displayName: 'Spanish',
    rssLanguageTag: 'es',
    channelTitle:
      'Conferencia General - La Iglesia de Jesucristo de los Santos de los Últimos Días',
    channelDescription:
      'Grabaciones de audio de la Conferencia General de La Iglesia de Jesucristo de los Santos de los Últimos Días. Incluye discursos de líderes de la Iglesia de las transmisiones mundiales semestrales.',
  },
  por: {
    code: 'por',
    urlParam: 'por',
    audioSuffix: 'pt',
    displayName: 'Portuguese',
    rssLanguageTag: 'pt',
    channelTitle:
      'Conferência Geral - A Igreja de Jesus Cristo dos Santos dos Últimos Dias',
    channelDescription:
      'Gravações de áudio da Conferência Geral de A Igreja de Jesus Cristo dos Santos dos Últimos Dias. Inclui discursos de líderes da Igreja das transmissões mundiais semestrais.',
  },
};

export type LanguageCode = LanguageConfig['code'];

export const LANGUAGE_CODES: LanguageCode[] = Object.keys(
  LANGUAGES
) as LanguageCode[];
