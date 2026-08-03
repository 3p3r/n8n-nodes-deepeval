import { type ChildProcess, spawn } from 'node:child_process';
import { cp } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';
import { dashboardHooksPath } from '../e2e/dashboard-paths.js';
import { ownerEmail, ownerPassword, startN8nSession } from '../e2e/n8n-session.js';
import { customExtensionsDirectory } from '../e2e/test-target.js';

const root = resolve(import.meta.dirname, '..');
const n8nPort = Number(process.env.N8N_PORT ?? '5678');
const vitePort = 5174;
const dashboardAppUrl = `http://127.0.0.1:${vitePort}/rest/deepeval-dashboard/app/`;

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
    child.on('exit', (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`${command} exited ${code}`)),
    );
    child.on('error', reject);
  });
}

function waitForPort(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 60_000;
  return new Promise((resolveWait, reject) => {
    const tick = () => {
      if (child.exitCode !== null) {
        reject(new Error(`Vite exited with code ${child.exitCode}`));
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(`Timed out waiting for Vite :${port}`));
        return;
      }
      const socket = createConnection({ host: '127.0.0.1', port }, () => {
        socket.destroy();
        resolveWait();
      });
      socket.on('error', () => setTimeout(tick, 200));
    };
    tick();
  });
}

console.info('Building dashboard…');
await run('npm', ['run', '--workspace', '@n8n-deepeval/dashboard', 'build']);
await cp(resolve(root, 'packages/dashboard/dist'), resolve(root, 'out/dashboard'), {
  recursive: true,
  force: true,
});

console.info(`Starting n8n on :${n8nPort} (llamafile + hooks; can take a minute)…`);
const session = await startN8nSession({
  testTarget: 'out',
  port: n8nPort,
  dashboardAppUrl,
});

const vite = spawn(
  process.execPath,
  [
    resolve(root, 'node_modules/vite/bin/vite.js'),
    '--config',
    resolve(root, 'packages/dashboard/vite.config.ts'),
  ],
  {
    cwd: resolve(root, 'packages/dashboard'),
    env: { ...process.env, N8N_PORT: String(n8nPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
vite.stdout?.on('data', (chunk: Buffer) => process.stdout.write(`[vite] ${chunk}`));
vite.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[vite] ${chunk}`));
await waitForPort(vitePort, vite);

console.info('');
console.info('n8n + dashboard Vite HMR ready.');
console.info(`  URL:      ${session.context.baseUrl}`);
console.info(`  Email:    ${ownerEmail}`);
console.info(`  Password: ${ownerPassword}`);
console.info(`  Nodes:    ${customExtensionsDirectory('out')}`);
console.info(`  Hooks:    ${dashboardHooksPath('out')}`);
console.info(`  Vite app: ${dashboardAppUrl}`);
console.info('');
console.info('Press Ctrl+C to stop.');

const shutdown = async () => {
  console.info('\nShutting down…');
  if (vite.exitCode === null) vite.kill('SIGTERM');
  await session.teardown();
  process.exit(0);
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

await new Promise<void>(() => {});
