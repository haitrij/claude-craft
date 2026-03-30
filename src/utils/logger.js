import { colors, icons } from '../ui/theme.js';

export function info(msg) {
  console.log(icons.info, msg);
}

export function success(msg) {
  console.log(icons.check, msg);
}

export function warn(msg) {
  console.log(icons.warning, msg);
}

export function error(msg) {
  console.error(icons.cross, msg);
}

export function heading(msg) {
  console.log('\n' + colors.bold(colors.underline(msg)));
}

export function debug(msg) {
  if (process.env.CLAUDE_CRAFT_DEBUG) {
    console.log(colors.muted('[debug]'), msg);
  }
}
