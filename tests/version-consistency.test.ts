/**
 * package.json and package-lock.json must name the same version
 * (gc_podcast-e88). Hand-edited bumps once left the lockfile at 1.5.1 while
 * the package was at 1.7.0. Bump with:
 *   npm version <major|minor|patch> --no-git-tag-version
 * which rewrites both files; release.yml creates the tag after CI passes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf-8'));

describe('version manifests', () => {
  it('package-lock.json root version matches package.json', () => {
    const pkg = readJson('package.json').version as string;
    const lock = readJson('package-lock.json');
    const found = { lockfile: lock.version, 'lockfile packages[""]': lock.packages?.['']?.version };
    expect(
      found,
      `package.json is ${pkg}; fix with: npm version ${pkg} --no-git-tag-version --allow-same-version`,
    ).toEqual({ lockfile: pkg, 'lockfile packages[""]': pkg });
  });
});
