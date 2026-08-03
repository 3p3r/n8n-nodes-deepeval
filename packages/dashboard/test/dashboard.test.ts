import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildArtifactZip, buildReportPdf } from '../src/backend/artifacts';
import { loadQuestionnaire, saveQuestionnaire } from '../src/backend/questionnaire';
import { buildAbcReport, summarizeAggregateRows } from '../src/backend/report';
import { inspectWorkflowEntity, WorkflowInspectError } from '../src/backend/workflow-inspect';
import type { InspectedWorkflow } from '../src/shared/types';

function sampleInspected(overrides: Partial<InspectedWorkflow> = {}): InspectedWorkflow {
  return {
    id: 'wf-1',
    name: 'Sample',
    projectId: 'proj-1',
    trigger: {
      dataTableId: 'src-1',
      runsPerRow: 2,
      runName: 'run',
    },
    aggregate: {
      dataTableId: 'res-1',
      passRule: 'allPass',
    },
    consistency: { dataTableId: 'con-1' },
    metrics: [
      {
        type: 'n8n-nodes-deepeval.deepEvalTaskCompletion',
        name: 'Task Completion',
        cleanSession: true,
        threshold: 0.5,
        hasCredentials: true,
      },
      {
        type: 'n8n-nodes-deepeval.deepEvalBias',
        name: 'Bias',
        cleanSession: true,
        threshold: 0.5,
        hasCredentials: true,
      },
    ],
    nodes: [],
    ...overrides,
  };
}

describe('workflow-inspect', () => {
  it('extracts Trigger and Aggregate table ids', () => {
    const inspected = inspectWorkflowEntity({
      id: 'abc',
      name: 'Eval',
      projectId: 'p1',
      nodes: [
        {
          type: 'n8n-nodes-deepeval.deepEvalTrigger',
          parameters: { dataTableId: 'source', runsPerRow: 1 },
        },
        {
          type: 'n8n-nodes-deepeval.deepEvalGEval',
          name: 'G-Eval',
          parameters: { threshold: 0.7, cleanSession: false },
          credentials: { openAiApi: { id: 'c1' } },
        },
        {
          type: 'n8n-nodes-deepeval.deepEvalAggregate',
          parameters: { dataTableId: 'results', passRule: 'majorityPass' },
        },
      ],
    });
    expect(inspected.trigger.dataTableId).toBe('source');
    expect(inspected.aggregate.dataTableId).toBe('results');
    expect(inspected.metrics).toHaveLength(1);
  });

  it('throws structured error when Aggregate is missing', () => {
    expect(() =>
      inspectWorkflowEntity({
        id: 'abc',
        name: 'Eval',
        nodes: [
          {
            type: 'n8n-nodes-deepeval.deepEvalTrigger',
            parameters: { dataTableId: 'source' },
          },
        ],
      }),
    ).toThrow(WorkflowInspectError);
  });
});

describe('report', () => {
  it('summarizes aggregate metric JSON rows', () => {
    const { metrics, topFailures } = summarizeAggregateRows([
      {
        runId: 'r1',
        metrics: JSON.stringify([
          { metric: 'Bias', score: 0.9, success: true, reason: null },
          { metric: 'Toxicity', score: 0.2, success: false, reason: 'bad' },
        ]),
      },
    ]);
    expect(metrics.find((m) => m.name === 'Toxicity')?.failCount).toBe(1);
    expect(topFailures[0]?.metric).toBe('Toxicity');
  });

  it('merges questionnaire answers into manual items', () => {
    const report = buildAbcReport({
      inspected: sampleInspected(),
      sourceRows: [{ id: 1, input: 'x' }],
      aggregateRows: [
        {
          runId: 'r1',
          metrics: JSON.stringify([{ metric: 'Bias', score: 1, success: true, reason: null }]),
        },
      ],
      consistencyRows: [{ caseId: 'c1', stats: JSON.stringify({ Bias: { std: 0.1 } }) }],
      answers: { 'T.1': { status: 'pass', notes: 'pinned' } },
    });
    const t1 = report.pillars.taskValidity.items.find((item) => item.id === 'T.1');
    expect(t1?.status).toBe('pass');
    expect(t1?.notes).toBe('pinned');
    expect(report.pillars.taskValidity.items.find((item) => item.id === 'T.6')?.source).toBe(
      'auto',
    );
    expect(typeof report.overallScore).toBe('number');
  });
});

describe('questionnaire + artifacts', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    delete process.env.N8N_USER_FOLDER;
  });

  it('persists questionnaire answers under N8N_USER_FOLDER', () => {
    const dir = mkdtempSync(join(tmpdir(), 'deepeval-q-'));
    dirs.push(dir);
    process.env.N8N_USER_FOLDER = dir;
    saveQuestionnaire('wf-9', { 'R.5': { status: 'partial', notes: 'draft' } });
    expect(loadQuestionnaire('wf-9')['R.5']?.status).toBe('partial');
    const raw = readFileSync(join(dir, 'deepeval-dashboard', 'questionnaire', 'wf-9.json'), 'utf8');
    expect(raw).toContain('R.5');
  });

  it('builds pdf and zip with expected members', async () => {
    const report = buildAbcReport({
      inspected: sampleInspected(),
      sourceRows: [{ id: 1, input: 'hello' }],
      aggregateRows: [
        {
          runId: 'r1',
          overallScore: 1,
          metrics: JSON.stringify([{ metric: 'Bias', score: 1, success: true, reason: null }]),
        },
      ],
      answers: {},
    });
    const pdf = await buildReportPdf(report);
    expect(pdf.subarray(0, 4).toString('utf8')).toBe('%PDF');
    const zip = await buildArtifactZip({
      report,
      sourceRows: [{ id: 1, input: 'hello' }],
      aggregateRows: [{ runId: 'r1' }],
      pdf,
    });
    expect(zip.length).toBeGreaterThan(100);
    // PK zip magic
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
  });
});
