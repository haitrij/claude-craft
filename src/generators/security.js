import { join } from 'path';
import { pathExists, outputFile } from 'fs-extra/esm';
import { readFileSync } from 'fs';
import { generateSecurityGitignore } from '../utils/security.js';

export async function generate(config, targetDir, opts = {}) {
  const results = [];

  if (!config.addSecurityGitignore) return results;

  const gitignorePath = join(targetDir, '.gitignore');
  const securityBlock = generateSecurityGitignore(config._detected || {});
  const marker = '# ── Security: sensitive files (added by claude-craft) ──';

  let content = '';
  let exists = false;

  if (await pathExists(gitignorePath)) {
    exists = true;
    content = readFileSync(gitignorePath, 'utf8');

    // Don't add if already present
    if (content.includes(marker)) {
      results.push({ path: gitignorePath, status: 'skipped' });
      return results;
    }

    // Append to existing
    if (!content.endsWith('\n')) content += '\n';
    content += '\n' + securityBlock;
  } else {
    content = securityBlock;
  }

  await outputFile(gitignorePath, content, 'utf8');
  results.push({ path: gitignorePath, status: exists ? 'updated' : 'created' });

  return results;
}
