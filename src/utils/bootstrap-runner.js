import { spawn } from 'child_process';
import { createInterface } from 'readline';
import chalk from 'chalk';
import { platformCmd } from './run-claude.js';

const DEFAULT_TIMEOUT = 600_000; // 10 minutes — bootstrap is long-running

/**
 * Shorten a file path to the last two segments for concise log output.
 */
function shortenPath(p) {
  if (!p) return '';
  const segments = p.replace(/\\/g, '/').split('/');
  return segments.length > 2 ? '\u2026/' + segments.slice(-2).join('/') : p;
}

/**
 * Format a tool-use event into a concise, human-friendly log line.
 */
function formatToolLog(name, input) {
  switch (name) {
    case 'Read':
      return `Reading ${shortenPath(input?.file_path)}`;
    case 'Write':
      return `Creating ${shortenPath(input?.file_path)}`;
    case 'Edit':
      return `Editing ${shortenPath(input?.file_path)}`;
    case 'Bash': {
      const cmd = input?.command || '';
      return `Running ${chalk.cyan(cmd.length > 60 ? cmd.slice(0, 57) + '\u2026' : cmd)}`;
    }
    case 'Glob':
      return `Searching for ${input?.pattern || 'files'}`;
    case 'Grep':
      return `Searching code for "${(input?.pattern || '').slice(0, 40)}"`;
    case 'Agent':
      return `Spawning ${input?.subagent_type || 'agent'}: ${(input?.description || '').slice(0, 50)}`;
    case 'Skill':
      return `Running /${input?.skill || 'skill'}`;
    case 'TaskCreate':
      return `Creating task: ${(input?.description || '').slice(0, 50)}`;
    case 'TaskUpdate':
      return `Updating task #${input?.task_id || '?'}`;
    default:
      return name;
  }
}

/**
 * Spawn `claude` CLI to run /bootstrap:auto in the target project directory.
 * Streams Claude's activity as a real-time log so the user can follow progress.
 *
 * Uses `--output-format stream-json` to capture tool-use events and display
 * them as concise log lines (e.g. "Creating src/index.ts", "Running npm install").
 *
 * @param {string} targetDir   – Absolute path to the new project directory
 * @param {string} description – User's project description (passed to /bootstrap:auto)
 * @param {object} [opts]
 * @param {number} [opts.timeout] – Hard timeout in ms (default: 600000)
 * @returns {Promise<void>} Resolves on exit code 0, rejects otherwise
 */
export function runBootstrap(targetDir, description, opts = {}) {
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT;

  const prompt = `/bootstrap:auto ${description}`;
  const { file, args } = platformCmd('claude', [
    '--dangerously-skip-permissions',
    '-p',
    prompt,
    '--verbose',
    '--output-format', 'stream-json',
  ]);

  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: targetDir,
      stdio: ['ignore', 'pipe', 'inherit'],
      windowsHide: true,
    });

    let killed = false;
    const toolBlocks = new Map(); // index → { name, chunks[] }

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
      }, 5000);
    }, timeout);

    // Parse streaming JSON and surface tool-use events as log lines
    const rl = createInterface({ input: child.stdout });

    rl.on('line', (line) => {
      if (!line.trim()) return;
      let event;
      try { event = JSON.parse(line); } catch { return; }

      // ── High-level message events (Claude Code wrapper format) ──
      if (event.type === 'assistant' && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === 'tool_use') {
            console.log(chalk.dim(`  \u25b8 ${formatToolLog(block.name, block.input)}`));
          }
        }
        return;
      }

      // ── Low-level streaming events (Anthropic API format) ───────
      if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
        toolBlocks.set(event.index, { name: event.content_block.name, chunks: [] });
        return;
      }
      if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
        const block = toolBlocks.get(event.index);
        if (block) block.chunks.push(event.delta.partial_json);
        return;
      }
      if (event.type === 'content_block_stop') {
        const block = toolBlocks.get(event.index);
        if (block) {
          let input = {};
          try { input = JSON.parse(block.chunks.join('')); } catch {}
          console.log(chalk.dim(`  \u25b8 ${formatToolLog(block.name, input)}`));
          toolBlocks.delete(event.index);
        }
        return;
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to launch Claude CLI: ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) {
        return reject(new Error('Bootstrap timed out after 10 minutes. You can re-run /bootstrap:auto manually inside the project.'));
      }
      if (code !== 0) {
        return reject(new Error(`Bootstrap exited with code ${code}. You can re-run /bootstrap:auto manually inside the project.`));
      }
      resolve();
    });
  });
}
