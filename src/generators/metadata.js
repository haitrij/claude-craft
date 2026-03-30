import { join } from 'path';
import { ensureDir } from 'fs-extra/esm';
import { safeWriteFile } from '../utils/file-writer.js';
import { VERSION } from '../constants.js';

/**
 * Generate .claude/.claude-craft.json — single metadata + project index file.
 * Combines installation metadata with the project snapshot (previously PROJECT_INDEX.json).
 */
export async function generate(config, targetDir, opts = {}) {
  const claudeDir = join(targetDir, '.claude');
  await ensureDir(claudeDir);

  const metadata = {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    preset: config._presetAlias || null,
    intents: config.intents || [],
    components: config.components || [],
    agents: (config._selectedAgents || []).map((a) => a.id),
    skills: (config._selectedSkills || []).map((s) => s.id),
    rules: (config._selectedRules || []).map((r) => r.id),
    mcps: (config._selectedMcps || []).map((m) => m.id),
    workflows: (config._selectedWorkflows || []).map((w) => w.id),
    project: {
      name: config.name || null,
      description: config.description || null,
      type: config.projectType || null,
      complexity: config.complexity ?? 0.5,
    },
    stack: {
      languages: config.languages || [],
      frameworks: config.frameworks || [],
      codeStyle: config.codeStyle || [],
      testFramework: config.testFramework || null,
      packageManager: config.packageManager || null,
      cicd: config.cicd || [],
    },
    architecture: config.architecture || null,
    entryPoints: config.entryPoints || [],
    coreModules: config.coreModules || [],
    subprojects: config.subprojects || [],
    buildCommands: config.buildCommands || {},
    metrics: config.metrics || null,
    stacks: (config._resolvedStacks || []).map(s => ({
      id: s.id, name: s.name, impactScore: s.impactScore,
    })),
  };

  const result = await safeWriteFile(
    join(claudeDir, '.claude-craft.json'),
    JSON.stringify(metadata, null, 2) + '\n',
    { force: opts.force }
  );
  return [result];
}
