/**
 * Update command — re-analyzes the project, compares to the last install snapshot,
 * calls /api/update to get delta components, and installs only what's new.
 *
 * Flow:
 *   1. Load stored analysis from .claude/.claude-craft/
 *   2. Re-run project analysis (detectProject + analyzeWithClaude)
 *   3. Extract installed relative paths from manifest
 *   4. Call /api/update — server returns only new/unlocked components
 *   5. Show change summary + new component counts
 *   6. Confirm, write files, merge manifest
 */
import { resolve, sep } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { detectProject } from '../utils/detect-project.js';
import { analyzeWithClaude } from '../utils/claude-analyzer.js';
import {
  readPermanentAnalysis,
  readInstalledManifest,
  mergePermanentManifest,
} from '../utils/analysis-cache.js';
import { callUpdate, ApiError } from '../utils/api-client.js';
import { runPreflight } from '../utils/preflight.js';
import { writeApiFiles, buildFileList } from '../utils/api-file-writer.js';
import { colors, icons } from '../ui/theme.js';
import { dotPad } from '../ui/format.js';
import { renderFileResults } from '../ui/tables.js';
import { themedConfirm } from '../ui/prompts.js';
import * as logger from '../utils/logger.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract normalized relative paths from the installed manifest.
 * Strips the targetDir prefix so paths are relative (e.g. ".claude/agents/orchestrator.md").
 */
function extractRelativePaths(manifest, targetDir) {
  if (!manifest?.files) return [];

  const prefix = targetDir.endsWith(sep) ? targetDir : targetDir + sep;
  // Also handle forward-slash variant on Windows
  const prefixFwd = prefix.replace(/\\/g, '/');

  return manifest.files
    .map((f) => {
      let p = (f.relativePath || '').replace(/\\/g, '/');
      if (p.startsWith(prefixFwd)) p = p.slice(prefixFwd.length);
      return p;
    })
    .filter(Boolean);
}

/**
 * Render the detected stack changes to the console.
 */
function renderChanges(changes, currentAnalysis) {
  const { addedFrameworks, removedFrameworks, addedLanguages, addedSubprojects,
          testFrameworkChanged, packageManagerChanged, hasChanges } = changes;

  if (!hasChanges) {
    console.log(chalk.dim('  No stack changes detected since last install.'));
    return;
  }

  console.log(chalk.bold('  Stack changes'));
  console.log();

  if (addedFrameworks.length > 0) {
    for (const fw of addedFrameworks) {
      console.log(`  ${icons.plus} ${colors.success(fw)} ${chalk.dim('(new framework)')}`);
    }
  }
  if (removedFrameworks.length > 0) {
    for (const fw of removedFrameworks) {
      console.log(`  ${chalk.dim('─')} ${chalk.dim(fw)} ${chalk.dim('(removed)')}`);
    }
  }
  if (addedLanguages.length > 0) {
    for (const lang of addedLanguages) {
      console.log(`  ${icons.plus} ${colors.success(lang)} ${chalk.dim('(new language)')}`);
    }
  }
  if (addedSubprojects.length > 0) {
    for (const sub of addedSubprojects) {
      console.log(`  ${icons.plus} ${colors.success(sub)} ${chalk.dim('(new subproject)')}`);
    }
  }
  if (testFrameworkChanged && currentAnalysis.testFramework) {
    console.log(
      `  ${icons.plus} ${colors.success(currentAnalysis.testFramework)} ${chalk.dim('(test framework detected)')}`,
    );
  }
  if (packageManagerChanged) {
    console.log(
      `  ${icons.tilde} ${colors.warning('package manager changed')} ${chalk.dim(`→ ${currentAnalysis.packageManager}`)}`,
    );
  }
}

/**
 * Render the delta component counts.
 */
function renderDeltaSummary(delta) {
  const total = Object.values(delta).reduce((s, n) => s + n, 0);
  if (total === 0) {
    console.log(chalk.dim('  No new components to install.'));
    return false;
  }

  console.log(chalk.bold(`  New components: ${colors.success(String(total))}`));
  const entries = Object.entries(delta).filter(([, n]) => n > 0);
  for (const [cat, count] of entries) {
    console.log(chalk.dim(`    ${dotPad(cat, colors.success(String(count)))}`));
  }
  return true;
}

// ── Main command ─────────────────────────────────────────────────────────────

/**
 * @param {object} options - { dir, yes }
 */
export async function runUpdate(options = {}) {
  try {
    const targetDir = resolve(options.dir || process.cwd());

    // ── Pre-flight checks (Claude Code + project marker + API key + server)
    await runPreflight({
      interactive: !options.yes,
      requireClaude: true,
      requireCraftProject: true,
      targetDir,
    });

    // ── Guard: must have a previous install ───────────────────────────
    const previousAnalysis = readPermanentAnalysis(targetDir);
    const installedManifest = readInstalledManifest(targetDir);

    if (!previousAnalysis) {
      logger.error(
        'No stored project analysis found. Re-run: ' + chalk.bold('ccraft install') +
          ' to rebuild the analysis cache.',
      );
      process.exit(1);
    }

    console.log(chalk.bold('  claude-craft update'));
    console.log(chalk.dim('  Re-analyzing project and checking for new components...'));
    console.log();

    // ── Phase 1: Re-analyze project ───────────────────────────────────
    let currentProjectInfo;
    let fsDetected;

    const spinner = ora('Analyzing project...').start();
    try {
      fsDetected = await detectProject(targetDir);

      let claudeAnalysis = null;
      try {
        const result = await analyzeWithClaude(targetDir);
        claudeAnalysis = result.analysis;
      } catch {
        // Claude unavailable — fall back to filesystem detection only
      }

      if (claudeAnalysis) {
        currentProjectInfo = {
          name: claudeAnalysis.name || fsDetected.name || previousAnalysis.name || 'my-project',
          description: claudeAnalysis.description || fsDetected.description || '',
          projectType: claudeAnalysis.projectType || fsDetected.projectType || 'monolith',
          languages: claudeAnalysis.languages?.length ? claudeAnalysis.languages : fsDetected.languages,
          frameworks: claudeAnalysis.frameworks?.length ? claudeAnalysis.frameworks : fsDetected.frameworks,
          codeStyle: claudeAnalysis.codeStyle?.length ? claudeAnalysis.codeStyle : fsDetected.codeStyle,
          cicd: claudeAnalysis.cicd?.length ? claudeAnalysis.cicd : fsDetected.cicd,
          subprojects: claudeAnalysis.subprojects?.length ? claudeAnalysis.subprojects : fsDetected.subprojects,
          architecture: claudeAnalysis.architecture || '',
          buildCommands: claudeAnalysis.buildCommands || {},
          complexity: claudeAnalysis.complexity ?? 0.5,
          metrics: claudeAnalysis.metrics || null,
          entryPoints: claudeAnalysis.entryPoints || [],
          coreModules: claudeAnalysis.coreModules || [],
          testFramework: claudeAnalysis.testFramework || '',
          packageManager: claudeAnalysis.packageManager || fsDetected.packageManager || '',
          languageDistribution: claudeAnalysis.languageDistribution || fsDetected.languageDistribution || null,
        };
      } else {
        currentProjectInfo = {
          name: fsDetected.name || previousAnalysis.name || 'my-project',
          description: fsDetected.description || '',
          projectType: fsDetected.projectType || 'monolith',
          languages: fsDetected.languages?.length ? fsDetected.languages : previousAnalysis.languages,
          frameworks: fsDetected.frameworks,
          codeStyle: fsDetected.codeStyle,
          cicd: fsDetected.cicd,
          subprojects: fsDetected.subprojects,
          architecture: '',
          buildCommands: {},
          complexity: 0.5,
          metrics: null,
          entryPoints: [],
          coreModules: [],
          testFramework: '',
          packageManager: fsDetected.packageManager || '',
          languageDistribution: fsDetected.languageDistribution || null,
        };
      }

      spinner.succeed('Project analyzed.');
    } catch (err) {
      spinner.fail('Analysis failed: ' + err.message);
      process.exit(1);
    }

    // ── Phase 2: Build installed path list ────────────────────────────
    const installedRelativePaths = extractRelativePaths(installedManifest, targetDir);

    // ── Phase 3: Call /api/update ─────────────────────────────────────
    const spinner2 = ora('Checking for new components...').start();
    let updateResponse;
    try {
      updateResponse = await callUpdate(
        currentProjectInfo,
        previousAnalysis,
        installedRelativePaths,
      );
      spinner2.succeed('Server responded.');
    } catch (err) {
      spinner2.fail('Server request failed.');
      if (err instanceof ApiError) {
        logger.error(err.message);
        process.exit(1);
      }
      throw err;
    }

    const { changes, summary } = updateResponse;

    // ── Display results ───────────────────────────────────────────────
    console.log();
    renderChanges(changes, currentProjectInfo);
    console.log();

    const hasNewComponents = renderDeltaSummary(summary?.delta || {});

    if (!changes.hasChanges && !hasNewComponents) {
      console.log();
      logger.success('Already up to date. Nothing to install.');
      console.log();
      process.exit(0);
    }

    if (!hasNewComponents) {
      console.log();
      logger.success('Stack changes noted — no new components needed.');
      console.log();
      process.exit(0);
    }

    // ── Confirm + install ─────────────────────────────────────────────
    console.log();

    let proceed = true;
    if (!options.yes) {
      proceed = await themedConfirm({ message: 'Install new components?', default: true });
    }

    if (!proceed) {
      console.log();
      logger.info('Cancelled.');
      process.exit(0);
    }

    // ── Write new files ───────────────────────────────────────────────
    const filesToWrite = buildFileList(updateResponse, null);

    if (filesToWrite.length === 0) {
      console.log();
      logger.success('No files to write. Already up to date.');
      process.exit(0);
    }

    const writeSpinner = ora('Writing new components...').start();
    let results;
    try {
      results = await writeApiFiles(filesToWrite, targetDir, {
        force: true,
        selectedMcpIds: [],
        detected: { ...fsDetected, ...currentProjectInfo },
      });
      writeSpinner.succeed('Components installed.');
    } catch (err) {
      writeSpinner.fail('Write failed: ' + err.message);
      throw err;
    }

    // ── Display written files ─────────────────────────────────────────
    console.log();
    renderFileResults(results);

    // ── Update manifest ───────────────────────────────────────────────
    try {
      mergePermanentManifest(targetDir, results, filesToWrite);
    } catch (err) {
      logger.debug(`Manifest merge failed: ${err.message}`);
    }

    console.log();
    logger.success('Done! New components installed.');
    console.log();
  } catch (err) {
    if (
      err &&
      (err.name === 'ExitPromptError' ||
        err.constructor?.name === 'ExitPromptError' ||
        err.message?.includes('User force closed'))
    ) {
      console.log();
      logger.info('Cancelled.');
      process.exit(0);
    }

    console.log();
    logger.error(err.message || String(err));
    process.exit(1);
  }
}
