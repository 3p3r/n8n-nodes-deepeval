import type { InspectErrorBody, InspectedWorkflow, WorkflowNodeLike } from '../shared/types';

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function nodeTypeName(type: string | undefined): string {
  if (!type) return '';
  const parts = type.split('.');
  return parts[parts.length - 1] ?? type;
}

function isDeepEvalMetricType(type: string | undefined): boolean {
  if (!type) return false;
  const name = nodeTypeName(type);
  return (
    name.startsWith('deepEval') &&
    name !== 'deepEvalTrigger' &&
    name !== 'deepEvalAggregate' &&
    name !== 'deepEvalConsistency'
  );
}

export class WorkflowInspectError extends Error {
  readonly body: InspectErrorBody;

  constructor(body: InspectErrorBody) {
    super(body.error);
    this.name = 'WorkflowInspectError';
    this.body = body;
  }
}

export function inspectWorkflowEntity(entity: Record<string, unknown>): InspectedWorkflow {
  const id = asString(entity.id);
  const name = asString(entity.name) ?? 'Untitled';
  if (!id) {
    throw new WorkflowInspectError({
      error: 'Workflow entity is missing an id',
      code: 'WORKFLOW_NOT_FOUND',
      missing: ['workflowId'],
    });
  }

  const nodes = Array.isArray(entity.nodes) ? (entity.nodes as WorkflowNodeLike[]) : [];
  const missing: string[] = [];

  const triggerNode = nodes.find((node) => nodeTypeName(node.type) === 'deepEvalTrigger');
  const aggregateNode = nodes.find((node) => nodeTypeName(node.type) === 'deepEvalAggregate');
  const consistencyNode = nodes.find((node) => nodeTypeName(node.type) === 'deepEvalConsistency');

  if (!triggerNode) missing.push('deepEvalTrigger');
  if (!aggregateNode) missing.push('deepEvalAggregate');

  const triggerTableId = asString(triggerNode?.parameters?.dataTableId);
  const aggregateTableId = asString(aggregateNode?.parameters?.dataTableId);
  if (!triggerTableId) missing.push('trigger.dataTableId');
  if (!aggregateTableId) missing.push('aggregate.dataTableId');

  const metrics = nodes
    .filter((node) => isDeepEvalMetricType(node.type))
    .map((node) => ({
      type: node.type ?? '',
      name: asString(node.name) ?? nodeTypeName(node.type),
      cleanSession: asBoolean(node.parameters?.cleanSession, false),
      threshold:
        typeof node.parameters?.threshold === 'number' ? node.parameters.threshold : undefined,
      hasCredentials: Boolean(node.credentials && Object.keys(node.credentials).length > 0),
    }));

  if (metrics.length === 0) missing.push('metricNodes');

  if (missing.length > 0) {
    throw new WorkflowInspectError({
      error: `Workflow is not Aggregate-ready: missing ${missing.join(', ')}`,
      code: 'INCOMPLETE_WORKFLOW',
      missing,
    });
  }

  let projectId = '';
  const shared = entity.shared;
  if (Array.isArray(shared) && shared[0] && typeof shared[0] === 'object') {
    projectId = asString((shared[0] as Record<string, unknown>).projectId) ?? '';
  }
  if (!projectId) {
    projectId = asString(entity.projectId) ?? '';
  }

  const consistencyTableId = asString(consistencyNode?.parameters?.dataTableId);

  return {
    id,
    name,
    projectId,
    trigger: {
      dataTableId: triggerTableId as string,
      runsPerRow: asNumber(triggerNode?.parameters?.runsPerRow, 1),
      runName: asString(triggerNode?.parameters?.runName) ?? 'DeepEval Benchmark',
    },
    aggregate: {
      dataTableId: aggregateTableId as string,
      passRule: asString(aggregateNode?.parameters?.passRule) ?? 'allPass',
    },
    ...(consistencyTableId ? { consistency: { dataTableId: consistencyTableId } } : {}),
    metrics,
    nodes,
  };
}
