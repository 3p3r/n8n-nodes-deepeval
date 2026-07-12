import {
  createJudgeCallback,
  type DeepEvalTestCase,
  type DeepEvalToolCall,
  evaluateDeepEval,
  intermediateStepsToTrace,
  memoryToTurns,
} from '@n8n-deepeval/runtime';
import {
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeInputConfiguration,
  type INodeType,
  type INodeTypeDescription,
  NodeConnectionTypes,
  NodeOperationError,
} from 'n8n-workflow';
import type { MetricDefinition } from './metric-definitions.js';

const TEST_CASE_PARAMETERS = new Set(['chatbotRole', 'expectedOutcome']);

function snakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!(trimmed.startsWith('[') || trimmed.startsWith('{'))) return value;
  return JSON.parse(trimmed);
}

function omitEmpty(value: unknown): boolean {
  return value === '' || (Array.isArray(value) && value.length === 0);
}

function asStringList(value: unknown, field: string): string[] {
  if (value == null) throw new TypeError(`Input field "${field}" is required`);
  const parsed = parseJsonValue(value);
  if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
    return parsed;
  }
  if (typeof parsed === 'string') return [parsed];
  throw new TypeError(`Input field "${field}" must be a string or string array`);
}

function asTools(value: unknown, field: string): DeepEvalToolCall[] {
  if (value == null) throw new TypeError(`Input field "${field}" is required`);
  const parsed = parseJsonValue(value);
  if (!Array.isArray(parsed)) throw new TypeError(`Input field "${field}" must be an array`);
  return parsed.map((item) => {
    if (!item || typeof item !== 'object' || typeof Reflect.get(item, 'name') !== 'string') {
      throw new TypeError(`Every ${field} entry must contain a tool name`);
    }
    return item as DeepEvalToolCall;
  });
}

function fieldValue(json: Record<string, unknown>, field: string): unknown {
  if (field === 'actualOutput') return json.actualOutput ?? json.output;
  return json[field];
}

function validateRequiredFields(definition: MetricDefinition, json: Record<string, unknown>): void {
  for (const field of definition.requiredFields) {
    const value = fieldValue(json, field);
    if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) {
      throw new TypeError(`DeepEval ${definition.displayName} requires input field "${field}"`);
    }
  }
}

function metricConfig(
  context: IExecuteFunctions,
  definition: MetricDefinition,
  itemIndex: number,
): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const property of definition.properties) {
    if (TEST_CASE_PARAMETERS.has(property.name)) continue;
    const value = parseJsonValue(context.getNodeParameter(property.name, itemIndex));
    if (omitEmpty(value)) continue;
    config[snakeCase(property.name)] = value;
  }
  return config;
}

async function buildTestCase(
  context: IExecuteFunctions,
  definition: MetricDefinition,
  json: Record<string, unknown>,
  itemIndex: number,
): Promise<DeepEvalTestCase> {
  validateRequiredFields(definition, json);

  const input = typeof json.input === 'string' ? json.input : '';
  const actualOutputValue = json.actualOutput ?? json.output;
  const actualOutput = typeof actualOutputValue === 'string' ? actualOutputValue : undefined;
  const testCase: DeepEvalTestCase = {
    input,
    ...(actualOutput === undefined ? {} : { actualOutput }),
    ...(typeof json.expectedOutput === 'string' ? { expectedOutput: json.expectedOutput } : {}),
    ...(json.context == null ? {} : { context: asStringList(json.context, 'context') }),
    ...(json.retrievalContext == null
      ? {}
      : { retrievalContext: asStringList(json.retrievalContext, 'retrievalContext') }),
    ...(json.expectedTools == null
      ? {}
      : { expectedTools: asTools(json.expectedTools, 'expectedTools') }),
    ...(json.metadata && typeof json.metadata === 'object'
      ? { metadata: json.metadata as Record<string, unknown> }
      : {}),
  };

  const rawSteps = json.intermediateSteps;
  if (Array.isArray(rawSteps) && rawSteps.length > 0) {
    const synthetic = intermediateStepsToTrace(input, actualOutput ?? '', rawSteps);
    testCase.toolsCalled = synthetic.toolsCalled;
    testCase.trace = synthetic.trace;
  } else if (definition.requiresTrace) {
    throw new TypeError(
      'This metric requires intermediateSteps. Enable Return Intermediate Steps on AI Agent.',
    );
  }

  if (definition.requiresMemory) {
    const memory = await context.getInputConnectionData(NodeConnectionTypes.AiMemory, itemIndex);
    const turns = await memoryToTurns(memory);
    if (testCase.toolsCalled) {
      const assistantTurn = [...turns].reverse().find((turn) => turn.role === 'assistant');
      if (assistantTurn) assistantTurn.toolsCalled = testCase.toolsCalled;
    }
    testCase.turns = turns;

    const chatbotRole =
      json.chatbotRole ??
      (definition.properties.some((property) => property.name === 'chatbotRole')
        ? context.getNodeParameter('chatbotRole', itemIndex)
        : undefined);
    if (typeof chatbotRole === 'string' && chatbotRole) testCase.chatbotRole = chatbotRole;

    const expectedOutcome =
      json.expectedOutcome ??
      (definition.properties.some((property) => property.name === 'expectedOutcome')
        ? context.getNodeParameter('expectedOutcome', itemIndex)
        : undefined);
    if (typeof expectedOutcome === 'string' && expectedOutcome) {
      testCase.expectedOutcome = expectedOutcome;
    }
  }

  return testCase;
}

function nodeInputs(definition: MetricDefinition): INodeInputConfiguration[] {
  return [
    { type: NodeConnectionTypes.Main, displayName: 'Input', required: true },
    ...(definition.requiresModel
      ? [
          {
            type: NodeConnectionTypes.AiLanguageModel,
            displayName: 'Judge Language Model',
            required: true,
            maxConnections: 1,
          } satisfies INodeInputConfiguration,
        ]
      : []),
    ...(definition.requiresMemory
      ? [
          {
            type: NodeConnectionTypes.AiMemory,
            displayName: 'Conversation Memory',
            required: true,
            maxConnections: 1,
          } satisfies INodeInputConfiguration,
        ]
      : []),
  ];
}

export function createMetricNode(definition: MetricDefinition): new () => INodeType {
  return class DeepEvalMetricNode implements INodeType {
    description: INodeTypeDescription = {
      displayName: definition.displayName,
      name: definition.className.charAt(0).toLowerCase() + definition.className.slice(1),
      icon: 'fa:flask',
      group: ['transform'],
      version: 1,
      description: definition.description,
      defaults: {
        name: definition.displayName,
      },
      codex: {
        categories: ['AI, LLM & Voice'],
        alias: ['DeepEval Benchmarking', 'evaluation', 'benchmark', definition.displayName],
      },
      inputs: nodeInputs(definition),
      outputs: [{ type: NodeConnectionTypes.Main, displayName: 'Result' }],
      properties: definition.properties,
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
      const items = this.getInputData();
      const output: INodeExecutionData[] = [];

      for (const [itemIndex, item] of items.entries()) {
        try {
          const json = item.json as Record<string, unknown>;
          const testCase = await buildTestCase(this, definition, json, itemIndex);
          const model = definition.requiresModel
            ? await this.getInputConnectionData(NodeConnectionTypes.AiLanguageModel, itemIndex)
            : undefined;
          const result = await evaluateDeepEval(
            {
              metricId: definition.id,
              pythonClass: definition.pythonClass,
              pythonImport: definition.pythonImport,
              config: metricConfig(this, definition, itemIndex),
              testCase,
              lowerIsBetter: definition.lowerIsBetter,
              requiresModel: definition.requiresModel,
            },
            model === undefined ? undefined : createJudgeCallback(model),
          );

          output.push({
            json: {
              ...json,
              metric: definition.displayName,
              score: result.score,
              reason: result.reason,
              success: result.success,
              ...(json.evalContext == null ? {} : { evalContext: json.evalContext }),
            },
            pairedItem: { item: itemIndex },
          });
        } catch (error) {
          if (this.continueOnFail()) {
            output.push({
              json: {
                ...item.json,
                error: error instanceof Error ? error.message : String(error),
                success: false,
              },
              pairedItem: { item: itemIndex },
            });
            continue;
          }
          throw new NodeOperationError(
            this.getNode(),
            error instanceof Error ? error : new Error(String(error)),
            { itemIndex },
          );
        }
      }

      return [output];
    }
  };
}
