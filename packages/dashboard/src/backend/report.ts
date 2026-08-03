import { ABC_CHECKLIST, PILLAR_TITLES } from '../shared/checklist';
import {
  type AbcChecklistItem,
  type AbcPillar,
  type AbcPillarId,
  type AbcReport,
  AGENTIC_METRIC_TYPE_FRAGMENTS,
  DEEPEVAL_VERSION,
  type FailureRow,
  type InspectedWorkflow,
  type MetricSummary,
  type QuestionnaireAnswers,
} from '../shared/types';

function statusScore(status: AbcChecklistItem['status']): number | undefined {
  if (status === 'pass') return 1;
  if (status === 'partial') return 0.5;
  if (status === 'fail') return 0;
  return undefined;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function parseMetricsJson(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>;
  if (typeof raw !== 'string' || raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];
  } catch {
    return [];
  }
}

export function summarizeAggregateRows(rows: Record<string, unknown>[]): {
  metrics: MetricSummary[];
  topFailures: FailureRow[];
} {
  const byMetric = new Map<string, { scores: number[]; fails: number }>();
  const failures: FailureRow[] = [];

  for (const row of rows) {
    const runId = typeof row.runId === 'string' ? row.runId : String(row.runId ?? '');
    const metrics = parseMetricsJson(row.metrics);
    for (const metric of metrics) {
      const name = typeof metric.metric === 'string' ? metric.metric : 'unknown';
      const score = typeof metric.score === 'number' ? metric.score : Number.NaN;
      const success = metric.success === true;
      const reason = typeof metric.reason === 'string' ? metric.reason : null;
      const entry = byMetric.get(name) ?? { scores: [], fails: 0 };
      if (Number.isFinite(score)) entry.scores.push(score);
      if (!success) {
        entry.fails += 1;
        failures.push({ runId, metric: name, score: Number.isFinite(score) ? score : 0, reason });
      }
      byMetric.set(name, entry);
    }
  }

  const metrics: MetricSummary[] = [...byMetric.entries()].map(([name, entry]) => ({
    name,
    meanScore: mean(entry.scores) ?? 0,
    passRate:
      entry.scores.length === 0 ? 0 : (entry.scores.length - entry.fails) / entry.scores.length,
    failCount: entry.fails,
  }));

  failures.sort((a, b) => a.score - b.score);
  return { metrics, topFailures: failures.slice(0, 25) };
}

function autoItems(
  inspected: InspectedWorkflow,
  aggregateRows: Record<string, unknown>[],
  consistencyRows: Record<string, unknown>[],
): Map<string, AbcChecklistItem> {
  const result = new Map<string, AbcChecklistItem>();
  const cleanSessionCount = inspected.metrics.filter((metric) => metric.cleanSession).length;
  const cleanRatio =
    inspected.metrics.length === 0 ? 0 : cleanSessionCount / inspected.metrics.length;
  const judgeCreds = inspected.metrics.some((metric) => metric.hasCredentials);
  const agentic = inspected.metrics.some((metric) =>
    AGENTIC_METRIC_TYPE_FRAGMENTS.some((fragment) => metric.type.includes(fragment)),
  );
  const hasThresholds = inspected.metrics.some((metric) => typeof metric.threshold === 'number');
  const multiRun = inspected.trigger.runsPerRow > 1;
  const hasConsistencyStats = consistencyRows.some((row) => {
    const stats = row.stats;
    return typeof stats === 'string' ? stats.length > 2 : Boolean(stats);
  });

  const put = (
    id: string,
    status: AbcChecklistItem['status'],
    evidence: string,
    score?: number,
  ): void => {
    const def = ABC_CHECKLIST.find((item) => item.id === id);
    if (!def || def.requiresManual) return;
    result.set(id, {
      id: def.id,
      pillar: def.pillar,
      title: def.title,
      description: def.description,
      status,
      source: 'auto',
      evidence,
      ...(score !== undefined ? { score } : { score: statusScore(status) }),
    });
  };

  if (cleanRatio >= 1) {
    put('T.4', 'pass', `All ${inspected.metrics.length} metrics enable Clean Session.`);
  } else if (cleanRatio > 0) {
    put(
      'T.4',
      'partial',
      `${cleanSessionCount}/${inspected.metrics.length} metrics enable Clean Session.`,
    );
  } else {
    put(
      'T.4',
      'fail',
      'No metric enables Clean Session; pool slot reset still runs after each eval.',
    );
  }

  put(
    'T.6',
    'pass',
    `DeepEval ${DEEPEVAL_VERSION} is pinned; Trigger stamps workflowHash into evalContext.`,
  );

  if (judgeCreds && multiRun && hasConsistencyStats) {
    put(
      'O.c.1',
      'pass',
      `Judge credentials present; runsPerRow=${inspected.trigger.runsPerRow} with Consistency stats.`,
    );
  } else if (judgeCreds && multiRun) {
    put(
      'O.c.1',
      'partial',
      `Judge credentials present and runsPerRow=${inspected.trigger.runsPerRow}; add Consistency node for stats.`,
    );
  } else if (judgeCreds) {
    put(
      'O.c.1',
      'partial',
      'Judge credentials present; increase runsPerRow and add Consistency for self-consistency checks.',
    );
  } else {
    put('O.c.1', 'fail', 'No LLM-judge credentials detected on metric nodes.');
  }

  if (agentic && inspected.metrics.length > 1) {
    put(
      'O.i.1',
      'pass',
      'Workflow includes process-based agentic metrics alongside other DeepEval metrics.',
    );
  } else if (agentic) {
    put('O.i.1', 'partial', 'Agentic metrics present; broaden outcome/process coverage.');
  } else {
    put('O.i.1', 'fail', 'No process-based agentic metrics detected on the canvas.');
  }

  put(
    'R.1',
    aggregateRows.length >= 0 && inspected.trigger.dataTableId ? 'pass' : 'fail',
    `Source Data Table ${inspected.trigger.dataTableId} is attached to DeepEval Trigger.`,
  );

  put(
    'R.2',
    'pass',
    `Aggregate sink Data Table ${inspected.aggregate.dataTableId} with passRule=${inspected.aggregate.passRule}.`,
  );

  if (multiRun && hasConsistencyStats) {
    put('R.10', 'pass', 'Consistency rows include per-metric stats for multi-run analysis.');
  } else if (multiRun) {
    put('R.10', 'partial', 'runsPerRow > 1 but Consistency stats are missing.');
  } else {
    put('R.10', 'fail', 'runsPerRow is 1; multi-run statistical reporting is unavailable.');
  }

  if (hasThresholds) {
    put(
      'R.11',
      'pass',
      `Aggregate passRule=${inspected.aggregate.passRule}; metric thresholds are configured.`,
    );
  } else {
    put(
      'R.11',
      'partial',
      `Aggregate passRule=${inspected.aggregate.passRule}; metric thresholds not detected.`,
    );
  }

  return result;
}

function buildPillar(pillar: AbcPillarId, items: AbcChecklistItem[]): AbcPillar {
  const scored = items
    .map((item) => item.score)
    .filter((score): score is number => typeof score === 'number');
  const pillarScore = mean(scored);
  return {
    id: pillar,
    title: PILLAR_TITLES[pillar],
    score: pillarScore === null ? null : pillarScore * 100,
    items,
  };
}

export function buildAbcReport(input: {
  inspected: InspectedWorkflow;
  sourceRows: Record<string, unknown>[];
  aggregateRows: Record<string, unknown>[];
  consistencyRows?: Record<string, unknown>[];
  answers: QuestionnaireAnswers;
}): AbcReport {
  const consistencyRows = input.consistencyRows ?? [];
  const { metrics, topFailures } = summarizeAggregateRows(input.aggregateRows);
  const auto = autoItems(input.inspected, input.aggregateRows, consistencyRows);

  const items: AbcChecklistItem[] = ABC_CHECKLIST.map((def) => {
    const autoItem = auto.get(def.id);
    if (autoItem) return autoItem;

    const answer = input.answers[def.id];
    if (answer) {
      const score = statusScore(answer.status);
      return {
        id: def.id,
        pillar: def.pillar,
        title: def.title,
        description: def.description,
        status: answer.status,
        source: 'manual',
        evidence: 'Manual questionnaire response.',
        ...(score !== undefined ? { score } : {}),
        ...(answer.notes ? { notes: answer.notes } : {}),
      };
    }

    return {
      id: def.id,
      pillar: def.pillar,
      title: def.title,
      description: def.description,
      status: def.requiresManual ? 'unanswered' : 'manual',
      source: 'manual',
      evidence: def.requiresManual
        ? 'Awaiting manual questionnaire response.'
        : 'No automatic evidence available.',
    };
  });

  const byPillar = (pillar: AbcPillarId) => items.filter((item) => item.pillar === pillar);
  const taskValidity = buildPillar('taskValidity', byPillar('taskValidity'));
  const outcomeValidity = buildPillar('outcomeValidity', byPillar('outcomeValidity'));
  const benchmarkReporting = buildPillar('benchmarkReporting', byPillar('benchmarkReporting'));

  const overall = mean(
    items.map((item) => item.score).filter((score): score is number => typeof score === 'number'),
  );

  return {
    workflowId: input.inspected.id,
    workflowName: input.inspected.name,
    generatedAt: new Date().toISOString(),
    pillars: { taskValidity, outcomeValidity, benchmarkReporting },
    overallScore: overall === null ? null : overall * 100,
    deepeval: {
      metrics,
      aggregateRows: input.aggregateRows,
      ...(consistencyRows.length > 0 ? { consistencyRows } : {}),
      topFailures,
    },
    tables: {
      sourceTableId: input.inspected.trigger.dataTableId,
      resultsTableId: input.inspected.aggregate.dataTableId,
      sourceRowCount: input.sourceRows.length,
      resultsRowCount: input.aggregateRows.length,
      ...(input.inspected.consistency
        ? { consistencyTableId: input.inspected.consistency.dataTableId }
        : {}),
    },
    setup: { complete: true, missing: [] },
  };
}
