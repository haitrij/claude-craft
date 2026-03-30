#!/usr/bin/env node

const [major] = process.versions.node.split('.').map(Number);
if (major < 18) {
  console.error('claude-craft requires Node.js >= 18. Current: ' + process.version);
  process.exit(1);
}

// Load .env files (lightweight, no dependency)
import { readFileSync } from 'fs';
import { resolve as resolvePath } from 'path';

function loadEnvFile(filePath) {
  try {
    const content = readFileSync(filePath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {}
}

// .env.development takes priority in dev, then .env as fallback
const cliRoot = resolvePath(import.meta.dirname, '..');
if (process.env.NODE_ENV !== 'production') {
  loadEnvFile(resolvePath(cliRoot, '.env.development'));
}
loadEnvFile(resolvePath(cliRoot, '.env'));

import { Command } from 'commander';
import { VERSION, PRESET_ALIASES } from '../src/constants.js';
import { runInstall } from '../src/commands/install.js';
import { runUpdate } from '../src/commands/update.js';
import { runAuth } from '../src/commands/auth.js';
import { runLogout } from '../src/commands/logout.js';

const program = new Command();

program
  .name('ccraft')
  .description('Scaffold Claude Code project structure')
  .version(VERSION);

program
  .command('auth <key>')
  .description('Store API key for claude-craft server')
  .option('-s, --server <url>', 'Server URL (default: https://api.claude-craft.dev)')
  .action(runAuth);

program
  .command('logout')
  .description('Remove stored API key')
  .action(runLogout);

program
  .command('install')
  .description('Generate Claude Code configuration — auto-detects new vs existing projects')
  .option('-y, --yes', 'Accept all defaults (non-interactive)')
  .option('-n, --name <name>', 'Project name (triggers new-project mode)')
  .option('--description <text>', 'Project description (triggers new-project mode)')
  .option(`-p, --preset <preset>`, `Apply a framework preset (${Object.keys(PRESET_ALIASES).join(', ')})`)
  .option('--pro', 'Developer mode — skip persona selection, show all options')
  .option('-d, --dir <path>', 'Target directory (default: cwd)')
  .action(runInstall);

program
  .command('update')
  .description('Re-analyze project and install any new components for detected stack changes')
  .option('-y, --yes', 'Accept all defaults (non-interactive)')
  .option('-d, --dir <path>', 'Target directory (default: cwd)')
  .action(runUpdate);

// Warn on unknown commands
program.on('command:*', ([cmd]) => {
  console.error(`\n  ⚠ Unknown command: "${cmd}"\n`);
  console.error(`  Run "ccraft --help" to see available commands.\n`);
  process.exit(1);
});

program.parse();

// No command provided — show warning + help
if (!program.args.length) {
  console.warn(`\n  ⚠ No command specified.\n`);
  program.help();
}
