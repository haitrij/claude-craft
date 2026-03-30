import figlet from 'figlet';
import gradient from 'gradient-string';
import boxen from 'boxen';
import chalk from 'chalk';
import { isNarrow, isTTY, colors } from './theme.js';

const LOGO_TEXT = 'Claude Craft';

const OVERVIEW_LINES = [
  '  What we\'ll do:',
  '',
  '  1. Learn about you     Your role and preferences',
  '  2. Analyze project     Deep-scan your codebase',
  '  3. Configure           Pick servers and settings',
  '  4. Install             Write optimized config',
  '  5. Finalize            Polish and verify',
];

/**
 * Render the ASCII logo with gradient coloring.
 * Falls back to plain text on narrow terminals or non-TTY.
 */
export function renderLogo() {
  if (isNarrow() || !isTTY()) {
    return chalk.bold.cyan('  Claude Craft');
  }

  try {
    const raw = figlet.textSync(LOGO_TEXT, { font: 'Small' });
    const colored = gradient(['#6EC1E4', '#8B5CF6']).multiline(raw);
    return colored
      .split('\n')
      .map((line) => '  ' + line)
      .join('\n');
  } catch {
    return chalk.bold.cyan('  Claude Craft');
  }
}

/**
 * Render the full welcome banner: logo + version + overview card.
 */
export function renderBanner(version) {
  console.log();
  console.log(renderLogo());
  console.log(colors.muted(`  v${version}  Intelligent Claude Code Configurator`));
  console.log();

  if (!isNarrow()) {
    const overviewContent = OVERVIEW_LINES.join('\n');
    const box = boxen(overviewContent, {
      padding: { top: 0, bottom: 0, left: 0, right: 1 },
      margin: { top: 0, bottom: 0, left: 2, right: 0 },
      borderStyle: 'round',
      borderColor: 'cyan',
      dimBorder: true,
    });
    console.log(box);
  }

  console.log();
}
