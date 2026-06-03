/**
 * Auth command — sign in to claude-craft.
 *
 * Default: opens the browser, the user signs in via the existing OAuth +
 * consent flow, and a hidden ck_live_ API key is minted and stored.
 *
 * Flags:
 *   --no-browser   Print a URL to open manually and paste the code (headless/SSH).
 *   --token <key>  Sign in non-interactively with an existing ck_live_ key (CI).
 */
import chalk from 'chalk';
import { validateKey, saveConfig, loadConfig, getDefaultServerUrl, ApiError } from '../utils/api-client.js';
import { loginViaBrowser } from '../utils/browser-auth.js';
import * as logger from '../utils/logger.js';

export async function runAuth(options = {}) {
  // ── Non-interactive token path (CI) ─────────────────────────────────
  if (options.token) {
    const key = String(options.token).trim();
    if (!key.startsWith('ck_live_')) {
      logger.error('Invalid key format. API keys must start with ' + chalk.bold('ck_live_'));
      process.exit(1);
    }

    try {
      const valid = await validateKey(key);
      if (!valid) {
        logger.error('API key is not valid. Check the key and try again.');
        await new Promise((r) => setTimeout(r, 50));
        process.exit(1);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NETWORK_ERROR') {
        logger.error('Could not reach server to validate the key. Check your connection and try again.');
        await new Promise((r) => setTimeout(r, 50));
        process.exit(1);
      }
      throw err;
    }

    saveConfig({ ...(loadConfig() || {}), apiKey: key, serverUrl: getDefaultServerUrl() });
    logger.success('API key saved to ~/.claude-craft/config.json');
    return;
  }

  // ── Default: browser login ──────────────────────────────────────────
  await loginViaBrowser({ noBrowser: options.browser === false });
}
