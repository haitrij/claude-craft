import { Listr } from 'listr2';
import { isTTY } from './theme.js';

/**
 * Create a listr2 task runner with appropriate renderer.
 */
function createTaskRunner(tasks, options = {}) {
  return new Listr(tasks, {
    concurrent: false,
    exitOnError: true,
    rendererOptions: {
      collapseSubtasks: false,
      showTimer: true,
      ...options.rendererOptions,
    },
    renderer: isTTY() ? 'default' : 'simple',
    ...options,
  });
}

/**
 * Run existing setup detection, context extraction, and removal.
 * Returns { existingSetup, existingContext, skip }.
 */
export async function runExistingSetupTasks(targetDir, { detectExistingSetup, extractExistingContext, removeExistingSetup }) {
  const ctx = {};

  const tasks = createTaskRunner([
    {
      title: 'Checking for existing Claude configuration',
      task: async (ctx, task) => {
        const setup = detectExistingSetup(targetDir);
        ctx.existingSetup = setup;

        if (!setup) {
          task.title = 'No existing Claude configuration found';
          ctx.skip = true;
          return;
        }

        const parts = [];
        if (setup.claudeMd) parts.push('CLAUDE.md');
        if (setup.settings) parts.push('settings.json');
        if (setup.agents > 0) parts.push(`${setup.agents} agents`);
        if (setup.rules > 0) parts.push(`${setup.rules} rules`);
        if (setup.skills > 0) parts.push(`${setup.skills} skills`);
        if (setup.commands > 0) parts.push(`${setup.commands} commands`);
        task.title = `Existing setup detected: ${parts.join(', ')}`;
      },
    },
    {
      title: 'Wrapping up current configuration with Claude',
      skip: (ctx) => ctx.skip,
      task: async (ctx, task) => {
        ctx.existingContext = await extractExistingContext(targetDir);
        task.title = 'Context extracted from previous installation';
      },
    },
    {
      title: 'Removing previous configuration',
      skip: (ctx) => ctx.skip,
      task: async (ctx, task) => {
        removeExistingSetup(targetDir);
        task.title = 'Previous .claude/ configuration removed';
      },
    },
  ]);

  await tasks.run(ctx);
  return ctx;
}

/**
 * Run project analysis as a multi-step task list.
 * Returns { claudeAnalysis, fsDetected }.
 */
export async function runAnalysisTasks(targetDir, { analyzeWithClaude, detectProject, existingContext }) {
  const ctx = {};

  const tasks = createTaskRunner([
    {
      title: 'Scanning project structure',
      task: async (ctx) => {
        ctx.fsDetected = await detectProject(targetDir);
      },
    },
    {
      title: 'Analyzing project with Claude',
      task: async (ctx) => {
        const { analysis, failReason } = await analyzeWithClaude(targetDir, existingContext);
        ctx.claudeAnalysis = analysis;
        ctx.claudeFailReason = failReason;
      },
    },
  ]);

  await tasks.run(ctx);
  return ctx;
}

/**
 * Run installation as a multi-step task list.
 * Returns { results, filesToWrite }.
 */
export async function runInstallTasks({
  apiResponse,
  targetDir,
  selectedMcps,
  mcpKeys,
  securityConfig,
  detected,
  buildFileList,
  writeApiFiles,
}) {
  const ctx = {};

  const taskList = [
    {
      title: 'Writing configuration files',
      task: async (ctx) => {
        ctx.filesToWrite = buildFileList(apiResponse);
        ctx.results = await writeApiFiles(ctx.filesToWrite, targetDir, {
          force: true,
          selectedMcpIds: selectedMcps.map((m) => m.id),
          mcpKeys,
          securityConfig,
          detected,
        });
      },
    },
  ];

  const tasks = createTaskRunner(taskList);
  await tasks.run(ctx);
  return ctx;
}

/**
 * Run MCP verification as a task list.
 */
export async function runVerifyTasks(selectedMcps, mcpKeys, { setupMcps, targetDir }) {
  const ctx = {};

  const tasks = createTaskRunner([
    {
      title: `Verifying ${selectedMcps.length} MCP servers`,
      task: async (ctx, task) => {
        ctx.mcpResults = await setupMcps(selectedMcps, mcpKeys, {
          healthCheck: true,
          targetDir,
          onStatus: (id, status) => {
            if (status === 'verifying') {
              task.title = `Verifying ${id}...`;
            } else if (status === 'testing') {
              task.title = `Health-checking ${id}...`;
            }
          },
        });

        const ready = ctx.mcpResults.filter((r) => r.status === 'ready' || r.status === 'verified' || r.status === 'verified-with-warning');
        const needsKey = ctx.mcpResults.filter((r) => r.status === 'needs-key');
        const failed = ctx.mcpResults.filter((r) => r.status === 'package-error');

        if (failed.length === 0 && needsKey.length === 0) {
          task.title = `All ${ctx.mcpResults.length} MCP servers verified`;
        } else if (failed.length === 0) {
          task.title = `${ready.length}/${ctx.mcpResults.length} MCP servers verified (${needsKey.length} need API keys)`;
        } else {
          task.title = `${ready.length}/${ctx.mcpResults.length} MCP servers ready, ${failed.length} need attention`;
        }
      },
    },
  ]);

  await tasks.run(ctx);
  return ctx;
}

/**
 * Run finalization tasks (toolkit rule + optimization + CLAUDE.md rewrite).
 */
export async function runFinalizeTasks({
  targetDir,
  readAnalysisCache,
  optimizeSettings,
  rewriteClaudeMd,
  generateToolkitRule,
}) {
  const ctx = {};

  const taskList = [];

  if (generateToolkitRule) {
    taskList.push({
      title: 'Generating toolkit usage guide',
      task: async (ctx, task) => {
        const toolkit = generateToolkitRule(targetDir);
        const total = toolkit.agentCount + toolkit.skillCount + toolkit.commandCount;
        ctx.toolkitResult = toolkit;
        task.title = total > 0
          ? `Toolkit guide: ${toolkit.agentCount} agents, ${toolkit.skillCount} skills, ${toolkit.commandCount} commands`
          : 'Toolkit guide skipped — no components found';
      },
    });
  }

  taskList.push({
    title: 'Optimizing settings for this project',
    task: async (ctx, task) => {
      const result = optimizeSettings(targetDir);
      ctx.optimizationResult = result;

      if (result.status === 'ok' && result.applied > 0) {
        task.title = `Optimized ${result.applied} setting(s)`;
      } else {
        task.title = 'Settings reviewed — no changes needed';
      }
    },
  });

  taskList.push({
    title: 'Claude is rewriting CLAUDE.md',
    task: async (ctx, task) => {
      const cache = readAnalysisCache(targetDir);
      const rewritten = await rewriteClaudeMd(targetDir, cache);
      ctx.rewritten = rewritten;
      task.title = rewritten
        ? 'CLAUDE.md rewritten with project-specific context'
        : 'CLAUDE.md rewrite skipped — using template version';
    },
  });

  if (taskList.length === 0) return ctx;

  const tasks = createTaskRunner(taskList);
  await tasks.run(ctx);
  return ctx;
}
