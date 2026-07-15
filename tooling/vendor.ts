import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const vendorRoot = resolve(root, 'vendor');
const assetsRoot = resolve(root, 'packages/runtime/assets');
const wheelsRoot = resolve(assetsRoot, 'python/wheels');
const pyodideAssets = resolve(assetsRoot, 'pyodide');
const buildRoot = resolve(root, '.vendor-build');

const archives = {
  deepeval: {
    url: 'https://github.com/confident-ai/deepeval/archive/refs/tags/v4.0.7.tar.gz',
    sha256: '84660cdd8b4691fc02e18dbfe822fa9a381b5da05c8fd6a7d1308d538d97c7f2',
  },
  web: {
    url: 'https://github.com/3p3r/deep-eval-web/archive/8dca1bfb1a6f3c4e45f135827b1a88f226171955.tar.gz',
    sha256: '930a5b42c7620be8ac9d06e42a334b75fc0df065f3fced84911fa05a8303296a',
  },
  overlays: {
    url: 'https://github.com/confident-ai/deepeval/archive/625814c0c7f3fe88abd2dd7cf96944b2b4d9ed68.tar.gz',
    sha256: '05a3cfa527be73985696fbd6d28877d2d683f7b373b63d468b45a555c72a872b',
  },
} as const;

function run(command: string, args: string[], cwd = root): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function download(url: string, destination: string, expectedSha256?: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download ${url}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (expectedSha256 && digest !== expectedSha256) {
    throw new Error(`Checksum mismatch for ${url}: expected ${expectedSha256}, received ${digest}`);
  }
  await writeFile(destination, bytes);
}

async function extract(archive: keyof typeof archives, expectedDirectory: string): Promise<string> {
  const archivePath = resolve(buildRoot, `${archive}.tar.gz`);
  const destination = resolve(buildRoot, archive);
  await mkdir(destination, { recursive: true });
  await download(archives[archive].url, archivePath, archives[archive].sha256);
  await run('tar', ['-xzf', archivePath, '-C', destination]);
  return resolve(destination, expectedDirectory);
}

async function prepareDeepEvalSources(): Promise<void> {
  const deepevalSource = await extract('deepeval', 'deepeval-4.0.7');
  const webSource = await extract('web', 'deep-eval-web-8dca1bfb1a6f3c4e45f135827b1a88f226171955');
  const overlaysSource = await extract(
    'overlays',
    'deepeval-625814c0c7f3fe88abd2dd7cf96944b2b4d9ed68',
  );

  const target = resolve(vendorRoot, 'deepeval');
  await rm(target, { recursive: true, force: true });
  await cp(deepevalSource, target, { recursive: true });

  const patchesTarget = resolve(vendorRoot, 'patches');
  await rm(patchesTarget, { recursive: true, force: true });
  await mkdir(patchesTarget, { recursive: true });
  await cp(
    resolve(webSource, 'patches/deepeval/001-deepeval-pyodide.patch'),
    resolve(patchesTarget, '001-deepeval-pyodide.patch'),
  );
  await cp(
    resolve(root, 'tooling/patches/002-argument-correctness-template.patch'),
    resolve(patchesTarget, '002-argument-correctness-template.patch'),
  );
  await run('git', [
    'apply',
    '--directory=vendor/deepeval',
    resolve(patchesTarget, '001-deepeval-pyodide.patch'),
  ]);
  await run('git', [
    'apply',
    '--directory=vendor/deepeval',
    resolve(patchesTarget, '002-argument-correctness-template.patch'),
  ]);

  const stubsTarget = resolve(root, 'packages/pyodide-otel-stubs');
  await rm(stubsTarget, { recursive: true, force: true });
  await cp(resolve(webSource, 'packages/pyodide-otel-stubs'), stubsTarget, {
    recursive: true,
  });

  await cp(
    resolve(overlaysSource, 'deepeval/metrics/community'),
    resolve(target, 'deepeval/metrics/community'),
    { recursive: true },
  );
  for (const packageName of ['agent_loop_detection', 'tool_permission']) {
    await cp(
      resolve(overlaysSource, 'deepeval/metrics', packageName),
      resolve(target, 'deepeval/metrics', packageName),
      { recursive: true },
    );
  }

  const metricsInitPath = resolve(target, 'deepeval/metrics/__init__.py');
  let metricsInit = await readFile(metricsInitPath, 'utf8');
  metricsInit += `
from .agent_loop_detection.agent_loop_detection import AgentLoopDetectionMetric
from .tool_permission.tool_permission import ToolPermissionMetric
`;
  await writeFile(metricsInitPath, metricsInit);

  await writeFile(
    resolve(vendorRoot, 'manifest.json'),
    `${JSON.stringify(
      {
        deepeval: { version: '4.0.7', ...archives.deepeval },
        deepEvalWeb: {
          commit: '8dca1bfb1a6f3c4e45f135827b1a88f226171955',
          ...archives.web,
        },
        overlays: {
          commit: '625814c0c7f3fe88abd2dd7cf96944b2b4d9ed68',
          ...archives.overlays,
          metrics: [
            'CitationFaithfulnessMetric',
            'AgentLoopDetectionMetric',
            'ToolPermissionMetric',
          ],
        },
      },
      null,
      2,
    )}\n`,
  );
}

interface PyodidePackage {
  depends: string[];
  file_name: string;
  sha256: string;
}

async function vendorPyodidePackages(): Promise<void> {
  const runtimeRequire = createRequire(resolve(root, 'packages/runtime/package.json'));
  const installedPyodide = dirname(runtimeRequire.resolve('pyodide/package.json'));
  await rm(pyodideAssets, { recursive: true, force: true });
  await mkdir(pyodideAssets, { recursive: true });

  for (const file of [
    'package.json',
    'pyodide-lock.json',
    'pyodide.asm.js',
    'pyodide.asm.wasm',
    'pyodide.js',
    'pyodide.mjs',
    'python_stdlib.zip',
  ]) {
    await cp(resolve(installedPyodide, file), resolve(pyodideAssets, file));
  }

  const lock = JSON.parse(
    await readFile(resolve(installedPyodide, 'pyodide-lock.json'), 'utf8'),
  ) as { packages: Record<string, PyodidePackage> };
  const roots = [
    'micropip',
    'pyodide-http',
    'pydantic',
    'requests',
    'aiohttp',
    'jinja2',
    'openai',
    'rich',
    'tqdm',
    'pytest',
    'click',
    'setuptools',
  ];
  const selected = new Set<string>();
  const aliases = new Map(
    Object.keys(lock.packages).map((name) => [name.replaceAll('-', '_'), name]),
  );
  const visit = (name: string) => {
    const canonicalName = lock.packages[name] ? name : aliases.get(name.replaceAll('-', '_'));
    if (!canonicalName) throw new Error(`Pyodide package ${name} is unavailable`);
    if (selected.has(canonicalName)) return;
    const packageInfo = lock.packages[canonicalName];
    if (!packageInfo) throw new Error(`Pyodide package ${name} is unavailable`);
    selected.add(canonicalName);
    for (const dependency of packageInfo.depends) visit(dependency);
  };
  for (const packageName of roots) visit(packageName);

  for (const packageName of [...selected].sort()) {
    const packageInfo = lock.packages[packageName];
    if (!packageInfo) continue;
    await download(
      `https://cdn.jsdelivr.net/pyodide/v0.27.7/full/${packageInfo.file_name}`,
      resolve(pyodideAssets, packageInfo.file_name),
      packageInfo.sha256,
    );
  }
}

async function buildWheels(): Promise<void> {
  const venv = resolve(root, '.venv-build');
  const python = resolve(venv, 'bin/python');
  await run('python3', ['-m', 'venv', venv]);
  await run(python, ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip', 'build']);

  await rm(wheelsRoot, { recursive: true, force: true });
  await mkdir(wheelsRoot, { recursive: true });
  await run(python, [
    '-m',
    'build',
    resolve(root, 'packages/pyodide-otel-stubs'),
    '--outdir',
    wheelsRoot,
  ]);
  await run(python, ['-m', 'build', resolve(vendorRoot, 'deepeval'), '--outdir', wheelsRoot]);

  const pureDependencies = [
    'pydantic-settings==2.10.1',
    'python-dotenv==1.1.1',
    'tenacity==9.1.2',
    'tabulate==0.9.0',
    'nest-asyncio==1.6.0',
    'typer==0.16.1',
    'portalocker==3.2.0',
    'pyfiglet==1.0.4',
    'typing-inspection==0.4.1',
    'shellingham==1.5.4',
  ];
  await run(python, [
    '-m',
    'pip',
    'download',
    '--quiet',
    '--only-binary=:all:',
    '--no-deps',
    '--dest',
    wheelsRoot,
    ...pureDependencies,
  ]);

  const wheelNames = (await readdir(wheelsRoot)).filter((file) => file.endsWith('.whl')).sort();
  await mkdir(resolve(assetsRoot, 'python'), { recursive: true });
  await writeFile(
    resolve(assetsRoot, 'python/wheels.json'),
    `${JSON.stringify(wheelNames, null, 2)}\n`,
  );
}

await rm(buildRoot, { recursive: true, force: true });
await mkdir(buildRoot, { recursive: true });
await mkdir(vendorRoot, { recursive: true });
await prepareDeepEvalSources();
await vendorPyodidePackages();
await buildWheels();
await rm(buildRoot, { recursive: true, force: true });
await rm(resolve(root, '.venv-build'), { recursive: true, force: true });

console.info(`Vendored DeepEval and ${basename(pyodideAssets)} assets successfully.`);
