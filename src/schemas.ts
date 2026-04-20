/**
 * Runtime schema validation with zod.
 *
 * Mirrors compile-time interfaces in `./types.ts`. Use these schemas to
 * validate untrusted inputs (HTTP responses, on-disk JSON) at the edges.
 * Compile-time consumers should continue to import from `./types.ts`; this
 * module exists purely to catch drift that static typing cannot.
 *
 * Philosophy: warn on unexpected, don't reject on benign change. Optional
 * fields are generous — the goal is to surface drift via logging, not to
 * brick the scraper on harmless upstream tweaks.
 */
import { z } from 'zod';

// --- Language & role --------------------------------------------------------

export const LanguageSchema = z.enum(['eng', 'spa', 'por']);

export const SpeakerRoleTagSchema = z
  .enum(['first-presidency', 'quorum-of-the-twelve'])
  .nullable();

// --- Audio / Speaker --------------------------------------------------------

export const AudioAssetSchema = z.object({
  url: z.string(),
  quality: z.string().optional(),
  language: z.string().optional(),
  duration_ms: z.number().optional(),
});

export const SpeakerSchema = z.object({
  name: z.string(),
  role_tag: SpeakerRoleTagSchema,
  calling: z.string().optional(),
  bio_url: z.string().optional(),
});

// --- Talk / Session / Conference -------------------------------------------

export const TalkSchema = z.object({
  title: z.string(),
  slug: z.string(),
  order: z.number(),
  url: z.string(),
  speaker: SpeakerSchema,
  audio: AudioAssetSchema.optional(),
  duration_ms: z.number().optional(),
});

export const SessionSchema = z.object({
  name: z.string(),
  slug: z.string(),
  order: z.number(),
  url: z.string(),
  audio: AudioAssetSchema.optional(),
  duration_ms: z.number().optional(),
  talks: z.array(TalkSchema),
});

export const ConferenceSchema = z.object({
  year: z.number(),
  month: z.number(),
  name: z.string(),
  ordinal: z.string().optional(),
  url: z.string(),
  language: LanguageSchema,
  sessions: z.array(SessionSchema),
});

// --- Output file ------------------------------------------------------------

export const ConferenceOutputSchema = z.object({
  scraped_at: z.string(),
  version: z.string(),
  conference: ConferenceSchema,
});

// --- Church API response ----------------------------------------------------
//
// Only covers the fields actually read by src/scraper.ts (meta.title,
// meta.audio[], meta.pageAttributes, content.body). All other upstream
// fields are ignored (zod defaults to strip). Optionality is permissive
// since benign upstream shape changes should warn, not break.

export const ApiAudioEntrySchema = z.object({
  mediaUrl: z.string(),
  variant: z.string(),
});

export const ApiResponseSchema = z.object({
  meta: z.object({
    title: z.string(),
    audio: z.array(ApiAudioEntrySchema).optional(),
    pageAttributes: z.record(z.string()).optional(),
  }),
  content: z.object({
    body: z.string(),
  }),
});

// --- Inferred types (runtime-derived) --------------------------------------
//
// These mirror the handwritten types in ./types.ts. Existing callers should
// keep importing from ./types.ts; these exports are here for code that wants
// the zod-inferred shape.

export type LanguageZ = z.infer<typeof LanguageSchema>;
export type SpeakerRoleTagZ = z.infer<typeof SpeakerRoleTagSchema>;
export type AudioAssetZ = z.infer<typeof AudioAssetSchema>;
export type SpeakerZ = z.infer<typeof SpeakerSchema>;
export type TalkZ = z.infer<typeof TalkSchema>;
export type SessionZ = z.infer<typeof SessionSchema>;
export type ConferenceZ = z.infer<typeof ConferenceSchema>;
export type ConferenceOutputZ = z.infer<typeof ConferenceOutputSchema>;
export type ApiAudioEntryZ = z.infer<typeof ApiAudioEntrySchema>;
export type ApiResponseZ = z.infer<typeof ApiResponseSchema>;
