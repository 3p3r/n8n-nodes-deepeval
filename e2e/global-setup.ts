import { readFile } from 'node:fs/promises';
import type { TestProject } from 'vitest/node';
import { type DeepEvalE2EContext, startN8nSession } from './n8n-session.js';

export type { DeepEvalE2EContext };

function expectedPoolSize(): number {
  const raw = Number(process.env.DEEPEVAL_PYODIDE_POOL_SIZE ?? '4');
  if (!Number.isFinite(raw)) return 4;
  return Math.min(16, Math.max(1, Math.floor(raw)));
}

declare module 'vitest' {
  export interface ProvidedContext {
    deepevalE2E: DeepEvalE2EContext;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const session = await startN8nSession();
  project.provide('deepevalE2E', session.context);

  return async () => {
    const logs = await readFile(session.logPath, 'utf8');
    await session.teardown();
    const poolSize = expectedPoolSize();
    const initializationCount =
      logs.match(/pyodide-initialized .* slot=\d+\/\d+ count=\d+/g)?.length ?? 0;
    if (initializationCount !== poolSize) {
      throw new Error(
        `Expected ${poolSize} Pyodide pool initializations in the n8n process, observed ${initializationCount}`,
      );
    }
  };
}
