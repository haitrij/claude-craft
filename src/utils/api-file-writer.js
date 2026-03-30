/**
 * API file writer — writes files from server response to disk.
 *
 * Handles two types:
 *   - type: 'file'       → safeWriteFile(path, content)
 *   - type: 'json-merge'  → accumulate, then mergeJsonFile
 *
 * Also handles MCP filtering (only selected MCPs) and API key injection.
 */
import { join } from 'path';
import { ensureDir } from 'fs-extra/esm';
import { safeWriteFile, mergeJsonFile } from './file-writer.js';
import { generateSecurityGitignore } from './security.js';

/**
 * Write all files from the API response to disk.
 *
 * @param {Array<{relativePath: string, content: string, type: 'file'|'json-merge'}>} files
 * @param {string} targetDir - Project root directory
 * @param {object} [opts]
 * @param {boolean} [opts.force] - Overwrite existing files
 * @param {string[]} [opts.selectedMcpIds] - MCP IDs user selected (for filtering)
 * @param {object} [opts.mcpKeys] - { mcpId: { KEY_NAME: 'value' } }
 * @param {object} [opts.securityConfig] - { addSecurityGitignore: boolean }
 * @param {object} [opts.detected] - Detection result (for security gitignore)
 * @returns {Promise<Array<{path: string, status: string}>>}
 */
export async function writeApiFiles(files, targetDir, opts = {}) {
  const results = [];

  // Ensure base directories exist
  const directories = [
    '.claude/scripts',
    '.claude/mcps',
    '.claude/workflows',
  ];
  for (const dir of directories) {
    await ensureDir(join(targetDir, dir));
  }

  // Separate json-merge files from regular files
  const regularFiles = [];
  const jsonMergeAccum = new Map(); // relativePath → [parsed objects]

  for (const file of files) {
    if (file.type === 'json-merge') {
      const existing = jsonMergeAccum.get(file.relativePath) || [];
      existing.push(JSON.parse(file.content));
      jsonMergeAccum.set(file.relativePath, existing);
    } else {
      regularFiles.push(file);
    }
  }

  // Write regular files
  for (const file of regularFiles) {
    const filePath = join(targetDir, file.relativePath);
    const result = await safeWriteFile(filePath, file.content, { force: opts.force ?? true });
    results.push(result);
  }

  // Process json-merge files — inject MCP keys and filter MCPs
  for (const [relativePath, objects] of jsonMergeAccum) {
    // Merge all objects for this path into one
    let merged = {};
    for (const obj of objects) {
      merged = deepMerge(merged, obj);
    }

    // If this is settings.json and has mcpServers, filter to selected MCPs and inject keys
    if (relativePath === '.claude/settings.json' && merged.mcpServers && opts.selectedMcpIds) {
      const filtered = {};
      for (const [id, serverConfig] of Object.entries(merged.mcpServers)) {
        if (opts.selectedMcpIds.includes(id)) {
          // Inject user-provided API keys
          if (opts.mcpKeys && opts.mcpKeys[id]) {
            serverConfig.env = { ...serverConfig.env, ...opts.mcpKeys[id] };
          }
          filtered[id] = serverConfig;
        }
      }
      merged.mcpServers = filtered;
    }

    const filePath = join(targetDir, relativePath);
    const result = await mergeJsonFile(filePath, merged, { force: opts.force ?? true });
    results.push(result);
  }

  // Security gitignore (handled locally, not from server)
  if (opts.securityConfig?.addSecurityGitignore) {
    const { join: pathJoin } = await import('path');
    const { pathExists, outputFile } = await import('fs-extra/esm');
    const { readFileSync } = await import('fs');

    const gitignorePath = pathJoin(targetDir, '.gitignore');
    const securityBlock = generateSecurityGitignore(opts.detected || {});

    if (await pathExists(gitignorePath)) {
      const content = readFileSync(gitignorePath, 'utf8');
      const existingLines = new Set(
        content.split('\n').map((l) => l.trim()).filter(Boolean)
      );

      // Filter out lines that already exist in .gitignore (dedup)
      const newLines = securityBlock
        .split('\n')
        .filter((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return true; // keep comments & blanks
          return !existingLines.has(trimmed);
        });

      if (newLines.some((l) => l.trim() && !l.trim().startsWith('#'))) {
        let updated = content;
        if (!updated.endsWith('\n')) updated += '\n';
        updated += '\n' + newLines.join('\n');
        await outputFile(gitignorePath, updated, 'utf8');
        results.push({ path: gitignorePath, status: 'updated' });
      } else {
        results.push({ path: gitignorePath, status: 'skipped' });
      }
    } else {
      await outputFile(gitignorePath, securityBlock, 'utf8');
      results.push({ path: gitignorePath, status: 'created' });
    }
  }

  return results;
}

/**
 * Build a flat file list from a V3 API response.
 *
 * @param {object} apiResponse - Response with guaranteed.files and candidates.items
 * @returns {Array<{relativePath: string, content: string, type: string}>}
 */
export function buildFileList(apiResponse) {
  const files = [...(apiResponse.guaranteed?.files || [])];

  const candidates = apiResponse.candidates?.items || [];

  for (const candidate of candidates) {

    if (Array.isArray(candidate.files) && candidate.files.length > 0) {
      // Multi-file candidates (skills with references/)
      for (const f of candidate.files) {
        if (f && typeof f.relativePath === 'string' && typeof f.content === 'string') {
          files.push(f);
        }
      }
    } else if (candidate.file) {
      // Single-file candidates
      files.push(candidate.file);
    } else if (candidate.category === 'mcp' && candidate.mcpConfig) {
      // MCP candidates: generate json-merge entry for settings.json
      const serverConfig = {};
      if (candidate.mcpConfig.command) {
        serverConfig.command = candidate.mcpConfig.command;
        if (candidate.mcpConfig.args?.length) serverConfig.args = candidate.mcpConfig.args;
      } else if (candidate.mcpConfig.url) {
        serverConfig.url = candidate.mcpConfig.url;
        serverConfig.type = candidate.mcpConfig.transport || 'url';
      }
      files.push({
        relativePath: '.claude/settings.json',
        content: JSON.stringify({ mcpServers: { [candidate.id]: serverConfig } }),
        type: 'json-merge',
      });
    }
  }

  return files;
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
