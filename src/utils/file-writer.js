import { pathExists, ensureDir, readJson, writeJson, outputFile } from 'fs-extra/esm';
import { dirname } from 'path';
import { warn } from './logger.js';

/**
 * Write a file. Overwrites by default.
 * If force=false AND interactive=true, could prompt (but we default interactive to false).
 * Returns { path, status: 'created' | 'skipped' | 'updated' }
 */
export async function safeWriteFile(filePath, content, { force = false } = {}) {
  await ensureDir(dirname(filePath));

  const exists = await pathExists(filePath);
  if (exists && !force) {
    // Non-destructive: skip existing files unless force is set.
    // No interactive prompt — prompts during generation hang behind the spinner.
    return { path: filePath, status: 'skipped' };
  }

  await outputFile(filePath, content, 'utf8');
  return { path: filePath, status: exists ? 'updated' : 'created' };
}

/**
 * Merge new keys into an existing JSON file, or create it.
 * Always merges — never prompts.
 */
export async function mergeJsonFile(filePath, data, { force = false } = {}) {
  await ensureDir(dirname(filePath));

  let existing = {};
  const exists = await pathExists(filePath);

  if (exists) {
    try {
      existing = await readJson(filePath);
    } catch {
      warn(`Could not parse ${filePath}, overwriting`);
    }
  }

  const merged = deepMerge(existing, data);
  await writeJson(filePath, merged, { spaces: 2 });
  return { path: filePath, status: exists ? 'updated' : 'created' };
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
