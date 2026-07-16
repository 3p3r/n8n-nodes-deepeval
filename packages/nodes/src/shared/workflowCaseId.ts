import { createHash } from 'node:crypto';
import type { IConnections, IExecuteFunctions, INode, INodeParameters } from 'n8n-workflow';

export interface WorkflowGraph {
  nodes: INode[];
  connections: IConnections;
}

const NODE_KEEP_FIELDS = ['name', 'type', 'typeVersion', 'disabled', 'parameters'] as const;

function sortObjectKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((element) => sortObjectKeys(element));
  }
  const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
  const sorted: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    sorted[key] = sortObjectKeys((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

function canonicalNode(node: INode): Record<string, unknown> {
  const canonical: Record<string, unknown> = {};
  for (const field of NODE_KEEP_FIELDS) {
    const value = node[field];
    if (value !== undefined) {
      canonical[field] = field === 'parameters' ? sortObjectKeys(value as INodeParameters) : value;
    }
  }
  return canonical;
}

export function canonicalizeWorkflowGraph(graph: WorkflowGraph): {
  nodes: Array<Record<string, unknown>>;
  connections: IConnections;
} {
  const nodes = [...graph.nodes]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((node) => canonicalNode(node));
  return {
    nodes,
    connections: sortObjectKeys(graph.connections) as IConnections,
  };
}

export function hashCanonicalWorkflow(graph: WorkflowGraph): string {
  const canonical = canonicalizeWorkflowGraph(graph);
  const serialized = JSON.stringify(canonical);
  return createHash('sha256').update(serialized).digest('hex');
}

export function getExecutingWorkflowGraph(executeFunctions: IExecuteFunctions): WorkflowGraph {
  const context = executeFunctions as IExecuteFunctions & {
    workflow: {
      nodes: Record<string, INode>;
      connectionsBySourceNode: IConnections;
    };
  };
  const { workflow } = context;
  if (!workflow?.nodes || !workflow.connectionsBySourceNode) {
    throw new Error('Executing workflow graph is not available');
  }
  return {
    nodes: Object.values(workflow.nodes),
    connections: workflow.connectionsBySourceNode,
  };
}
