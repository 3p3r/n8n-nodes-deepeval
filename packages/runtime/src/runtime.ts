import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { PyodideInterface } from 'pyodide';
import { PYTHON_BRIDGE } from './python-bridge.js';
import type {
  DeepEvalRequest,
  DeepEvalResult,
  JudgeCallback,
  RuntimeDiagnostics,
} from './types.js';

interface PoolSlot {
  id: number;
  pyodide: PyodideInterface | null;
  busy: boolean;
}

interface PoolWaiter {
  resolve: (slot: PoolSlot) => void;
}

const runtimeId = randomUUID();
let initializationCount = 0;
let evaluationCount = 0;
let initializedAt: string | null = null;
let poolSlots: PoolSlot[] = [];
const poolWaiters: PoolWaiter[] = [];
let poolPromise: Promise<void> | undefined;

function moduleDirectory(): string {
  if (typeof __dirname !== 'undefined') return __dirname;
  return dirname(fileURLToPath(import.meta.url));
}

function assetsDirectory(): string {
  return resolve(moduleDirectory(), '..', 'assets');
}

function loadPyodideFromAssets(assets: string): Promise<PyodideInterface> {
  const pyodideDir = resolve(assets, 'pyodide');
  const require = createRequire(resolve(pyodideDir, 'package.json'));
  const { loadPyodide } = require('./pyodide.js') as {
    loadPyodide: (config: { indexURL: string }) => Promise<PyodideInterface>;
  };
  return loadPyodide({ indexURL: `${pyodideDir}/` });
}

export function getPyodidePoolSize(): number {
  const raw = Number(process.env.DEEPEVAL_PYODIDE_POOL_SIZE ?? '4');
  if (!Number.isFinite(raw)) return 4;
  return Math.min(16, Math.max(1, Math.floor(raw)));
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

async function initializeSlot(slotIndex: number, poolSize: number): Promise<PyodideInterface> {
  initializationCount += 1;
  const assets = assetsDirectory();
  const pyodide = await loadPyodideFromAssets(assets);

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

  if (initializedAt === null) {
    initializedAt = new Date().toISOString();
  }
  console.info(
    `[n8n-nodes-deepeval] pyodide-initialized runtime=${runtimeId} slot=${slotIndex + 1}/${poolSize} count=${initializationCount}`,
  );
  return pyodide;
}

async function ensurePool(): Promise<void> {
  if (poolPromise) {
    await poolPromise;
    return;
  }

  poolPromise = (async () => {
    const poolSize = getPyodidePoolSize();
    poolSlots = Array.from({ length: poolSize }, (_, id) => ({
      id,
      pyodide: null,
      busy: false,
    }));
    await Promise.all(
      poolSlots.map(async (slot) => {
        slot.pyodide = await initializeSlot(slot.id, poolSize);
      }),
    );
  })().catch((error) => {
    poolPromise = undefined;
    console.error('[n8n-nodes-deepeval] Pyodide pool initialization failed', error);
    throw error;
  });

  await poolPromise;
}

async function acquireSlot(): Promise<PoolSlot> {
  await ensurePool();

  const available = poolSlots.find((slot) => !slot.busy && slot.pyodide !== null);
  if (available) {
    available.busy = true;
    return available;
  }

  return await new Promise<PoolSlot>((resolve) => {
    poolWaiters.push({ resolve });
  });
}

function releaseSlot(slot: PoolSlot): void {
  slot.busy = false;
  const waiter = poolWaiters.shift();
  if (waiter) {
    slot.busy = true;
    waiter.resolve(slot);
  }
}

async function resetSlotSession(pyodide: PyodideInterface): Promise<void> {
  for (const name of ['__deepeval_judge', '__deepeval_request_json']) {
    try {
      pyodide.globals.delete(name);
    } catch {
      // Globals may already be cleared by a prior cleanup step.
    }
  }
  await pyodide.runPythonAsync('reset_deepeval_session()');
}

async function recreateSlot(slot: PoolSlot): Promise<void> {
  const poolSize = getPyodidePoolSize();
  slot.pyodide = await initializeSlot(slot.id, poolSize);
}

async function evaluateOnSlot(
  slot: PoolSlot,
  request: DeepEvalRequest,
  judge: JudgeCallback | undefined,
): Promise<DeepEvalResult> {
  const pyodide = slot.pyodide;
  if (!pyodide) {
    throw new Error(`Pyodide slot ${slot.id} is not initialized`);
  }

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
    for (const name of ['__deepeval_judge', '__deepeval_request_json']) {
      try {
        pyodide.globals.delete(name);
      } catch {
        // Ignore missing globals after failed evaluations.
      }
    }
  }
}

async function evaluateNow(
  request: DeepEvalRequest,
  judge: JudgeCallback | undefined,
): Promise<DeepEvalResult> {
  const slot = await acquireSlot();
  try {
    return await evaluateOnSlot(slot, request, judge);
  } finally {
    const pyodide = slot.pyodide;
    if (pyodide) {
      try {
        await resetSlotSession(pyodide);
      } catch (error) {
        console.error('[n8n-nodes-deepeval] Failed to reset Pyodide session', error);
      }
    }
    if (request.cleanSession) {
      await recreateSlot(slot);
    }
    releaseSlot(slot);
  }
}

export function evaluateDeepEval(
  request: DeepEvalRequest,
  judge?: JudgeCallback,
): Promise<DeepEvalResult> {
  return evaluateNow(request, judge);
}

export async function prewarmDeepEval(): Promise<void> {
  await ensurePool();
}

export function getRuntimeDiagnostics(): RuntimeDiagnostics {
  return {
    runtimeId,
    poolSize: getPyodidePoolSize(),
    busyCount: poolSlots.filter((slot) => slot.busy).length,
    initializationCount,
    initializedAt,
    evaluationCount,
  };
}
