/**
 * Runtime schema version check and migration scaffolding (gc_podcast-0uc).
 *
 * When loading persisted `output/gc-*.json` files, the version string must
 * match CURRENT_SCHEMA_VERSION. If it doesn't but a migration is registered
 * for the "fromVersion->toVersion" path, the migration is applied in-place.
 * If no migration exists for the detected version, a VersionMismatchError
 * is thrown so callers fail loudly rather than silently consuming stale data.
 *
 * Usage:
 *   import { validateVersion, CURRENT_SCHEMA_VERSION } from './migrations.js';
 *
 *   const raw = JSON.parse(await fs.readFile(path, 'utf-8'));
 *   const migrated = validateVersion(raw); // throws on unresolvable mismatch
 */

/** The schema version this codebase understands. Single source of truth. */
export const CURRENT_SCHEMA_VERSION = '1.0';

/**
 * Thrown when a loaded JSON file has a version that is neither
 * CURRENT_SCHEMA_VERSION nor covered by a registered migration path.
 */
export class VersionMismatchError extends Error {
  public readonly foundVersion: string | undefined;
  public readonly expectedVersion: string;

  constructor(found: string | undefined, expected: string) {
    const foundStr = found !== undefined ? `"${found}"` : 'absent';
    super(
      `Schema version mismatch: found ${foundStr}, expected "${expected}". ` +
        `No migration is registered for this version transition. ` +
        `Re-scrape the conference to regenerate the file.`
    );
    this.name = 'VersionMismatchError';
    this.foundVersion = found;
    this.expectedVersion = expected;
  }
}

/**
 * Migration function signature. Receives the raw (any-typed) object and
 * returns a transformed copy. MUST update the `version` field to the target
 * version so subsequent calls to validateVersion() see the new version.
 */
export type MigrationFn = (obj: Record<string, unknown>) => Record<string, unknown>;

/**
 * No-op migration registry. Keyed by `"fromVersion->toVersion"` string.
 *
 * To add a migration when v1.1 is introduced:
 *   MIGRATIONS['1.0->1.1'] = (obj) => {
 *     // transform obj.conference.sessions etc.
 *     return { ...obj, version: '1.1' };
 *   };
 *
 * Migrations are applied in a chain until the version matches
 * CURRENT_SCHEMA_VERSION or no further migration is found.
 */
export const MIGRATIONS: Record<string, MigrationFn> = {
  // Example (no-op, for demonstration — remove when real migrations land):
  // '0.9->1.0': (obj) => ({ ...obj, version: '1.0' }),
};

/**
 * Resolve a chain of migrations from `fromVersion` to
 * `CURRENT_SCHEMA_VERSION`, returning the path as an ordered array of
 * "from->to" keys. Returns an empty array when `fromVersion` already equals
 * the current version. Returns null when no complete path exists.
 *
 * This is a simple linear search — migration keys form a directed linear
 * chain, not an arbitrary graph. Good enough for a data format that
 * increments slowly.
 */
function resolveMigrationChain(fromVersion: string): string[] | null {
  if (fromVersion === CURRENT_SCHEMA_VERSION) return [];

  const chain: string[] = [];
  let current = fromVersion;
  const visited = new Set<string>();

  while (current !== CURRENT_SCHEMA_VERSION) {
    if (visited.has(current)) return null; // cycle guard
    visited.add(current);

    // Find a migration that starts from `current`.
    const nextKey = Object.keys(MIGRATIONS).find((k) => k.startsWith(`${current}->`));
    if (!nextKey) return null; // no path

    chain.push(nextKey);
    // Extract the target version from "from->to".
    current = nextKey.split('->')[1];
  }

  return chain;
}

/**
 * Validate and, if necessary, migrate a raw parsed JSON object.
 *
 * - If the version matches CURRENT_SCHEMA_VERSION: returns the object unchanged.
 * - If the version is different but a migration chain exists: applies all
 *   migrations in order and returns the migrated object.
 * - If the version is different and no chain exists: throws VersionMismatchError.
 *
 * The input is typed as `unknown` to force callers to go through this gate
 * before casting to ConferenceOutput.
 */
export function validateVersion(parsed: unknown): Record<string, unknown> {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new VersionMismatchError(undefined, CURRENT_SCHEMA_VERSION);
  }

  const obj = parsed as Record<string, unknown>;
  const version =
    typeof obj.version === 'string' ? obj.version : undefined;

  if (version === CURRENT_SCHEMA_VERSION) {
    return obj;
  }

  // Attempt to resolve a migration chain.
  const chain = version !== undefined ? resolveMigrationChain(version) : null;

  if (!chain || chain.length === 0) {
    throw new VersionMismatchError(version, CURRENT_SCHEMA_VERSION);
  }

  // Apply migrations in order.
  let result: Record<string, unknown> = { ...obj };
  for (const key of chain) {
    const migrate = MIGRATIONS[key];
    result = migrate(result);
  }

  return result;
}
