import type { DeepEvalE2EContext } from '../../e2e/n8n-session.js';

export interface N8nEnvelope<T> {
  data: T;
}

export interface WorkflowNode {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, unknown>;
  credentials?: Record<string, { id: string; name: string }>;
}

export interface WorkflowConnection {
  node: string;
  type: string;
  index: number;
}

export interface WorkflowDefinition {
  id?: string;
  name: string;
  nodes: WorkflowNode[];
  connections: Record<string, Record<string, WorkflowConnection[][]>>;
  settings: Record<string, unknown>;
  versionId?: string;
  staticData?: unknown;
  meta?: unknown;
  checksum?: string;
}

export async function api<T>(
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
  const body = (await response.json()) as N8nEnvelope<T> | T | { message?: string };
  if (!response.ok) {
    throw new Error(`n8n API ${response.status} ${path}: ${JSON.stringify(body)}`);
  }
  return body && typeof body === 'object' && 'data' in body
    ? (body as N8nEnvelope<T>).data
    : (body as T);
}

export async function getWorkflow(
  context: DeepEvalE2EContext,
  id: string,
): Promise<WorkflowDefinition> {
  return await api<WorkflowDefinition>(context, `/rest/workflows/${id}`);
}

export async function putWorkflow(
  context: DeepEvalE2EContext,
  workflow: WorkflowDefinition,
): Promise<WorkflowDefinition> {
  if (!workflow.id) throw new Error('Cannot save a workflow without an id');
  const payload = {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: workflow.settings,
    versionId: workflow.versionId,
    staticData: workflow.staticData ?? null,
    meta: workflow.meta ?? {},
    expectedChecksum: workflow.checksum,
  };
  try {
    return await api<WorkflowDefinition>(context, `/rest/workflows/${workflow.id}?forceSave=true`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  } catch (patchError) {
    try {
      return await api<WorkflowDefinition>(
        context,
        `/rest/workflows/${workflow.id}?forceSave=true`,
        {
          method: 'PUT',
          body: JSON.stringify(payload),
        },
      );
    } catch {
      throw patchError;
    }
  }
}

export async function createWorkflow(
  context: DeepEvalE2EContext,
  name: string,
): Promise<{ id: string }> {
  return await api<{ id: string }>(context, '/rest/workflows', {
    method: 'POST',
    body: JSON.stringify({
      name,
      nodes: [],
      connections: {},
      settings: { executionOrder: 'v1' },
    }),
  });
}

function requireType(context: DeepEvalE2EContext, displayName: string): string {
  const type = context.nodeTypes[displayName];
  if (!type) throw new Error(`DeepEval node type missing: ${displayName}`);
  return type;
}

function connect(
  from: string,
  to: string,
  type = 'main',
  index = 0,
): Record<string, Record<string, WorkflowConnection[][]>> {
  return { [from]: { [type]: [[{ node: to, type, index }]] } };
}

function mergeConnections(
  ...parts: Array<Record<string, Record<string, WorkflowConnection[][]>>>
): Record<string, Record<string, WorkflowConnection[][]>> {
  const out: Record<string, Record<string, WorkflowConnection[][]>> = {};
  for (const part of parts) {
    for (const [from, byType] of Object.entries(part)) {
      out[from] ??= {};
      for (const [type, groups] of Object.entries(byType)) {
        const existing = out[from][type] ?? [[]];
        const incoming = groups[0] ?? [];
        out[from][type] = [[...(existing[0] ?? []), ...incoming]];
      }
    }
  }
  return out;
}

function judgeNode(context: DeepEvalE2EContext): WorkflowNode {
  return {
    id: 'judge-model',
    name: 'OpenAI Chat Model',
    type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
    typeVersion: 1.2,
    position: [1200, 620],
    parameters: {
      model: { __rl: true, mode: 'id', value: context.model },
      options: {
        baseURL: context.inferenceBaseUrl,
        timeout: 180_000,
        maxRetries: 0,
        temperature: 0,
      },
    },
    credentials: {
      openAiApi: { id: context.credentialId, name: 'Local OpenAI-compatible endpoint' },
    },
  };
}

function persistNode(context: DeepEvalE2EContext, position: [number, number]): WorkflowNode {
  return {
    id: 'persist-results',
    name: 'Persist Results',
    type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1,
    position,
    parameters: {
      resource: 'row',
      operation: 'insert',
      dataTableId: {
        __rl: true,
        mode: 'id',
        value: context.resultsTableId,
      },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          runId: '={{ $json.runId }}',
          overallScore: '={{ $json.overallScore }}',
          overallSuccess: '={{ $json.overallSuccess }}',
          metrics: '={{ JSON.stringify($json.metrics) }}',
        },
        schema: [
          { id: 'runId', displayName: 'runId', type: 'string', canBeUsedToMatch: true },
          {
            id: 'overallScore',
            displayName: 'overallScore',
            type: 'number',
            canBeUsedToMatch: true,
          },
          {
            id: 'overallSuccess',
            displayName: 'overallSuccess',
            type: 'boolean',
            canBeUsedToMatch: true,
          },
          { id: 'metrics', displayName: 'metrics', type: 'string', canBeUsedToMatch: true },
        ],
      },
      options: {},
    },
  };
}

function loadSourceNode(context: DeepEvalE2EContext, position: [number, number]): WorkflowNode {
  return {
    id: 'source-table',
    name: 'Load Source Rows',
    type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1,
    position,
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'id', value: context.sourceTableId },
      returnAll: true,
      filters: {},
      orderBy: false,
    },
  };
}

export async function ensureSourceHasActualOutput(context: DeepEvalE2EContext): Promise<void> {
  const base = `/rest/projects/${context.projectId}/data-tables/${context.sourceTableId}`;
  try {
    await api(context, `${base}/columns`, {
      method: 'POST',
      body: JSON.stringify({ name: 'actualOutput', type: 'string' }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/409|already|exist|conflict/i.test(message)) {
      console.info(`Add actualOutput column: ${message}`);
    }
  }

  const rows = await api<{ count?: number; data?: Array<Record<string, unknown>> }>(
    context,
    `${base}/rows?take=20`,
  );
  const list = Array.isArray(rows) ? rows : (rows.data ?? []);
  const first = list[0];
  if (!first) return;
  if (typeof first.actualOutput === 'string' && first.actualOutput.length > 0) return;

  const columnName = first.id !== undefined ? 'id' : 'input';
  const value = first.id ?? first.input;
  try {
    await api(context, `${base}/rows`, {
      method: 'PATCH',
      body: JSON.stringify({
        filter: {
          type: 'and',
          filters: [{ columnName, condition: 'eq', value }],
        },
        data: { actualOutput: 'The answer is 4.' },
        returnData: false,
      }),
    });
  } catch (error) {
    console.info(`Update actualOutput: ${error instanceof Error ? error.message : String(error)}`);
    await api(context, `${base}/insert`, {
      method: 'POST',
      body: JSON.stringify({
        data: [
          {
            input: 'Use the calculator when appropriate, then answer: what is 2 + 2?',
            expectedOutput: 'The answer is 4.',
            actualOutput: 'The answer is 4.',
          },
        ],
        returnType: 'all',
      }),
    });
  }
}

export async function seedDemoCanvasWithTables(
  context: DeepEvalE2EContext,
  workflowId: string,
): Promise<void> {
  const current = await getWorkflow(context, workflowId);
  await putWorkflow(context, {
    ...current,
    name: current.name || 'Support Agent Benchmark',
    nodes: [
      {
        id: 'manual-trigger',
        name: 'When clicking Execute Workflow',
        type: 'n8n-nodes-base.manualTrigger',
        typeVersion: 1,
        position: [240, 280],
        parameters: {},
      },
      loadSourceNode(context, [520, 280]),
      persistNode(context, [1540, 280]),
      {
        ...judgeNode(context),
        position: [520, 560],
      },
    ],
    connections: mergeConnections(connect('When clicking Execute Workflow', 'Load Source Rows')),
    settings: { executionOrder: 'v1' },
  });
}

export type PipelineStage = 'empty' | 'trigger' | 'metrics' | 'aggregate';

export function buildPipeline(
  context: DeepEvalE2EContext,
  stage: PipelineStage,
  name = 'Support Agent Benchmark',
): Omit<WorkflowDefinition, 'id' | 'versionId'> {
  const nodes: WorkflowNode[] = [
    {
      id: 'manual-trigger',
      name: 'When clicking Execute Workflow',
      type: 'n8n-nodes-base.manualTrigger',
      typeVersion: 1,
      position: [240, 300],
      parameters: {},
    },
  ];
  let connections: Record<string, Record<string, WorkflowConnection[][]>> = {};

  if (stage === 'empty') {
    return { name, nodes, connections, settings: { executionOrder: 'v1' } };
  }

  nodes.push(
    {
      id: 'source-table',
      name: 'Load Source Rows',
      type: 'n8n-nodes-base.dataTable',
      typeVersion: 1.1,
      position: [500, 300],
      parameters: {
        resource: 'row',
        operation: 'get',
        dataTableId: { __rl: true, mode: 'id', value: context.sourceTableId },
        returnAll: true,
        filters: {},
        orderBy: false,
      },
    },
    {
      id: 'deepeval-trigger',
      name: 'DeepEval Trigger',
      type: requireType(context, 'DeepEval Trigger'),
      typeVersion: 1,
      position: [760, 300],
      parameters: {
        runName: 'Support Agent Benchmark',
        dataTableId: context.sourceTableId,
        columnMapping: '{"input":"input","expectedOutput":"expectedOutput"}',
        filters: '{}',
        limitRows: true,
        maxRows: 1,
        runsPerRow: 1,
      },
    },
  );
  connections = mergeConnections(
    connect('When clicking Execute Workflow', 'Load Source Rows'),
    connect('Load Source Rows', 'DeepEval Trigger'),
  );

  if (stage === 'trigger') {
    return { name, nodes, connections, settings: { executionOrder: 'v1' } };
  }

  nodes.push(
    {
      id: 'enrich-case',
      name: 'Enrich Case',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [1020, 300],
      parameters: {
        assignments: {
          assignments: [
            {
              id: 'actual-output',
              name: 'actualOutput',
              type: 'string',
              value: 'The answer is 4.',
            },
            {
              id: 'output',
              name: 'output',
              type: 'string',
              value: 'The answer is 4.',
            },
          ],
        },
        includeOtherFields: true,
        options: {},
      },
    },
    {
      id: 'deepeval-geval',
      name: 'DeepEval G-Eval',
      type: requireType(context, 'DeepEval G-Eval'),
      typeVersion: 1,
      position: [1280, 160],
      parameters: {
        name: 'Custom Correctness',
        criteria: 'Determine whether the support answer is correct.',
        evaluationSteps:
          '["Check whether the response answers the user question.","Check whether the response is accurate."]',
        evaluationParams: ['INPUT', 'ACTUAL_OUTPUT'],
        rubric: '[]',
        threshold: 0.5,
        strictMode: false,
        asyncMode: true,
        verboseMode: false,
        cleanSession: false,
      },
    },
    {
      id: 'deepeval-bias',
      name: 'DeepEval Bias',
      type: requireType(context, 'DeepEval Bias'),
      typeVersion: 1,
      position: [1280, 440],
      parameters: {
        threshold: 0.5,
        includeReason: true,
        strictMode: false,
        asyncMode: true,
        verboseMode: false,
        cleanSession: false,
      },
    },
    judgeNode(context),
  );
  connections = mergeConnections(
    connections,
    connect('DeepEval Trigger', 'Enrich Case'),
    connect('Enrich Case', 'DeepEval G-Eval'),
    connect('Enrich Case', 'DeepEval Bias'),
    {
      'OpenAI Chat Model': {
        ai_languageModel: [
          [
            { node: 'DeepEval G-Eval', type: 'ai_languageModel', index: 0 },
            { node: 'DeepEval Bias', type: 'ai_languageModel', index: 0 },
          ],
        ],
      },
    },
  );

  if (stage === 'metrics') {
    return { name, nodes, connections, settings: { executionOrder: 'v1' } };
  }

  nodes.push(
    {
      id: 'collect-metric-results',
      name: 'Collect Metric Results',
      type: 'n8n-nodes-base.merge',
      typeVersion: 3.2,
      position: [1540, 300],
      parameters: { mode: 'append', numberInputs: 2, options: {} },
    },
    {
      id: 'deepeval-aggregate',
      name: 'DeepEval Aggregate',
      type: requireType(context, 'DeepEval Aggregate'),
      typeVersion: 1,
      position: [1800, 300],
      parameters: {
        dataTableId: context.resultsTableId,
        passRule: 'allPass',
        writeMode: 'upsert',
        runIdColumn: 'runId',
        scoreColumn: 'overallScore',
        successColumn: 'overallSuccess',
        metricsColumn: 'metrics',
      },
    },
    {
      id: 'persist-results',
      name: 'Persist Results',
      type: 'n8n-nodes-base.dataTable',
      typeVersion: 1.1,
      position: [2060, 300],
      parameters: {
        resource: 'row',
        operation: 'insert',
        dataTableId: {
          __rl: true,
          mode: 'id',
          value: context.resultsTableId,
        },
        columns: {
          mappingMode: 'defineBelow',
          value: {
            runId: '={{ $json.runId }}',
            overallScore: '={{ $json.overallScore }}',
            overallSuccess: '={{ $json.overallSuccess }}',
            metrics: '={{ JSON.stringify($json.metrics) }}',
          },
          schema: [
            { id: 'runId', displayName: 'runId', type: 'string', canBeUsedToMatch: true },
            {
              id: 'overallScore',
              displayName: 'overallScore',
              type: 'number',
              canBeUsedToMatch: true,
            },
            {
              id: 'overallSuccess',
              displayName: 'overallSuccess',
              type: 'boolean',
              canBeUsedToMatch: true,
            },
            { id: 'metrics', displayName: 'metrics', type: 'string', canBeUsedToMatch: true },
          ],
        },
        options: {},
      },
    },
  );
  connections = mergeConnections(
    connections,
    {
      'DeepEval G-Eval': {
        main: [[{ node: 'Collect Metric Results', type: 'main', index: 0 }]],
      },
      'DeepEval Bias': {
        main: [[{ node: 'Collect Metric Results', type: 'main', index: 1 }]],
      },
    },
    connect('Collect Metric Results', 'DeepEval Aggregate'),
    connect('DeepEval Aggregate', 'Persist Results'),
  );

  return { name, nodes, connections, settings: { executionOrder: 'v1' } };
}

export async function saveStage(
  context: DeepEvalE2EContext,
  workflowId: string,
  stage: PipelineStage,
): Promise<void> {
  const current = await getWorkflow(context, workflowId);
  const next = buildPipeline(context, stage, current.name || 'Support Agent Benchmark');
  await putWorkflow(context, {
    ...current,
    name: next.name,
    nodes: next.nodes,
    connections: next.connections,
    settings: next.settings,
  });
}

export async function seedDashboardData(
  context: DeepEvalE2EContext,
  workflowId: string,
): Promise<void> {
  await api(
    context,
    `/rest/projects/${context.projectId}/data-tables/${context.resultsTableId}/insert`,
    {
      method: 'POST',
      body: JSON.stringify({
        data: [
          {
            runId: 'demo-run-1',
            overallScore: 0.91,
            overallSuccess: true,
            metrics: JSON.stringify([
              {
                metric: 'DeepEval G-Eval',
                score: 0.95,
                success: true,
                reason: 'The answer matches the expected arithmetic result.',
              },
              {
                metric: 'Bias',
                score: 0.88,
                success: true,
                reason: 'No biased language detected.',
              },
            ]),
          },
        ],
        returnType: 'all',
      }),
    },
  );
  await api(context, `/rest/deepeval-dashboard/workflows/${workflowId}/questionnaire`, {
    method: 'PUT',
    body: JSON.stringify({
      'T.1': {
        status: 'pass',
        notes: 'Pinned DeepEval 4.0.7 and the local llamafile judge in the workflow.',
      },
      'T.7': {
        status: 'partial',
        notes: 'Spot-checked the source Data Table row against expectedOutput.',
      },
    }),
  });
}
