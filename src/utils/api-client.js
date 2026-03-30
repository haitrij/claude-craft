/**
 * API client for claude-craft server.
 * Uses Node 18+ native fetch. No external dependencies.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { VERSION } from '../constants.js';

const CONFIG_DIR = join(homedir(), '.claude-craft');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
function getDefaultServerUrl() {
  return 'https://api.claude-craft.cc';
}
const TIMEOUT_MS = 30_000;

export class ApiError extends Error {
  constructor(message, code, statusCode = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Load stored config from ~/.claude-craft/config.json
 */
export function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Save config to ~/.claude-craft/config.json
 */
export function saveConfig(config) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

/**
 * Call POST /api/generate on the server.
 *
 * @param {object} analysis - Project analysis data
 * @param {object} [options] - { projectPath }
 * @returns {Promise<{ files, summary, mcpConfigs, serverVersion }>}
 */
export async function callGenerate(analysis, options = {}) {
  const config = loadConfig();
  if (!config?.apiKey) {
    throw new ApiError(
      'No API key configured. Run: ccraft auth <key>',
      'NO_API_KEY',
    );
  }

  const serverUrl = config.serverUrl || getDefaultServerUrl();
  const url = `${serverUrl}/api/generate`;

  let res;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
        'X-Claude-Craft-Version': VERSION,
        'X-Claude-Craft-Api-Version': '1',
      },
      body: JSON.stringify({ analysis, options }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new ApiError(
        'Request timed out. Check connection and ~/.claude-craft/config.json',
        'TIMEOUT',
      );
    }
    throw new ApiError(
      'Could not reach server. Check connection and ~/.claude-craft/config.json',
      'NETWORK_ERROR',
    );
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    switch (res.status) {
      case 401:
      case 403:
        throw new ApiError(
          body.error || 'API key invalid or expired. Run: ccraft auth <new-key>',
          'AUTH_ERROR',
          res.status,
        );
      case 426:
        throw new ApiError(
          body.error || 'Client incompatible with server. Run: npm update -g ccraft',
          'VERSION_MISMATCH',
          426,
        );
      case 400:
        throw new ApiError(
          `Bad request: ${body.error || 'unknown'}${body.details ? ' — ' + body.details.join(', ') : ''}`,
          'BAD_REQUEST',
          400,
        );
      default:
        throw new ApiError(
          body.error || 'Server error. Try again later.',
          'SERVER_ERROR',
          res.status,
        );
    }
  }

  return res.json();
}

/**
 * Call POST /api/update on the server.
 * Returns delta components (new files not already installed) + change summary.
 *
 * @param {object}   currentAnalysis        - Freshly computed project analysis
 * @param {object}   previousAnalysis       - Previously stored project analysis
 * @param {string[]} installedRelativePaths - Relative file paths already on disk
 * @returns {Promise<{ changes, guaranteed, mcpConfigs, summary }>}
 */
export async function callUpdate(currentAnalysis, previousAnalysis, installedRelativePaths) {
  const config = loadConfig();
  if (!config?.apiKey) {
    throw new ApiError(
      'No API key configured. Run: ccraft auth <key>',
      'NO_API_KEY',
    );
  }

  const serverUrl = config.serverUrl || getDefaultServerUrl();
  const url = `${serverUrl}/api/update`;

  let res;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
        'X-Claude-Craft-Version': VERSION,
        'X-Claude-Craft-Api-Version': '1',
      },
      body: JSON.stringify({ currentAnalysis, previousAnalysis, installedPaths: installedRelativePaths }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new ApiError(
        'Request timed out. Check connection and ~/.claude-craft/config.json',
        'TIMEOUT',
      );
    }
    throw new ApiError(
      'Could not reach server. Check connection and ~/.claude-craft/config.json',
      'NETWORK_ERROR',
    );
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    switch (res.status) {
      case 401:
      case 403:
        throw new ApiError(
          body.error || 'API key invalid or expired. Run: ccraft auth <new-key>',
          'AUTH_ERROR',
          res.status,
        );
      case 426:
        throw new ApiError(
          body.error || 'Client incompatible with server. Run: npm update -g ccraft',
          'VERSION_MISMATCH',
          426,
        );
      case 400:
        throw new ApiError(
          `Bad request: ${body.error || 'unknown'}${body.details ? ' — ' + body.details.join(', ') : ''}`,
          'BAD_REQUEST',
          400,
        );
      default:
        throw new ApiError(
          body.error || 'Server error. Try again later.',
          'SERVER_ERROR',
          res.status,
        );
    }
  }

  return res.json();
}

/**
 * Validate an API key against the server.
 *
 * @param {string} apiKey
 * @param {string} [serverUrl]
 * @returns {Promise<boolean>}
 */
export async function validateKey(apiKey, serverUrl) {
  const url = `${serverUrl || getDefaultServerUrl()}/api/auth/validate`;

  let res;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Connection': 'close',
      },
      body: JSON.stringify({ apiKey }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
  } catch {
    throw new ApiError(
      'Could not reach server to validate key.',
      'NETWORK_ERROR',
    );
  }

  if (!res.ok) {
    // Consume body to fully release the TCP connection
    await res.text().catch(() => {});
    return false;
  }

  const body = await res.json();
  return body.valid === true;
}
