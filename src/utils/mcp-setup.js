/**
 * MCP server setup utilities.
 *
 * Handles prerequisites checking, package verification, API key validation,
 * and health checks to ensure MCP servers are properly configured and working.
 */

import { execSync, spawn } from 'child_process';

// ── Prerequisites ────────────────────────────────────────────────────

/**
 * Verify that node and npx are available at required versions.
 * Returns { node, npx, errors[] }.
 */
export function checkPrerequisites() {
  const results = { node: false, npx: false, errors: [] };

  try {
    const nodeVersion = execSync('node --version', {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const major = parseInt(nodeVersion.replace('v', '').split('.')[0]);
    results.node = major >= 18;
    results.nodeVersion = nodeVersion;
    if (!results.node) {
      results.errors.push(`Node.js ${nodeVersion} found — v18+ required for MCP servers`);
    }
  } catch {
    results.errors.push('Node.js not found in PATH — required for MCP servers');
  }

  try {
    const npxVersion = execSync('npx --version', {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    results.npx = true;
    results.npxVersion = npxVersion;
  } catch {
    results.errors.push('npx not found in PATH — required to run stdio MCP servers');
  }

  return results;
}

// ── API Key Validation ───────────────────────────────────────────────

const KEY_VALIDATORS = {
  github: {
    keyName: 'GITHUB_PERSONAL_ACCESS_TOKEN',
    check: (v) => /^(ghp_|github_pat_)/.test(v),
    hint: 'GitHub PATs typically start with ghp_ or github_pat_',
  },
  supabase: {
    keyName: 'SUPABASE_ACCESS_TOKEN',
    check: (v) => /^sbp_/.test(v) || v.startsWith('eyJ'),
    hint: 'Supabase tokens typically start with sbp_ or eyJ (JWT)',
  },
  linear: {
    keyName: 'LINEAR_API_KEY',
    check: (v) => /^lin_api_/.test(v),
    hint: 'Linear API keys typically start with lin_api_',
  },
  'brave-search': {
    keyName: 'BRAVE_API_KEY',
    check: (v) => /^BSA/.test(v) || v.length >= 20,
    hint: 'Brave Search API keys typically start with BSA',
  },
  notion: {
    keyName: 'NOTION_TOKEN',
    check: (v) => /^(ntn_|secret_)/.test(v),
    hint: 'Notion tokens typically start with ntn_ or secret_',
  },
  // ── Database validators ────────────────────────────────────────
  postgres: {
    keyName: 'POSTGRES_CONNECTION_STRING',
    check: (v) => /^postgres(ql)?:\/\//.test(v),
    hint: 'PostgreSQL connection strings start with postgres:// or postgresql://',
  },
  mongodb: {
    keyName: 'MONGODB_CONNECTION_STRING',
    check: (v) => /^mongodb(\+srv)?:\/\//.test(v),
    hint: 'MongoDB connection strings start with mongodb:// or mongodb+srv://',
  },
  mssql: {
    keyName: 'MSSQL_CONNECTION_STRING',
    check: (v) => /^(Server|Data Source|mssql:)/i.test(v) || v.includes('Initial Catalog') || v.includes('Database='),
    hint: 'SQL Server connection strings typically contain Server= and Database= (or use mssql:// URL format)',
  },
  mysql: {
    keyName: 'MYSQL_CONNECTION_STRING',
    check: (v) => /^mysql:\/\//.test(v),
    hint: 'MySQL connection strings start with mysql://',
  },
  redis: {
    keyName: 'REDIS_URL',
    check: (v) => /^rediss?:\/\//.test(v),
    hint: 'Redis URLs start with redis:// or rediss://',
  },
  // ── PM tool validators ──────────────────────────────────────────
  'jira-url': {
    keyName: 'JIRA_BASE_URL',
    check: (v) => /^https?:\/\/.+\.atlassian\.net/.test(v),
    hint: 'Jira base URL must be a full HTTPS URL, e.g. https://yourteam.atlassian.net',
  },
  jira: {
    keyName: 'JIRA_PAT',
    check: (v) => v.length >= 20,
    hint: 'Jira PATs are long base64 strings (20+ characters)',
  },
  clickup: {
    keyName: 'CLICKUP_API_KEY',
    check: (v) => /^pk_/.test(v) || v.length >= 20,
    hint: 'ClickUp API keys typically start with pk_',
  },
  asana: {
    keyName: 'ASANA_ACCESS_TOKEN',
    check: (v) => v.startsWith('1/') || v.length >= 20,
    hint: 'Asana PATs typically start with 1/ followed by a long string',
  },
  monday: {
    keyName: 'MONDAY_TOKEN',
    check: (v) => v.startsWith('eyJ') || v.length >= 100,
    hint: 'Monday.com API tokens are JWT-format strings starting with eyJ',
  },
  shortcut: {
    keyName: 'SHORTCUT_API_TOKEN',
    check: (v) => v.length >= 32,
    hint: 'Shortcut API tokens are UUID-format strings (32+ characters)',
  },
  gitlab: {
    keyName: 'GITLAB_PERSONAL_ACCESS_TOKEN',
    check: (v) => /^glpat-/.test(v) || v.length >= 20,
    hint: 'GitLab PATs typically start with glpat-',
  },
  'trello-key': {
    keyName: 'TRELLO_API_KEY',
    check: (v) => /^[0-9a-f]{32}$/.test(v),
    hint: 'Trello API keys are 32-character hex strings',
  },
  trello: {
    keyName: 'TRELLO_TOKEN',
    check: (v) => /^[0-9a-f]{64}$/.test(v) || v.length >= 32,
    hint: 'Trello tokens are typically 64-character hex strings',
  },
  todoist: {
    keyName: 'TODOIST_API_TOKEN',
    check: (v) => /^[0-9a-f]{40}$/.test(v) || v.length >= 20,
    hint: 'Todoist API tokens are 40-character hex strings',
  },
  'youtrack-url': {
    keyName: 'YOUTRACK_URL',
    check: (v) => /^https?:\/\//.test(v),
    hint: 'YouTrack URL must start with https://, e.g. https://yourteam.youtrack.cloud',
  },
  youtrack: {
    keyName: 'YOUTRACK_TOKEN',
    check: (v) => /^perm:/.test(v) || v.length >= 20,
    hint: 'YouTrack permanent tokens typically start with perm:',
  },
  plane: {
    keyName: 'PLANE_API_KEY',
    check: (v) => v.length >= 20,
    hint: 'Plane API keys are long strings (20+ characters)',
  },
};

/**
 * Validate API key format for known MCP providers.
 * Returns { valid: boolean, warning: string|null }.
 * A warning means the format looks unusual but is still accepted.
 */
export function validateApiKeyFormat(mcpId, keyName, keyValue) {
  if (!keyValue || !keyValue.trim()) {
    return { valid: false, warning: null };
  }

  const value = keyValue.trim();
  // Try mcpId first, then look up by keyName for multi-key MCPs
  let validator = KEY_VALIDATORS[mcpId];
  if (!validator || (validator.keyName !== keyName)) {
    const byKeyName = Object.values(KEY_VALIDATORS).find((v) => v.keyName === keyName);
    if (byKeyName) validator = byKeyName;
  }
  if (!validator) return { valid: true, warning: null };

  if (!validator.check(value)) {
    return { valid: true, warning: validator.hint };
  }

  return { valid: true, warning: null };
}

// ── Package Verification ─────────────────────────────────────────────

/**
 * Extract npm package name from an npx command string.
 * e.g. 'npx -y @upstash/context7-mcp@latest' → '@upstash/context7-mcp'
 */
export function extractPackageName(command) {
  const parts = command.split(/\s+/);
  for (const part of parts) {
    if (part === 'npx' || part.startsWith('-')) continue;
    // Strip version suffix (@latest, @^1.0.0, etc.)
    // Handle scoped packages: @scope/name@version
    if (part.startsWith('@')) {
      const slashIdx = part.indexOf('/');
      if (slashIdx === -1) continue;
      const afterSlash = part.slice(slashIdx + 1);
      const atIdx = afterSlash.indexOf('@');
      if (atIdx > 0) {
        return part.slice(0, slashIdx + 1 + atIdx);
      }
      return part;
    }
    // Unscoped: name@version → name
    const atIdx = part.indexOf('@');
    if (atIdx > 0) return part.slice(0, atIdx);
    return part;
  }
  return null;
}

/**
 * Verify an MCP package exists in the npm registry.
 * Returns { success, version?, packageName?, error? }.
 */
export async function verifyMcpPackage(mcp) {
  if (mcp.transport === 'url') {
    return { success: true, type: 'url', url: mcp.url };
  }

  const packageName = extractPackageName(mcp.command);
  if (!packageName) {
    return { success: false, error: 'Could not parse package name from command' };
  }

  try {
    const version = execSync(`npm view "${packageName}" version`, {
      encoding: 'utf8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return { success: true, version, packageName };
  } catch {
    return {
      success: false,
      error: `Package "${packageName}" not found in npm registry`,
      packageName,
    };
  }
}

// ── Health Checks ────────────────────────────────────────────────────

/**
 * Health check a URL-based MCP endpoint.
 * Returns { success, error? }.
 */
async function healthCheckUrl(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    // MCP SSE endpoints may return various codes; anything < 500 is reachable
    return { success: response.status < 500 };
  } catch (err) {
    return { success: false, error: `URL unreachable: ${err.message}` };
  }
}

/**
 * Resolve placeholder variables in MCP args.
 * e.g. '${PROJECT_DIR}' → '/actual/path'
 */
function resolveArgs(args, targetDir) {
  if (!args || args.length === 0) return [];
  return args.map((arg) => arg.replace(/\$\{PROJECT_DIR\}/g, targetDir));
}

/**
 * Extract a meaningful error message from stderr output.
 * Node.js stack traces start with file paths — find the actual Error: line instead.
 */
function extractStderrMessage(stderr, exitCode) {
  if (!stderr.trim()) return `Exited with code ${exitCode}`;
  const lines = stderr.trim().split('\n');
  // Look for an "Error:" line (the most informative part of a Node stack trace)
  const errorLine = lines.find((l) => /^\w*Error:/.test(l.trim()));
  if (errorLine) return errorLine.trim();
  // Fallback: last non-empty line is often more useful than first
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (l && !l.startsWith('at ') && !l.startsWith('^')) return l;
  }
  return lines[0] || `Exited with code ${exitCode}`;
}

/**
 * Health check a stdio MCP server by spawning it briefly.
 * The server is started and if it hasn't crashed after ~3s, it's considered working.
 * Returns { success, error? }.
 */
async function healthCheckStdio(mcp, env = {}, targetDir = process.cwd()) {
  return new Promise((resolve) => {
    const resolvedArgs = resolveArgs(mcp.args, targetDir);
    const fullCommand = [mcp.command, ...resolvedArgs].join(' ');

    let settled = false;
    const settle = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    let child;
    try {
      child = spawn(fullCommand, [], {
        env: { ...process.env, ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
        windowsHide: true,
      });
    } catch (err) {
      settle({ success: false, error: `Failed to spawn: ${err.message}` });
      return;
    }

    let stderr = '';
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      settle({ success: false, error: err.message });
    });

    child.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        settle({ success: false, error: extractStderrMessage(stderr, code) });
      }
    });

    // If still running after 3s, it's working — kill it
    setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore kill errors
      }
      settle({ success: true });
    }, 3000);
  });
}

/**
 * Run a health check on a single MCP server.
 * Returns { success, error? }.
 */
export async function healthCheckMcp(mcp, env = {}, targetDir = process.cwd()) {
  if (mcp.transport === 'url') {
    return healthCheckUrl(mcp.url);
  }
  return healthCheckStdio(mcp, env, targetDir);
}

// ── Full Setup Pipeline ──────────────────────────────────────────────

/**
 * Run the full MCP setup pipeline for selected servers.
 *
 * Steps per MCP:
 *   1. Verify package exists in npm registry
 *   2. Check API key status
 *   3. Health check (if package verified and key available)
 *
 * @param {Array} selectedMcps - MCP catalog entries
 * @param {Object} mcpKeys - { [mcpId]: { KEY_NAME: 'value' } }
 * @param {Object} opts
 * @param {Function} opts.onStatus - callback(mcpId, status, detail)
 * @param {boolean} opts.healthCheck - whether to run health checks (default: true)
 * @param {string} opts.targetDir - project directory for resolving ${PROJECT_DIR} in args
 * @returns {Array} Per-MCP results
 */
export async function setupMcps(selectedMcps, mcpKeys = {}, opts = {}) {
  const { onStatus, healthCheck = true, targetDir = process.cwd() } = opts;
  const results = [];

  // Run package verification in parallel for speed
  const verifyPromises = selectedMcps.map(async (mcp) => {
    if (onStatus) onStatus(mcp.id, 'verifying');
    return { mcp, pkgResult: await verifyMcpPackage(mcp) };
  });

  const verified = await Promise.all(verifyPromises);

  // Run health checks sequentially (spawning many processes at once is risky)
  for (const { mcp, pkgResult } of verified) {
    const result = {
      id: mcp.id,
      description: mcp.description,
      package: pkgResult,
      apiKey: null,
      healthCheck: null,
      status: 'unknown',
    };

    // API key status
    if (mcp.requiresKey) {
      const providedKey = mcpKeys[mcp.id] && Object.values(mcpKeys[mcp.id])[0];
      result.apiKey = {
        required: true,
        provided: !!providedKey,
        keyName: mcp.keyName,
      };
    } else {
      result.apiKey = { required: false, provided: true };
    }

    // Health check (only if package OK and key available)
    if (healthCheck && pkgResult.success && result.apiKey.provided) {
      if (onStatus) onStatus(mcp.id, 'testing');
      const env = mcpKeys[mcp.id] || {};
      result.healthCheck = await healthCheckMcp(mcp, env, targetDir);
    } else if (!healthCheck) {
      result.healthCheck = { success: null, skipped: true };
    } else {
      result.healthCheck = { success: false, skipped: true };
    }

    // Determine overall status
    if (!pkgResult.success) {
      result.status = 'package-error';
    } else if (mcp.requiresKey && !result.apiKey.provided) {
      result.status = 'needs-key';
    } else if (result.healthCheck.success === true) {
      result.status = 'ready';
    } else if (result.healthCheck.skipped) {
      result.status = pkgResult.success ? 'verified' : 'package-error';
    } else {
      // Health check failed but package is verified — degrade gracefully.
      // npx spawn during install is unreliable (missing deps, sandbox issues);
      // Claude Code's own MCP runtime handles this correctly.
      result.status = 'verified-with-warning';
    }

    results.push(result);
    if (onStatus) onStatus(mcp.id, result.status);
  }

  return results;
}
