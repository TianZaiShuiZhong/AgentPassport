import 'dotenv/config';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { root } from './compile.mjs';
import { initializePublicSettings } from '../server/public.mjs';
import { publicSettingsFile } from '../server/public-access.mjs';
import { writeJson } from '../server/storage.mjs';
const executable =
  process.env.CLOUDFLARED_PATH ||
  path.join(root, '.tools', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
if (!existsSync(executable))
  throw new Error(
    'Install cloudflared from Cloudflare, then set CLOUDFLARED_PATH or place it in .tools.',
  );
const settings = initializePublicSettings();
settings.origin = null;
writeJson(publicSettingsFile(), settings);
const port = Number(process.env.PUBLIC_PORT || 4394),
  children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach((p) => p.kill('SIGTERM'));
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
function launch(command, args, stdio) {
  const child = spawn(command, args, { cwd: root, stdio, windowsHide: true });
  children.push(child);
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`Public service exited (${code})`);
      stop(code || 1);
    }
  });
  return child;
}
launch(process.execPath, ['server/public.mjs'], 'inherit');
let ready = false;
for (let i = 0; i < 50 && !stopping; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/public/session`, {
      signal: AbortSignal.timeout(1000),
    });
    if (r.ok) {
      ready = true;
      break;
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 200));
}
if (!ready) {
  stop(1);
  throw new Error('Public gateway did not start');
}
const tunnel = launch(
  executable,
  ['tunnel', '--url', `http://127.0.0.1:${port}`, '--protocol', 'http2', '--no-autoupdate'],
  ['ignore', 'pipe', 'pipe'],
);
let collected = '',
  published = false;
function output(chunk) {
  const value = chunk.toString();
  collected = (collected + value).slice(-15000);
  if (!published) {
    const match = collected.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match) {
      published = true;
      settings.origin = match[0];
      writeJson(publicSettingsFile(), settings);
      console.log(
        `\nPublic URL: ${settings.origin}\nDemo access code: ${settings.accessCode}\nOnly share the code with intended demo visitors. Local main service must remain running.\n`,
      );
    }
  }
  if (/ERR|connection.*registered|Registered tunnel/i.test(value)) process.stderr.write(value);
}
tunnel.stdout.on('data', output);
tunnel.stderr.on('data', output);
