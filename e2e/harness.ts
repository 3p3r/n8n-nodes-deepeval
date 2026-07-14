import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseFlatted } from 'flatted';
import { describe, expect, inject, it } from 'vitest';
import type { DeepEvalE2EContext } from './global-setup.js';

interface WorkflowNode {
  name: string;
  type: string;
  parameters: Record<string, unknown>;
  credentials?: Record<string, { id: string; name: string }>;
}

interface WorkflowDefinition {
  name: string;
  nodes: WorkflowNode[];
  connections: Record<string, unknown>;
  settings: Record<string, unknown>;
  pinData?: Record<string, unknown>;
  active?: boolean;
  tags?: unknown[];
  meta?: unknown;
}

interface ExecutionResponse {
  id: string;
  status: string;
  finished: boolean;
  data: string;
}

interface ParsedExecutionData {
  resultData: {
    error?: { message?: string; stack?: string };
    runData: Record<
      string,
      Array<{
        data?: {
          main?: Array<Array<{ json: Record<string, unknown> }>>;
        };
      }>
    >;
  };
}

interface N8nEnvelope<T> {
  data: T;
}

const root = resolve(import.meta.dirname, '..');

async function api<T>(
  context: DeepEvalE2EContext,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${context.baseUrl}${path}`, {
    ...init,
    headers: {
      Cookie: context.cookie,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const body = (await response.json()) as N8nEnvelope<T> | { message?: string };
  if (!response.ok) {
    throw new Error(`n8n API ${response.status}: ${JSON.stringify(body)}`);
  }
  return 'data' in body ? body.data : (body as T);
}

function replacePlaceholders(value: unknown, replacements: Record<string, string>): unknown {
  if (typeof value === 'string') {
    let output = value;
    for (const [placeholder, replacement] of Object.entries(replacements)) {
      output = output.replaceAll(placeholder, replacement);
    }
    return output;
  }
  if (Array.isArray(value)) {
    return value.map((item) => replacePlaceholders(item, replacements));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replacePlaceholders(item, replacements)]),
    );
  }
  return value;
}

function prepareWorkflow(
  workflow: WorkflowDefinition,
  context: DeepEvalE2EContext,
): WorkflowDefinition {
  const prepared = replacePlaceholders(workflow, {
    REPLACE_WITH_MODEL_ID: context.model,
    REPLACE_WITH_OPENAI_CREDENTIAL_ID: context.credentialId,
    REPLACE_WITH_SOURCE_DATA_TABLE_ID: context.sourceTableId,
    REPLACE_WITH_RESULTS_DATA_TABLE_ID: context.resultsTableId,
  }) as WorkflowDefinition;

  for (const node of prepared.nodes) {
    const customType = context.nodeTypes[node.name];
    if (customType) node.type = customType;
    if (node.name === 'OpenAI Chat Model') {
      const model = node.parameters.model as Record<string, unknown>;
      model.value = context.model;
      node.parameters.options = {
        baseURL: context.inferenceBaseUrl,
        timeout: 180_000,
        maxRetries: 0,
        temperature: 0,
      };
      if (node.credentials?.openAiApi) {
        node.credentials.openAiApi.id = context.credentialId;
        node.credentials.openAiApi.name = 'Local OpenAI-compatible endpoint';
      }
    }
  }

  delete prepared.active;
  delete prepared.tags;
  delete prepared.meta;
  return prepared;
}

async function waitForExecution(
  context: DeepEvalE2EContext,
  executionId: string,
): Promise<ExecutionResponse> {
  const deadline = Date.now() + 840_000;
  while (Date.now() < deadline) {
    const execution = await api<ExecutionResponse>(
      context,
      `/rest/executions/${executionId}?includeData=true`,
    );
    if (['success', 'error', 'canceled', 'crashed'].includes(execution.status)) {
      return execution;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Timed out waiting for n8n execution ${executionId}`);
}

function executionOutput(
  execution: ExecutionResponse,
  nodeName: string,
): Record<string, unknown>[] {
  const parsed = parseFlatted(execution.data) as ParsedExecutionData;
  if (execution.status !== 'success') {
    const error = parsed.resultData.error;
    throw new Error(
      `n8n execution ${execution.id} failed: ${error?.stack ?? error?.message ?? execution.status}`,
    );
  }
  const runs = parsed.resultData.runData[nodeName];
  const lastRun = runs?.at(-1);
  return lastRun?.data?.main?.[0]?.map((item) => item.json) ?? [];
}

async function assertAggregatePersistence(
  context: DeepEvalE2EContext,
  runId: string,
): Promise<void> {
  const result = await api<{ data: Array<Record<string, unknown>> }>(
    context,
    `/rest/projects/${context.projectId}/data-tables/${context.resultsTableId}/rows`,
  );
  expect(result.data.some((row) => row.runId === runId)).toBe(true);
}

export function runNodeWorkflow(workflowId: string, displayName: string): void {
  describe(displayName, () => {
    it('executes its importable example in a real n8n process', async () => {
      const context = inject('deepevalE2E');
      const workflowPath = resolve(root, 'packages/nodes/examples', `${workflowId}.workflow.json`);
      const source = JSON.parse(await readFile(workflowPath, 'utf8')) as WorkflowDefinition;
      const workflow = prepareWorkflow(source, context);
      const created = await api<{ id: string }>(context, '/rest/workflows', {
        method: 'POST',
        body: JSON.stringify(workflow),
      });

      try {
        const executeOnce = async (): Promise<ReturnType<typeof executionOutput>> => {
          const run = await api<{ executionId: string }>(
            context,
            `/rest/workflows/${created.id}/run`,
            {
              method: 'POST',
              body: JSON.stringify({
                destinationNode: {
                  nodeName: workflowId === 'deepEvalAggregate' ? 'Persist Results' : displayName,
                  mode: 'inclusive',
                },
              }),
            },
          );
          const execution = await waitForExecution(context, run.executionId);
          return executionOutput(execution, displayName);
        };

        const output = await executeOnce();
        expect(output.length).toBeGreaterThan(0);

        if (workflowId === 'deepEvalTrigger') {
          expect(output[0]?.evalContext).toMatchObject({
            isEvalRun: true,
            sourceTableId: context.sourceTableId,
          });
        } else if (workflowId === 'deepEvalAggregate') {
          expect(typeof output[0]?.score).toBe('number');
          expect(typeof output[0]?.success).toBe('boolean');
          expect(Array.isArray(output[0]?.metrics)).toBe(true);
          await assertAggregatePersistence(context, String(output[0]?.runId));
        } else {
          expect(output[0]?.metric).toBe(displayName);
          expect(typeof output[0]?.score).toBe('number');
          expect(Number.isFinite(output[0]?.score)).toBe(true);
          expect(typeof output[0]?.success).toBe('boolean');
          expect(output[0]?.reason === null || typeof output[0]?.reason === 'string').toBe(true);

          if (workflowId === 'bias') {
            const concurrentOutputs = await Promise.all([executeOnce(), executeOnce()]);
            for (const concurrentOutput of concurrentOutputs) {
              expect(concurrentOutput[0]?.metric).toBe(displayName);
              expect(typeof concurrentOutput[0]?.score).toBe('number');
            }
          }
        }
      } finally {
        await api(context, `/rest/workflows/${created.id}/archive`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        await api(context, `/rest/workflows/${created.id}`, { method: 'DELETE' });
      }
    });
  });
}
