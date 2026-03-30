import { resolve } from 'path';
import { existsSync, statSync } from 'fs';
import chalk from 'chalk';
import {
  INTENTS,
  COMPONENTS,
  PROJECT_TYPES,
  SOURCE_CONTROLS,
  DOCUMENT_TOOLS,
  PERSONAS,
} from '../constants.js';
import { validateApiKeyFormat } from '../utils/mcp-setup.js';
import { themedSelect, themedCheckbox, themedConfirm, themedPassword, themedInput } from '../ui/prompts.js';
import { renderSummaryCard, renderWarningCard } from '../ui/cards.js';
import { colors } from '../ui/theme.js';

// ── Persona selection ───────────────────────────────────────────────────

export async function gatherPersona() {
  console.log();
  const persona = await themedSelect({
    message: 'How do you want to use Claude Code?',
    choices: PERSONAS.map((p) => ({
      name: p.name,
      value: p.value,
      description: p.description,
    })),
  });

  return persona;
}

// ── Project path ────────────────────────────────────────────────────────

export async function gatherProjectPath() {
  const projectPath = await themedInput({
    message: 'Project path:',
    hint: 'Enter the path to the project you want to configure.',
    default: process.cwd(),
    validate: (v) => {
      const p = resolve(v.trim());
      if (!existsSync(p)) return 'Path does not exist.';
      if (!statSync(p).isDirectory()) return 'Path is not a directory.';
      return true;
    },
  });
  return resolve(projectPath.trim());
}

// ── Create profile (new project from scratch) ─────────────────────────

export async function gatherCreateProfile() {
  console.log(colors.muted('\n  Let\'s set up your new project.\n'));

  // Project name
  const name = await themedInput({
    message: 'Project name:',
    hint: 'Leave empty to use the current directory. Letters, numbers, dots, hyphens, underscores only.',
    validate: (v) => {
      const t = v.trim();
      if (!t) return true; // empty = use current directory
      if (!/^[a-zA-Z0-9._-]+$/.test(t)) return 'Only letters, numbers, dots, hyphens, and underscores allowed.';
      return true;
    },
  });

  // Description (free text)
  const description = await themedInput({
    message: 'Describe what you want to build:',
    hint: 'Be specific — this drives tech stack selection and project scaffolding.',
    validate: (v) => (v.trim().length > 0 ? true : 'Please describe your project.'),
  });

  // Project type
  const projectType = await themedSelect({
    message: 'What kind of project is this?',
    hint: 'Affects architecture-level agents and rules.',
    choices: PROJECT_TYPES.map((pt) => ({
      name: pt.name,
      value: pt.value,
    })),
  });

  return { name: name.trim(), description: description.trim(), projectType };
}

// ── Phase 1: User profile ──────────────────────────────────────────────

export async function gatherUserProfile() {
  console.log(colors.muted('\n  Let\'s personalize your Claude Code environment.\n'));

  // Intents

  const intents = await themedCheckbox({
    message: 'What will you use Claude Code for?',
    hint: 'Select everything that applies. This determines which skills and workflows we install.',
    choices: INTENTS.map((i) => ({
      ...i,
      checked: true,
    })),
    validate: (selected) => selected.length > 0 || 'Select at least one intent',
  });

  // Source control

  const sourceControl = await themedSelect({
    message: 'Where do you host your code?',
    hint: 'We\'ll configure source-control integrations accordingly.',
    choices: SOURCE_CONTROLS.map((sc) => ({
      name: sc.name,
      value: sc.value,
      description: sc.description,
    })),
  });

  // Document tools

  const documentTools = await themedCheckbox({
    message: 'Which project management tools do you use?',
    hint: 'We can install MCP servers for these to give Claude context from your docs and tickets.',
    choices: DOCUMENT_TOOLS.map((dt) => ({ ...dt, checked: false })),
    required: true,
  });

  // If "None" was selected, clear all selections
  if (documentTools.includes('none')) {
    documentTools.length = 0;
  }

  // If "Other" was selected, prompt for the tool name
  const otherIndex = documentTools.indexOf('other');
  if (otherIndex !== -1) {
    const otherTool = await themedInput({
      message: 'Enter the name of your tool:',
      validate: (v) => (v.trim() ? true : 'Please enter a tool name.'),
    });
    documentTools[otherIndex] = otherTool.trim();
  }

  return { intents, sourceControl, documentTools };
}

// ── MCP selection + credential setup ──────────────────────────────────

export async function gatherMcpConfig(scoredMcps) {
  console.log(chalk.bold('\n  MCP Servers\n'));

  // Split into guaranteed and optional
  const GUARANTEED_TIERS = new Set(['core', 'role', 'stack', 'auto']);
  const guaranteedMcps = scoredMcps.filter((m) => GUARANTEED_TIERS.has(m.tier));
  const optionalMcps = scoredMcps.filter((m) => !GUARANTEED_TIERS.has(m.tier));

  // Display guaranteed MCPs
  if (guaranteedMcps.length > 0) {
    console.log(chalk.dim('  Auto-installed (core/role/stack):'));
    for (const mcp of guaranteedMcps) {
      const keyTag = mcp.requiresKey ? chalk.yellow(' [key required]') : '';
      const tokenTag = mcp.tokenSaving ? colors.success(' [saves tokens]') : '';
      console.log(colors.success(`    ✔ ${mcp.id}`) + chalk.dim(` — ${mcp.description}${keyTag}${tokenTag}`));
    }
    console.log();
  }

  // Show optional MCPs as checkbox
  let selectedOptionalMcps = [];
  if (optionalMcps.length > 0) {
    const choices = optionalMcps.map((mcp) => {
      const tags = [];
      if (mcp.requiresKey) tags.push(chalk.yellow('[key required]'));
      if (mcp.tokenSaving) tags.push(colors.success('[saves tokens]'));
      if (mcp.score != null) tags.push(chalk.dim(`(${Math.round(mcp.score * 100)}%)`));
      const suffix = tags.length ? ' ' + tags.join(' ') : '';
      return {
        name: `${mcp.id}${suffix}`,
        value: mcp.id,
        description: mcp.description,
        checked: mcp.recommended || false,
      };
    });

  
    const selectedOptionalIds = await themedCheckbox({
      message: 'Select additional MCP servers',
      hint: 'Sorted by relevance to your project. Recommended ones are pre-selected.',
      choices,
    });

    selectedOptionalMcps = optionalMcps.filter((m) => selectedOptionalIds.includes(m.id));
  }

  const selectedMcps = [...guaranteedMcps, ...selectedOptionalMcps];

  // Collect API keys
  const mcpKeys = {};
  const needKeys = selectedMcps.filter((m) => m.requiresKey);

  if (needKeys.length > 0) {
    console.log(chalk.dim('\n  Configure API keys\n'));

    for (const mcp of needKeys) {
      const keyDefs = mcp.keyNames || [{ name: mcp.keyName, description: mcp.keyDescription }];
      const collected = {};

      for (const keyDef of keyDefs) {
        const key = await themedPassword({
          message: `${mcp.id} — ${keyDef.description}:`,
          hint: `Press Enter to skip. You can set ${keyDef.name} as an env variable later.`,
          mask: '*',
        });
        if (key && key.trim()) {
          const { warning } = validateApiKeyFormat(mcp.id, keyDef.name, key.trim());
          if (warning) {
            console.log(chalk.yellow(`    ⚠ ${warning}`));
          }
          collected[keyDef.name] = key.trim();
        } else {
          console.log(chalk.dim(`    Skipped — set ${keyDef.name} env var later`));
        }
      }

      if (Object.keys(collected).length > 0) {
        mcpKeys[mcp.id] = collected;
      }
    }
  }

  return { selectedMcps, mcpKeys };
}

// ── MCP API key collection (standalone) ──────────────────────────────

/**
 * Prompt the user for API keys for MCPs that require them.
 * Returns { [mcpId]: { KEY_NAME: 'value' } }.
 */
export async function gatherMcpKeys(selectedMcps) {
  const mcpKeys = {};
  const needKeys = selectedMcps.filter((m) => m.requiresKey);

  if (needKeys.length === 0) return mcpKeys;

  console.log(chalk.dim('\n  Some MCP servers require API keys.\n'));

  for (const mcp of needKeys) {
    const keyDefs = mcp.keyNames || [{ name: mcp.keyName, description: mcp.keyDescription }];
    const collected = {};

    for (const keyDef of keyDefs) {
      const key = await themedPassword({
        message: `${mcp.id} — ${keyDef.description}:`,
        hint: `Press Enter to skip. You can set ${keyDef.name} as an env variable later.`,
        mask: '*',
      });
      if (key && key.trim()) {
        const { warning } = validateApiKeyFormat(mcp.id, keyDef.name, key.trim());
        if (warning) {
          console.log(chalk.yellow(`    ⚠ ${warning}`));
        }
        collected[keyDef.name] = key.trim();
      } else {
        console.log(chalk.dim(`    Skipped — set ${keyDef.name} env var later`));
      }
    }

    if (Object.keys(collected).length > 0) {
      mcpKeys[mcp.id] = collected;
    }
  }

  return mcpKeys;
}

// ── Security configuration ────────────────────────────────────────────

export function gatherSecurityConfig(detected) {
  if (detected.sensitiveFiles.found.length > 0) {
    const items = [...detected.sensitiveFiles.found];
    if (!detected.sensitiveFiles.gitignoreCovers) {
      items.push('These may not be covered by .gitignore!');
    }
    renderWarningCard('Sensitive files detected:', items);
    console.log();
  }

  // Always add security patterns — no prompt needed
  return { addSecurityGitignore: true };
}

// ── Confirm installation ──────────────────────────────────────────────

export async function confirmInstallation(summary) {
  renderSummaryCard(summary);
  console.log();


  const proceed = await themedConfirm({
    message: 'Ready to install?',
    hint: 'This will create files in .claude/ and update .gitignore and settings.json.',
    default: true,
  });

  return proceed;
}

// ── Defaults (non-interactive mode) ───────────────────────────────────

export function getDefaults(detected) {
  return {
    intents: ['implementing', 'debugging', 'refactoring', 'testing', 'reviewing'],
    sourceControl: 'github',
    documentTools: [],
    name: detected.name || 'my-project',
    description: detected.description || '',
    projectType: detected.projectType || 'monolith',
    languages: detected.languages.length ? detected.languages : ['JavaScript'],
    frameworks: detected.frameworks,
    components: COMPONENTS.map((c) => c.value),
    addSecurityGitignore: true,
    mcpKeys: {},
  };
}
