import { loginViaBrowser } from './browser-auth.js';
import * as logger from './logger.js';

/**
 * Trigger the browser login flow inline when no API key is configured.
 * Returns the saved config object (preflight.js relies on this name).
 */
export async function promptForApiKey() {
  console.log();
  logger.warn("You're not signed in to claude-craft.");
  return loginViaBrowser();
}
