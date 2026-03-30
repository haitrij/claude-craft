import chalk from 'chalk';
import ora from 'ora';
import { validateKey, ApiError, loadConfig, saveConfig } from './api-client.js';
import { themedPassword } from '../ui/prompts.js';
import * as logger from './logger.js';

/**
 * Prompt user for API key inline when none is configured.
 * Validates format + server, saves to ~/.claude-craft/config.json.
 */
export async function promptForApiKey() {
  logger.warn('No API key found.');
  console.log(chalk.dim('  You need a claude-craft API key to continue.'));
  console.log(chalk.dim('  Get one at: ' + chalk.underline('https://claude-craft.dev/keys')));
  console.log();

  const key = await themedPassword({
    message: 'API key:',
    hint: 'Paste your ck_live_... key. It will be saved to ~/.claude-craft/config.json.',
    mask: '*',
  });

  if (!key || !key.trim()) {
    logger.error('No key provided. Run: ' + chalk.bold('ccraft auth <key>'));
    process.exit(1);
  }

  const trimmed = key.trim();

  if (!trimmed.startsWith('ck_live_')) {
    logger.error('Invalid key format. API keys must start with ' + chalk.bold('ck_live_'));
    process.exit(1);
  }

  const spinner = ora('Validating API key...').start();
  try {
    const valid = await validateKey(trimmed);
    if (!valid) {
      spinner.fail('API key is not valid.');
      await new Promise((r) => setTimeout(r, 50));
      process.exit(1);
    }
    spinner.succeed('API key validated.');
  } catch (err) {
    if (err instanceof ApiError && err.code === 'NETWORK_ERROR') {
      spinner.fail('Could not reach server. Ensure the server is running and try again.');
    } else {
      spinner.fail('Validation failed: ' + err.message);
    }
    await new Promise((r) => setTimeout(r, 50));
    process.exit(1);
  }

  const existing = loadConfig() || {};
  const config = { ...existing, apiKey: trimmed };
  saveConfig(config);
  logger.success('API key saved to ~/.claude-craft/config.json');
  console.log();

  return config;
}
