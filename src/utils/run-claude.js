import { execFile, execFileSync, spawn } from 'child_process';

// On Windows, .cmd/.bat files require cmd.exe to execute.
// We invoke cmd.exe explicitly (instead of shell: true with args) to avoid
// the DEP0190 deprecation warning about unescaped arguments.
const isWindows = process.platform === 'win32';
const CMD_EXE = process.env.ComSpec || 'cmd.exe';

/** Prepend cmd.exe /c on Windows so .cmd files execute without shell: true */
export function platformCmd(cmd, args) {
  return isWindows
    ? { file: CMD_EXE, args: ['/c', cmd, ...args] }
    : { file: cmd, args };
}

/**
 * Check if the `claude` CLI is on PATH.
 * This one stays sync — it's fast (<100ms) and runs before any spinner.
 */
export function isClaudeAvailable() {
  try {
    const { file, args } = platformCmd('claude', ['--version']);
    execFileSync(file, args, {
      stdio: 'pipe',
      timeout: 5000,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check Claude Code installation and authorization status.
 * Uses `claude auth status --json` (local-only, no API call).
 *
 * @returns {{ installed: boolean, authorized: boolean, detail: object|null }}
 */
export function getClaudeAuthStatus() {
  // Step 1: Check if claude is installed
  try {
    const { file, args } = platformCmd('claude', ['--version']);
    execFileSync(file, args, { stdio: 'pipe', timeout: 5000, windowsHide: true });
  } catch {
    return { installed: false, authorized: false, detail: null };
  }

  // If ANTHROPIC_API_KEY env var is set, Claude can authenticate via that
  if (process.env.ANTHROPIC_API_KEY) {
    return { installed: true, authorized: true, detail: { authMethod: 'env-var' } };
  }

  // Step 2: Check auth status
  try {
    const { file, args } = platformCmd('claude', ['auth', 'status', '--json']);
    const output = execFileSync(file, args, {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 5000,
      windowsHide: true,
    });
    const status = JSON.parse(output.trim());
    return {
      installed: true,
      authorized: status.loggedIn === true,
      detail: status,
    };
  } catch {
    // If auth status command is unavailable (older CLI), assume authorized —
    // actual auth failures will surface when runClaude() is called later.
    return { installed: true, authorized: true, detail: null };
  }
}

/**
 * Run `claude -p` asynchronously so the event loop stays free
 * and ora spinners keep animating.
 *
 * @param {string[]} args   – CLI arguments (after `claude`)
 * @param {object}   opts   – spawn options (cwd, timeout, stdinInput, etc.)
 * @param {string}  [opts.stdinInput] – When provided, pipe this text to stdin
 *   instead of passing it as a CLI argument. Avoids Windows cmd.exe argument
 *   length limits and special character issues.
 * @param {number}  [opts.timeout] – Override default timeout (ms). Default: 180000.
 * @returns {Promise<string>} stdout
 */
export function runClaude(args, opts = {}) {
  const { stdinInput, timeout: userTimeout, ...restOpts } = opts;
  const timeout = userTimeout ?? 180_000;
  const { file, args: execArgs } = platformCmd('claude', args);

  if (stdinInput != null) {
    // Use spawn + stdin piping for long prompts / Windows safety
    return new Promise((resolve, reject) => {
      const child = spawn(file, execArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        ...restOpts,
      });

      let stdout = '';
      let stderr = '';
      let killed = false;

      const timer = setTimeout(() => {
        killed = true;
        child.kill();
      }, timeout);

      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (killed) {
          const err = new Error('Process timed out');
          err.killed = true;
          return reject(err);
        }
        if (code !== 0) {
          const err = new Error(`claude exited with code ${code}: ${stderr}`);
          err.code = code;
          return reject(err);
        }
        resolve(stdout);
      });

      child.stdin.write(stdinInput);
      child.stdin.end();
    });
  }

  // Existing execFile path for simple commands (no stdin needed)
  return new Promise((resolve, reject) => {
    execFile(file, execArgs, {
      timeout,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
      ...restOpts,
      stdio: undefined, // execFile uses pipes by default
    }, (err, stdout, stderr) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}
