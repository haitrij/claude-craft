import boxen from 'boxen';
import chalk from 'chalk';
import { boxStyles, isNarrow, isTTY, colors } from './theme.js';

/**
 * Render project analysis as a styled card.
 */
export function renderProjectCard(projectInfo) {
  const lines = [];

  lines.push(chalk.bold('  Project Analysis'));
  lines.push('');

  const row = (label, value) => {
    if (!value) return;
    const padded = label.padEnd(16);
    lines.push(`  ${chalk.dim(padded)}${colors.success(value)}`);
  };

  row('Name', projectInfo.name + (projectInfo.description ? chalk.dim(` — ${projectInfo.description}`) : ''));
  row('Type', projectInfo.projectType);

  if (projectInfo.languageDistribution) {
    const distStr = Object.entries(projectInfo.languageDistribution)
      .sort(([, a], [, b]) => b - a)
      .map(([lang, pct]) => `${lang} (${pct}%)`)
      .join(', ');
    row('Languages', distStr);
  } else if (projectInfo.languages?.length) {
    row('Languages', projectInfo.languages.join(', '));
  }

  if (projectInfo.frameworks?.length) row('Frameworks', projectInfo.frameworks.join(', '));
  if (projectInfo.codeStyle?.length) row('Code style', projectInfo.codeStyle.join(', '));
  if (projectInfo.cicd?.length) row('CI/CD', projectInfo.cicd.join(', '));
  if (projectInfo.architecture) row('Architecture', projectInfo.architecture);

  if (typeof projectInfo.complexity === 'number') {
    const cl = projectInfo.complexity;
    const label = cl >= 0.7 ? 'complex' : cl >= 0.4 ? 'moderate' : 'simple';
    row('Complexity', `${cl.toFixed(2)} (${label})`);
  }

  if (projectInfo.metrics) {
    const m = projectInfo.metrics;
    const parts = [];
    if (m.totalFiles) parts.push(`${m.totalFiles} files`);
    if (m.dependencyCount) parts.push(`${m.dependencyCount} deps`);
    if (m.testFileCount) parts.push(`${m.testFileCount} tests`);
    if (m.estimatedTestCoverage && m.estimatedTestCoverage !== 'unknown') parts.push(`~${m.estimatedTestCoverage} coverage`);
    if (parts.length) row('Metrics', parts.join(', '));
  }

  if (projectInfo.entryPoints?.length > 0) {
    row('Entry points', projectInfo.entryPoints.map((e) => e.path).join(', '));
  }

  if (projectInfo.subprojects?.length > 0) {
    lines.push(chalk.dim('  Subprojects:'));
    for (const sub of projectInfo.subprojects) {
      const fws = sub.frameworks?.length ? ` (${sub.frameworks.join(', ')})` : '';
      lines.push(chalk.dim(`    ${chalk.green('•')} ${sub.path}: ${sub.languages.join(', ')}${fws}`));
    }
  }

  if (projectInfo.buildCommands) {
    const defined = Object.entries(projectInfo.buildCommands).filter(([, v]) => v);
    if (defined.length > 0) {
      row('Commands', defined.map(([k, v]) => `${k}: ${v}`).join(', '));
    }
  }

  const content = lines.join('\n');

  if (isNarrow() || !isTTY()) {
    console.log(content);
    return;
  }

  console.log(boxen(content, {
    ...boxStyles.info,
    title: 'Analysis',
    titleAlignment: 'left',
  }));
}

/**
 * Render the installation summary card before confirmation.
 */
export function renderSummaryCard(summary) {
  const lines = [];
  lines.push(chalk.bold('  Installation Summary'));
  lines.push('');

  const countItems = (bucket) => {
    if (!bucket) return 0;
    return Object.values(bucket).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
  };

  const guaranteedCount = countItems(summary.guaranteed);
  const candidateCount = countItems(summary.candidates);
  const mcpCount = summary.mcps ? summary.mcps.length : 0;

  lines.push(`  ${chalk.dim('Guaranteed components'.padEnd(24))}${colors.success(String(guaranteedCount))}`);
  if (candidateCount > 0) {
    lines.push(`  ${chalk.dim('Candidates for scoring'.padEnd(24))}${colors.primary(String(candidateCount))}`);
  }
  lines.push(`  ${chalk.dim('MCP servers'.padEnd(24))}${colors.success(String(mcpCount))}`);

  const content = lines.join('\n');

  if (isNarrow() || !isTTY()) {
    console.log(content);
    return;
  }

  console.log(boxen(content, boxStyles.info));
}

/**
 * Render the final success card.
 */
export function renderSuccessCard({ totalItems, mcpCount, mcpsNeedingKeys, persona }) {
  const isVibe = persona === 'vibe';
  const lines = [];

  if (isVibe) {
    lines.push(chalk.bold.green('  Claude is ready to build your app!'));
    lines.push('');
    lines.push(`  ${chalk.dim('Components installed'.padEnd(22))}${colors.success(String(totalItems))}`);
    lines.push(`  ${chalk.dim('MCP servers'.padEnd(22))}${colors.success(String(mcpCount))}`);

    if (mcpsNeedingKeys.length > 0) {
      lines.push('');
      lines.push(chalk.yellow('  Some MCP servers need an API key:'));
      for (const r of mcpsNeedingKeys) {
        lines.push(chalk.yellow(`    ${chalk.dim('•')} ${r.id}: set ${r.apiKey.keyName}`));
      }
    }

    lines.push('');
    lines.push(chalk.dim('  Next steps:'));
    lines.push(chalk.dim(`    1. Start Claude Code and describe what you want to build`));
    lines.push(chalk.dim(`    2. Claude will handle the rest!`));
  } else {
    lines.push(chalk.bold.green('  Installation complete!'));
    lines.push('');
    lines.push(`  ${chalk.dim('Settings installed'.padEnd(22))}${colors.success(String(totalItems))} ${chalk.dim('(guaranteed + selected)')}`);
    lines.push(`  ${chalk.dim('MCP servers'.padEnd(22))}${colors.success(String(mcpCount))}`);

    if (mcpsNeedingKeys.length > 0) {
      lines.push('');
      lines.push(chalk.yellow('  MCP servers needing API keys:'));
      for (const r of mcpsNeedingKeys) {
        lines.push(chalk.yellow(`    ${chalk.dim('•')} ${r.id}: set ${r.apiKey.keyName}`));
      }
    }

    lines.push('');
    lines.push(chalk.dim('  Next steps:'));
    lines.push(chalk.dim(`    1. Read ${chalk.underline('USER_GUIDE.md')} for a full feature overview`));

    let step = 2;
    if (mcpsNeedingKeys.length > 0) {
      lines.push(chalk.dim(`    ${step}. Set missing API keys for MCP servers (see above)`));
      step++;
    }
    lines.push(chalk.dim(`    ${step}. Start Claude Code and try out some commands!`));
    step++;
    lines.push(chalk.dim(`    ${step}. Customize .claude/ to your needs`));
  }

  const content = lines.join('\n');

  if (isNarrow() || !isTTY()) {
    console.log('\n' + content);
    return;
  }

  console.log(boxen(content, boxStyles.success));
}

/**
 * Render a warning card (e.g., sensitive files detected).
 */
export function renderWarningCard(title, items) {
  const lines = [];
  lines.push(chalk.yellow(`  ${title}`));
  for (const item of items) {
    lines.push(chalk.yellow(`    ${chalk.dim('•')} ${item}`));
  }

  const content = lines.join('\n');

  if (isNarrow() || !isTTY()) {
    console.log(content);
    return;
  }

  console.log(boxen(content, boxStyles.warning));
}
