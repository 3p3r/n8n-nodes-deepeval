import type { Request } from 'express';
import type { InspectedWorkflow } from '../shared/types';
import { WorkflowInspectError } from './workflow-inspect';

interface ApiEnvelope<T> {
  data?: T;
}

async function apiJson<T>(req: Request, path: string): Promise<T> {
  const origin = `${req.protocol}://${req.get('host')}`;
  const cookie = req.headers.cookie ?? '';
  const response = await fetch(`${origin}${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
  if (!response.ok) {
    throw new WorkflowInspectError({
      error: `n8n API ${path} failed (${response.status})`,
      code: 'BAD_REQUEST',
      missing: [path],
    });
  }
  const body = (await response.json()) as ApiEnvelope<T> | T;
  if (body && typeof body === 'object' && 'data' in body) {
    return (body as ApiEnvelope<T>).data as T;
  }
  return body as T;
}

export async function resolveProjectId(
  req: Request,
  entity: Record<string, unknown>,
  workflowId: string,
): Promise<string> {
  const shared = entity.shared;
  if (Array.isArray(shared) && shared[0] && typeof shared[0] === 'object') {
    const projectId = (shared[0] as Record<string, unknown>).projectId;
    if (typeof projectId === 'string' && projectId.length > 0) return projectId;
  }
  if (typeof entity.projectId === 'string' && entity.projectId.length > 0) {
    return entity.projectId;
  }

  const workflow = await apiJson<{
    homeProject?: { id?: string };
    shared?: Array<{ projectId?: string }>;
  }>(req, `/rest/workflows/${workflowId}`);
  const fromHome = workflow.homeProject?.id;
  if (fromHome) return fromHome;
  const fromShared = workflow.shared?.find((entry) => entry.projectId)?.projectId;
  if (fromShared) return fromShared;

  const projects = await apiJson<Array<{ id: string; type: string }>>(req, '/rest/projects');
  const personal = projects.find((project) => project.type === 'personal');
  if (personal) return personal.id;

  throw new WorkflowInspectError({
    error: 'Could not resolve projectId for workflow Data Tables',
    code: 'INCOMPLETE_WORKFLOW',
    missing: ['projectId'],
  });
}

export async function fetchDataTableRows(
  req: Request,
  projectId: string,
  tableId: string,
): Promise<Record<string, unknown>[]> {
  const body = await apiJson<{ data?: Record<string, unknown>[] } | Record<string, unknown>[]>(
    req,
    `/rest/projects/${projectId}/data-tables/${tableId}/rows?take=1000`,
  );

  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object' && Array.isArray(body.data)) return body.data;
  return [];
}

export async function loadReportTables(
  req: Request,
  inspected: InspectedWorkflow,
): Promise<{
  sourceRows: Record<string, unknown>[];
  aggregateRows: Record<string, unknown>[];
  consistencyRows: Record<string, unknown>[];
}> {
  const sourceRows = await fetchDataTableRows(
    req,
    inspected.projectId,
    inspected.trigger.dataTableId,
  );
  const aggregateRows = await fetchDataTableRows(
    req,
    inspected.projectId,
    inspected.aggregate.dataTableId,
  );
  const consistencyRows = inspected.consistency
    ? await fetchDataTableRows(req, inspected.projectId, inspected.consistency.dataTableId)
    : [];
  return { sourceRows, aggregateRows, consistencyRows };
}
