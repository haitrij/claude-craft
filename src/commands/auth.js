/**
 * Auth command — store API key for claude-craft server.
 *
 * Usage: ccraft auth <key> [-s <server-url>]
 */
import chalk from 'chalk';
import { validateKey, saveConfig, loadConfig, ApiError } from '../utils/api-client.js';
import * as logger from '../utils/logger.js';

export async function runAuth(key, options = {}) {
  const serverUrl = 'https://api.claude-craft.cc';

  if (!key.startsWith('ck_live_')) {
    logger.error('Invalid key format. API keys must start with ' + chalk.bold('ck_live_'));
    process.exit(1);
  }

  console.log();
  console.log(chalk.dim('  Validating API key against ' + serverUrl + '...'));

  try {
    const valid = await validateKey(key, serverUrl);
    if (!valid) {
      logger.error('API key is not valid. Check the key and try again.');
      await new Promise((r) => setTimeout(r, 50));
      process.exit(1);
    }
  } catch (err) {
    if (err instanceof ApiError && err.code === 'NETWORK_ERROR') {
      logger.error('Could not reach server at ' + chalk.bold(serverUrl));
      console.log(chalk.dim('  Ensure the server is running, or specify a different URL with -s <url>'));
      await new Promise((r) => setTimeout(r, 50));
      process.exit(1);
    }
    throw err;
  }

  const existing = loadConfig() || {};
  saveConfig({ ...existing, apiKey: key, serverUrl });

  console.log();
  logger.success('API key saved to ~/.claude-craft/config.json');
  console.log(chalk.dim('  Server: ' + serverUrl));
  console.log();
}
