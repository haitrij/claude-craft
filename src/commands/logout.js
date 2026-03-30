/**
 * Logout command — clear stored API key.
 *
 * Usage: ccraft logout
 */
import chalk from 'chalk';
import { loadConfig, saveConfig } from '../utils/api-client.js';
import * as logger from '../utils/logger.js';

export async function runLogout() {
  const config = loadConfig();

  if (!config?.apiKey) {
    logger.warn('No API key is currently stored.');
    return;
  }

  const { apiKey, ...rest } = config;
  saveConfig(rest);

  console.log();
  logger.success('API key removed from ~/.claude-craft/config.json');
  console.log();
}
