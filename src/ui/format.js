import chalk from 'chalk';
import { getTerminalWidth } from './theme.js';

/**
 * Indent every line of text by N spaces.
 */
export function indent(text, spaces = 2) {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => pad + line)
    .join('\n');
}

/**
 * Horizontal divider line.
 */
export function divider(width) {
  const w = width || Math.min(getTerminalWidth() - 4, 56);
  return chalk.dim('  ' + '─'.repeat(w));
}

/**
 * Pluralize a word based on count.
 */
export function pluralize(count, singular, plural) {
  return count === 1 ? `${count} ${singular}` : `${count} ${plural || singular + 's'}`;
}

/**
 * Truncate text with ellipsis if too long.
 */
export function truncate(text, maxLen = 60) {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

/**
 * Format milliseconds as human-readable duration.
 */
export function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Dot-padded label + value (e.g., "Node.js v20.11.0 ............ ok").
 */
export function dotPad(label, value, totalWidth) {
  const w = totalWidth || Math.min(getTerminalWidth() - 8, 48);
  const stripped = label.replace(/\x1b\[[0-9;]*m/g, '');
  const valStripped = value.replace(/\x1b\[[0-9;]*m/g, '');
  const dotsNeeded = Math.max(2, w - stripped.length - valStripped.length);
  return label + chalk.dim(' ' + '.'.repeat(dotsNeeded) + ' ') + value;
}
