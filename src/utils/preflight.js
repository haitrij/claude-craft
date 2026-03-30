/**
 * Shared pre-flight checks for all claude-craft commands.
 *
 * Verifies:
 *   1. Claude Code is installed and authorized
 *   2. Target directory is a claude-craft project (optional)
 *   3. API key exists in config
 *   4. API key is valid against the server (also proves the server is reachable)
 *
 * Exits the process with code 1 on failure.
 */
import { existsSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { loadConfig, validateKey, ApiError } from './api-client.js';
import { getClaudeAuthStatus } from './run-claude.js';
import { promptForApiKey } from './prompt-api-key.js';
import { dotPad } from '../ui/format.js';
import { colors } from '../ui/theme.js';
import * as logger from './logger.js';

/**
 * Run all pre-flight checks and display results.
 *
 * @param {object}  [options]
 * @param {boolean} [options.interactive=true]          - Allow prompting for missing API key
 * @param {boolean} [options.requireClaude=true]        - Require Claude Code (skip for headless)
 * @param {boolean} [options.requireCraftProject=false] - Require .claude/.claude-craft.json marker
 * @param {string}  [options.targetDir]                 - Project directory (needed for requireCraftProject)
 * @returns {Promise<{ apiConfig: object }>}            - Validated config for downstream use
 */
export async function runPreflight(options = {}) {
  const { interactive = true, requireClaude = true, requireCraftProject = false, targetDir } = options;

  console.log(chalk.bold('  Environment'));

  const envErrors = [];

  // ── 1. Claude Code ──────────────────────────────────────────────────
  if (requireClaude) {
    const claudeStatus = getClaudeAuthStatus();
    if (claudeStatus.installed && claudeStatus.authorized) {
      const suffix = claudeStatus.detail?.email ? chalk.dim(` (${claudeStatus.detail.email})`) : '';
      console.log('    ' + dotPad('Claude Code', colors.success('ok') + suffix));
    } else if (claudeStatus.installed && !claudeStatus.authorized) {
      console.log('    ' + dotPad('Claude Code', colors.error('not authorized')));
      envErrors.push('Claude Code is installed but not authorized. Run: claude auth login');
    } else {
      console.log('    ' + dotPad('Claude Code', colors.error('not found')));
      envErrors.push('Claude Code is required. Install from: https://claude.ai/download');
    }
  }

  // ── 2. claude-craft project marker ─────────────────────────────────
  if (requireCraftProject) {
    const markerPath = join(targetDir || process.cwd(), '.claude', '.claude-craft.json');
    if (existsSync(markerPath)) {
      console.log('    ' + dotPad('claude-craft project', colors.success('ok')));
    } else {
      console.log('    ' + dotPad('claude-craft project', colors.error('not found')));
      envErrors.push('No claude-craft project found. Run: ccraft install first.');
    }
  }

  // ── 3. API key existence ────────────────────────────────────────────
  let apiConfig = loadConfig();

  if (!apiConfig?.apiKey) {
    if (interactive) {
      apiConfig = await promptForApiKey();
    } else {
      console.log('    ' + dotPad('API key', colors.error('missing')));
      envErrors.push('No API key configured. Run: ccraft auth <key>');
    }
  }

  // ── 4. API key validation (also proves server is reachable) ─────────
  if (apiConfig?.apiKey) {
    const serverUrl = 'https://api.claude-craft.cc';

    try {
      const valid = await validateKey(apiConfig.apiKey, serverUrl);
      if (valid) {
        console.log('    ' + dotPad('API key', colors.success('valid')));
      } else {
        console.log('    ' + dotPad('API key', colors.error('invalid')));
        envErrors.push('API key is invalid or expired. Run: ccraft auth <new-key>\n  Get a new key at https://claude-craft.cc/');
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NETWORK_ERROR') {
        console.log('    ' + dotPad('API key', colors.error('server unreachable')));
        envErrors.push(`Could not reach claude-craft server at ${serverUrl}. Check your connection.`);
      } else {
        console.log('    ' + dotPad('API key', colors.error('check failed')));
        envErrors.push(`API key validation failed: ${err.message}`);
      }
    }
  }

  // ── Fail fast if any checks failed ──────────────────────────────────
  if (envErrors.length > 0) {
    console.log();
    for (const msg of envErrors) {
      logger.error(msg);
    }
    // Allow libuv to close pending fetch handles before exiting.
    // Calling process.exit() synchronously after fetch on Windows triggers
    // "UV_HANDLE_CLOSING" assertion in libuv's async.c.
    await new Promise((resolve) => setTimeout(resolve, 50));
    process.exit(1);
  }

  console.log();

  return { apiConfig };
}
