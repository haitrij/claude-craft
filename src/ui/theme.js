import chalk from 'chalk';

// ── Color palette ────────────────────────────────────────────────────────

export const colors = {
  primary: chalk.cyan,
  primaryBold: chalk.bold.cyan,
  success: chalk.green,
  successBold: chalk.bold.green,
  warning: chalk.yellow,
  warningBold: chalk.bold.yellow,
  error: chalk.red,
  errorBold: chalk.bold.red,
  muted: chalk.dim,
  info: chalk.blue,
  bold: chalk.bold,
  underline: chalk.underline,
  highlight: chalk.bold.white,
};

// ── Icons ────────────────────────────────────────────────────────────────

export const icons = {
  check: chalk.green('✔'),
  cross: chalk.red('✖'),
  warning: chalk.yellow('⚠'),
  info: chalk.blue('ℹ'),
  bullet: chalk.dim('•'),
  arrow: chalk.cyan('›'),
  plus: chalk.green('+'),
  tilde: chalk.yellow('~'),
  dash: chalk.dim('─'),
  dot: chalk.dim('·'),
};

// ── Phase definitions ────────────────────────────────────────────────────

export const PHASES = [
  { number: 1, name: 'Welcome & Setup' },
  { number: 2, name: 'Project Discovery' },
  { number: 3, name: 'Configuration' },
  { number: 4, name: 'Installation' },
  { number: 5, name: 'Finalization' },
];

export const TOTAL_PHASES = PHASES.length;

// ── Boxen styles ─────────────────────────────────────────────────────────

export const boxStyles = {
  info: {
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
    margin: { top: 0, bottom: 0, left: 2, right: 0 },
    borderStyle: 'round',
    borderColor: 'cyan',
  },
  success: {
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
    margin: { top: 1, bottom: 0, left: 2, right: 0 },
    borderStyle: 'double',
    borderColor: 'green',
  },
  warning: {
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
    margin: { top: 0, bottom: 0, left: 2, right: 0 },
    borderStyle: 'round',
    borderColor: 'yellow',
  },
};

// ── Terminal detection ───────────────────────────────────────────────────

export function getTerminalWidth() {
  return process.stdout.columns || 80;
}

export function isTTY() {
  return !!process.stdout.isTTY;
}

export function isNarrow() {
  return getTerminalWidth() < 60;
}
