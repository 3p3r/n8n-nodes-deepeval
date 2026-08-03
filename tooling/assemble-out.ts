import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const nodesRoot = resolve(root, 'packages/nodes');
const outRoot = resolve(root, 'out');

interface PublishPackageJson {
  name: string;
  version: string;
  description: string;
  license: string;
  type: string;
  keywords: string[];
  files: string[];
  peerDependencies: Record<string, string>;
  n8n: Record<string, unknown>;
}

async function assembleOut(): Promise<void> {
  const nodesPackagePath = resolve(nodesRoot, 'package.json');
  const nodesPackage = JSON.parse(await readFile(nodesPackagePath, 'utf8')) as Record<
    string,
    unknown
  >;

  const dashboardDist = resolve(root, 'packages/dashboard/dist');
  const dashboardBackend = resolve(dashboardDist, 'backend/hooks.cjs');
  const dashboardBridge = resolve(dashboardDist, 'bridge/index.js');
  const dashboardApp = resolve(dashboardDist, 'app/index.html');
  for (const required of [dashboardBackend, dashboardBridge, dashboardApp]) {
    try {
      await readFile(required);
    } catch {
      throw new Error(
        `Dashboard dist missing: ${required}. Build @n8n-deepeval/dashboard before assemble-out.`,
      );
    }
  }

  await rm(outRoot, { recursive: true, force: true });
  await mkdir(outRoot, { recursive: true });

  await cp(resolve(nodesRoot, 'dist'), resolve(outRoot, 'dist'), { recursive: true });
  await cp(resolve(nodesRoot, 'examples'), resolve(outRoot, 'examples'), { recursive: true });
  await cp(resolve(root, 'docs'), resolve(outRoot, 'docs'), { recursive: true });
  await cp(resolve(root, 'LICENSE'), resolve(outRoot, 'LICENSE'));
  await cp(resolve(root, 'README.md'), resolve(outRoot, 'README.md'));
  await cp(dashboardDist, resolve(outRoot, 'dashboard'), { recursive: true });

  const publishPackage: PublishPackageJson = {
    name: String(nodesPackage.name),
    version: String(nodesPackage.version),
    description: String(nodesPackage.description),
    license: String(nodesPackage.license),
    type: String(nodesPackage.type ?? 'commonjs'),
    keywords: nodesPackage.keywords as string[],
    files: ['dist', 'examples', 'docs', 'dashboard'],
    peerDependencies: nodesPackage.peerDependencies as Record<string, string>,
    n8n: nodesPackage.n8n as Record<string, unknown>,
  };

  await writeFile(resolve(outRoot, 'package.json'), `${JSON.stringify(publishPackage, null, 2)}\n`);
  console.info(`Assembled publishable package at ${outRoot}`);
}

await assembleOut();
