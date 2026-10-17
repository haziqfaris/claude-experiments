// Start the Soul Engine hub when you sign in to Windows, hidden, with its log in ~/.claude/soul-engine/hub.log.
//   npm run autostart          install (or update) the start-up entry
//   npm run autostart -- off   remove it
//   npm run autostart -- status
// It adds one small script to your own Start-up folder: no admin rights, no service, easy to remove.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = process.argv[2] ?? 'on';
if (process.platform !== 'win32') {
  console.log('Auto-start is set up for Windows. On macOS use a LaunchAgent, on Linux a systemd user service, running: npx tsx server/index.ts');
  process.exit(0);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const startup = path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const entry = path.join(startup, 'REKA Soul Engine hub.vbs');
const logDir = path.join(os.homedir(), '.claude', 'soul-engine');
const log = path.join(logDir, 'hub.log');

if (arg === 'status') {
  console.log(existsSync(entry) ? `On: ${entry}` : 'Off: the hub does not start at sign-in.');
  process.exit(0);
}
if (arg === 'off') {
  rmSync(entry, { force: true });
  console.log('Removed. The hub no longer starts at sign-in (a running hub keeps running until you close it or restart).');
  process.exit(0);
}

if (!existsSync(path.join(root, 'dist', 'index.html'))) {
  console.log('Note: there is no build yet. Run `npm run build` so the hub can serve the dashboard.');
}
mkdirSync(logDir, { recursive: true });
// VBScript runs the command with no window. Quotes are doubled inside VBScript strings.
const cmd = `cmd /c cd /d "${root}" && npx tsx server/index.ts >> "${log}" 2>&1`;
writeFileSync(entry, [
  "' Starts the REKA Soul Engine hub at sign-in, hidden. Remove with: npm run autostart -- off",
  `CreateObject("WScript.Shell").Run "${cmd.replace(/"/g, '""')}", 0, False`,
  '',
].join('\r\n'));
console.log(`On. The hub starts at sign-in, hidden.\n  entry: ${entry}\n  log:   ${log}\nOpen it at http://localhost:7777 (the address Windows Hello needs) and install it as an app from the browser's menu (Apps > Install this site as an app).`);
