/**
 * Runtime schema validation tests.
 *
 * Keeps the zod schemas in lockstep with the shapes actually produced by
 * the scraper and persisted to disk. Uses a real output file as the
 * canonical "valid" fixture.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ConferenceOutputSchema, ApiResponseSchema } from '../src/schemas.js';

const OUTPUT_DIR = path.join(__dirname, '..', 'output');

describe('ConferenceOutputSchema', () => {
  it('parses a real on-disk conference output file', () => {
    const fixturePath = path.join(OUTPUT_DIR, 'gc-2025-10-eng.json');
    const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
    const result = ConferenceOutputSchema.safeParse(raw);
    expect(result.success).toBe(true);
  });

  it('reports an actionable error when a required field is missing', () => {
    const fixturePath = path.join(OUTPUT_DIR, 'gc-2025-10-eng.json');
    const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
    // Drop a required field
    delete raw.conference;
    const result = ConferenceOutputSchema.safeParse(raw);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('conference');
    }
  });

  it('strips unknown extra fields rather than rejecting', () => {
    const fixturePath = path.join(OUTPUT_DIR, 'gc-2025-10-eng.json');
    const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
    raw.future_field_upstream_added_this = 'benign';
    const result = ConferenceOutputSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(
        (result.data as Record<string, unknown>).future_field_upstream_added_this,
      ).toBeUndefined();
    }
  });
});

describe('ApiResponseSchema', () => {
  it('parses the minimum shape the scraper relies on', () => {
    const minimal = {
      meta: {
        title: 'Saturday Morning Session',
        audio: [{ mediaUrl: 'https://example.com/a.mp3', variant: 'audio' }],
      },
      content: {
        body: '<html></html>',
      },
    };
    const result = ApiResponseSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it('accepts meta.ogTagImageUrl (gc_podcast-e62 talk hero image field)', () => {
    const withOg = {
      meta: {
        title: 'All Who Have Endured Valiantly',
        audio: [{ mediaUrl: 'https://example.com/a.mp3', variant: 'audio' }],
        ogTagImageUrl:
          'https://www.churchofjesuschrist.org/imgs/ibjynpzh92ctp5jb5d52w0litgecjiwn56afk26y/full/%21192%2C/0/default',
      },
      content: { body: '<html></html>' },
    };
    const result = ApiResponseSchema.safeParse(withOg);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.meta.ogTagImageUrl).toContain(
        'ibjynpzh92ctp5jb5d52w0litgecjiwn56afk26y',
      );
    }
  });
});
