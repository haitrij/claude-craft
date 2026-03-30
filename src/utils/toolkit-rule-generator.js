/**
 * Toolkit rule generator — produces .claude/rules/toolkit-usage.md
 * based on actually installed agents, skills, and commands.
 *
 * Claude Code auto-discovers these files but doesn't know when to prefer them
 * over generic approaches. This rule file makes the mapping explicit.
 */
import { join } from 'path';
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import * as logger from './logger.js';

/**
 * MCP capability descriptions for the routing section.
 * Maps MCP id → { capability, userIntents[] }
 */
const MCP_CAPABILITIES = {
  gemini: {
    capability: 'URLs, web pages, YouTube, multimedia, web search, deep research',
    intents: ['URLs, web pages, YouTube', 'Web search, deep research'],
    agent: 'researcher',
  },
  context7: {
    capability: 'Live documentation lookup for libraries and frameworks',
    intents: ['Live documentation lookup'],
  },
  github: {
    capability: 'GitHub PRs, issues, code search, Dependabot alerts',
    intents: ['GitHub PRs, issues, code search'],
  },
  gitlab: {
    capability: 'GitLab MRs, issues, code search, dependency scanning',
    intents: ['GitLab MRs, issues, code search'],
  },
  postgres: { capability: 'PostgreSQL queries and schema inspection', intents: ['Database queries'] },
  mongodb: { capability: 'MongoDB queries and collection inspection', intents: ['Database queries'] },
  mssql: { capability: 'SQL Server queries and schema inspection', intents: ['Database queries'] },
  mysql: { capability: 'MySQL queries and schema inspection', intents: ['Database queries'] },
  sqlite: { capability: 'SQLite queries and schema inspection', intents: ['Database queries'] },
  redis: { capability: 'Redis key inspection and cache analysis', intents: ['Cache operations'] },
  playwright: { capability: 'Browser automation, screenshots, testing', intents: ['Browser testing'] },
  'sequential-thinking': { capability: 'Complex multi-step reasoning', intents: ['Complex reasoning'] },
  figma: { capability: 'Design specs extraction from Figma files', intents: ['Design specs'] },
};

/**
 * Parse YAML frontmatter from a markdown file.
 * Extracts name and description fields only.
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const fields = {};
  const lines = match[1].split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();

    // Handle YAML block scalar (> or >-)
    if (value === '>' || value === '>-') {
      const continuation = [];
      while (i + 1 < lines.length && lines[i + 1].startsWith('  ')) {
        i++;
        continuation.push(lines[i].trim());
      }
      value = continuation.join(' ');
    }

    // Strip surrounding quotes
    value = value.replace(/^['"]|['"]$/g, '');

    if (key === 'name' || key === 'description') {
      fields[key] = value;
    }
  }

  return fields;
}

/**
 * Collect installed components by reading actual files from disk.
 */
function collectComponents(targetDir) {
  const agents = collectFromDir(join(targetDir, '.claude', 'agents'), '*.md');
  const skills = collectSkills(join(targetDir, '.claude', 'skills'));
  const commands = collectCommands(join(targetDir, '.claude', 'commands'));
  return { agents, skills, commands };
}

/**
 * Read all .md files from a flat directory and extract frontmatter.
 */
function collectFromDir(dir) {
  if (!existsSync(dir)) return [];

  const items = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const content = readFileSync(join(dir, entry.name), 'utf8');
    const fm = parseFrontmatter(content);
    if (fm.name) {
      items.push({ name: fm.name, description: fm.description || '' });
    }
  }
  return items;
}

/**
 * Collect skills from .claude/skills/[name]/SKILL.md structure.
 */
function collectSkills(dir) {
  if (!existsSync(dir)) return [];

  const items = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillFile = join(dir, entry.name, 'SKILL.md');
    if (!existsSync(skillFile)) continue;
    const content = readFileSync(skillFile, 'utf8');
    const fm = parseFrontmatter(content);
    if (fm.name) {
      items.push({ name: fm.name, description: fm.description || '' });
    }
  }
  return items;
}

/**
 * Collect commands from .claude/commands/ including variants (subdirectories).
 * Handles two cases:
 *   - commands/plan.md + commands/plan/fast.md → /plan with variants /plan:fast
 *   - commands/fix/ (no fix.md) → variant-only commands /fix:fast, /fix:hard
 */
function collectCommands(dir) {
  if (!existsSync(dir)) return [];

  const items = [];
  const seenDirs = new Set();

  // Pass 1: commands with a parent .md file
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      const content = readFileSync(join(dir, entry.name), 'utf8');
      const fm = parseFrontmatter(content);
      const cmdName = entry.name.replace('.md', '');
      const variants = collectCommandVariants(join(dir, cmdName));
      seenDirs.add(cmdName);
      items.push({
        name: fm.name || cmdName,
        description: fm.description || '',
        variants,
      });
    }
  }

  // Pass 2: variant-only directories (no parent .md file)
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || seenDirs.has(entry.name)) continue;
    const variants = collectCommandVariants(join(dir, entry.name));
    if (variants.length === 0) continue;
    // Use first variant's description as the command group description
    const groupDesc = variants.length === 1
      ? variants[0].description
      : `${variants.length} variants for ${entry.name} operations`;
    items.push({
      name: entry.name,
      description: groupDesc,
      variants,
    });
  }

  return items;
}

/**
 * Collect command variants from a subdirectory (e.g., commands/plan/fast.md).
 */
function collectCommandVariants(dir) {
  if (!existsSync(dir)) return [];

  const variants = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const content = readFileSync(join(dir, entry.name), 'utf8');
    const fm = parseFrontmatter(content);
    const variantName = entry.name.replace('.md', '');
    variants.push({ name: fm.name || variantName, description: fm.description || '' });
  }
  return variants;
}

/**
 * Detect installed MCPs from settings.json.
 */
function collectMcps(targetDir) {
  const settingsPath = join(targetDir, '.claude', 'settings.json');
  if (!existsSync(settingsPath)) return [];

  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    return Object.keys(settings.mcpServers || {});
  } catch {
    return [];
  }
}

/**
 * Build MCP-Enhanced Capabilities section based on installed MCPs.
 */
function buildMcpSection(mcpIds) {
  if (mcpIds.length === 0) return [];

  const lines = [
    '## MCP-Enhanced Capabilities',
    '',
    'NEVER say "I can\'t" when an MCP can handle it. See `rules/mcp-routing.md` for the full routing map.',
    '',
  ];

  for (const id of mcpIds) {
    const cap = MCP_CAPABILITIES[id];
    if (!cap) continue;
    const agentNote = cap.agent ? ` or **${cap.agent}** agent` : '';
    lines.push(`- **${cap.intents[0]}** → use **${id.charAt(0).toUpperCase() + id.slice(1)} MCP**${agentNote}`);
  }

  lines.push('');
  return lines;
}

/**
 * Build the mandatory preferences section based on installed agents.
 */
function buildPreferences(agents) {
  const prefs = [];
  const agentNames = new Set(agents.map((a) => a.name));

  if (agentNames.has('scout')) {
    prefs.push('- Use **scout** agent for file discovery and codebase exploration — NOT generic Explore');
  }
  if (agentNames.has('architect')) {
    prefs.push('- Use **architect** agent for system design and trade-off analysis — NOT generic Plan');
  }
  if (agentNames.has('planner')) {
    prefs.push('- Use **planner** agent for implementation planning — NOT generic Plan');
  }
  if (agentNames.has('code-reviewer')) {
    prefs.push('- Use **code-reviewer** agent for post-implementation quality review');
  }
  if (agentNames.has('debugger')) {
    prefs.push('- Use **debugger** agent for bug investigation — NOT manual debugging');
  }
  if (agentNames.has('researcher')) {
    prefs.push('- Use **researcher** agent for multi-source technical research — has Gemini + context7 for web/docs');
  }
  if (agentNames.has('interviewer')) {
    prefs.push('- **ALWAYS** run the interviewer trigger checklist before implementation — invoke **interviewer** agent proactively, not reactively. See capability-map.md Auto-Invoke section for the full checklist');
  }
  if (agentNames.has('tdd-guide')) {
    prefs.push('- Use **tdd-guide** agent for test-driven development workflows');
  }
  if (agentNames.has('build-resolver')) {
    prefs.push('- Use **build-resolver** agent for build failures and dependency issues');
  }
  if (agentNames.has('refactor-cleaner')) {
    prefs.push('- Use **refactor-cleaner** agent for safe refactoring operations');
  }

  return prefs;
}

/**
 * Generate .claude/rules/toolkit-usage.md from installed components.
 *
 * @param {string} targetDir - Project root
 * @returns {{ agentCount: number, skillCount: number, commandCount: number }}
 */
export function generateToolkitRule(targetDir) {
  const { agents, skills, commands } = collectComponents(targetDir);

  if (agents.length === 0 && skills.length === 0 && commands.length === 0) {
    logger.debug('No agents, skills, or commands found — skipping toolkit rule.');
    return { agentCount: 0, skillCount: 0, commandCount: 0 };
  }

  const sections = ['# Installed Toolkit', ''];
  sections.push('Use the project\'s specialized agents, skills, and commands instead of generic approaches.');
  sections.push('');

  // Agents table
  if (agents.length > 0) {
    sections.push('## Agents');
    sections.push('');
    sections.push('| Agent | Use When |');
    sections.push('|-------|----------|');
    for (const agent of agents) {
      sections.push(`| **${agent.name}** | ${agent.description} |`);
    }
    sections.push('');
  }

  // Skills table
  if (skills.length > 0) {
    sections.push('## Skills (invoke with /skill-name)');
    sections.push('');
    sections.push('| Skill | Use When |');
    sections.push('|-------|----------|');
    for (const skill of skills) {
      sections.push(`| **/${skill.name}** | ${skill.description} |`);
    }
    sections.push('');
  }

  // Commands table
  if (commands.length > 0) {
    sections.push('## Commands (invoke with /command-name)');
    sections.push('');
    sections.push('| Command | Use When |');
    sections.push('|---------|----------|');
    for (const cmd of commands) {
      // Filter variants that duplicate the parent name
      const uniqueVariants = cmd.variants.filter((v) => v.name !== cmd.name);
      const variantNote = uniqueVariants.length > 0
        ? ` Variants: ${uniqueVariants.map((v) => `/${v.name}`).join(', ')}`
        : '';
      sections.push(`| **/${cmd.name}** | ${cmd.description}${variantNote} |`);
    }
    sections.push('');
  }

  // MCP-Enhanced Capabilities
  const mcpIds = collectMcps(targetDir);
  const mcpSection = buildMcpSection(mcpIds);
  if (mcpSection.length > 0) {
    sections.push(...mcpSection);
  }

  // Mandatory preferences
  const prefs = buildPreferences(agents);
  if (prefs.length > 0) {
    sections.push('## Mandatory Preferences');
    sections.push('');
    sections.push(...prefs);
    sections.push('');
  }

  const content = sections.join('\n').trimEnd() + '\n';

  // Write the rule file
  const ruleDir = join(targetDir, '.claude', 'rules');
  mkdirSync(ruleDir, { recursive: true });
  writeFileSync(join(ruleDir, 'toolkit-usage.md'), content, 'utf8');

  return {
    agentCount: agents.length,
    skillCount: skills.length,
    commandCount: commands.length,
  };
}
