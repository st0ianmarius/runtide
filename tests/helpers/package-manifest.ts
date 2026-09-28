import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROJECT_ROOT } from './source-scan.ts';

/** Whether a parsed JSON value is an object whose keys can be read. */
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The package names listed in one dependency field of the project's `package.json`, such as `dependencies`. A missing
 * field lists nothing.
 */
export const listedPackages = (field: 'dependencies' | 'devDependencies'): ReadonlySet<string> => {
  const manifest: unknown = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8'));

  if (!isRecord(manifest)) {
    throw new Error('package.json is not a JSON object');
  }

  const packages = manifest[field];

  return new Set(isRecord(packages) ? Object.keys(packages) : []);
};
