/**
 * Semver version for this codebase (gc_podcast-0xx).
 *
 * Read from package.json so there is a single source of truth. The RSS
 * generator wires this into the channel-level `<generator>` tag so feed
 * consumers can identify which version of the generator produced a feed.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { name: string; version: string };

/** The semver string from package.json (e.g. "1.0.0"). */
export const PACKAGE_VERSION: string = pkg.version;

/** The package name from package.json. */
export const PACKAGE_NAME: string = pkg.name;

/**
 * A human-readable generator string suitable for the RSS `<generator>` tag,
 * e.g. "gc-podcast-scraper/1.0.0".
 */
export const GENERATOR_STRING = `${PACKAGE_NAME}/${PACKAGE_VERSION}`;
