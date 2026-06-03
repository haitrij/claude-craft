/**
 * Browser login flow for `ccraft auth`.
 *
 * Opens the browser to the web consent screen, runs a loopback HTTP server on
 * 127.0.0.1 to receive the signed authorization code (loopback + PKCE S256),
 * then exchanges the code + verifier for a hidden ck_live_ API key.
 *
 * The user never sees or pastes the key. A --no-browser fallback prints the
 * URL and accepts a pasted code for headless/SSH sessions.
 */
import http from 'http';
import crypto from 'crypto';
import os from 'os';
import chalk from 'chalk';
import ora from 'ora';
import {
  exchangeCliCode,
  getWebUrl,
  getDefaultServerUrl,
  loadConfig,
  saveConfig,
  ApiError,
} from './api-client.js';
import { openBrowser } from './open-browser.js';
import { themedInput } from '../ui/prompts.js';
import * as logger from './logger.js';

/**
 * Perform the full browser-login flow and return the saved config object.
 *
 * @param {object}  [opts]
 * @param {boolean} [opts.noBrowser=false] - Print URL + paste-code instead of loopback.
 * @returns {Promise<object>} the saved config
 */
export async function loginViaBrowser({ noBrowser = false } = {}) {
  // PKCE: verifier (hex) + S256 challenge (base64url, no padding) + state.
  const verifier = crypto.randomBytes(32).toString('hex');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');

  const serverUrl = getDefaultServerUrl();
  const webUrl = getWebUrl();
  const label = `claude-craft CLI on ${os.hostname()}`;

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  function finish(apiKey) {
    const existing = loadConfig() || {};
    const config = { ...existing, apiKey, serverUrl };
    saveConfig(config);
    return config;
  }

  async function exchangeAndSave(code) {
    const { apiKey, user } = await exchangeCliCode(code, verifier, serverUrl);
    const config = finish(apiKey);
    logger.success(`Signed in as ${user?.email || 'your account'}`);
    console.log(chalk.dim('  Saved to ~/.claude-craft/config.json'));
    return config;
  }

  // ── Manual / --no-browser path ──────────────────────────────────────
  if (noBrowser) {
    const authUrl = `${webUrl}/cli/auth?challenge=${challenge}&name=${encodeURIComponent(label)}&mode=manual`;
    console.log();
    console.log('  To sign in, open this URL in a browser:');
    console.log('  ' + chalk.underline(authUrl));
    console.log();
    console.log(chalk.dim('  After approving, copy the code shown and paste it below.'));
    console.log();

    const code = (await themedInput({ message: 'Paste the code from your browser:' })).trim();
    if (!code) {
      logger.error('No code entered.');
      process.exit(1);
    }

    const spinner = ora('Completing sign-in...').start();
    try {
      const c = await exchangeAndSave(code);
      spinner.stop();
      return c;
    } catch (err) {
      spinner.fail('Sign-in failed: ' + err.message);
      await delay(50);
      process.exit(1);
    }
  }

  // ── Loopback path (default) ─────────────────────────────────────────
  let resolveFlow, rejectFlow;
  const codePromise = new Promise((resolve, reject) => {
    resolveFlow = resolve;
    rejectFlow = reject;
  });

  const successPage = `<!doctype html><html><head><meta charset="utf-8"><title>claude-craft</title></head><body style="font-family:system-ui,-apple-system,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#111"><h2>Signed in to claude-craft</h2><p>You can close this tab and return to your terminal.</p></body></html>`;
  const errorPage = `<!doctype html><html><head><meta charset="utf-8"><title>claude-craft</title></head><body style="font-family:system-ui,-apple-system,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#111"><h2>Sign-in failed</h2><p>Something went wrong. Return to your terminal and try again.</p></body></html>`;

  const server = http.createServer((req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://127.0.0.1');
    } catch {
      res.writeHead(400).end();
      return;
    }

    if (url.pathname === '/callback') {
      const qCode = url.searchParams.get('code');
      const qState = url.searchParams.get('state');
      const qErr = url.searchParams.get('error');

      if (qErr) {
        res.writeHead(200, { 'Content-Type': 'text/html' }).end(errorPage);
        rejectFlow(new Error(qErr));
      } else if (qState !== state) {
        res.writeHead(200, { 'Content-Type': 'text/html' }).end(errorPage);
        rejectFlow(new Error('state_mismatch'));
      } else if (!qCode) {
        res.writeHead(200, { 'Content-Type': 'text/html' }).end(errorPage);
        rejectFlow(new Error('missing_code'));
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' }).end(successPage);
        resolveFlow(qCode);
      }
    } else if (url.pathname === '/favicon.ico') {
      res.writeHead(204).end();
    } else {
      res.writeHead(404).end();
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const authUrl = `${webUrl}/cli/auth?port=${port}&state=${state}&challenge=${challenge}&name=${encodeURIComponent(label)}`;
  console.log();
  console.log('  Opening your browser to sign in...');
  console.log(chalk.dim('  If it does not open, visit:'));
  console.log('  ' + chalk.underline(authUrl));

  try {
    await openBrowser(authUrl);
  } catch {
    logger.warn('Could not open a browser automatically. Open the URL above, or run: ccraft auth --no-browser');
  }

  const spinner = ora('Waiting for you to authorize in the browser...').start();
  const timeoutMs = 5 * 60 * 1000;
  let timer;
  const timeoutP = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error('timeout')), timeoutMs);
  });

  let code;
  try {
    code = await Promise.race([codePromise, timeoutP]);
  } catch (err) {
    spinner.fail(err.message === 'timeout' ? 'Timed out waiting for authorization.' : 'Sign-in failed: ' + err.message);
    clearTimeout(timer);
    server.close();
    await delay(50);
    process.exit(1);
  }

  clearTimeout(timer);
  server.close();
  spinner.text = 'Completing sign-in...';

  try {
    const c = await exchangeAndSave(code);
    spinner.stop();
    return c;
  } catch (err) {
    spinner.fail('Sign-in failed: ' + err.message);
    await delay(50);
    process.exit(1);
  }
}
