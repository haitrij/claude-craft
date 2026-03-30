/**
 * Lightweight settings post-processor.
 *
 * Replaces generic multi-tool references in installed .claude/ config files
 * with the actual project commands detected from the analysis cache or filesystem.
 *
 * Pure filesystem operations — no Claude CLI needed. Runs in <1s.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import { readAnalysisCache } from './analysis-cache.js';
import * as logger from './logger.js';

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Replace generic command references with project-specific ones.
 *
 * @param {string} targetDir - Project root (cwd)
 * @returns {{ status: string, applied: number, replacements: string[] }}
 */
export function optimizeSettings(targetDir) {
  const commands = _resolveCommands(targetDir);

  if (!commands) {
    return { status: 'no-commands', applied: 0, replacements: [] };
  }

  const claudeDir = join(targetDir, '.claude');
  if (!existsSync(claudeDir)) {
    return { status: 'ok', applied: 0, replacements: [] };
  }

  const mdFiles = _collectMarkdownFiles(claudeDir);
  if (mdFiles.length === 0) {
    return { status: 'ok', applied: 0, replacements: [] };
  }

  let applied = 0;
  const labels = new Set();

  for (const filePath of mdFiles) {
    let content;
    try {
      content = readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    const { text, changed } = _applyReplacements(content, commands);

    if (text !== content) {
      writeFileSync(filePath, text, 'utf8');
      applied++;
      for (const c of changed) labels.add(c);
      logger.debug(`Optimized ${relative(targetDir, filePath)}`);
    }
  }

  return { status: 'ok', applied, replacements: [...labels] };
}

// ── Command resolution ──────────────────────────────────────────────────

/**
 * Build a commands object from the analysis cache or direct filesystem reads.
 * Returns null if no meaningful commands could be detected.
 */
function _resolveCommands(targetDir) {
  // 1. Try the analysis cache (Claude-extracted, most accurate)
  const cache = readAnalysisCache(targetDir);
  const pi = cache?.projectInfo;

  if (pi?.buildCommands) {
    const bc = pi.buildCommands;
    if (bc.test || bc.build || bc.lint) {
      return {
        test: bc.test || null,
        build: bc.build || null,
        lint: bc.lint || null,
        dev: bc.dev || null,
        audit: _deriveAuditCommand(pi.packageManager, pi.languages),
        packageManager: pi.packageManager || null,
        testFramework: pi.testFramework || null,
        languages: pi.languages || [],
      };
    }
  }

  // 2. Fallback: read config files directly from the project
  return _detectFromFilesystem(targetDir);
}

/**
 * Detect commands by reading package.json, Cargo.toml, go.mod, etc.
 */
function _detectFromFilesystem(targetDir) {
  const result = {
    test: null,
    build: null,
    lint: null,
    dev: null,
    audit: null,
    packageManager: null,
    testFramework: null,
    languages: [],
  };

  // Detect JS/TS package manager
  if (existsSync(join(targetDir, 'pnpm-lock.yaml'))) result.packageManager = 'pnpm';
  else if (existsSync(join(targetDir, 'yarn.lock'))) result.packageManager = 'yarn';
  else if (existsSync(join(targetDir, 'bun.lockb')) || existsSync(join(targetDir, 'bun.lock'))) result.packageManager = 'bun';
  else if (existsSync(join(targetDir, 'package-lock.json'))) result.packageManager = 'npm';

  // ── Node.js ───────────────────────────────────────────────────────
  const pkgPath = join(targetDir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      const scripts = pkg.scripts || {};
      const pm = result.packageManager || 'npm';
      const run = pm === 'npm' ? 'npm run' : pm;

      if (scripts.test && !scripts.test.includes('no test specified')) {
        result.test = pm === 'npm' ? 'npm test' : `${pm} test`;
      }
      if (scripts.build) result.build = `${run} build`;
      if (scripts.lint) result.lint = `${run} lint`;
      if (scripts.dev) result.dev = `${run} dev`;

      // Test framework from devDependencies
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps?.vitest) result.testFramework = 'Vitest';
      else if (deps?.jest) result.testFramework = 'Jest';
      else if (deps?.mocha) result.testFramework = 'Mocha';

      result.languages.push('javascript');
    } catch {
      // Ignore parse errors
    }
  }

  // ── Python ────────────────────────────────────────────────────────
  const hasPython =
    existsSync(join(targetDir, 'pyproject.toml')) ||
    existsSync(join(targetDir, 'setup.py')) ||
    existsSync(join(targetDir, 'requirements.txt'));
  if (hasPython) {
    result.languages.push('python');
    if (
      existsSync(join(targetDir, 'conftest.py')) ||
      existsSync(join(targetDir, 'pytest.ini')) ||
      existsSync(join(targetDir, 'setup.cfg'))
    ) {
      result.test = result.test || 'pytest';
      result.testFramework = result.testFramework || 'pytest';
    }
    result.audit = result.audit || 'pip audit';
  }

  // ── Rust ──────────────────────────────────────────────────────────
  if (existsSync(join(targetDir, 'Cargo.toml'))) {
    result.languages.push('rust');
    result.test = result.test || 'cargo test';
    result.build = result.build || 'cargo build';
    result.lint = result.lint || 'cargo clippy';
    result.audit = result.audit || 'cargo audit';
  }

  // ── Go ────────────────────────────────────────────────────────────
  if (existsSync(join(targetDir, 'go.mod'))) {
    result.languages.push('go');
    result.test = result.test || 'go test ./...';
    result.build = result.build || 'go build ./...';
    result.lint = result.lint || 'golangci-lint run';
    result.audit = result.audit || 'govulncheck ./...';
  }

  // Derive audit for JS if not already set
  if (!result.audit && result.packageManager) {
    result.audit = `${result.packageManager} audit`;
  }

  // Return null if nothing useful detected
  if (!result.test && !result.build && !result.lint) return null;
  return result;
}

/**
 * Derive the audit command from package manager / languages.
 */
function _deriveAuditCommand(packageManager, languages) {
  if (packageManager && ['npm', 'pnpm', 'yarn'].includes(packageManager)) {
    return `${packageManager} audit`;
  }
  if (languages?.includes('python') || languages?.includes('Python')) return 'pip audit';
  if (languages?.includes('rust') || languages?.includes('Rust')) return 'cargo audit';
  if (languages?.includes('go') || languages?.includes('Go')) return 'govulncheck ./...';
  return null;
}

// ── Replacement engine ──────────────────────────────────────────────────

/**
 * Apply all replacement patterns to content.
 * Returns { text, changed: string[] }.
 */
function _applyReplacements(content, commands) {
  let text = content;
  const changed = [];

  // 1. Backtick slash lists:  `cmd1` / `cmd2` / `cmd3` [/ etc.]
  //    → narrow to the single matching command
  text = text.replace(
    /`([^`\n]+)`(?:\s*\/\s*`[^`\n]+`)+(?:\s*\/?\s*etc\.)?/g,
    (match) => {
      const cmds = [...match.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
      const category = _classifyAll(cmds);
      const replacement = category && commands[category];
      if (replacement) {
        changed.push(`${category}-commands`);
        return `\`${replacement}\``;
      }
      return match;
    },
  );

  // 2. Parenthesized test-framework lists: (Jest, Vitest, Mocha, etc.)
  if (commands.testFramework) {
    text = text.replace(
      /\((?:(?:Jest|Vitest|Mocha|pytest|unittest)(?:,\s*)?){2,}(?:,?\s*etc\.?)?\)/gi,
      () => {
        changed.push('test-framework');
        return `(${commands.testFramework})`;
      },
    );
  }

  // 3. Parenthesized linter lists: (ESLint, Biome, etc.)
  if (commands.lint) {
    text = text.replace(
      /\((?:(?:ESLint|Biome|Prettier|ruff|pylint)(?:,\s*)?){2,}(?:,?\s*etc\.?)?\)/gi,
      (match) => {
        // Extract the tool name from the lint command
        const tool = _extractToolName(commands.lint);
        if (tool) {
          changed.push('linter-tool');
          return `(${tool})`;
        }
        return match;
      },
    );
  }

  // 4. Wrong package manager in inline backtick commands
  if (commands.packageManager && commands.packageManager !== 'npm') {
    const pm = commands.packageManager;
    const before = text;
    text = text.replace(/`npm (run \w+|test|install|audit)`/g, (match, sub) => {
      return `\`${pm} ${sub}\``;
    });
    if (text !== before) {
      changed.push(`npm → ${pm}`);
    }
  }

  return { text, changed };
}

// ── Classification ──────────────────────────────────────────────────────

const CATEGORY_PATTERNS = {
  test: /\btest\b|\bjest\b|\bvitest\b|\bpytest\b|\bmocha\b/i,
  lint: /\blint\b|\beslint\b|\bruff\b|\bclippy\b|\bpylint\b|\bbiome\s*(check|lint)\b/i,
  audit: /\baudit\b|\bsafety\b|\bgovulncheck\b|\bsnyk\b/i,
  build: /\bbuild\b|\bcompile\b|\btsc\b/i,
};

/**
 * Return the shared category of all commands, or null if mixed/unknown.
 */
function _classifyAll(cmds) {
  let shared = null;
  for (const cmd of cmds) {
    const cat = _classify(cmd);
    if (!cat) return null;
    if (shared && cat !== shared) return null;
    shared = cat;
  }
  return shared;
}

function _classify(cmd) {
  for (const [cat, re] of Object.entries(CATEGORY_PATTERNS)) {
    if (re.test(cmd)) return cat;
  }
  return null;
}

/**
 * Extract a human-readable tool name from a command string.
 * e.g. "npm run lint" → "ESLint" (heuristic), "ruff check" → "ruff"
 */
function _extractToolName(lintCmd) {
  const lower = lintCmd.toLowerCase();
  if (lower.includes('eslint') || lower.includes('npm run lint') || lower.includes('npx eslint')) return 'ESLint';
  if (lower.includes('biome')) return 'Biome';
  if (lower.includes('ruff')) return 'ruff';
  if (lower.includes('pylint')) return 'pylint';
  if (lower.includes('clippy')) return 'clippy';
  if (lower.includes('golangci')) return 'golangci-lint';
  return null;
}

// ── File collection ─────────────────────────────────────────────────────

/**
 * Recursively find all .md files under a directory.
 * Skips the temp dir and node_modules.
 */
function _collectMarkdownFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.claude-craft-temp' || entry.name === 'node_modules') continue;
      results.push(..._collectMarkdownFiles(fullPath));
    } else if (entry.name.endsWith('.md')) {
      results.push(fullPath);
    }
  }

  return results;
}
