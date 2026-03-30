import { join } from 'path';
import { ensureDir, outputFile } from 'fs-extra/esm';
import { pathExists } from 'fs-extra/esm';

const directories = [
  '.claude/scripts',
  '.claude/mcps',
  '.claude/workflows',
];

export async function generate(config, targetDir, opts = {}) {
  const results = [];

  for (const dir of directories) {
    const dirPath = join(targetDir, dir);
    await ensureDir(dirPath);

    const gitkeepPath = join(dirPath, '.gitkeep');
    const exists = await pathExists(gitkeepPath);

    if (!exists) {
      await outputFile(gitkeepPath, '');
      results.push({ path: gitkeepPath, status: 'created' });
    } else {
      results.push({ path: gitkeepPath, status: 'exists' });
    }
  }

  return results;
}
