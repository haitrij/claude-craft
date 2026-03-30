import { resolve, join, basename } from 'path';
import { mkdirSync, existsSync, writeFileSync, readdirSync } from 'fs';
import { execFileSync } from 'child_process';
import chalk from 'chalk';
import ora from 'ora';
import { detectProject } from '../utils/detect-project.js';
import { analyzeWithClaude } from '../utils/claude-analyzer.js';
import { rewriteClaudeMd } from '../utils/claude-rewriter.js';
import {
  detectExistingSetup,
  extractExistingContext,
  removeExistingSetup,
} from '../utils/existing-setup.js';
import {
  gatherProjectPath,
  gatherCreateProfile,
  gatherMcpKeys,
  confirmInstallation,
} from '../prompts/gather.js';
import { themedInput } from '../ui/prompts.js';
import { callGenerate, ApiError } from '../utils/api-client.js';
import { writeApiFiles, buildFileList } from '../utils/api-file-writer.js';
import { setupMcps } from '../utils/mcp-setup.js';
import { optimizeSettings } from '../utils/claude-optimizer.js';
import { runPreflight } from '../utils/preflight.js';
import { platformCmd } from '../utils/run-claude.js';
import {
  writeAnalysisCache,
  updateManifest,
  readAnalysisCache,
  promoteCache,
  cleanupAnalysisCache,
} from '../utils/analysis-cache.js';
import { VERSION } from '../constants.js';
import * as logger from '../utils/logger.js';

// UI modules
import { renderBanner } from '../ui/brand.js';
import { renderPhaseHeader } from '../ui/phase-header.js';
import { renderProjectCard, renderSuccessCard } from '../ui/cards.js';
import { renderComponentBreakdown, renderMcpStatus, renderFileResults } from '../ui/tables.js';
import { runExistingSetupTasks, runAnalysisTasks, runInstallTasks, runVerifyTasks, runFinalizeTasks } from '../ui/tasks.js';

// ── Create-mode detection ───────────────────────────────────────────────────

const IGNORED_ENTRIES = new Set(['.git', '.DS_Store', 'Thumbs.db', '.gitkeep']);

/**
 * Returns true if the directory doesn't exist or contains only ignored files.
 */
function isEmptyDir(dirPath) {
  if (!existsSync(dirPath)) return true;
  const entries = readdirSync(dirPath).filter((f) => !IGNORED_ENTRIES.has(f));
  return entries.length === 0;
}

/**
 * Determine whether we're in create mode (new project) or install mode (existing project).
 *
 * Create mode triggers when:
 * - --name or --description flag is provided (explicit intent)
 * - Target directory doesn't exist
 * - Target directory is empty (ignoring .git, .DS_Store, etc.)
 */
function isCreateMode(dirPath, options) {
  if (options.name || options.description) return true;
  return isEmptyDir(dirPath);
}

/**
 * Main install command — unified orchestrator for both new and existing projects.
 *
 * Auto-detects mode:
 * - Create mode (empty/missing dir): gather profile → mkdir → git init → synthetic
 *   analysis → server → write files → bootstrap → re-analyze → finalize
 * - Install mode (existing project): discover → analyze → server → confirm →
 *   write files → MCP verify → finalize
 */
export async function runInstall(options = {}) {
  let targetDir;
  let createMode = false;
  let createName = '';
  let createDescription = '';

  try {
    // ================================================================
    // PHASE 1: Welcome & Setup
    // ================================================================
    renderBanner(VERSION);

    // ── Pre-flight checks (Claude Code + API key + server) ──────
    const { apiConfig } = await runPreflight({
      interactive: !options.yes,
      requireClaude: true,
    });

    // ── Resolve target directory + detect mode ──────────────────────
    if (!options.yes && !options.dir && !options.name && !options.description) {
      // Interactive, no flags — ask for path first, then detect mode
      targetDir = await gatherProjectPath();
    } else {
      targetDir = resolve(options.dir || process.cwd());
    }

    createMode = isCreateMode(targetDir, options);

    if (createMode) {
      // ── Create mode: gather profile + mkdir + git init ────────────
      let name, description, projectType;

      if (options.yes) {
        name = options.name || 'my-project';
        description = options.description || 'A new project';
        projectType = 'monolith';
        logger.info(`New project mode — creating ${chalk.bold(name)} (monolith).`);
      } else if (options.name || options.description) {
        // Partial flags provided — fill in the rest interactively
        const profile = await gatherCreateProfile();
        name = options.name || profile.name;
        description = options.description || profile.description;
        projectType = profile.projectType;
      } else {
        // Empty dir detected — prompt for project details
        logger.info('Empty directory detected — switching to new project mode.');
        const profile = await gatherCreateProfile();
        name = profile.name;
        description = profile.description;
        projectType = profile.projectType;
      }

      // Resolve target directory for new project
      const parentDir = resolve(options.dir || process.cwd());
      let useCurrentDir = false;

      if (!name) {
        // Empty name = use current directory
        targetDir = parentDir;
        useCurrentDir = true;
        const contents = readdirSync(targetDir).filter((f) => !IGNORED_ENTRIES.has(f));
        if (contents.length > 0) {
          logger.error(`Current directory ${chalk.bold(targetDir)} is not empty. Cannot create a project here.`);
          process.exit(1);
        }
        name = basename(targetDir) || 'my-project';
      } else {
        // Named project — re-prompt if directory already exists and is non-empty
        targetDir = join(parentDir, name);
        while (existsSync(targetDir) && !isEmptyDir(targetDir)) {
          logger.warn(`Directory ${chalk.bold(name)} already exists and is not empty.`);
          const newName = await themedInput({
            message: 'Enter a different project name:',
            hint: 'Letters, numbers, dots, hyphens, underscores only.',
            validate: (v) => {
              const t = v.trim();
              if (!t) return 'Name is required.';
              if (!/^[a-zA-Z0-9._-]+$/.test(t)) return 'Only letters, numbers, dots, hyphens, and underscores allowed.';
              return true;
            },
          });
          name = newName.trim();
          targetDir = join(parentDir, name);
        }
      }

      // Create directory + git init
      const spinner1 = ora(useCurrentDir ? 'Initializing project in current directory...' : 'Creating project directory...').start();
      if (!useCurrentDir && !existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true });
      }

      writeFileSync(
        join(targetDir, '.gitignore'),
        'node_modules/\ndist/\nbuild/\n.env\n.env.*\n!.env.example\n*.log\n.DS_Store\nThumbs.db\n',
        'utf8',
      );

      try {
        const { file, args } = platformCmd('git', ['init']);
        execFileSync(file, args, { cwd: targetDir, stdio: 'pipe', windowsHide: true });
        spinner1.succeed(useCurrentDir
          ? `Initialized project in ${chalk.bold(targetDir)} with git.`
          : `Created ${chalk.bold(name)}/ with git initialized.`);
      } catch {
        spinner1.succeed(useCurrentDir
          ? `Initialized project in ${chalk.bold(targetDir)} (git init skipped — git not available).`
          : `Created ${chalk.bold(name)}/ (git init skipped — git not available).`);
      }

      createName = name;
      createDescription = description;
      // projectType is captured in the closure for Phase 2
      options._createProjectType = projectType;
    }

    // ================================================================
    // PHASE 2: Project Discovery
    // ================================================================
    const phaseOpts = createMode ? { totalPhases: 6 } : {};
    renderPhaseHeader(2, phaseOpts);

    let projectInfo;
    let detected;
    let existingContext = null;

    if (createMode) {
      // ── Create mode: synthetic analysis from description ──────────
      const { analyzeDescription } = await import('../utils/description-analyzer.js');

      let descAnalysis = null;
      {
        const spinnerAnalyze = ora('Analyzing your requirements...').start();
        const { analysis, failReason } = await analyzeDescription(createDescription, options._createProjectType);
        if (analysis) {
          descAnalysis = analysis;
          const parts = [];
          if (analysis.frameworks.length) parts.push(analysis.frameworks.join(', '));
          if (analysis.languages.length) parts.push(analysis.languages.join(', '));
          if (analysis.databases.length) parts.push(analysis.databases.join(', '));
          spinnerAnalyze.succeed(
            parts.length
              ? `Detected stack: ${chalk.bold(parts.join(' + '))}`
              : 'Requirements analyzed.',
          );
        } else {
          spinnerAnalyze.info(`Stack inference skipped${failReason ? ` (${failReason})` : ''} — using defaults.`);
        }
      }

      projectInfo = {
        name: createName,
        description: createDescription,
        projectType: options._createProjectType || 'monolith',
        languages: descAnalysis?.languages?.length ? descAnalysis.languages : [],
        frameworks: descAnalysis?.frameworks?.length ? descAnalysis.frameworks : [],
        codeStyle: descAnalysis?.codeStyle?.length ? descAnalysis.codeStyle : [],
        cicd: descAnalysis?.cicd?.length ? descAnalysis.cicd : [],
        subprojects: descAnalysis?.subprojects?.length ? descAnalysis.subprojects : [],
        architecture: descAnalysis?.architecture || '',
        buildCommands: descAnalysis?.buildCommands || {},
        complexity: descAnalysis?.complexity ?? 0.3,
        metrics: descAnalysis?.metrics || null,
        entryPoints: descAnalysis?.entryPoints || [],
        coreModules: descAnalysis?.coreModules || [],
        testFramework: descAnalysis?.testFramework || '',
        packageManager: descAnalysis?.packageManager || '',
        languageDistribution: descAnalysis?.languageDistribution || null,
      };

      detected = {
        ...projectInfo,
        sensitiveFiles: { found: [], gitignoreCovers: true },
        _rootFiles: [],
        databases: descAnalysis?.databases?.length ? descAnalysis.databases : [],
      };
    } else {
      // ── Install mode: real project analysis ───────────────────────
      try {
        const setupCtx = await runExistingSetupTasks(targetDir, {
          detectExistingSetup,
          extractExistingContext,
          removeExistingSetup,
        });
        existingContext = setupCtx.existingContext || null;
      } catch (setupErr) {
        logger.debug(`Existing setup check failed: ${setupErr.message}`);
      }

      try {
        const ctx = await runAnalysisTasks(targetDir, { analyzeWithClaude, detectProject, existingContext });

        const { claudeAnalysis, claudeFailReason, fsDetected } = ctx;

        if (claudeAnalysis) {
          projectInfo = {
            name: claudeAnalysis.name || fsDetected.name || 'my-project',
            description: claudeAnalysis.description || fsDetected.description || '',
            projectType: claudeAnalysis.projectType || fsDetected.projectType || 'monolith',
            languages: claudeAnalysis.languages.length ? claudeAnalysis.languages : (fsDetected.languages.length ? fsDetected.languages : ['JavaScript']),
            frameworks: claudeAnalysis.frameworks.length ? claudeAnalysis.frameworks : fsDetected.frameworks,
            codeStyle: claudeAnalysis.codeStyle.length ? claudeAnalysis.codeStyle : fsDetected.codeStyle,
            cicd: claudeAnalysis.cicd.length ? claudeAnalysis.cicd : fsDetected.cicd,
            subprojects: claudeAnalysis.subprojects.length ? claudeAnalysis.subprojects : fsDetected.subprojects,
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
          projectInfo = {
            name: fsDetected.name || targetDir.split(/[/\\]/).filter(Boolean).pop() || 'my-project',
            description: fsDetected.description || '',
            projectType: fsDetected.projectType || 'monolith',
            languages: fsDetected.languages.length ? fsDetected.languages : ['JavaScript'],
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

        detected = { ...fsDetected, ...projectInfo };
      } catch (analysisErr) {
        // Fallback if task runner fails — run sequentially with spinner
        const spinner = ora('Analyzing project...').start();
        const fsDetected = await detectProject(targetDir);
        spinner.succeed('Project scanned.');
        projectInfo = {
          name: fsDetected.name || targetDir.split(/[/\\]/).filter(Boolean).pop() || 'my-project',
          description: fsDetected.description || '',
          projectType: fsDetected.projectType || 'monolith',
          languages: fsDetected.languages.length ? fsDetected.languages : ['JavaScript'],
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
        detected = { ...fsDetected, ...projectInfo };
      }

      // Display results (install mode only — create mode has no real project to show)
      console.log();
      renderProjectCard(projectInfo);
    }

    // Cache analysis for later phases and future update runs
    try {
      writeAnalysisCache(targetDir, projectInfo, detected, existingContext);
    } catch (cacheErr) {
      logger.debug(`Analysis cache write failed: ${cacheErr.message}`);
    }

    // ================================================================
    // PHASE 3: Configuration
    // ================================================================
    renderPhaseHeader(3, phaseOpts);

    const spinner3 = ora('Calling claude-craft server...').start();

    let apiResponse;
    try {
      apiResponse = await callGenerate(
        {
          name: projectInfo.name,
          projectType: projectInfo.projectType,
          languages: projectInfo.languages,
          languageDistribution: projectInfo.languageDistribution,
          frameworks: projectInfo.frameworks,
          complexity: projectInfo.complexity,
          architecture: projectInfo.architecture,
          buildCommands: projectInfo.buildCommands,
          codeStyle: projectInfo.codeStyle,
          cicd: projectInfo.cicd,
          subprojects: projectInfo.subprojects,
          metrics: projectInfo.metrics,
          entryPoints: projectInfo.entryPoints,
          coreModules: projectInfo.coreModules,
          testFramework: projectInfo.testFramework,
          packageManager: projectInfo.packageManager,
          detectedFiles: detected._rootFiles || [],
          databases: projectInfo.databases || detected.databases || [],
        },
        { projectPath: targetDir },
      );
      spinner3.succeed('Server returned configuration.');
    } catch (err) {
      spinner3.fail('Server request failed.');
      if (err instanceof ApiError) {
        logger.error(err.message);
        process.exit(1);
      }
      throw err;
    }

    const { summary, mcpConfigs } = apiResponse;

    // Display component summary
    console.log();
    renderComponentBreakdown(summary);

    // All MCPs are auto-installed; no interactive selection
    const selectedMcps = mcpConfigs || [];
    let mcpKeys = {};
    const securityConfig = { addSecurityGitignore: true };

    // Confirmation gate (skipped in create mode and non-interactive mode)
    if (!createMode && !options.yes) {
      const finalSummary = { ...summary, mcps: selectedMcps.map((m) => ({ id: m.id, tier: m.tier })) };
      const proceed = await confirmInstallation(finalSummary);
      if (!proceed) {
        console.log();
        logger.info('Cancelled.');
        process.exit(0);
      }
    }

    // ================================================================
    // PHASE 4: Installation
    // ================================================================
    renderPhaseHeader(4, phaseOpts);

    // Prompt for API keys for MCPs that need them
    if (!options.yes) {
      mcpKeys = await gatherMcpKeys(selectedMcps);
    }

    let results;
    let filesToWrite;

    try {
      const installCtx = await runInstallTasks({
        apiResponse,
        targetDir,
        selectedMcps,
        mcpKeys,
        securityConfig,
        detected,
        buildFileList,
        writeApiFiles,
      });

      results = installCtx.results;
      filesToWrite = installCtx.filesToWrite;
    } catch (installErr) {
      // Fallback to sequential if task runner fails
      const spinnerWrite = ora('Writing configuration files...').start();
      filesToWrite = buildFileList(apiResponse);
      results = await writeApiFiles(filesToWrite, targetDir, {
        force: true,
        selectedMcpIds: selectedMcps.map((m) => m.id),
        mcpKeys,
        securityConfig,
        detected,
      });
      spinnerWrite.succeed('Configuration generated.');
    }

    // Update cache with installed file manifest
    try {
      if (filesToWrite) {
        updateManifest(targetDir, results, filesToWrite);
      }
    } catch (cacheErr) {
      logger.debug(`Manifest update failed: ${cacheErr.message}`);
    }

    // Display file results
    renderFileResults(results);

    // MCP verification
    let mcpResults = [];
    if (selectedMcps.length > 0) {
      console.log();
      try {
        const verifyCtx = await runVerifyTasks(selectedMcps, mcpKeys, { setupMcps, targetDir });
        mcpResults = verifyCtx.mcpResults;
      } catch {
        const spinnerMcp = ora('Verifying MCP servers...').start();
        mcpResults = await setupMcps(selectedMcps, mcpKeys, {
          healthCheck: true,
          targetDir,
          onStatus: (id, status) => {
            if (status === 'verifying') spinnerMcp.text = `Verifying ${id}...`;
            else if (status === 'testing') spinnerMcp.text = `Health-checking ${id}...`;
          },
        });
        spinnerMcp.succeed('MCP verification complete.');
      }

      renderMcpStatus(mcpResults);
    }

    // ================================================================
    // CREATE MODE: Bootstrap
    // ================================================================
    let bootstrapSucceeded = true;

    if (createMode) {
      renderPhaseHeader(5, { totalPhases: 6, name: 'Bootstrap' });

      console.log(chalk.dim('  Handing off to Claude to scaffold your project...'));
      console.log(chalk.dim('  This may take several minutes. Activity log:'));
      console.log();

      try {
        const { runBootstrap } = await import('../utils/bootstrap-runner.js');
        await runBootstrap(targetDir, createDescription);
      } catch (err) {
        bootstrapSucceeded = false;
        console.log();
        logger.warn('Bootstrap did not complete: ' + err.message);
        logger.info('Your .claude/ configuration is still intact. You can run /bootstrap:auto manually inside the project.');
        console.log();
      }
    }

    // ================================================================
    // FINALIZATION
    // ================================================================
    renderPhaseHeader(createMode ? 6 : 5, createMode ? { totalPhases: 6, name: 'Finalization' } : {});

    // Create mode: re-analyze after bootstrap
    if (createMode && bootstrapSucceeded) {
      try {
        const spinnerReanalyze = ora('Re-analyzing project...').start();
        const fsDetected = await detectProject(targetDir);

        let reanalyzedInfo;
        try {
          const { analysis } = await analyzeWithClaude(targetDir);
          if (analysis) {
            reanalyzedInfo = {
              name: analysis.name || fsDetected.name || createName,
              description: analysis.description || fsDetected.description || createDescription,
              projectType: analysis.projectType || fsDetected.projectType || options._createProjectType,
              languages: analysis.languages?.length ? analysis.languages : fsDetected.languages,
              frameworks: analysis.frameworks?.length ? analysis.frameworks : fsDetected.frameworks,
              codeStyle: analysis.codeStyle?.length ? analysis.codeStyle : fsDetected.codeStyle,
              cicd: analysis.cicd?.length ? analysis.cicd : fsDetected.cicd,
              subprojects: analysis.subprojects?.length ? analysis.subprojects : fsDetected.subprojects,
              architecture: analysis.architecture || '',
              buildCommands: analysis.buildCommands || {},
              complexity: analysis.complexity ?? 0.5,
              metrics: analysis.metrics || null,
              entryPoints: analysis.entryPoints || [],
              coreModules: analysis.coreModules || [],
              testFramework: analysis.testFramework || '',
              packageManager: analysis.packageManager || fsDetected.packageManager || '',
              languageDistribution: analysis.languageDistribution || fsDetected.languageDistribution || null,
            };
          } else {
            reanalyzedInfo = buildProjectInfoFromFs(fsDetected, createName, createDescription, options._createProjectType);
          }
        } catch {
          reanalyzedInfo = buildProjectInfoFromFs(fsDetected, createName, createDescription, options._createProjectType);
        }

        spinnerReanalyze.succeed('Project re-analyzed.');

        // Overwrite cache with real data
        const reanalyzedDetected = { ...fsDetected, ...reanalyzedInfo };
        writeAnalysisCache(targetDir, reanalyzedInfo, reanalyzedDetected, null);
      } catch (err) {
        logger.debug(`Post-bootstrap analysis failed: ${err.message}`);
      }
    }

    // Shared finalization — optimize settings + rewrite CLAUDE.md
    try {
      const finCtx = await runFinalizeTasks({
        targetDir,
        readAnalysisCache,
        optimizeSettings,
        rewriteClaudeMd,
      });

      const opt = finCtx.optimizationResult;
      if (opt?.status === 'ok' && opt.applied > 0 && opt.replacements?.length > 0) {
        for (const label of opt.replacements) {
          console.log(chalk.dim(`    • ${label}`));
        }
      }
    } catch {
      const spinner7 = ora('Optimizing settings...').start();
      const optResult = optimizeSettings(targetDir);

      if (optResult.status === 'ok' && optResult.applied > 0) {
        spinner7.succeed(`Optimized ${optResult.applied} setting(s).`);
      } else {
        spinner7.succeed('Settings reviewed — no changes needed.');
      }

      const spinner8 = ora('Rewriting CLAUDE.md...').start();
      const cache8 = readAnalysisCache(targetDir);
      const rewritten = await rewriteClaudeMd(targetDir, cache8);
      if (rewritten) {
        spinner8.succeed('CLAUDE.md rewritten.');
      } else {
        spinner8.warn('CLAUDE.md rewrite skipped — using template version.');
      }
    }

    // ── Success ──────────────────────────────────────────────────────
    const totalItems = countTotalItems(summary);
    const mcpsNeedingKeys = mcpResults.filter((r) => r.status === 'needs-key');

    renderSuccessCard({
      totalItems,
      mcpCount: selectedMcps.length,
      mcpsNeedingKeys,
    });

    console.log();
    if (createMode) {
      if (bootstrapSucceeded) {
        logger.success(`Project ${chalk.bold(createName)} created and bootstrapped!`);
        console.log(chalk.dim(`  cd ${createName} && claude`));
      } else {
        logger.success(`Project ${chalk.bold(createName)} created with Claude configuration.`);
        console.log(chalk.dim(`  cd ${createName} && claude -p "/bootstrap:auto ${createDescription}"`));
      }
    } else {
      logger.success('Done! Claude Code is ready.');
    }
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
  } finally {
    if (targetDir) {
      try {
        promoteCache(targetDir);
        cleanupAnalysisCache(targetDir);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Count total installed items from the summary.
 */
function countTotalItems(summary) {
  const countBucket = (bucket) => {
    if (!bucket) return 0;
    return Object.values(bucket).reduce(
      (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0),
      0,
    );
  };

  return countBucket(summary.guaranteed) + countBucket(summary.candidates);
}

/**
 * Build projectInfo from filesystem detection only (fallback for create mode re-analysis).
 */
function buildProjectInfoFromFs(fsDetected, name, description, projectType) {
  return {
    name: fsDetected.name || name,
    description: fsDetected.description || description,
    projectType: fsDetected.projectType || projectType,
    languages: fsDetected.languages?.length ? fsDetected.languages : [],
    frameworks: fsDetected.frameworks || [],
    codeStyle: fsDetected.codeStyle || [],
    cicd: fsDetected.cicd || [],
    subprojects: fsDetected.subprojects || [],
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
