/**
 * Open a URL in the user's default browser, cross-platform.
 *
 * Uses argument arrays (no shell) to avoid escaping issues. On Windows,
 * rundll32 url.dll,FileProtocolHandler avoids cmd.exe mangling '&' in URLs.
 */
import { spawn } from 'child_process';

export function openBrowser(url) {
  return new Promise((resolve, reject) => {
    let cmd, args;
    if (process.platform === 'win32') {
      cmd = 'rundll32';
      args = ['url.dll,FileProtocolHandler', url];
    } else if (process.platform === 'darwin') {
      cmd = 'open';
      args = [url];
    } else {
      cmd = 'xdg-open';
      args = [url];
    }
    try {
      const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
      child.on('error', reject);
      child.unref();
      resolve(true);
    } catch (err) {
      reject(err);
    }
  });
}
