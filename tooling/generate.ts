import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type MetricDefinition,
  metricDefinitions,
} from '../packages/nodes/src/shared/metric-definitions.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nodesRoot = resolve(root, 'packages/nodes');
const sourceRoot = resolve(nodesRoot, 'src/nodes');
const examplesRoot = resolve(nodesRoot, 'examples');
const e2eRoot = resolve(root, 'e2e/generated');

const fixture = {
  input: 'Use the calculator when appropriate, then answer: what is 2 + 2?',
  actualOutput: 'The answer is 4.',
  output: 'The answer is 4.',
  expectedOutput: 'The answer is 4.',
  context: ['Two plus two equals four.'],
  retrievalContext: ['[1] Basic arithmetic states that 2 + 2 = 4.'],
  expectedTools: [{ name: 'calculator', inputParameters: { input: '2+2' } }],
  chatbotRole: 'A concise and accurate arithmetic assistant',
  expectedOutcome: 'The assistant answers that 2 + 2 equals 4.',
  metadata: { suite: 'deepeval-e2e' },
};

const singleDag = {
  nodes: {
    judge: {
      type: 'BinaryJudgementNode',
      criteria: 'Is the actual output correct for the input?',
      evaluation_params: ['input', 'actual_output'],
      children: ['incorrect', 'correct'],
    },
    incorrect: { type: 'VerdictNode', verdict: false, score: 0 },
    correct: { type: 'VerdictNode', verdict: true, score: 10 },
  },
};

const conversationalDag = {
  nodes: {
    judge: {
      type: 'BinaryJudgementNode',
      criteria: 'Was the assistant response relevant and correct?',
      evaluation_params: ['content', 'role'],
      children: ['incorrect', 'correct'],
    },
    incorrect: { type: 'VerdictNode', verdict: false, score: 0 },
    correct: { type: 'VerdictNode', verdict: true, score: 10 },
  },
};

function nodeType(definition: MetricDefinition): string {
  return `n8n-nodes-deepeval.${definition.className.charAt(0).toLowerCase()}${definition.className.slice(1)}`;
}

function wrapperSource(definition: MetricDefinition): string {
  return `import { createMetricNode } from '../../../shared/create-metric-node.js';
import { getMetricDefinition } from '../../../shared/metric-definitions.js';

const MetricNode = createMetricNode(getMetricDefinition('${definition.id}'));

export class ${definition.className} extends MetricNode {}
`;
}

function codex(definition: MetricDefinition): string {
  return `${JSON.stringify(
    {
      node: nodeType(definition),
      nodeVersion: '1.0',
      codexVersion: '1.0',
      categories: ['AI, LLM & Voice'],
      alias: ['DeepEval Benchmarking', 'evaluation', 'benchmark', definition.displayName],
      resources: {
        primaryDocumentation: [{ url: 'https://github.com/3p3r/n8n-nodes-deepeval' }],
      },
    },
    null,
    2,
  )}\n`;
}

function exampleParameters(definition: MetricDefinition): Record<string, unknown> {
  const parameters = Object.fromEntries(
    definition.properties.map((property) => [property.name, property.default]),
  );
  if ('dag' in parameters) {
    parameters.dag = JSON.stringify(
      definition.id === 'conversationalDAG' ? conversationalDag : singleDag,
    );
  }
  if ('availableTools' in parameters) {
    parameters.availableTools = JSON.stringify([
      { name: 'calculator', description: 'Evaluate arithmetic expressions' },
    ]);
  }
  if ('relevantTopics' in parameters) parameters.relevantTopics = '["arithmetic"]';
  if ('adviceTypes' in parameters) parameters.adviceTypes = '["financial","medical"]';
  if ('promptInstructions' in parameters) {
    parameters.promptInstructions = '["Answer concisely","Use factual information"]';
  }
  if ('allowedTools' in parameters) parameters.allowedTools = '["calculator"]';
  if ('deniedTools' in parameters) parameters.deniedTools = '["shell"]';
  if ('assessmentQuestions' in parameters) {
    parameters.assessmentQuestions = '["Does the summary preserve the answer?"]';
  }
  if ('chatbotRole' in parameters) parameters.chatbotRole = fixture.chatbotRole;
  if ('expectedOutcome' in parameters) parameters.expectedOutcome = fixture.expectedOutcome;
  if ('evaluationSteps' in parameters) {
    parameters.evaluationSteps = JSON.stringify([
      'Check whether the response answers the user question.',
      'Check whether the response is accurate and supported by the context.',
    ]);
  }
  if (definition.id === 'turnFaithfulness') parameters.includeReason = false;
  if ('rubric' in parameters) parameters.rubric = '[]';
  return parameters;
}

interface WorkflowNode {
  parameters: Record<string, unknown>;
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  credentials?: Record<string, { id: string; name: string }>;
}

function metricWorkflow(definition: MetricDefinition): Record<string, unknown> {
  const metricName = definition.displayName;
  const needsAgent = definition.requiresMemory || definition.requiresTrace;
  const nodes: WorkflowNode[] = [
    {
      parameters: {},
      id: 'manual-trigger',
      name: 'When clicking Execute Workflow',
      type: 'n8n-nodes-base.manualTrigger',
      typeVersion: 1,
      position: [0, 0],
    },
    {
      parameters: {
        mode: 'raw',
        jsonOutput: JSON.stringify(fixture),
        options: {},
      },
      id: 'evaluation-data',
      name: 'Set Evaluation Data',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [220, 0],
    },
  ];

  if (needsAgent) {
    nodes.push(
      {
        parameters: {
          promptType: 'define',
          text: '={{ $json.input }}',
          options: {
            returnIntermediateSteps: true,
            systemMessage:
              'You are an arithmetic assistant. You must use the Calculator tool exactly once before answering.',
          },
        },
        id: 'ai-agent',
        name: 'AI Agent',
        type: '@n8n/n8n-nodes-langchain.agent',
        typeVersion: 3.1,
        position: [460, 0],
      },
      {
        parameters: {
          mode: 'combine',
          combineBy: 'combineByPosition',
          options: {},
        },
        id: 'metric-input',
        name: 'Prepare Metric Input',
        type: 'n8n-nodes-base.merge',
        typeVersion: 3.2,
        position: [700, 0],
      },
    );
  }

  nodes.push({
    parameters: exampleParameters(definition),
    id: 'deepeval-metric',
    name: metricName,
    type: nodeType(definition),
    typeVersion: 1,
    position: [needsAgent ? 940 : 460, 0],
  });

  if (definition.requiresModel || needsAgent) {
    nodes.push({
      parameters: {
        model: { __rl: true, mode: 'id', value: 'REPLACE_WITH_MODEL_ID' },
        options: {
          baseURL: 'http://127.0.0.1:8080/v1',
          timeout: 120_000,
          maxRetries: 0,
        },
      },
      id: 'judge-model',
      name: 'OpenAI Chat Model',
      type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
      typeVersion: 1.2,
      position: [needsAgent ? 500 : 460, 240],
      credentials: {
        openAiApi: {
          id: 'REPLACE_WITH_OPENAI_CREDENTIAL_ID',
          name: 'Local OpenAI-compatible endpoint',
        },
      },
    });
  }

  if (definition.requiresMemory) {
    nodes.push({
      parameters: {
        sessionIdType: 'customKey',
        sessionKey: `deepeval-${definition.id}`,
        contextWindowLength: 10,
      },
      id: 'simple-memory',
      name: 'Simple Memory',
      type: '@n8n/n8n-nodes-langchain.memoryBufferWindow',
      typeVersion: 1.3,
      position: [700, 240],
    });
  }

  if (definition.requiresTrace) {
    nodes.push({
      parameters: {},
      id: 'calculator',
      name: 'Calculator',
      type: '@n8n/n8n-nodes-langchain.toolCalculator',
      typeVersion: 1,
      position: [820, 240],
    });
  }

  const connections: Record<string, Record<string, unknown[][]>> = {
    'When clicking Execute Workflow': {
      main: [[{ node: 'Set Evaluation Data', type: 'main', index: 0 }]],
    },
    'Set Evaluation Data': {
      main: [
        [
          {
            node: needsAgent ? 'AI Agent' : metricName,
            type: 'main',
            index: 0,
          },
          ...(needsAgent
            ? [
                {
                  node: 'Prepare Metric Input',
                  type: 'main',
                  index: 0,
                },
              ]
            : []),
        ],
      ],
    },
  };

  if (needsAgent) {
    connections['AI Agent'] = {
      main: [[{ node: 'Prepare Metric Input', type: 'main', index: 1 }]],
    };
    connections['Prepare Metric Input'] = {
      main: [[{ node: metricName, type: 'main', index: 0 }]],
    };
  }

  if (definition.requiresModel || needsAgent) {
    const modelTargets = [
      ...(needsAgent ? [{ node: 'AI Agent', type: 'ai_languageModel', index: 0 }] : []),
      ...(definition.requiresModel
        ? [{ node: metricName, type: 'ai_languageModel', index: 0 }]
        : []),
    ];
    connections['OpenAI Chat Model'] = { ai_languageModel: [modelTargets] };
  }

  if (definition.requiresMemory) {
    connections['Simple Memory'] = {
      ai_memory: [
        [
          { node: 'AI Agent', type: 'ai_memory', index: 0 },
          { node: metricName, type: 'ai_memory', index: 0 },
        ],
      ],
    };
  }
  if (definition.requiresTrace) {
    connections.Calculator = {
      ai_tool: [[{ node: 'AI Agent', type: 'ai_tool', index: 0 }]],
    };
  }

  return {
    name: `${metricName} Example`,
    nodes,
    connections,
    settings: { executionOrder: 'v1' },
    active: false,
    pinData: {},
    meta: { templateCredsSetupCompleted: false },
    tags: [],
  };
}

function triggerWorkflow(): Record<string, unknown> {
  return {
    name: 'DeepEval Trigger Example',
    nodes: [
      {
        parameters: {},
        id: 'manual-trigger',
        name: 'When clicking Execute Workflow',
        type: 'n8n-nodes-base.manualTrigger',
        typeVersion: 1,
        position: [0, 0],
      },
      {
        parameters: {
          resource: 'row',
          operation: 'get',
          dataTableId: {
            __rl: true,
            mode: 'id',
            value: 'REPLACE_WITH_SOURCE_DATA_TABLE_ID',
          },
          returnAll: true,
          filters: {},
          orderBy: false,
        },
        id: 'source-table',
        name: 'Load Source Rows',
        type: 'n8n-nodes-base.dataTable',
        typeVersion: 1.1,
        position: [240, 0],
      },
      {
        parameters: {
          runName: 'Local DeepEval Benchmark',
          dataTableId: 'REPLACE_WITH_SOURCE_DATA_TABLE_ID',
          columnMapping: '{"input":"input","expectedOutput":"expectedOutput"}',
          filters: '{}',
          limitRows: true,
          maxRows: 10,
        },
        id: 'deepeval-trigger',
        name: 'DeepEval Trigger',
        type: 'n8n-nodes-deepeval.deepEvalTrigger',
        typeVersion: 1,
        position: [480, 0],
      },
    ],
    connections: {
      'When clicking Execute Workflow': {
        main: [[{ node: 'Load Source Rows', type: 'main', index: 0 }]],
      },
      'Load Source Rows': {
        main: [[{ node: 'DeepEval Trigger', type: 'main', index: 0 }]],
      },
    },
    settings: { executionOrder: 'v1' },
    active: false,
    pinData: {},
    tags: [],
  };
}

const kitchenSinkEnrichFields = {
  input: fixture.input,
  actualOutput: fixture.actualOutput,
  output: fixture.output,
  context: fixture.context,
  retrievalContext: fixture.retrievalContext,
  expectedTools: fixture.expectedTools,
  chatbotRole: fixture.chatbotRole,
  expectedOutcome: fixture.expectedOutcome,
  metadata: fixture.metadata,
};

function kitchenSinkEnrichAssignments(): Array<Record<string, unknown>> {
  let index = 0;
  return Object.entries(kitchenSinkEnrichFields).map(([name, value]) => {
    const assignment: Record<string, unknown> = {
      id: `enrich-${index++}`,
      name,
    };
    if (Array.isArray(value)) {
      assignment.type = 'array';
      assignment.value = JSON.stringify(value);
    } else if (value && typeof value === 'object') {
      assignment.type = 'object';
      assignment.value = value;
    } else {
      assignment.type = 'string';
      assignment.value = String(value);
    }
    return assignment;
  });
}

function kitchenSinkWorkflow(conversational: boolean): Record<string, unknown> {
  const metrics = metricDefinitions.filter((definition) =>
    conversational ? definition.requiresMemory : !definition.requiresMemory,
  );
  const workflowName = conversational
    ? 'Conversational Kitchen Sink'
    : 'Non-Conversational Kitchen Sink';

  const nodes: WorkflowNode[] = [
    {
      parameters: {},
      id: 'manual-trigger',
      name: 'When clicking Execute Workflow',
      type: 'n8n-nodes-base.manualTrigger',
      typeVersion: 1,
      position: [0, 0],
    },
    {
      parameters: {
        resource: 'row',
        operation: 'get',
        dataTableId: {
          __rl: true,
          mode: 'id',
          value: 'REPLACE_WITH_SOURCE_DATA_TABLE_ID',
        },
        returnAll: true,
        filters: {},
        orderBy: false,
      },
      id: 'source-table',
      name: 'Load Source Rows',
      type: 'n8n-nodes-base.dataTable',
      typeVersion: 1.1,
      position: [240, 0],
    },
    {
      parameters: {
        runName: conversational
          ? 'Conversational Kitchen Sink Benchmark'
          : 'Non-Conversational Kitchen Sink Benchmark',
        dataTableId: 'REPLACE_WITH_SOURCE_DATA_TABLE_ID',
        columnMapping: '{"input":"input","expectedOutput":"expectedOutput"}',
        filters: '{}',
        limitRows: true,
        maxRows: 1,
      },
      id: 'deepeval-trigger',
      name: 'DeepEval Trigger',
      type: 'n8n-nodes-deepeval.deepEvalTrigger',
      typeVersion: 1,
      position: [480, 0],
    },
    {
      parameters: {
        mode: 'manual',
        assignments: {
          assignments: kitchenSinkEnrichAssignments(),
        },
        includeOtherFields: true,
        options: {},
      },
      id: 'enrich-evaluation-data',
      name: 'Enrich Evaluation Data',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [720, 0],
    },
    {
      parameters: {
        promptType: 'define',
        text: '={{ $json.input }}',
        options: {
          returnIntermediateSteps: true,
          systemMessage:
            'You are an arithmetic assistant. You must use the Calculator tool exactly once before answering.',
        },
      },
      id: 'ai-agent',
      name: 'AI Agent',
      type: '@n8n/n8n-nodes-langchain.agent',
      typeVersion: 3.1,
      position: [960, 0],
    },
    {
      parameters: {
        mode: 'combine',
        combineBy: 'combineByPosition',
        options: {},
      },
      id: 'metric-input',
      name: 'Prepare Metric Input',
      type: 'n8n-nodes-base.merge',
      typeVersion: 3.2,
      position: [1200, 0],
    },
    {
      parameters: {
        mode: 'append',
        numberInputs: metrics.length,
        options: {},
      },
      id: 'collect-metric-results',
      name: 'Collect Metric Results',
      type: 'n8n-nodes-base.merge',
      typeVersion: 3.2,
      position: [1680, 0],
    },
    {
      parameters: {
        dataTableId: 'REPLACE_WITH_RESULTS_DATA_TABLE_ID',
        passRule: 'allPass',
        writeMode: 'upsert',
        runIdColumn: 'runId',
        scoreColumn: 'overallScore',
        successColumn: 'overallSuccess',
        metricsColumn: 'metrics',
      },
      id: 'deepeval-aggregate',
      name: 'DeepEval Aggregate',
      type: 'n8n-nodes-deepeval.deepEvalAggregate',
      typeVersion: 1,
      position: [1920, 0],
    },
    {
      parameters: {
        resource: 'row',
        operation: 'insert',
        dataTableId: {
          __rl: true,
          mode: 'id',
          value: 'REPLACE_WITH_RESULTS_DATA_TABLE_ID',
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
            {
              id: 'runId',
              displayName: 'runId',
              type: 'string',
              canBeUsedToMatch: true,
            },
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
            {
              id: 'metrics',
              displayName: 'metrics',
              type: 'string',
              canBeUsedToMatch: true,
            },
          ],
        },
        options: {},
      },
      id: 'persist-results',
      name: 'Persist Results',
      type: 'n8n-nodes-base.dataTable',
      typeVersion: 1.1,
      position: [2160, 0],
    },
    {
      parameters: {
        model: { __rl: true, mode: 'id', value: 'REPLACE_WITH_MODEL_ID' },
        options: {
          baseURL: 'http://127.0.0.1:8080/v1',
          timeout: 120_000,
          maxRetries: 0,
        },
      },
      id: 'judge-model',
      name: 'OpenAI Chat Model',
      type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
      typeVersion: 1.2,
      position: [960, 280],
      credentials: {
        openAiApi: {
          id: 'REPLACE_WITH_OPENAI_CREDENTIAL_ID',
          name: 'Local OpenAI-compatible endpoint',
        },
      },
    },
    {
      parameters: {},
      id: 'calculator',
      name: 'Calculator',
      type: '@n8n/n8n-nodes-langchain.toolCalculator',
      typeVersion: 1,
      position: [1080, 280],
    },
  ];

  if (conversational) {
    nodes.push({
      parameters: {
        sessionIdType: 'customKey',
        sessionKey: '={{ $json.evalContext.runId }}',
        contextWindowLength: 10,
      },
      id: 'simple-memory',
      name: 'Simple Memory',
      type: '@n8n/n8n-nodes-langchain.memoryBufferWindow',
      typeVersion: 1.3,
      position: [1200, 280],
    });
  }

  const metricYOffset = 120;
  const metricBaseY = -((metrics.length - 1) * metricYOffset) / 2;

  for (const [index, definition] of metrics.entries()) {
    nodes.push({
      parameters: exampleParameters(definition),
      id: `metric-${definition.id}`,
      name: definition.displayName,
      type: nodeType(definition),
      typeVersion: 1,
      position: [1440, metricBaseY + index * metricYOffset],
    });
  }

  const connections: Record<string, Record<string, unknown[][]>> = {
    'When clicking Execute Workflow': {
      main: [[{ node: 'Load Source Rows', type: 'main', index: 0 }]],
    },
    'Load Source Rows': {
      main: [[{ node: 'DeepEval Trigger', type: 'main', index: 0 }]],
    },
    'DeepEval Trigger': {
      main: [[{ node: 'Enrich Evaluation Data', type: 'main', index: 0 }]],
    },
    'Enrich Evaluation Data': {
      main: [
        [
          { node: 'AI Agent', type: 'main', index: 0 },
          { node: 'Prepare Metric Input', type: 'main', index: 0 },
        ],
      ],
    },
    'AI Agent': {
      main: [[{ node: 'Prepare Metric Input', type: 'main', index: 1 }]],
    },
    'DeepEval Aggregate': {
      main: [[{ node: 'Persist Results', type: 'main', index: 0 }]],
    },
    Calculator: {
      ai_tool: [[{ node: 'AI Agent', type: 'ai_tool', index: 0 }]],
    },
    'OpenAI Chat Model': {
      ai_languageModel: [
        [
          { node: 'AI Agent', type: 'ai_languageModel', index: 0 },
          ...metrics
            .filter((definition) => definition.requiresModel)
            .map((definition) => ({
              node: definition.displayName,
              type: 'ai_languageModel',
              index: 0,
            })),
        ],
      ],
    },
  };

  connections['Prepare Metric Input'] = {
    main: [
      metrics.map((definition) => ({
        node: definition.displayName,
        type: 'main',
        index: 0,
      })),
    ],
  };

  for (const [index, definition] of metrics.entries()) {
    connections[definition.displayName] = {
      main: [[{ node: 'Collect Metric Results', type: 'main', index }]],
    };
  }

  connections['Collect Metric Results'] = {
    main: [[{ node: 'DeepEval Aggregate', type: 'main', index: 0 }]],
  };

  if (conversational) {
    connections['Simple Memory'] = {
      ai_memory: [
        [
          { node: 'AI Agent', type: 'ai_memory', index: 0 },
          ...metrics.map((definition) => ({
            node: definition.displayName,
            type: 'ai_memory',
            index: 0,
          })),
        ],
      ],
    };
  }

  return {
    name: workflowName,
    nodes,
    connections,
    settings: { executionOrder: 'v1' },
    active: false,
    pinData: {},
    meta: { templateCredsSetupCompleted: false },
    tags: [],
  };
}

function consistencyWorkflow(): Record<string, unknown> {
  const gEval = metricDefinitions.find((definition) => definition.id === 'gEval');
  if (!gEval) {
    throw new Error('gEval metric definition is required for the consistency workflow');
  }

  const nodes: WorkflowNode[] = [
    {
      parameters: {},
      id: 'manual-trigger',
      name: 'When clicking Execute Workflow',
      type: 'n8n-nodes-base.manualTrigger',
      typeVersion: 1,
      position: [0, 0],
    },
    {
      parameters: {
        resource: 'row',
        operation: 'get',
        dataTableId: {
          __rl: true,
          mode: 'id',
          value: 'REPLACE_WITH_SOURCE_DATA_TABLE_ID',
        },
        returnAll: true,
        filters: {},
        orderBy: false,
      },
      id: 'source-table',
      name: 'Load Source Rows',
      type: 'n8n-nodes-base.dataTable',
      typeVersion: 1.1,
      position: [240, 0],
    },
    {
      parameters: {
        runName: 'DeepEval Consistency Benchmark',
        dataTableId: 'REPLACE_WITH_SOURCE_DATA_TABLE_ID',
        columnMapping: '{"input":"input","expectedOutput":"expectedOutput"}',
        filters: '{}',
        runsPerRow: 3,
        limitRows: true,
        maxRows: 1,
      },
      id: 'deepeval-trigger',
      name: 'DeepEval Trigger',
      type: 'n8n-nodes-deepeval.deepEvalTrigger',
      typeVersion: 1,
      position: [480, 0],
    },
    {
      parameters: {
        mode: 'manual',
        assignments: {
          assignments: kitchenSinkEnrichAssignments(),
        },
        includeOtherFields: true,
        options: {},
      },
      id: 'enrich-evaluation-data',
      name: 'Enrich Evaluation Data',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [720, 0],
    },
    {
      parameters: {
        promptType: 'define',
        text: '={{ $json.input }}',
        options: {
          returnIntermediateSteps: true,
          systemMessage:
            'You are an arithmetic assistant. You must use the Calculator tool exactly once before answering.',
        },
      },
      id: 'ai-agent',
      name: 'AI Agent',
      type: '@n8n/n8n-nodes-langchain.agent',
      typeVersion: 3.1,
      position: [960, 0],
    },
    {
      parameters: {
        mode: 'combine',
        combineBy: 'combineByPosition',
        options: {},
      },
      id: 'metric-input',
      name: 'Prepare Metric Input',
      type: 'n8n-nodes-base.merge',
      typeVersion: 3.2,
      position: [1200, 0],
    },
    {
      parameters: exampleParameters(gEval),
      id: 'deepeval-g-eval',
      name: gEval.displayName,
      type: nodeType(gEval),
      typeVersion: 1,
      position: [1440, 0],
    },
    {
      parameters: {
        dataTableId: 'REPLACE_WITH_RESULTS_DATA_TABLE_ID',
        passRule: 'allPass',
        writeMode: 'upsert',
        runIdColumn: 'runId',
        scoreColumn: 'overallScore',
        successColumn: 'overallSuccess',
        metricsColumn: 'metrics',
      },
      id: 'deepeval-aggregate',
      name: 'DeepEval Aggregate',
      type: 'n8n-nodes-deepeval.deepEvalAggregate',
      typeVersion: 1,
      position: [1680, 0],
    },
    {
      parameters: {
        groupByField: 'caseId',
        labelField: '',
        consistencyBasis: 'cv',
        dataTableId: 'REPLACE_WITH_RESULTS_DATA_TABLE_ID',
        writeMode: 'upsert',
        caseIdColumn: 'caseId',
        meanScoreColumn: 'meanScore',
        consistencyColumn: 'overallConsistency',
        statsColumn: 'stats',
      },
      id: 'deepeval-consistency',
      name: 'DeepEval Consistency',
      type: 'n8n-nodes-deepeval.deepEvalConsistency',
      typeVersion: 1,
      position: [1920, 0],
    },
    {
      parameters: {
        resource: 'row',
        operation: 'insert',
        dataTableId: {
          __rl: true,
          mode: 'id',
          value: 'REPLACE_WITH_RESULTS_DATA_TABLE_ID',
        },
        columns: {
          mappingMode: 'defineBelow',
          value: {
            caseId: '={{ $json.caseId }}',
            meanScore: '={{ $json.meanScore }}',
            overallConsistency: '={{ $json.overallConsistency }}',
            stats: '={{ JSON.stringify($json.stats) }}',
          },
          schema: [
            {
              id: 'caseId',
              displayName: 'caseId',
              type: 'string',
              canBeUsedToMatch: true,
            },
            {
              id: 'meanScore',
              displayName: 'meanScore',
              type: 'number',
              canBeUsedToMatch: true,
            },
            {
              id: 'overallConsistency',
              displayName: 'overallConsistency',
              type: 'number',
              canBeUsedToMatch: true,
            },
            {
              id: 'stats',
              displayName: 'stats',
              type: 'string',
              canBeUsedToMatch: true,
            },
          ],
        },
        options: {},
      },
      id: 'persist-results',
      name: 'Persist Results',
      type: 'n8n-nodes-base.dataTable',
      typeVersion: 1.1,
      position: [2160, 0],
    },
    {
      parameters: {
        model: { __rl: true, mode: 'id', value: 'REPLACE_WITH_MODEL_ID' },
        options: {
          baseURL: 'http://127.0.0.1:8080/v1',
          timeout: 120_000,
          maxRetries: 0,
        },
      },
      id: 'judge-model',
      name: 'OpenAI Chat Model',
      type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
      typeVersion: 1.2,
      position: [960, 280],
      credentials: {
        openAiApi: {
          id: 'REPLACE_WITH_OPENAI_CREDENTIAL_ID',
          name: 'Local OpenAI-compatible endpoint',
        },
      },
    },
    {
      parameters: {},
      id: 'calculator',
      name: 'Calculator',
      type: '@n8n/n8n-nodes-langchain.toolCalculator',
      typeVersion: 1,
      position: [1080, 280],
    },
  ];

  return {
    name: 'DeepEval Consistency Example',
    nodes,
    connections: {
      'When clicking Execute Workflow': {
        main: [[{ node: 'Load Source Rows', type: 'main', index: 0 }]],
      },
      'Load Source Rows': {
        main: [[{ node: 'DeepEval Trigger', type: 'main', index: 0 }]],
      },
      'DeepEval Trigger': {
        main: [[{ node: 'Enrich Evaluation Data', type: 'main', index: 0 }]],
      },
      'Enrich Evaluation Data': {
        main: [
          [
            { node: 'AI Agent', type: 'main', index: 0 },
            { node: 'Prepare Metric Input', type: 'main', index: 0 },
          ],
        ],
      },
      'AI Agent': {
        main: [[{ node: 'Prepare Metric Input', type: 'main', index: 1 }]],
      },
      'Prepare Metric Input': {
        main: [[{ node: gEval.displayName, type: 'main', index: 0 }]],
      },
      [gEval.displayName]: {
        main: [[{ node: 'DeepEval Aggregate', type: 'main', index: 0 }]],
      },
      'DeepEval Aggregate': {
        main: [[{ node: 'DeepEval Consistency', type: 'main', index: 0 }]],
      },
      'DeepEval Consistency': {
        main: [[{ node: 'Persist Results', type: 'main', index: 0 }]],
      },
      Calculator: {
        ai_tool: [[{ node: 'AI Agent', type: 'ai_tool', index: 0 }]],
      },
      'OpenAI Chat Model': {
        ai_languageModel: [
          [
            { node: 'AI Agent', type: 'ai_languageModel', index: 0 },
            { node: gEval.displayName, type: 'ai_languageModel', index: 0 },
          ],
        ],
      },
    },
    settings: { executionOrder: 'v1' },
    active: false,
    pinData: {},
    tags: [],
  };
}

function aggregateWorkflow(): Record<string, unknown> {
  return {
    name: 'DeepEval Aggregate Example',
    nodes: [
      {
        parameters: {},
        id: 'manual-trigger',
        name: 'When clicking Execute Workflow',
        type: 'n8n-nodes-base.manualTrigger',
        typeVersion: 1,
        position: [0, 0],
      },
      {
        parameters: {
          mode: 'raw',
          jsonOutput:
            '{"metric":"DeepEval Example","score":1,"reason":"Example passed","success":true,"evalContext":{"runId":"example-run","runName":"Example"}}',
          options: {},
        },
        id: 'metric-result',
        name: 'Metric Result',
        type: 'n8n-nodes-base.set',
        typeVersion: 3.4,
        position: [240, 0],
      },
      {
        parameters: {
          dataTableId: 'REPLACE_WITH_RESULTS_DATA_TABLE_ID',
          passRule: 'allPass',
          writeMode: 'upsert',
          runIdColumn: 'runId',
          scoreColumn: 'overallScore',
          successColumn: 'overallSuccess',
          metricsColumn: 'metrics',
        },
        id: 'deepeval-aggregate',
        name: 'DeepEval Aggregate',
        type: 'n8n-nodes-deepeval.deepEvalAggregate',
        typeVersion: 1,
        position: [480, 0],
      },
      {
        parameters: {
          resource: 'row',
          operation: 'insert',
          dataTableId: {
            __rl: true,
            mode: 'id',
            value: 'REPLACE_WITH_RESULTS_DATA_TABLE_ID',
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
              {
                id: 'runId',
                displayName: 'runId',
                type: 'string',
                canBeUsedToMatch: true,
              },
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
              {
                id: 'metrics',
                displayName: 'metrics',
                type: 'string',
                canBeUsedToMatch: true,
              },
            ],
          },
          options: {},
        },
        id: 'persist-results',
        name: 'Persist Results',
        type: 'n8n-nodes-base.dataTable',
        typeVersion: 1.1,
        position: [720, 0],
      },
    ],
    connections: {
      'When clicking Execute Workflow': {
        main: [[{ node: 'Metric Result', type: 'main', index: 0 }]],
      },
      'Metric Result': {
        main: [[{ node: 'DeepEval Aggregate', type: 'main', index: 0 }]],
      },
      'DeepEval Aggregate': {
        main: [[{ node: 'Persist Results', type: 'main', index: 0 }]],
      },
    },
    settings: { executionOrder: 'v1' },
    active: false,
    pinData: {},
    tags: [],
  };
}

async function writeGeneratedFiles(): Promise<void> {
  await rm(resolve(sourceRoot, 'metrics'), { recursive: true, force: true });
  await rm(examplesRoot, { recursive: true, force: true });
  await rm(e2eRoot, { recursive: true, force: true });
  await mkdir(examplesRoot, { recursive: true });
  await mkdir(e2eRoot, { recursive: true });

  const nodePaths = [
    'dist/nodes/trigger/DeepEvalTrigger.node.js',
    'dist/nodes/aggregate/DeepEvalAggregate.node.js',
    'dist/nodes/consistency/DeepEvalConsistency.node.js',
  ];

  for (const definition of metricDefinitions) {
    const directory = resolve(sourceRoot, 'metrics', definition.className);
    await mkdir(directory, { recursive: true });
    await writeFile(
      resolve(directory, `${definition.className}.node.ts`),
      wrapperSource(definition),
    );
    await writeFile(resolve(directory, `${definition.className}.node.json`), codex(definition));
    await writeFile(
      resolve(examplesRoot, `${definition.id}.workflow.json`),
      `${JSON.stringify(metricWorkflow(definition), null, 2)}\n`,
    );
    await writeFile(
      resolve(e2eRoot, `${definition.id}.e2e.test.ts`),
      `import { runNodeWorkflow } from '../harness.js';

runNodeWorkflow('${definition.id}', '${definition.displayName}');
`,
    );
    nodePaths.push(`dist/nodes/metrics/${definition.className}/${definition.className}.node.js`);
  }

  await writeFile(
    resolve(examplesRoot, 'deepEvalTrigger.workflow.json'),
    `${JSON.stringify(triggerWorkflow(), null, 2)}\n`,
  );
  await writeFile(
    resolve(examplesRoot, 'deepEvalAggregate.workflow.json'),
    `${JSON.stringify(aggregateWorkflow(), null, 2)}\n`,
  );
  await writeFile(
    resolve(examplesRoot, 'deepEvalConsistency.workflow.json'),
    `${JSON.stringify(consistencyWorkflow(), null, 2)}\n`,
  );
  await writeFile(
    resolve(e2eRoot, 'deepEvalTrigger.e2e.test.ts'),
    `import { runNodeWorkflow } from '../harness.js';

runNodeWorkflow('deepEvalTrigger', 'DeepEval Trigger');
`,
  );
  await writeFile(
    resolve(e2eRoot, 'deepEvalAggregate.e2e.test.ts'),
    `import { runNodeWorkflow } from '../harness.js';

runNodeWorkflow('deepEvalAggregate', 'DeepEval Aggregate');
`,
  );
  await writeFile(
    resolve(e2eRoot, 'deepEvalConsistency.e2e.test.ts'),
    `import { runNodeWorkflow } from '../harness.js';

runNodeWorkflow('deepEvalConsistency', 'DeepEval Consistency');
`,
  );

  const kitchenSinks = [
    {
      id: 'kitchenSinkNonConversational',
      conversational: false,
      expectedMetricCount: metricDefinitions.filter((definition) => !definition.requiresMemory)
        .length,
    },
    {
      id: 'kitchenSinkConversational',
      conversational: true,
      expectedMetricCount: metricDefinitions.filter((definition) => definition.requiresMemory)
        .length,
    },
  ] as const;

  for (const kitchenSink of kitchenSinks) {
    await writeFile(
      resolve(examplesRoot, `${kitchenSink.id}.workflow.json`),
      `${JSON.stringify(kitchenSinkWorkflow(kitchenSink.conversational), null, 2)}\n`,
    );
    await writeFile(
      resolve(e2eRoot, `${kitchenSink.id}.e2e.test.ts`),
      `import { runKitchenSinkWorkflow } from '../harness.js';

runKitchenSinkWorkflow('${kitchenSink.id}', ${kitchenSink.expectedMetricCount});
`,
    );
  }

  const packagePath = resolve(nodesRoot, 'package.json');
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as Record<string, unknown>;
  const n8n = packageJson.n8n as Record<string, unknown>;
  n8n.nodes = nodePaths;
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

await writeGeneratedFiles();
