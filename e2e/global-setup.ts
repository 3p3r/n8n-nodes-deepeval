import { readFile } from 'node:fs/promises';
import type { TestProject } from 'vitest/node';
import { type DeepEvalE2EContext, startN8nSession } from './n8n-session.js';

export type { DeepEvalE2EContext };

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
    const initializationCount = logs.match(/pyodide-initialized .* count=1/g)?.length ?? 0;
    if (initializationCount !== 1) {
      throw new Error(
        `Expected exactly one Pyodide initialization in the n8n process, observed ${initializationCount}`,
      );
    }
  };
}
