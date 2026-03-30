import chalk from 'chalk';
import { colors } from './theme.js';

/**
 * Render component selection breakdown.
 */
export function renderComponentBreakdown(summary) {
  const countItems = (tier) => {
    if (!tier) return 0;
    return Object.values(tier).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
  };

  const guaranteedCount = countItems(summary.guaranteed);
  const candidateCount = countItems(summary.candidates);

  const cplx = summary.complexity ?? 0.5;
  const cplxLabel = cplx >= 0.7 ? 'complex' : cplx >= 0.4 ? 'moderate' : 'simple';
  const cplxNote = cplx >= 0.6 ? ' — expanded selection' : cplx < 0.3 ? ' — minimal selection' : '';

  console.log(chalk.dim(`  Complexity: ${colors.success(cplx.toFixed(1))} (${cplxLabel})${cplxNote}`));
  console.log(chalk.dim('  Component selection:'));
  console.log(chalk.dim(`    Guaranteed: ${colors.success(String(guaranteedCount))} (core + role + stack)`));
  if (candidateCount > 0) {
    console.log(chalk.dim(`    Candidates: ${colors.primary(String(candidateCount))} for Claude scoring`));
  }

  if (summary.stacks?.length > 0) {
    console.log(chalk.dim(`    Tech stacks:  ${summary.stacks.map(
      (ts) => `${colors.success(ts.name)} (${ts.impactScore.toFixed(2)})`
    ).join(', ')}`));
  }
}

/**
 * Render MCP server verification results.
 */
export function renderMcpStatus(mcpResults) {
  console.log();
  for (const r of mcpResults) {
    const versionTag = r.package.version ? chalk.dim(` v${r.package.version}`) : '';
    switch (r.status) {
      case 'ready':
        console.log(colors.success(`    ✔ ${r.id}${versionTag} — ready`));
        break;
      case 'verified':
        console.log(colors.success(`    ✔ ${r.id}${versionTag} — package verified`));
        break;
      case 'needs-key':
        console.log(colors.warning(`    ⚠ ${r.id}${versionTag} — set ${r.apiKey.keyName} env var`));
        break;
      case 'package-error':
        console.log(colors.error(`    ✖ ${r.id} — ${r.package.error}`));
        break;
      case 'verified-with-warning':
        console.log(colors.success(`    ✔ ${r.id}${versionTag} — package verified`) + chalk.dim(` (startup test: ${r.healthCheck.error || 'failed'})`));
        break;
      default:
        console.log(chalk.dim(`    ? ${r.id} — ${r.status}`));
    }
  }
}

/**
 * Render file write results grouped by status.
 */
export function renderFileResults(results) {
  console.log();
  const grouped = { created: [], updated: [], skipped: [] };
  for (const result of results) {
    const status = result.status || 'created';
    if (!grouped[status]) grouped[status] = [];
    grouped[status].push(result);
  }

  const statusStyles = {
    created: { icon: '+', color: colors.success },
    updated: { icon: '~', color: colors.warning },
    skipped: { icon: '-', color: chalk.dim },
  };

  for (const [status, items] of Object.entries(grouped)) {
    if (items.length === 0) continue;
    const style = statusStyles[status] || { icon: '?', color: chalk.white };
    console.log(style.color(`  ${style.icon} ${status} (${items.length}):`));
    for (const item of items) {
      console.log(style.color(`    ${item.path}`));
    }
  }
}
