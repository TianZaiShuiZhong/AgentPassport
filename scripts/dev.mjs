import 'dotenv/config';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { root } from './compile.mjs';
const production = process.argv.includes('--production');
if (production && !existsSync(path.join(root, 'dist/index.html')))
  throw new Error('Run npm run build first');
// Check both IP families. Windows can otherwise route localhost to a different
// already-running project even when this server successfully binds 127.0.0.1.
async function occupied(port, host) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}
for (const port of [
  Number(process.env.UI_PORT || 4390),
  Number(process.env.VAULT_PORT || 4391),
  Number(process.env.RESEARCH_PORT || 4392),
  Number(process.env.WRITER_PORT || 4393),
]) {
  if ((await Promise.all(['127.0.0.1', '::1'].map((host) => occupied(port, host)))).some(Boolean)) {
    throw new Error(
      `Port ${port} is already in use. Configure different UI_PORT / VAULT_PORT / RESEARCH_PORT / WRITER_PORT in .env. Other projects are not stopped.`,
    );
  }
}
const children = [];
let stopping = false;
let restarting = false;
function start(file, args = [], name = 'service') {
  const child = spawn(process.execPath, [file, ...args], {
    cwd: root,
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    windowsHide: true,
  });
  children.push(child);
  child.on('message', (msg) => {
    if (msg?.type === 'restart') void restart();
  });
  child.on('exit', (code) => {
    if (!stopping && !restarting) {
      console.error(`${name} exited (${code})`);
      stop(code || 1);
    }
  });
  return child;
}
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach((c) => c.kill('SIGTERM'));
  setTimeout(() => process.exit(code), 1000);
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
async function waitReady(port) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline && !stopping) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(1500),
      });
      if (r.ok) {
        const json = await r.json();
        if (json.ready === true) return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Service ${port} did not become ready`);
}
async function boot() {
  start('server/vault.mjs', [], 'Vault');
  try {
    await waitReady(Number(process.env.VAULT_PORT || 4391));
    start('server/agent-app.mjs', ['research'], 'Research Studio');
    start('server/agent-app.mjs', ['writer'], 'Writing Studio');
    await Promise.all([
      waitReady(Number(process.env.RESEARCH_PORT || 4392)),
      waitReady(Number(process.env.WRITER_PORT || 4393)),
    ]);
    const uiPort = Number(process.env.UI_PORT || 4390);
    const network = await (
      await fetch(`http://127.0.0.1:${process.env.VAULT_PORT || 4391}/api/config`)
    ).json();
    if (production) start('server/ui.mjs', [], 'Dashboard');
    else start('node_modules/vite/bin/vite.js', [], 'Dashboard');
    console.log(
      `\nAgentPassport: http://127.0.0.1:${uiPort}\nIndependent apps: research :${process.env.RESEARCH_PORT || 4392} / writer :${process.env.WRITER_PORT || 4393}\nActive network: ${network.mode === 'monad' ? 'Monad Testnet' : 'Local EVM'} · chain ${network.chainId}\n`,
    );
  } catch (error) {
    console.error(error.message);
    stop(1);
  }
}
async function restart() {
  if (stopping || restarting) return;
  restarting = true;
  console.log('Restarting AgentPassport services for the configured network...');
  await Promise.all(
    children.map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null) return resolve();
          child.once('exit', resolve);
          child.kill('SIGTERM');
        }),
    ),
  );
  children.length = 0;
  restarting = false;
  await boot();
}
await boot();
