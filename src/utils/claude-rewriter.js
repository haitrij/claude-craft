/**
 * Claude-powered CLAUDE.md rewriter — context-injected approach.
 *
 * Phase 1 (filter): Quick check which sections need project-specific enhancement.
 * Phase 2 (rewrite): All context embedded inline — zero tool calls needed.
 * Phase 3 (verify): Validate that references in generated content match reality.
 *
 * Falls back to legacy tool-based approach if analysis cache is unavailable.
 */
import { join } from 'path';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { isClaudeAvailable, runClaude } from './run-claude.js';
import { extractJsonObject } from './json-extract.js';
import * as logger from './logger.js';

/** Override rule — appended after every rewrite to ensure it survives. */
const OVERRIDE_RULE = '> **Override rule:** In every mode (plan, edit, default), check `.claude/` definitions FIRST. Only use Claude\'s built-in agents, skills, or commands if no project-specific match exists. See `.claude/rules/capability-map.md` for detailed routing.';

/**
 * Append the override rule to rewritten content if not already present.
 */
function _ensureOverrideRule(content) {
  if (!content) return content;
  if (content.includes('**Override rule:**')) return content;
  return content.trimEnd() + '\n\n' + OVERRIDE_RULE;
}

/**
 * Use Claude to rewrite CLAUDE.md based on installed configuration.
 *
 * @param {string}      targetDir - Project root
 * @param {object|null} cache     - From readAnalysisCache(); null triggers legacy
 * @returns {Promise<boolean>} true on success
 */
export async function rewriteClaudeMd(targetDir, cache = null) {
  if (!isClaudeAvailable()) {
    return false;
  }

  // If no cache or no manifest, fall back to legacy tool-based approach
  if (!cache || !cache.projectContext || !cache.manifest) {
    return _legacyRewrite(targetDir);
  }

  try {
    // Read current template CLAUDE.md (written by step 5)
    const claudeMdPath = join(targetDir, 'CLAUDE.md');
    if (!existsSync(claudeMdPath)) {
      logger.debug('No CLAUDE.md found to rewrite.');
      return false;
    }
    const templateContent = readFileSync(claudeMdPath, 'utf8');

    // Read settings.json for MCP server info
    const settingsJson = _readSettingsJson(targetDir);

    // ── Phase 1: Filter — determine which sections need enhancement ──
    const sectionsResult = await _filterSections(cache, templateContent, settingsJson, targetDir);

    if (sectionsResult?.skipRewrite) {
      logger.debug('Filter phase determined CLAUDE.md template is sufficient — skipping rewrite.');
      return false;
    }

    // If filter failed or returned sections, proceed with rewrite
    const sections = sectionsResult?.sectionsToEnhance || null;

    // ── Phase 2: Rewrite — context-injected, no tool calls ──────────
    const rewritten = await _contextRewrite(cache, templateContent, settingsJson, sections, targetDir);

    if (!rewritten) {
      // Context-injected approach failed — fall back to legacy tool-based rewrite
      logger.debug('Context-injected rewrite failed — falling back to legacy tool-based approach.');
      return _legacyRewrite(targetDir);
    }

    // Write the new CLAUDE.md (ensure override rule survives rewrite)
    writeFileSync(claudeMdPath, _ensureOverrideRule(rewritten) + '\n', 'utf8');

    // ── Phase 3: Verify — check references ──────────────────────────
    const verified = _verifyClaudeMd(rewritten, targetDir);
    if (verified.warnings.length > 0) {
      for (const w of verified.warnings) {
        logger.debug(`CLAUDE.md verify: ${w}`);
      }
    }

    return true;
  } catch (err) {
    // If the two-phase approach fails entirely, try legacy as last resort
    logger.debug(`Two-phase rewrite failed (${err.killed ? 'timeout' : err.message}) — trying legacy.`);
    try {
      return await _legacyRewrite(targetDir);
    } catch {
      logger.debug('CLAUDE.md rewrite failed — keeping original.');
      return false;
    }
  }
}

// ── Phase 1: Filter ──────────────────────────────────────────────────

/**
 * Quick Claude call to check which CLAUDE.md sections need enhancement.
 * Returns { sectionsToEnhance, skipRewrite } or null on failure.
 */
async function _filterSections(cache, templateContent, settingsJson, targetDir) {
  const counts = cache.manifest.counts || {};

  const filterPrompt = `Review this template CLAUDE.md against the actual project.
Determine which sections need project-specific enhancement.

## Project Context
${cache.projectContext}

## Installed Counts
- Agents: ${counts.agents || 0}, Skills: ${counts.skills || 0}, Rules: ${counts.rules || 0}, Workflows: ${counts.workflows || 0}

## Current CLAUDE.md (template version)
${templateContent}

## Task
Which sections need project-specific enhancement? A section needs enhancement if:
1. It uses generic/placeholder text that should reference actual project details
2. Build commands or project name/description are placeholders

Sections that are already accurate should be SKIPPED.

## Response Format
Return a JSON object (and NOTHING else):
{
  "sectionsToEnhance": ["Project Overview", "Build & Run Commands"],
  "skipRewrite": false
}

If the template is already accurate for this project, return: { "sectionsToEnhance": [], "skipRewrite": true }`;

  try {
    const output = await runClaude([
      '-p',
      '--max-turns', '2',
      '--allowedTools', '',
    ], { cwd: targetDir, stdinInput: filterPrompt, timeout: 60_000 });

    return _parseJsonResponse(output, 'sectionsToEnhance');
  } catch (err) {
    if (err.killed) {
      logger.debug('CLAUDE.md filter phase timed out — proceeding with full rewrite.');
    } else {
      logger.debug(`CLAUDE.md filter phase failed: ${err.message} — proceeding with full rewrite.`);
    }
    return null; // null = proceed with full rewrite as fallback
  }
}

// ── Phase 2: Context-Injected Rewrite ────────────────────────────────

/**
 * Rewrite CLAUDE.md with all context embedded inline.
 * No --allowedTools needed — zero tool calls.
 * Returns markdown string or null on failure.
 */
async function _contextRewrite(cache, templateContent, settingsJson, sections, targetDir) {
  const projectName = cache.projectInfo?.name || 'this project';
  const installedSummary = _buildInstalledSummary(cache.manifest, settingsJson);

  const sectionsNote = sections && sections.length > 0
    ? `\nFocus your enhancements on these sections: ${sections.join(', ')}\nKeep other sections close to the template version.`
    : '';

  const rewritePrompt = `You are rewriting the CLAUDE.md file for "${projectName}".
All the information you need is provided below. Do NOT request any tools or file access.

## Project Context
${cache.projectContext}

## Installed Configuration
${installedSummary}
${sectionsNote}

## Current Template CLAUDE.md
${templateContent}

## CRITICAL: Do NOT list auto-discovered components

Claude Code auto-discovers agents, skills, rules, MCP servers, and hooks from \`.claude/\`.
**USER_GUIDE.md** has the full reference for all installed components.
CLAUDE.md should contain ONLY what Claude cannot infer from code or auto-loaded files.

## CLAUDE.md structure (MUST be under 80 lines)

Write a CLAUDE.md with these exact sections:

### 1. Project Overview (3-8 lines)
- Project name, what it does, tech stack
- Architecture pattern if detected
- Use the project description from the context above

### 2. Build & Run Commands (only if known)
A markdown table of: install, dev, build, test, lint commands.
Only include commands that are known from the project context above.

### 3. Tech Stack (only if stack-specific conventions exist)
- Stack-specific conventions (purpose, not a file tree)
- Key directory conventions — max 3 lines, describe purpose not inventory
- One line pointing to the relevant rules file: "See \`.claude/rules/<stack>.md\`"
- OMIT this section entirely if no stack rules exist
- Do NOT include a directory tree or file-by-file listing

### 4. Usage Reporting (always include, do not modify)
- Always report the total API request usage (requests made, tokens consumed) when a task is finished.
- Include this section exactly as-is — do not rephrase or omit.

## Rules for writing

- MUST be under 80 lines total
- Be concise — one line per item, no lengthy explanations
- Do NOT include generic advice, filler, or self-evident statements
- Do NOT include content that Claude can infer from code or auto-loaded files
- Do NOT list agents, skills, rules, MCP servers, or security patterns — they are all auto-discovered
- Do NOT include an "Installed Configuration" section — auto-loaded components are documented elsewhere
- Do NOT wrap the output in \`\`\`markdown fences
- Do NOT add any explanation or commentary before or after the markdown
- Start your response directly with the # header
- End your response immediately after the last section — NOTHING after it
- ABSOLUTELY NO trailing text, changelog, or summary-of-differences section`;

  try {
    const output = await runClaude([
      '-p',
      '--max-turns', '3',
      '--allowedTools', '',
    ], { cwd: targetDir, stdinInput: rewritePrompt, timeout: 120_000 });

    // Extract markdown from response
    const responseText = extractMarkdown(output);

    // Validate
    if (!responseText || !responseText.includes('#')) {
      logger.debug(`Context rewrite produced invalid markdown (first 300 chars): ${(output || '').slice(0, 300)}`);
      return null;
    }

    const lineCount = responseText.split('\n').length;
    if (lineCount > 80) {
      logger.debug(`Context rewrite produced ${lineCount} lines — too long.`);
      return null;
    }

    return responseText;
  } catch (err) {
    if (err.killed) {
      logger.debug('Context rewrite phase timed out.');
    } else {
      logger.debug(`Context rewrite phase failed: ${err.message}`);
    }
    return null; // Return null so caller can fall back to legacy
  }
}

// ── Phase 3: Verify ──────────────────────────────────────────────────

/**
 * Validate references in generated CLAUDE.md against actual installed files.
 */
function _verifyClaudeMd(content, targetDir) {
  const warnings = [];

  // Check 1: Referenced file paths exist
  const fileRefs = content.match(/`\.claude\/[^`]+`/g) || [];
  for (const ref of fileRefs) {
    const refPath = ref.replace(/`/g, '').trim();
    if (refPath.endsWith('/') || refPath.endsWith('\\')) continue; // directory ref
    if (!existsSync(join(targetDir, refPath))) {
      warnings.push(`References ${refPath} which does not exist`);
    }
  }

  // Check 2: Line count is under limit
  const lineCount = content.split('\n').length;
  if (lineCount > 80) {
    warnings.push(`CLAUDE.md has ${lineCount} lines (target: under 80)`);
  }

  return { warnings };
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Build the installed configuration summary block from cached manifest.
 */
function _buildInstalledSummary(manifest, settingsJson) {
  const counts = manifest?.counts || {};
  const mcpCount = Object.keys(settingsJson?.mcpServers || {}).length;

  return [
    `- Agents: ${counts.agents || 0} (auto-discovered from .claude/agents/)`,
    `- Skills: ${counts.skills || 0} (auto-discovered from .claude/skills/)`,
    `- Rules: ${counts.rules || 0} files (auto-loaded from .claude/rules/)`,
    `- MCP Servers: ${mcpCount} (auto-loaded from settings.json)`,
    `- Workflows: ${counts.workflows || 0} (in .claude/workflows/)`,
  ].join('\n');
}

/**
 * Read .claude/settings.json safely.
 */
function _readSettingsJson(targetDir) {
  const settingsPath = join(targetDir, '.claude', 'settings.json');
  try {
    if (existsSync(settingsPath)) {
      return JSON.parse(readFileSync(settingsPath, 'utf8'));
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

/**
 * Parse a JSON response from Claude using multiple strategies.
 */
function _parseJsonResponse(text, key) {
  if (!text) return null;

  try {
    const obj = JSON.parse(text.trim());
    if (obj && key in obj) return obj;
  } catch {
    // Not direct JSON
  }

  const fenceMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      const obj = JSON.parse(fenceMatch[1].trim());
      if (obj && key in obj) return obj;
    } catch {
      // Invalid JSON in fence
    }
  }

  const obj = extractJsonObject(text, key);
  if (obj && key in obj) return obj;

  return null;
}

// ── Markdown extraction (preserved from original) ────────────────────

/**
 * Extract clean markdown from Claude's response.
 */
function extractMarkdown(text) {
  if (!text) return '';

  let md;

  // Strategy 1: ```markdown fence with GREEDY match to last ```
  const fenceMatch = text.match(/```(?:markdown|md)\s*\n([\s\S]*)```\s*$/i);
  if (fenceMatch) {
    md = fenceMatch[1].trim();
  }

  // Strategy 2: Preamble then first # header
  if (!md) {
    const headerIdx = text.indexOf('\n# ');
    if (headerIdx !== -1 && headerIdx < 500) {
      md = text.slice(headerIdx + 1);
      md = md.replace(/\n```\s*$/, '');
      md = md.trim();
    }
  }

  // Strategy 3: Starts with # directly
  if (!md && text.trimStart().startsWith('#')) {
    md = text.replace(/\n```\s*$/, '').trim();
  }

  // Strategy 4: Any ``` fence containing # headers
  if (!md) {
    const anyFence = text.match(/```\w*\s*\n([\s\S]*)```\s*$/);
    if (anyFence && anyFence[1].includes('#')) {
      md = anyFence[1].trim();
    }
  }

  // Fallback
  if (!md) {
    md = text.trim();
  }

  md = stripTrailingProse(md);
  md = stripChangelogSuffix(md);

  return md;
}

/**
 * Strip trailing conversational prose.
 */
function stripTrailingProse(text) {
  if (!text) return '';

  const lines = text.split('\n');
  let end = lines.length - 1;
  while (end >= 0 && lines[end].trim() === '') {
    end--;
  }

  while (end >= 0) {
    const line = lines[end].trim();
    if (/^(#{1,6}\s|[-*+]\s|>\s|\||\d+\.\s|```|<)/.test(line)) break;
    if (line === '') {
      end--;
      continue;
    }

    let probeIdx = end - 1;
    while (probeIdx >= 0 && lines[probeIdx].trim() !== '') {
      if (/^(#{1,6}\s|[-*+]\s|>\s|\||\d+\.\s|```|<)/.test(lines[probeIdx].trim())) {
        return lines.slice(0, end + 1).join('\n').trimEnd();
      }
      probeIdx--;
    }

    if (probeIdx >= 0 && lines[probeIdx].trim() === '') {
      end = probeIdx;
      continue;
    }

    break;
  }

  return lines.slice(0, end + 1).join('\n').trimEnd();
}

/**
 * Strip changelog / summary blocks.
 */
function stripChangelogSuffix(text) {
  if (!text) return '';

  const triggerRe = /^(\*{2}|#{1,6}\s*)(key changes|changes from|what changed|summary of changes|notes?:|differences?:|changelog)\b/i;

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (triggerRe.test(lines[i].trim())) {
      let cutAt = i;
      while (cutAt > 0 && lines[cutAt - 1].trim() === '') cutAt--;
      return lines.slice(0, cutAt).join('\n').trimEnd();
    }
  }

  return text;
}

// ── Legacy fallback ──────────────────────────────────────────────────

/**
 * Original tool-based CLAUDE.md rewrite (preserved for backward compat).
 */
const LEGACY_REWRITE_PROMPT = `You are rewriting the CLAUDE.md file for this project.

IMPORTANT: Ignore any existing CLAUDE.md content. Write a completely new one based ONLY
on the actual project files and the installed .claude/ configuration.

## What to read

1. Read .claude/.claude-craft.json — the single source of truth: project analysis (name, description, tech stack, architecture, build commands), installation metadata, and resolved tech stacks with impact scores
2. List .claude/rules/ — check which rule files exist (for "See .claude/rules/<name>.md" pointers)

Do NOT read or enumerate agents, skills, rules, MCP servers, or settings.json — they are auto-loaded by Claude Code.

## CRITICAL: Do NOT list auto-discovered components

Claude Code auto-discovers agents, skills, rules, MCP servers, and hooks from \`.claude/\`.
**USER_GUIDE.md** has the full reference for all installed components.
CLAUDE.md should contain ONLY what Claude cannot infer from code or auto-loaded files.

## CLAUDE.md structure (MUST be under 80 lines)

Write a CLAUDE.md with these exact sections:

### 1. Project Overview (3-8 lines)
- Project name, what it does, tech stack
- Architecture pattern if detected
- Use the description from .claude-craft.json

### 2. Build & Run Commands (only if known)
A markdown table of: install, dev, build, test, lint commands.
Only include commands that exist in .claude-craft.json buildCommands.

### 3. Tech Stack (only if stack-specific conventions exist)
- Stack-specific conventions (purpose, not a file tree)
- Key directory conventions — max 3 lines, describe purpose not inventory
- One line pointing to the relevant rules file
- OMIT this section entirely if no stack rules exist in .claude/rules/
- Do NOT include a directory tree or file-by-file listing

### 4. Usage Reporting (always include, do not modify)
- Always report the total API request usage (requests made, tokens consumed) when a task is finished.
- Include this section exactly as-is — do not rephrase or omit.

## Rules for writing

- MUST be under 80 lines total
- Be concise — one line per item, no lengthy explanations
- Do NOT include generic advice, filler, or self-evident statements
- Do NOT include content that Claude can infer from code or auto-loaded files
- Do NOT list agents, skills, rules, MCP servers, or security patterns — they are all auto-discovered
- Do NOT include an "Installed Configuration" section — auto-loaded components are documented elsewhere
- Do NOT try to write/edit files — just output the markdown content
- Do NOT wrap the output in \`\`\`markdown fences
- Do NOT add any explanation or commentary before or after the markdown
- Start your response directly with the # header
- End your response immediately after the last section — NOTHING after it
- ABSOLUTELY NO trailing text, changelog, or summary-of-differences section`;

async function _legacyRewrite(targetDir) {
  try {
    const output = await runClaude([
      '-p',
      '--max-turns', '5',
      '--allowedTools', 'Read,Glob,Bash(ls:*)',
    ], { cwd: targetDir, stdinInput: LEGACY_REWRITE_PROMPT, timeout: 180_000 });

    const responseText = extractMarkdown(output);

    if (!responseText || !responseText.includes('#')) {
      logger.debug(`Legacy rewrite raw output (first 500 chars): ${(output || '').slice(0, 500)}`);
      logger.debug('Claude did not produce valid markdown for CLAUDE.md — keeping original.');
      return false;
    }

    const lineCount = responseText.split('\n').length;
    if (lineCount > 80) {
      logger.debug(`Claude produced ${lineCount} lines for CLAUDE.md (limit 80) — keeping original.`);
      return false;
    }

    writeFileSync(join(targetDir, 'CLAUDE.md'), _ensureOverrideRule(responseText) + '\n', 'utf8');
    return true;
  } catch (err) {
    if (err.killed) {
      logger.debug('CLAUDE.md rewrite timed out — keeping original.');
    } else {
      logger.debug('CLAUDE.md rewrite failed — keeping original.');
    }
    return false;
  }
}
