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

// --- Drift detection -------------------------------------------------------
//
// Binary schema validation (safeParse returns success/failure) only catches
// shape breaks that are already bad enough to fail a permissive schema. For
// proactive monitoring we also want to notice:
//   - unknown top-level keys (upstream added a field we don't know about)
//   - unknown keys inside meta/content (the nested objects scraper.ts reads)
//   - "soft" signals — benign-but-suspicious values that still pass schema
//     (e.g. an empty title string, an empty audio[] where we expected one).
//
// detectApiDrift is pragmatic: it does NOT recurse deeply into every schema.
// We only watch the three surfaces scraper.ts actually touches.

/** Well-formed drift report produced by {@link detectApiDrift}. */
export interface DriftReport<T> {
  /** True when zod safeParse succeeded (may still have drift signals). */
  ok: boolean;
  /** Parsed (schema-stripped) data when ok === true. */
  data?: T;
  /** Zod issues when ok === false. */
  issues: z.ZodIssue[];
  /**
   * Keys present in the raw object but not in the schema, expressed as
   * dot-paths ("foo", "meta.bar", "content.baz"). Only the top level and the
   * known object fields (meta, content) are inspected.
   */
  unknownKeys: string[];
  /** Benign-but-suspicious values worth surfacing (empty title etc). */
  softSignals: string[];
}

/**
 * Collect the keys a zod object schema declares at the top level. Returns
 * an empty set for non-object schemas so callers can no-op gracefully.
 */
function getSchemaKeys(schema: z.ZodTypeAny): Set<string> {
  // Unwrap optional / nullable / default wrappers to get at the inner shape.
  let inner: z.ZodTypeAny = schema;
  while (
    inner instanceof z.ZodOptional ||
    inner instanceof z.ZodNullable ||
    inner instanceof z.ZodDefault
  ) {
    inner = inner._def.innerType as z.ZodTypeAny;
  }
  if (inner instanceof z.ZodObject) {
    return new Set(Object.keys(inner.shape as Record<string, unknown>));
  }
  return new Set();
}

/**
 * Compare a raw object's keys against a zod object schema and collect keys
 * present on the raw object that the schema does not declare.
 */
function diffKeys(
  raw: unknown,
  schema: z.ZodTypeAny,
  pathPrefix: string
): string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const schemaKeys = getSchemaKeys(schema);
  if (schemaKeys.size === 0) return [];
  const extras: string[] = [];
  for (const key of Object.keys(raw as Record<string, unknown>)) {
    if (!schemaKeys.has(key)) {
      extras.push(pathPrefix ? `${pathPrefix}.${key}` : key);
    }
  }
  return extras;
}

/**
 * Run {@link ApiResponseSchema}-style validation and ALSO collect drift
 * signals that wouldn't fail the schema itself. Generic enough to point at
 * any top-level zod object schema that has a `meta` and/or `content`
 * sub-object, but in practice only called against `ApiResponseSchema`.
 *
 * Non-fatal: callers should log drift signals, not throw.
 */
export function detectApiDrift<T>(
  parsed: unknown,
  schema: z.ZodType<T>
): DriftReport<T> {
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues,
      unknownKeys: [],
      softSignals: [],
    };
  }

  const unknownKeys: string[] = [];
  const softSignals: string[] = [];

  // Only inspect when parsed is an object — safeParse success guarantees
  // this for a ZodObject schema, but be defensive for generic callers.
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    unknownKeys.push(...diffKeys(parsed, schema, ''));

    // Probe meta and content sub-objects if the schema declares them.
    const schemaKeys = getSchemaKeys(schema);
    const raw = parsed as Record<string, unknown>;

    if (schemaKeys.has('meta')) {
      const metaSchema = (schema as unknown as z.ZodObject<z.ZodRawShape>)
        .shape?.meta;
      if (metaSchema) {
        unknownKeys.push(...diffKeys(raw.meta, metaSchema, 'meta'));
      }
      // Soft signals on meta.
      const meta = raw.meta;
      if (meta && typeof meta === 'object') {
        const m = meta as Record<string, unknown>;
        if (typeof m.title === 'string' && m.title.trim() === '') {
          softSignals.push('meta.title is empty');
        }
        if (Array.isArray(m.audio) && m.audio.length === 0) {
          softSignals.push('meta.audio is an empty array');
        }
      }
    }

    if (schemaKeys.has('content')) {
      const contentSchema = (schema as unknown as z.ZodObject<z.ZodRawShape>)
        .shape?.content;
      if (contentSchema) {
        unknownKeys.push(...diffKeys(raw.content, contentSchema, 'content'));
      }
      // Soft signals on content.
      const content = raw.content;
      if (content && typeof content === 'object') {
        const c = content as Record<string, unknown>;
        if (typeof c.body === 'string' && c.body.trim() === '') {
          softSignals.push('content.body is empty');
        }
      }
    }
  }

  return {
    ok: true,
    data: result.data,
    issues: [],
    unknownKeys,
    softSignals,
  };
}
