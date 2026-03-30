import chalk from 'chalk';
import { PHASES, TOTAL_PHASES, getTerminalWidth } from './theme.js';

/**
 * Render a phase header like:
 *   ── Phase 2 of 5 ── Project Discovery ──────────────────
 *
 * @param {number} phaseNumber — current phase number
 * @param {object} [opts] — optional overrides
 * @param {number} [opts.totalPhases] — override total phase count (default: TOTAL_PHASES)
 * @param {string} [opts.name] — override phase name
 */
export function renderPhaseHeader(phaseNumber, opts = {}) {
  const total = opts.totalPhases || TOTAL_PHASES;
  const phase = PHASES.find((p) => p.number === phaseNumber);
  const name = opts.name || (phase ? phase.name : `Phase ${phaseNumber}`);
  const label = `Phase ${phaseNumber} of ${total}`;

  const w = Math.min(getTerminalWidth() - 4, 56);
  const inner = ` ${label} ── ${name} `;
  const tailLen = Math.max(2, w - inner.length - 2);

  console.log();
  console.log(chalk.bold.cyan(`  ──${inner}${'─'.repeat(tailLen)}`));
  console.log();
}
