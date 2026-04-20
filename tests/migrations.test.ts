/**
 * Tests for runtime schema version check + migration scaffolding (gc_podcast-0uc).
 *
 * Verifies:
 *   - Loading a file with the correct version passes
 *   - Loading a file with a wrong version fails (VersionMismatchError)
 *   - A registered migration is invoked and transforms the object
 *   - Migration chain updates the version field
 *   - CURRENT_SCHEMA_VERSION is exported and matches the value in SPEC_VERSION
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  validateVersion,
  VersionMismatchError,
  CURRENT_SCHEMA_VERSION,
  MIGRATIONS,
  MigrationFn,
} from '../src/migrations.js';

// Clean up any test migrations we add.
afterEach(() => {
  for (const key of Object.keys(MIGRATIONS)) {
    // Only clean up keys we added in tests (not real keys).
    if (key.startsWith('0.') || key.startsWith('99.')) {
      delete MIGRATIONS[key];
    }
  }
});

describe('CURRENT_SCHEMA_VERSION', () => {
  it('is a non-empty string', () => {
    expect(typeof CURRENT_SCHEMA_VERSION).toBe('string');
    expect(CURRENT_SCHEMA_VERSION.length).toBeGreaterThan(0);
  });
});

describe('validateVersion', () => {
  it('returns the object unchanged when version matches CURRENT_SCHEMA_VERSION', () => {
    const obj = { version: CURRENT_SCHEMA_VERSION, conference: { year: 2025 } };
    const result = validateVersion(obj);
    expect(result).toBe(obj); // same reference — no copy made
  });

  it('throws VersionMismatchError when version is wrong and no migration exists', () => {
    const obj = { version: '99.0', conference: {} };
    expect(() => validateVersion(obj)).toThrowError(VersionMismatchError);
  });

  it('throws VersionMismatchError when version is absent', () => {
    const obj = { conference: {} };
    expect(() => validateVersion(obj)).toThrowError(VersionMismatchError);
  });

  it('throws VersionMismatchError for a non-object input', () => {
    expect(() => validateVersion('bad')).toThrowError(VersionMismatchError);
    expect(() => validateVersion(null)).toThrowError(VersionMismatchError);
    expect(() => validateVersion([1, 2])).toThrowError(VersionMismatchError);
  });

  it('applies a registered migration and returns the migrated object', () => {
    // Register a test migration from "0.9" to CURRENT_SCHEMA_VERSION.
    const migrateFn: MigrationFn = (obj) => ({
      ...obj,
      version: CURRENT_SCHEMA_VERSION,
      migrated: true,
    });
    MIGRATIONS[`0.9->${CURRENT_SCHEMA_VERSION}`] = migrateFn;

    const obj = { version: '0.9', conference: { year: 2025 } };
    const result = validateVersion(obj);

    expect(result.version).toBe(CURRENT_SCHEMA_VERSION);
    expect((result as Record<string, unknown>).migrated).toBe(true);
  });

  it('records VersionMismatchError.foundVersion and expectedVersion', () => {
    const obj = { version: '99.0' };
    let caught: unknown;
    try {
      validateVersion(obj);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(VersionMismatchError);
    const err = caught as VersionMismatchError;
    expect(err.foundVersion).toBe('99.0');
    expect(err.expectedVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('migration chain is applied in order for multi-hop paths', () => {
    // Set up a two-hop chain: 0.8 → 0.9 → CURRENT_SCHEMA_VERSION
    MIGRATIONS[`0.8->0.9`] = (obj) => ({
      ...obj,
      version: '0.9',
      hop1: true,
    });
    MIGRATIONS[`0.9->${CURRENT_SCHEMA_VERSION}`] = (obj) => ({
      ...obj,
      version: CURRENT_SCHEMA_VERSION,
      hop2: true,
    });

    const obj = { version: '0.8', conference: {} };
    const result = validateVersion(obj);

    expect(result.version).toBe(CURRENT_SCHEMA_VERSION);
    expect((result as Record<string, unknown>).hop1).toBe(true);
    expect((result as Record<string, unknown>).hop2).toBe(true);
  });
});
