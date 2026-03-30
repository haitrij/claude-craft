import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { safeWriteFile } from './file-writer.js';
import { SENSITIVE_PATTERNS } from '../constants.js';

/**
 * Generate .gitignore additions to protect sensitive files.
 */
export function generateSecurityGitignore(detected) {
  const lines = [
    '# ── Security: sensitive files (added by claude-craft) ──',
    '.env',
    '.env.*',
    '!.env.example',
    '*.pem',
    '*.key',
    '*.cert',
    '*.p12',
    'credentials.json',
    'secrets.yaml',
    'secrets.yml',
    'serviceAccountKey*.json',
    'firebase-adminsdk*.json',
    '.aws/',
    '.gcp/',
    'id_rsa',
    'id_ed25519',
    '',
    '# ── Claude settings (added by claude-craft) ──',
    '.claude/',
    'CLAUDE.md',
    'USER_GUIDE.md',
    '.plans/',
    '',
  ];
  return lines.join('\n');
}

/**
 * Check if .gitignore already covers sensitive patterns.
 */
export function checkGitignoreSecurity(targetDir) {
  const gitignorePath = join(targetDir, '.gitignore');
  if (!existsSync(gitignorePath)) return { exists: false, coversSensitive: false, missing: SENSITIVE_PATTERNS };

  const content = readFileSync(gitignorePath, 'utf8');
  const missing = [];

  // Check core patterns
  if (!content.includes('.env')) missing.push('.env');
  if (!content.includes('*.pem') && !content.includes('.pem')) missing.push('*.pem');
  if (!content.includes('*.key') && !content.includes('.key')) missing.push('*.key');
  if (!content.includes('credentials')) missing.push('credentials.json');

  return {
    exists: true,
    coversSensitive: missing.length === 0,
    missing,
  };
}

/**
 * Generate security-related permission prompts for settings.json.
 * These define what Claude is allowed to do without asking.
 */
export function generatePermissionConfig(config) {
  const permissions = {
    // Default deny-list for sensitive operations
    deny: [
      'Bash(rm -rf *)',
      'Bash(rm -rf /)',
      'Bash(git push --force)',
      'Bash(git reset --hard)',
      'Bash(DROP TABLE)',
      'Bash(DELETE FROM)',
      'Bash(curl * | bash)',
      'Bash(wget * | bash)',
    ],
  };

  return permissions;
}
