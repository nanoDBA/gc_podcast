/**
 * Every phrase on the landing page, per site language (gc_podcast site i18n).
 * generate-index.ts owns structure; this file owns wording. The type makes a
 * missing translation a compile error.
 *
 * Spanish and Portuguese follow the Church's own usage on churchofjesuschrist.org
 * and its newsroom: lowercase "general conference" in running text, the Church's
 * full name with its capitalized article.
 */
import type { LanguageCode } from './languages.js';
import { SESSION_HOURS_TEXT, TALK_MINUTES_TEXT } from './episode-lengths.js';

export interface SiteStrings {
  /** BCP 47 tag for <html lang> and hreflang. */
  htmlLang: string;
  title: string;
  metaDescription: string;
  subtitle: string;
  /** Names of the three feed languages, in this page's language. */
  languageNames: Record<LanguageCode, string>;
  languageNavLabel: string;
  feedUrlLabel: string;
  viewFeed: string;
  copyUrl: string;
  copy: string;
  copied: string;
  pressAndHoldToCopy: string;
  features: { title: string; html: string }[];
  recentConferences: string;
  monthNames: string[];
  /** Heading for one conference, e.g. "April 2026". */
  conferenceDate: (month: number, year: number) => string;
  /** Line under the heading, e.g. "April 2026 General Conference". */
  conferenceName: (month: number, year: number) => string;
  sessionCount: (n: number) => string;
  availableFeeds: string;
  oneClickSubscribe: string;
  feedLanguageLabel: string;
  rssFeed: string;
  manualSubscribe: string;
  manualSteps: string[];
  appleNoteHtml: string;
  episodeTypes: string;
  episodeTypesIntro: string;
  episodeTypeItemsHtml: string[];
  supportedApps: string;
  supportedAppsIntro: string;
  supportedAppItems: string[];
  footerSourceHtml: (churchLink: string) => string;
  viewOnGitHub: string;
  lastUpdated: string;
}

const EN_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const eng: SiteStrings = {
  htmlLang: 'en',
  title: 'General Conference Podcast',
  metaDescription:
    'Subscribe to general conference audio from The Church of Jesus Christ of Latter-day Saints',
  subtitle:
    'Audio from general conference, the worldwide gathering of The Church of Jesus Christ of Latter-day Saints',
  languageNames: { eng: 'English', spa: 'Spanish', por: 'Portuguese' },
  languageNavLabel: 'Page language',
  feedUrlLabel: 'Podcast Feed URL:',
  viewFeed: 'View Feed',
  copyUrl: 'Copy URL',
  copy: 'Copy',
  copied: 'Copied!',
  pressAndHoldToCopy: 'Press and hold to copy',
  features: [
    {
      title: 'Full Sessions',
      html: `Complete session recordings (about ${SESSION_HOURS_TEXT} hours) including all talks and music`,
    },
    {
      title: 'Individual Talks',
      html: `Each talk available separately (about ${TALK_MINUTES_TEXT} minutes each)`,
    },
    {
      title: 'Per-Episode Artwork',
      html: 'Speaker portraits appear beside every talk in supported apps',
    },
    { title: 'Multi-Language', html: 'English, Spanish, and Portuguese feeds' },
    {
      title: 'Podcasting 2.0',
      html: 'Stable <code>&lt;podcast:guid&gt;</code> so your subscription survives URL changes',
    },
    {
      title: 'Conference Channel Art',
      html: 'A channel image chosen for each conference and each language',
    },
  ],
  recentConferences: 'Recent Conferences',
  monthNames: EN_MONTHS,
  conferenceDate: (month, year) => `${EN_MONTHS[month - 1]} ${year}`,
  conferenceName: (month, year) => `${EN_MONTHS[month - 1]} ${year} General Conference`,
  sessionCount: (n) => `${n} session${n !== 1 ? 's' : ''}`,
  availableFeeds: 'Available Feeds',
  oneClickSubscribe: 'One-Click Subscribe',
  feedLanguageLabel: 'Feed language',
  rssFeed: 'RSS Feed',
  manualSubscribe: 'Manual Subscribe',
  manualSteps: [
    'Copy a feed URL above',
    'Open your podcast app',
    'Look for "Add by URL" or "Add RSS Feed"',
    'Paste the URL and confirm',
  ],
  appleNoteHtml:
    '<strong>Apple Podcasts:</strong> the Search tab only finds shows listed in Apple\'s directory, and these feeds are not listed, so a pasted URL shows "No Results". Use <strong>Library &rarr; &hellip; (top right) &rarr; Follow a Show by URL</strong> instead, or tap the Apple Podcasts button above after choosing your language.',
  episodeTypes: 'Episode Types',
  episodeTypesIntro: 'The feed includes two types of episodes:',
  episodeTypeItemsHtml: [
    `<strong>Full Session</strong> - Complete session recording (about ${SESSION_HOURS_TEXT} hours). Great for listening to an entire session.`,
    `<strong>Individual Talks</strong> - Each speaker's talk separately (about ${TALK_MINUTES_TEXT} min). Perfect for focused study.`,
  ],
  supportedApps: 'Supported Apps',
  supportedAppsIntro: 'This feed works with any podcast app that supports RSS:',
  supportedAppItems: [
    'Apple Podcasts',
    'Overcast',
    'Pocket Casts',
    'Castro',
    'Spotify (via RSS)',
    'Any RSS reader',
  ],
  footerSourceHtml: (link) =>
    `Audio content from <a href="${link}">churchofjesuschrist.org</a>.
      This is an unofficial feed for personal use.`,
  viewOnGitHub: 'View on GitHub',
  lastUpdated: 'Last updated:',
};

// Spanish: tú, as the Church's es pages ("Acompáñanos", "Siente paz").
// Month names are lowercase mid-phrase ("Conferencia General de abril de 2026").
const ES_MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
const capitalize = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

const spa: SiteStrings = {
  htmlLang: 'es',
  title: 'Podcast de la conferencia general',
  metaDescription:
    'Suscríbete al audio de la conferencia general de La Iglesia de Jesucristo de los Santos de los Últimos Días',
  // After the Church's own "La conferencia general es la reunión mundial de La Iglesia..."
  subtitle:
    'Audio de la conferencia general, la reunión mundial de La Iglesia de Jesucristo de los Santos de los Últimos Días',
  languageNames: { eng: 'Inglés', spa: 'Español', por: 'Portugués' },
  languageNavLabel: 'Idioma de la página',
  feedUrlLabel: 'URL del podcast:',
  viewFeed: 'Ver canal RSS',
  copyUrl: 'Copiar URL',
  copy: 'Copiar',
  copied: '¡Copiado!',
  pressAndHoldToCopy: 'Mantén presionado para copiar',
  features: [
    {
      title: 'Sesiones completas',
      html: `Grabaciones completas de cada sesión (unas ${SESSION_HOURS_TEXT} horas), con todos los discursos y la música`,
    },
    {
      title: 'Discursos individuales',
      html: `Cada discurso por separado (unos ${TALK_MINUTES_TEXT} minutos cada uno)`,
    },
    {
      title: 'Imagen en cada episodio',
      html: 'El retrato del discursante aparece junto a cada discurso en las aplicaciones compatibles',
    },
    { title: 'Varios idiomas', html: 'Canales en inglés, español y portugués' },
    {
      title: 'Podcasting 2.0',
      html: 'Un <code>&lt;podcast:guid&gt;</code> estable para que tu suscripción siga funcionando aunque cambie la URL',
    },
    {
      title: 'Imagen de cada conferencia',
      html: 'Una imagen del canal elegida para cada conferencia y cada idioma',
    },
  ],
  recentConferences: 'Conferencias recientes',
  monthNames: ES_MONTHS,
  conferenceDate: (month, year) => `${capitalize(ES_MONTHS[month - 1])} de ${year}`,
  conferenceName: (month, year) => `Conferencia General de ${ES_MONTHS[month - 1]} de ${year}`,
  sessionCount: (n) => (n === 1 ? '1 sesión' : `${n} sesiones`),
  availableFeeds: 'Canales disponibles',
  oneClickSubscribe: 'Suscríbete con un toque',
  feedLanguageLabel: 'Idioma del canal',
  rssFeed: 'Canal RSS',
  manualSubscribe: 'Suscripción manual',
  manualSteps: [
    'Copia la URL de uno de los canales de arriba',
    'Abre tu aplicación de podcasts',
    'Busca la opción para agregar un podcast por URL o canal RSS',
    'Pega la URL y confirma',
  ],
  // Menu label as Apple's Spanish support pages write it.
  appleNoteHtml:
    '<strong>Apple Podcasts:</strong> la pestaña Buscar solo encuentra programas del directorio de Apple, y estos canales no están en él, así que al pegar la URL no aparece ningún resultado. En su lugar, ve a <strong>Biblioteca &rarr; &hellip; (arriba a la derecha) &rarr; Seguir un programa por URL</strong>, o toca el botón de Apple Podcasts de arriba después de elegir tu idioma.',
  episodeTypes: 'Tipos de episodios',
  episodeTypesIntro: 'El canal incluye dos tipos de episodios:',
  episodeTypeItemsHtml: [
    `<strong>Sesión completa</strong> - Grabación completa de la sesión (unas ${SESSION_HOURS_TEXT} horas). Ideal para escuchar una sesión entera.`,
    `<strong>Discursos individuales</strong> - Cada discurso por separado (unos ${TALK_MINUTES_TEXT} min). Ideal para el estudio personal.`,
  ],
  supportedApps: 'Aplicaciones compatibles',
  supportedAppsIntro:
    'Este canal funciona con cualquier aplicación de podcasts compatible con RSS:',
  supportedAppItems: [
    'Apple Podcasts',
    'Overcast',
    'Pocket Casts',
    'Castro',
    'Spotify (mediante RSS)',
    'Cualquier lector de RSS',
  ],
  footerSourceHtml: (link) =>
    `Contenido de audio de <a href="${link}">churchofjesuschrist.org</a>.
      Este es un canal no oficial para uso personal.`,
  viewOnGitHub: 'Ver en GitHub',
  lastUpdated: 'Última actualización:',
};

// Portuguese: Brazilian, você, as the Church's por pages ("Sinta paz", "Junte-se a nós").
// The Church capitalizes the month in conference names ("Conferência Geral de Outubro de 2026").
const PT_MONTHS = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

const por: SiteStrings = {
  htmlLang: 'pt-BR',
  title: 'Podcast da conferência geral',
  metaDescription:
    'Assine o áudio da conferência geral de A Igreja de Jesus Cristo dos Santos dos Últimos Dias',
  // After the Church's own "A conferência geral é uma reunião mundial de A Igreja..."
  subtitle:
    'Áudio da conferência geral, uma reunião mundial de A Igreja de Jesus Cristo dos Santos dos Últimos Dias',
  languageNames: { eng: 'Inglês', spa: 'Espanhol', por: 'Português' },
  languageNavLabel: 'Idioma da página',
  feedUrlLabel: 'URL do podcast:',
  viewFeed: 'Ver feed RSS',
  copyUrl: 'Copiar URL',
  copy: 'Copiar',
  copied: 'Copiado!',
  pressAndHoldToCopy: 'Toque e segure para copiar',
  features: [
    {
      title: 'Sessões completas',
      html: `Gravações completas de cada sessão (cerca de ${SESSION_HOURS_TEXT} horas), com todos os discursos e as músicas`,
    },
    {
      title: 'Discursos individuais',
      html: `Cada discurso separadamente (cerca de ${TALK_MINUTES_TEXT} minutos cada)`,
    },
    {
      title: 'Imagem em cada episódio',
      html: 'A foto de quem discursa aparece ao lado de cada discurso nos aplicativos compatíveis',
    },
    { title: 'Vários idiomas', html: 'Feeds em inglês, espanhol e português' },
    {
      title: 'Podcasting 2.0',
      html: 'Um <code>&lt;podcast:guid&gt;</code> estável para que sua assinatura continue funcionando mesmo se a URL mudar',
    },
    {
      title: 'Imagem de cada conferência',
      html: 'Uma imagem de capa escolhida para cada conferência e cada idioma',
    },
  ],
  recentConferences: 'Conferências recentes',
  monthNames: PT_MONTHS,
  conferenceDate: (month, year) => `${PT_MONTHS[month - 1]} de ${year}`,
  conferenceName: (month, year) => `Conferência Geral de ${PT_MONTHS[month - 1]} de ${year}`,
  sessionCount: (n) => (n === 1 ? '1 sessão' : `${n} sessões`),
  availableFeeds: 'Feeds disponíveis',
  oneClickSubscribe: 'Assine com um toque',
  feedLanguageLabel: 'Idioma do feed',
  rssFeed: 'Feed RSS',
  manualSubscribe: 'Assinatura manual',
  manualSteps: [
    'Copie a URL de um dos feeds acima',
    'Abra seu aplicativo de podcasts',
    'Procure a opção de adicionar um podcast por URL ou feed RSS',
    'Cole a URL e confirme',
  ],
  // Apple's current pt-BR menu label is unverified, so describe the option instead of quoting it.
  appleNoteHtml:
    '<strong>Apple Podcasts:</strong> a aba Buscar só encontra programas do diretório da Apple, e estes feeds não estão nele, então colar a URL não mostra nenhum resultado. Em vez disso, vá em <strong>Biblioteca &rarr; &hellip; (canto superior direito)</strong> e escolha a opção de seguir um programa por URL, ou toque no botão do Apple Podcasts acima depois de escolher seu idioma.',
  episodeTypes: 'Tipos de episódio',
  episodeTypesIntro: 'O feed inclui dois tipos de episódio:',
  episodeTypeItemsHtml: [
    `<strong>Sessão completa</strong> - Gravação completa da sessão (cerca de ${SESSION_HOURS_TEXT} horas). Ótimo para ouvir uma sessão inteira.`,
    `<strong>Discursos individuais</strong> - Cada discurso separadamente (cerca de ${TALK_MINUTES_TEXT} min). Ideal para o estudo pessoal.`,
  ],
  supportedApps: 'Aplicativos compatíveis',
  supportedAppsIntro: 'Este feed funciona com qualquer aplicativo de podcasts compatível com RSS:',
  supportedAppItems: [
    'Apple Podcasts',
    'Overcast',
    'Pocket Casts',
    'Castro',
    'Spotify (via RSS)',
    'Qualquer leitor de RSS',
  ],
  footerSourceHtml: (link) =>
    `Conteúdo de áudio de <a href="${link}">churchofjesuschrist.org</a>.
      Este é um feed não oficial para uso pessoal.`,
  viewOnGitHub: 'Ver no GitHub',
  lastUpdated: 'Última atualização:',
};

export const SITE_STRINGS: Record<LanguageCode, SiteStrings> = { eng, spa, por };
