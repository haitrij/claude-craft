import { select, checkbox, confirm, password, input } from '@inquirer/prompts';
import chalk from 'chalk';
import { colors } from './theme.js';

/**
 * Themed select prompt with description hint.
 */
export async function themedSelect({ message, hint, choices, ...rest }) {
  if (hint) {
    console.log(colors.muted(`    ${hint}`));
    console.log();
  }
  return select({ message, choices, loop: false, ...rest });
}

/**
 * Themed checkbox prompt with description hint.
 */
export async function themedCheckbox({ message, hint, choices, ...rest }) {
  if (hint) {
    console.log(colors.muted(`    ${hint}`));
    console.log();
  }
  return checkbox({ message, choices, loop: false, ...rest });
}

/**
 * Themed confirm prompt with description hint.
 */
export async function themedConfirm({ message, hint, ...rest }) {
  if (hint) {
    console.log(colors.muted(`    ${hint}`));
    console.log();
  }
  return confirm({ message, ...rest });
}

/**
 * Themed password prompt with description hint.
 */
export async function themedPassword({ message, hint, ...rest }) {
  if (hint) {
    console.log(colors.muted(`    ${hint}`));
  }
  return password({ message, ...rest });
}

/**
 * Themed input prompt with description hint.
 */
export async function themedInput({ message, hint, ...rest }) {
  if (hint) {
    console.log(colors.muted(`    ${hint}`));
  }
  return input({ message, ...rest });
}
