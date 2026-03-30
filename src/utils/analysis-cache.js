/**
 * Analysis cache — bridges data between install steps 2/5 and steps 7/8.
 *
 * Persists project analysis and installed file manifest to a temp directory
 * so that steps 7 (optimization) and 8 (CLAUDE.md rewrite) can access
 * pre-computed context without re-analyzing or re-reading the project.
 *
 * Temp directory:      .claude/.claude-craft-temp/ — cleaned up after install.
 * Permanent directory: .claude/.claude-craft/      — kept as project overview data.
 */
import { join, basename } from 'path';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, copyFileSync } from 'fs';
import * as logger from './logger.js';

const CACHE_DIR = '.claude/.claude-craft-temp';
const PERMANENT_DIR = '.claude/.claude-craft';

/** Files promoted from temp → permanent after install. */
const PERMANENT_FILES = ['project-analysis.json', 'project-context.md', 'installed-manifest.json'];

/**
 * Resolve the temp cache directory path for a given target directory.
 */
function cachePath(targetDir) {
  return join(targetDir, CACHE_DIR);
}

/**
 * Resolve the permanent data directory path for a given target directory.
 */
function permanentPath(targetDir) {
  return join(targetDir, PERMANENT_DIR);
}

/**
 * Write analysis data to temp cache directory.
 * Called after step 2 completes.
 *
 * @param {string}      targetDir       - Project root
 * @param {object}      projectInfo     - Merged analysis from Claude + filesystem detection
 * @param {object}      detected        - Raw filesystem detection result
 * @param {object|null} existingContext  - Context from previous Claude setup (optional)
 */
export function writeAnalysisCache(targetDir, projectInfo, detected, existingContext = null) {
  const dir = cachePath(targetDir);
  mkdirSync(dir, { recursive: true });

  // Full analysis JSON
  writeFileSync(
    join(dir, 'project-analysis.json'),
    JSON.stringify(projectInfo, null, 2),
    'utf8',
  );

  // Rich human-readable context for embedding in prompts
  let contextMd = formatRichProjectContext(projectInfo, detected);

  // Append prior setup context if available
  if (existingContext?.summary) {
    const priorLines = ['\n### Prior Installation Context'];
    if (existingContext.summary.projectContext) {
      priorLines.push(existingContext.summary.projectContext);
    }
    if (existingContext.summary.preserveNotes) {
      priorLines.push(`Note: ${existingContext.summary.preserveNotes}`);
    }
    if (existingContext.summary.customizations?.length) {
      priorLines.push(`Customizations: ${existingContext.summary.customizations.join('; ')}`);
    }
    contextMd += '\n' + priorLines.join('\n');
  }

  writeFileSync(join(dir, 'project-context.md'), contextMd, 'utf8');

  // Store previous CLAUDE.md content for the rewriter to reference
  if (existingContext?.claudeMdContent) {
    writeFileSync(
      join(dir, 'previous-claude-md.md'),
      existingContext.claudeMdContent,
      'utf8',
    );
  }

  logger.debug('Analysis cache written to ' + CACHE_DIR);
}

/**
 * Update the installed manifest after step 5.
 * Stores file paths, statuses, categories, and first-line summaries
 * so steps 7/8 know exactly what was written without re-reading.
 *
 * @param {string} targetDir - Project root
 * @param {Array<{path: string, status: string}>} results - Step 5 write results
 * @param {Array<{relativePath: string, content: string, type: string}>} files - Files from buildFileList
 */
export function updateManifest(targetDir, results, files) {
  const dir = cachePath(targetDir);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Build a content lookup from the files array
  const contentMap = new Map();
  for (const f of files) {
    if (f.relativePath && f.content) {
      contentMap.set(f.relativePath, f.content);
    }
  }

  const counts = {
    agents: 0,
    skills: 0,
    rules: 0,
    commands: 0,
    workflows: 0,
    hooks: 0,
    mcps: 0,
    other: 0,
  };

  const manifestFiles = results.map((r) => {
    const rel = r.path;
    const category = categorizeByPath(rel);
    counts[category] = (counts[category] || 0) + 1;

    const content = contentMap.get(rel) || '';
    const firstLine = extractFirstLine(content);

    return {
      relativePath: rel,
      status: r.status || 'created',
      category,
      firstLine,
    };
  });

  const manifest = {
    writtenAt: new Date().toISOString(),
    files: manifestFiles,
    counts,
  };

  writeFileSync(
    join(dir, 'installed-manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8',
  );

  logger.debug('Installed manifest updated with ' + manifestFiles.length + ' files.');
}

/**
 * Read all cached analysis data.
 * Returns null if cache is missing or corrupted (triggers legacy fallback).
 *
 * @param {string} targetDir - Project root
 * @returns {{ projectInfo: object, projectContext: string, manifest: object|null } | null}
 */
export function readAnalysisCache(targetDir) {
  const dir = cachePath(targetDir);

  try {
    const analysisPath = join(dir, 'project-analysis.json');
    const contextPath = join(dir, 'project-context.md');

    if (!existsSync(analysisPath) || !existsSync(contextPath)) {
      return null;
    }

    const projectInfo = JSON.parse(readFileSync(analysisPath, 'utf8'));
    const projectContext = readFileSync(contextPath, 'utf8');

    // Manifest may not exist yet (only written after step 5)
    let manifest = null;
    const manifestPath = join(dir, 'installed-manifest.json');
    if (existsSync(manifestPath)) {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    }

    return { projectInfo, projectContext, manifest };
  } catch (err) {
    logger.debug(`Failed to read analysis cache: ${err.message}`);
    return null;
  }
}

/**
 * Format project info into a rich human-readable context string.
 * Used for embedding directly into Claude prompts to avoid tool calls.
 *
 * @param {object} projectInfo - Full project analysis object
 * @param {object} detected    - Filesystem detection result
 * @returns {string} Formatted markdown context block
 */
export function formatRichProjectContext(projectInfo, detected) {
  const lines = [];

  // Header
  lines.push(`## Project: ${projectInfo.name || '(unnamed)'}`);
  if (projectInfo.description) {
    lines.push(projectInfo.description);
  }
  lines.push('');

  // Tech stack
  lines.push('### Tech Stack');
  if (projectInfo.languageDistribution) {
    const distStr = Object.entries(projectInfo.languageDistribution)
      .sort(([, a], [, b]) => b - a)
      .map(([lang, pct]) => `${lang} (${pct}%)`)
      .join(', ');
    lines.push(`- Languages: ${distStr}`);
  } else if (projectInfo.languages?.length) {
    lines.push(`- Languages: ${projectInfo.languages.join(', ')}`);
  }
  if (projectInfo.frameworks?.length) {
    lines.push(`- Frameworks: ${projectInfo.frameworks.join(', ')}`);
  }
  lines.push(`- Type: ${projectInfo.projectType || 'monolith'}`);
  if (projectInfo.architecture) {
    lines.push(`- Architecture: ${projectInfo.architecture}`);
  }
  const cplx = projectInfo.complexity ?? 0.5;
  const cplxLabel = cplx >= 0.7 ? 'complex' : cplx >= 0.4 ? 'moderate' : 'simple';
  lines.push(`- Complexity: ${cplx.toFixed(2)} (${cplxLabel})`);
  if (projectInfo.packageManager) {
    lines.push(`- Package manager: ${projectInfo.packageManager}`);
  }
  if (projectInfo.testFramework) {
    lines.push(`- Test framework: ${projectInfo.testFramework}`);
  }
  if (projectInfo.codeStyle?.length) {
    lines.push(`- Code style: ${projectInfo.codeStyle.join(', ')}`);
  }
  if (projectInfo.cicd?.length) {
    lines.push(`- CI/CD: ${projectInfo.cicd.join(', ')}`);
  }
  lines.push('');

  // Build commands
  if (projectInfo.buildCommands) {
    const cmds = Object.entries(projectInfo.buildCommands).filter(([, v]) => v);
    if (cmds.length > 0) {
      lines.push('### Build Commands');
      for (const [key, val] of cmds) {
        lines.push(`- ${key}: \`${val}\``);
      }
      lines.push('');
    }
  }

  // Metrics
  if (projectInfo.metrics) {
    const m = projectInfo.metrics;
    const parts = [];
    if (m.totalFiles) parts.push(`${m.totalFiles} files`);
    if (m.totalDirs) parts.push(`${m.totalDirs} directories`);
    if (m.maxDepth) parts.push(`max depth ${m.maxDepth}`);
    if (m.dependencyCount) parts.push(`${m.dependencyCount} dependencies`);
    if (m.testFileCount) parts.push(`${m.testFileCount} test files`);
    if (m.sourceFileCount) parts.push(`${m.sourceFileCount} source files`);
    if (m.estimatedTestCoverage && m.estimatedTestCoverage !== 'unknown') {
      parts.push(`~${m.estimatedTestCoverage} coverage`);
    }
    if (parts.length > 0) {
      lines.push('### Metrics');
      lines.push(`- ${parts.join(', ')}`);
      lines.push('');
    }
  }

  // Entry points
  if (projectInfo.entryPoints?.length) {
    lines.push('### Entry Points');
    for (const ep of projectInfo.entryPoints) {
      const cmd = ep.command ? ` (\`${ep.command}\`)` : '';
      lines.push(`- ${ep.type}: ${ep.path}${cmd}`);
    }
    lines.push('');
  }

  // Core modules
  if (projectInfo.coreModules?.length) {
    lines.push('### Core Modules');
    for (const mod of projectInfo.coreModules) {
      lines.push(`- ${mod.path} — ${mod.purpose}`);
    }
    lines.push('');
  }

  // Subprojects
  if (projectInfo.subprojects?.length) {
    lines.push('### Subprojects');
    for (const sub of projectInfo.subprojects) {
      const fws = sub.frameworks?.length ? ` (${sub.frameworks.join(', ')})` : '';
      lines.push(`- ${sub.path}: ${sub.languages?.join(', ') || 'unknown'}${fws}`);
    }
    lines.push('');
  }

  // Sensitive files (from detected)
  if (detected?.sensitiveFiles?.length) {
    lines.push('### Sensitive Files Detected');
    const capped = detected.sensitiveFiles.slice(0, 10);
    for (const sf of capped) {
      const covered = sf.gitignored ? ' (gitignored)' : ' (NOT gitignored)';
      lines.push(`- ${sf.file}${covered}`);
    }
    if (detected.sensitiveFiles.length > 10) {
      lines.push(`- ... and ${detected.sensitiveFiles.length - 10} more`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

// writeUserProfile and readUserProfile removed — user profile no longer used.

/**
 * Read the permanent project analysis JSON.
 * Returns null if not found.
 *
 * @param {string} targetDir - Project root
 * @returns {object|null}
 */
export function readPermanentAnalysis(targetDir) {
  const filePath = join(permanentPath(targetDir), 'project-analysis.json');
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    logger.debug(`Failed to read permanent analysis: ${err.message}`);
    return null;
  }
}

/**
 * Read the permanent installed manifest.
 * Returns null if not found.
 *
 * @param {string} targetDir - Project root
 * @returns {object|null}
 */
export function readInstalledManifest(targetDir) {
  const filePath = join(permanentPath(targetDir), 'installed-manifest.json');
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    logger.debug(`Failed to read installed manifest: ${err.message}`);
    return null;
  }
}

/**
 * Merge new install results into the permanent manifest without removing existing entries.
 * Used by the update command to record newly installed files.
 *
 * @param {string} targetDir - Project root
 * @param {Array<{path: string, status: string}>} newResults - Newly written file results
 * @param {Array<{relativePath: string, content: string}>} newFiles - Newly written file objects
 */
export function mergePermanentManifest(targetDir, newResults, newFiles) {
  const dest = permanentPath(targetDir);
  const manifestPath = join(dest, 'installed-manifest.json');

  // Build content lookup for first-line extraction
  const contentMap = new Map();
  for (const f of newFiles) {
    if (f.relativePath && f.content) contentMap.set(f.relativePath, f.content);
  }

  // Read existing manifest or start fresh
  let existing = { writtenAt: new Date().toISOString(), files: [], counts: {} };
  try {
    if (existsSync(manifestPath)) {
      existing = JSON.parse(readFileSync(manifestPath, 'utf8'));
    }
  } catch {
    // start fresh if corrupted
  }

  // Build set of already-recorded paths to avoid duplicates
  const recordedPaths = new Set((existing.files || []).map((f) => f.relativePath));

  const counts = { ...existing.counts };

  for (const r of newResults) {
    if (recordedPaths.has(r.path)) continue;

    const category = categorizeByPath(r.path);
    counts[category] = (counts[category] || 0) + 1;

    const content = contentMap.get(r.path) || '';
    existing.files.push({
      relativePath: r.path,
      status: r.status || 'created',
      category,
      firstLine: extractFirstLine(content),
    });
    recordedPaths.add(r.path);
  }

  existing.counts = counts;
  existing.updatedAt = new Date().toISOString();

  try {
    mkdirSync(dest, { recursive: true });
    writeFileSync(manifestPath, JSON.stringify(existing, null, 2), 'utf8');
    logger.debug(`Permanent manifest updated with ${newResults.length} new file(s).`);
  } catch (err) {
    logger.debug(`Failed to update permanent manifest: ${err.message}`);
  }
}

/**
 * Promote keeper files from temp cache → permanent .claude/.claude-craft/ directory.
 * Call this before cleanupAnalysisCache() so the data survives the temp wipe.
 *
 * Promoted: project-analysis.json, project-context.md, installed-manifest.json
 * Discarded: previous-claude-md.md (upgrade-specific, not needed after install)
 *
 * @param {string} targetDir - Project root
 */
export function promoteCache(targetDir) {
  const src = cachePath(targetDir);
  const dest = permanentPath(targetDir);

  try {
    mkdirSync(dest, { recursive: true });

    for (const file of PERMANENT_FILES) {
      const srcFile = join(src, file);
      if (existsSync(srcFile)) {
        copyFileSync(srcFile, join(dest, file));
      }
    }

    logger.debug(`Project overview data saved to ${PERMANENT_DIR}`);
  } catch (err) {
    logger.debug(`Failed to promote cache to permanent directory: ${err.message}`);
  }
}

/**
 * Remove the temp cache directory.
 * Safe to call even if directory doesn't exist.
 *
 * @param {string} targetDir - Project root
 */
export function cleanupAnalysisCache(targetDir) {
  const dir = cachePath(targetDir);
  try {
    rmSync(dir, { recursive: true, force: true });
    logger.debug('Analysis cache cleaned up.');
  } catch {
    // Ignore cleanup errors
  }
}

// ── Internal helpers ─────────────────────────────────────────────

/**
 * Categorize a file by its path prefix.
 */
function categorizeByPath(relativePath) {
  if (relativePath.includes('/agents/') || relativePath.includes('\\agents\\')) return 'agents';
  if (relativePath.includes('/skills/') || relativePath.includes('\\skills\\')) return 'skills';
  if (relativePath.includes('/rules/') || relativePath.includes('\\rules\\')) return 'rules';
  if (relativePath.includes('/commands/') || relativePath.includes('\\commands\\')) return 'commands';
  if (relativePath.includes('/workflows/') || relativePath.includes('\\workflows\\')) return 'workflows';
  if (relativePath.includes('/hooks/') || relativePath.includes('\\hooks\\') || relativePath.endsWith('hooks.json')) return 'hooks';
  if (relativePath.includes('settings.json') && relativePath.includes('mcpServers')) return 'mcps';
  return 'other';
}

/**
 * Extract the first meaningful line from file content.
 * Prefers the first # heading, falls back to first non-empty line.
 */
function extractFirstLine(content) {
  if (!content) return '';
  const lines = content.split('\n');
  const heading = lines.find((l) => l.startsWith('# '));
  if (heading) return heading.replace(/^#+\s*/, '').trim();
  const nonEmpty = lines.find((l) => l.trim() && !l.startsWith('<!--'));
  return nonEmpty?.trim().slice(0, 100) || '';
}
