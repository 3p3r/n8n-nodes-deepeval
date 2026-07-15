import type { DeepEvalE2EContext } from './n8n-session.js';

export interface WorkflowNode {
  name: string;
  type: string;
  parameters: Record<string, unknown>;
  credentials?: Record<string, { id: string; name: string }>;
}

export interface WorkflowDefinition {
  name: string;
  nodes: WorkflowNode[];
  connections: Record<string, unknown>;
  settings: Record<string, unknown>;
  pinData?: Record<string, unknown>;
  active?: boolean;
  tags?: unknown[];
  meta?: unknown;
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

export function prepareWorkflow(
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
