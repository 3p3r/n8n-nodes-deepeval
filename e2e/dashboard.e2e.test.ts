import { describe, expect, inject, it } from 'vitest';
import type { DeepEvalE2EContext } from './global-setup.js';

interface N8nEnvelope<T> {
  data: T;
}

async function api<T>(
  context: DeepEvalE2EContext,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${context.baseUrl}${path}`, {
    ...init,
    headers: {
      Cookie: context.cookie,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const body = (await response.json()) as N8nEnvelope<T> | T;
  const unwrapped =
    body && typeof body === 'object' && 'data' in body
      ? (body as N8nEnvelope<T>).data
      : (body as T);
  return { status: response.status, body: unwrapped };
}

function aggregateReadyWorkflow(context: DeepEvalE2EContext) {
  const triggerType = context.nodeTypes['DeepEval Trigger'];
  const aggregateType = context.nodeTypes['DeepEval Aggregate'];
  const gEvalType = context.nodeTypes['DeepEval G-Eval'];
  if (!triggerType || !aggregateType || !gEvalType) {
    throw new Error('DeepEval node types missing from live n8n');
  }
  return {
    name: 'Dashboard ABC Fixture',
    nodes: [
      {
        id: 'manual',
        name: 'Manual',
        type: 'n8n-nodes-base.manualTrigger',
        typeVersion: 1,
        position: [0, 0],
        parameters: {},
      },
      {
        id: 'trigger',
        name: 'DeepEval Trigger',
        type: triggerType,
        typeVersion: 1,
        position: [220, 0],
        parameters: {
          dataTableId: context.sourceTableId,
          columnMapping: '{"input":"input","expectedOutput":"expectedOutput"}',
          runsPerRow: 1,
        },
      },
      {
        id: 'metric',
        name: 'DeepEval G-Eval',
        type: gEvalType,
        typeVersion: 1,
        position: [440, 0],
        parameters: { threshold: 0.5, cleanSession: false },
        credentials: {
          openAiApi: { id: context.credentialId, name: 'Local OpenAI-compatible endpoint' },
        },
      },
      {
        id: 'aggregate',
        name: 'DeepEval Aggregate',
        type: aggregateType,
        typeVersion: 1,
        position: [660, 0],
        parameters: {
          dataTableId: context.resultsTableId,
          passRule: 'allPass',
        },
      },
    ],
    connections: {},
    settings: {},
  };
}

describe('DeepEval dashboard hooks', () => {
  it('serves config and bridge.js', async () => {
    const context = inject('deepevalE2E');
    const config = await api<{ mode: string; appUrl: string; stylesheets: string[] }>(
      context,
      '/rest/deepeval-dashboard/config',
    );
    expect(config.status).toBe(200);
    expect(config.body.appUrl).toContain('/rest/deepeval-dashboard/app');
    expect(config.body.stylesheets.length).toBeGreaterThan(0);

    const bridge = await fetch(`${context.baseUrl}/rest/deepeval-dashboard/bridge.js`, {
      headers: { Cookie: context.cookie },
    });
    expect(bridge.ok).toBe(true);
    expect(bridge.headers.get('content-type') ?? '').toContain('javascript');
    const text = await bridge.text();
    expect(text).toContain('deepeval-dashboard');
  });

  it('returns 400 for incomplete workflows and full report after Aggregate fixture', async () => {
    const context = inject('deepevalE2E');

    const incomplete = await api<{ id: string }>(context, '/rest/workflows', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Dashboard Incomplete',
        nodes: [
          {
            id: 'manual',
            name: 'Manual',
            type: 'n8n-nodes-base.manualTrigger',
            typeVersion: 1,
            position: [0, 0],
            parameters: {},
          },
        ],
        connections: {},
        settings: {},
      }),
    });
    expect(incomplete.status).toBe(200);

    const badReport = await fetch(
      `${context.baseUrl}/rest/deepeval-dashboard/workflows/${incomplete.body.id}/report`,
      { headers: { Cookie: context.cookie } },
    );
    expect(badReport.status).toBe(400);
    const badBody = (await badReport.json()) as { code: string; missing: string[] };
    expect(badBody.code).toBe('INCOMPLETE_WORKFLOW');
    expect(badBody.missing.length).toBeGreaterThan(0);

    await api(context, `/rest/workflows/${incomplete.body.id}/archive`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    await api(context, `/rest/workflows/${incomplete.body.id}`, { method: 'DELETE' });

    await api(
      context,
      `/rest/projects/${context.projectId}/data-tables/${context.resultsTableId}/insert`,
      {
        method: 'POST',
        body: JSON.stringify({
          data: [
            {
              runId: 'dashboard-run-1',
              overallScore: 1,
              overallSuccess: true,
              metrics: JSON.stringify([
                { metric: 'DeepEval G-Eval', score: 1, success: true, reason: 'ok' },
              ]),
            },
          ],
          returnType: 'all',
        }),
      },
    );

    const created = await api<{ id: string }>(context, '/rest/workflows', {
      method: 'POST',
      body: JSON.stringify(aggregateReadyWorkflow(context)),
    });
    expect(created.status).toBe(200);

    try {
      const report = await api<{
        workflowId: string;
        overallScore: number | null;
        pillars: { taskValidity: { items: Array<{ id: string; status: string }> } };
        tables: { sourceRowCount: number; resultsRowCount: number };
      }>(context, `/rest/deepeval-dashboard/workflows/${created.body.id}/report`);
      expect(report.status).toBe(200);
      expect(report.body.workflowId).toBe(created.body.id);
      expect(report.body.tables.sourceRowCount).toBeGreaterThan(0);
      expect(report.body.tables.resultsRowCount).toBeGreaterThan(0);
      expect(report.body.pillars.taskValidity.items.some((item) => item.id === 'T.6')).toBe(true);

      const saved = await api<{
        pillars: { taskValidity: { items: Array<{ id: string; status: string; notes?: string }> } };
      }>(context, `/rest/deepeval-dashboard/workflows/${created.body.id}/questionnaire`, {
        method: 'PUT',
        body: JSON.stringify({ 'T.1': { status: 'pass', notes: 'versions pinned' } }),
      });
      expect(saved.status).toBe(200);
      const t1 = saved.body.pillars.taskValidity.items.find((item) => item.id === 'T.1');
      expect(t1?.status).toBe('pass');
      expect(t1?.notes).toBe('versions pinned');

      const pdf = await fetch(
        `${context.baseUrl}/rest/deepeval-dashboard/workflows/${created.body.id}/report.pdf`,
        { headers: { Cookie: context.cookie } },
      );
      expect(pdf.ok).toBe(true);
      const pdfBytes = Buffer.from(await pdf.arrayBuffer());
      expect(pdfBytes.subarray(0, 4).toString('utf8')).toBe('%PDF');

      const zip = await fetch(
        `${context.baseUrl}/rest/deepeval-dashboard/workflows/${created.body.id}/artifact.zip`,
        { headers: { Cookie: context.cookie } },
      );
      expect(zip.ok).toBe(true);
      const zipBytes = Buffer.from(await zip.arrayBuffer());
      expect(zipBytes[0]).toBe(0x50);
      expect(zipBytes[1]).toBe(0x4b);
    } finally {
      await api(context, `/rest/workflows/${created.body.id}/archive`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await api(context, `/rest/workflows/${created.body.id}`, { method: 'DELETE' });
    }
  });
});
