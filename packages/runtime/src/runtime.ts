import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPyodide, type PyodideInterface } from 'pyodide';
import { PYTHON_BRIDGE } from './python-bridge.js';
import type {
  DeepEvalRequest,
  DeepEvalResult,
  JudgeCallback,
  RuntimeDiagnostics,
} from './types.js';

interface RuntimeState {
  pyodide: PyodideInterface;
}

const runtimeId = randomUUID();
let initializationCount = 0;
let evaluationCount = 0;
let initializedAt: string | null = null;
let runtimePromise: Promise<RuntimeState> | undefined;
let evaluationQueue: Promise<void> = Promise.resolve();

function moduleDirectory(): string {
  if (typeof __dirname !== 'undefined') return __dirname;
  return dirname(fileURLToPath(import.meta.url));
}

function assetsDirectory(): string {
  return resolve(moduleDirectory(), '..', 'assets');
}

async function installPythonWheels(pyodide: PyodideInterface, assets: string): Promise<void> {
  const manifestPath = resolve(assets, 'python', 'wheels.json');
  const wheelNames = JSON.parse(await readFile(manifestPath, 'utf8')) as string[];
  const wheelUrls = wheelNames.map(
    (name) => pathToFileURL(resolve(assets, 'python', 'wheels', name)).href,
  );

  pyodide.globals.set('__deepeval_wheels', wheelUrls);
  try {
    await pyodide.runPythonAsync(`
import micropip
for wheel in __deepeval_wheels:
    await micropip.install(wheel, deps=False)
import pyodide_http
pyodide_http.patch_all()
`);
  } finally {
    pyodide.globals.delete('__deepeval_wheels');
  }
}

async function initializeRuntime(): Promise<RuntimeState> {
  initializationCount += 1;
  const assets = assetsDirectory();
  const indexUrl = `${resolve(assets, 'pyodide')}/`;
  const pyodide = await loadPyodide({ indexURL: indexUrl });

  await pyodide.loadPackage([
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
  ]);
  await installPythonWheels(pyodide, assets);
  await pyodide.runPythonAsync(PYTHON_BRIDGE);

  initializedAt = new Date().toISOString();
  console.info(
    `[n8n-nodes-deepeval] pyodide-initialized runtime=${runtimeId} count=${initializationCount}`,
  );
  return { pyodide };
}

function getRuntime(): Promise<RuntimeState> {
  runtimePromise ??= initializeRuntime().catch((error) => {
    console.error('[n8n-nodes-deepeval] Pyodide initialization failed', error);
    throw error;
  });
  return runtimePromise;
}

async function evaluateNow(
  request: DeepEvalRequest,
  judge: JudgeCallback | undefined,
): Promise<DeepEvalResult> {
  const { pyodide } = await getRuntime();
  if (request.requiresModel && !judge) {
    throw new TypeError(`DeepEval metric ${request.metricId} requires a Language Model connection`);
  }

  const judgeBridge = async (promptValue: unknown, schemaValue: unknown) => {
    if (!judge) throw new TypeError('No Language Model is connected');
    const schemaText = schemaValue == null ? null : String(schemaValue);
    return judge({
      prompt: String(promptValue),
      schema: schemaText ? (JSON.parse(schemaText) as Record<string, unknown>) : null,
    });
  };

  pyodide.globals.set('__deepeval_judge', judgeBridge);
  pyodide.globals.set('__deepeval_request_json', JSON.stringify(request));
  try {
    const rawResult = await pyodide.runPythonAsync(
      'await run_deepeval_request(__deepeval_request_json)',
    );
    evaluationCount += 1;
    return JSON.parse(String(rawResult)) as DeepEvalResult;
  } finally {
    pyodide.globals.delete('__deepeval_judge');
    pyodide.globals.delete('__deepeval_request_json');
  }
}

export function evaluateDeepEval(
  request: DeepEvalRequest,
  judge?: JudgeCallback,
): Promise<DeepEvalResult> {
  const execution = evaluationQueue.then(() => evaluateNow(request, judge));
  evaluationQueue = execution.then(
    () => undefined,
    () => undefined,
  );
  return execution;
}

export async function prewarmDeepEval(): Promise<void> {
  await getRuntime();
}

export function getRuntimeDiagnostics(): RuntimeDiagnostics {
  return {
    runtimeId,
    initializationCount,
    initializedAt,
    evaluationCount,
  };
}
