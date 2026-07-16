import {
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeType,
  type INodeTypeDescription,
  NodeConnectionTypes,
  NodeOperationError,
} from 'n8n-workflow';
import {
  type AggregateRun,
  type ConsistencyBasis,
  computeCaseConsistency,
  type MetricResult,
} from '../../shared/consistency.js';

function readAggregateRun(item: INodeExecutionData): AggregateRun {
  const { score, success, metrics, evalContext } = item.json;
  if (typeof score !== 'number' || typeof success !== 'boolean' || !Array.isArray(metrics)) {
    throw new TypeError('Every Consistency input must be a DeepEval Aggregate result');
  }
  if (!evalContext || typeof evalContext !== 'object' || Array.isArray(evalContext)) {
    throw new TypeError('Every Consistency input must include evalContext');
  }

  const parsedMetrics = metrics.map((metric) => {
    if (!metric || typeof metric !== 'object' || Array.isArray(metric)) {
      throw new TypeError('Aggregate metrics must be objects');
    }
    const {
      metric: name,
      score: metricScore,
      reason,
      success: metricSuccess,
    } = metric as MetricResult;
    if (
      typeof name !== 'string' ||
      typeof metricScore !== 'number' ||
      typeof metricSuccess !== 'boolean'
    ) {
      throw new TypeError('Aggregate metrics must include metric, score, and success');
    }
    return {
      metric: name,
      score: metricScore,
      reason: typeof reason === 'string' ? reason : null,
      success: metricSuccess,
    };
  });

  return {
    score,
    success,
    metrics: parsedMetrics,
    evalContext: evalContext as Record<string, unknown>,
    json: item.json as Record<string, unknown>,
  };
}

function readGroupKey(
  evalContext: Record<string, unknown>,
  groupByField: string,
  node: ReturnType<IExecuteFunctions['getNode']>,
): string {
  const value = evalContext[groupByField];
  if (typeof value !== 'string' || value.length === 0) {
    throw new NodeOperationError(
      node,
      `evalContext.${groupByField} is required on every Aggregate result`,
    );
  }
  return value;
}

export class DeepEvalConsistency implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'DeepEval Consistency',
    name: 'deepEvalConsistency',
    icon: 'fa:flask',
    group: ['transform'],
    version: 1,
    description: 'Aggregate multi-run DeepEval results into per-case consistency statistics',
    defaults: { name: 'DeepEval Consistency' },
    codex: {
      categories: ['AI, LLM & Voice'],
      alias: ['DeepEval Benchmarking', 'evaluation consistency', 'benchmark stability'],
    },
    inputs: [{ type: NodeConnectionTypes.Main, displayName: 'Aggregate Results', required: true }],
    outputs: [{ type: NodeConnectionTypes.Main, displayName: 'Consistency Result' }],
    properties: [
      {
        displayName: 'Group By Field',
        name: 'groupByField',
        type: 'string',
        default: 'caseId',
        description: 'evalContext field used to group runs into a case',
      },
      {
        displayName: 'Label Field',
        name: 'labelField',
        type: 'string',
        default: '',
        description: 'Optional item path for categorical labels used by entropy and agreement',
      },
      {
        displayName: 'Consistency Basis',
        name: 'consistencyBasis',
        type: 'options',
        default: 'cv',
        options: [
          { name: 'Coefficient of Variation', value: 'cv' },
          { name: 'Label Entropy', value: 'entropy' },
          { name: 'Label Agreement', value: 'agreement' },
        ],
      },
      {
        displayName: 'Data Table ID',
        name: 'dataTableId',
        type: 'string',
        required: true,
        default: '',
      },
      {
        displayName: 'Write Mode',
        name: 'writeMode',
        type: 'options',
        default: 'upsert',
        options: [
          { name: 'Append', value: 'append' },
          { name: 'Upsert by Case ID', value: 'upsert' },
        ],
      },
      {
        displayName: 'Case ID Column',
        name: 'caseIdColumn',
        type: 'string',
        default: 'caseId',
      },
      {
        displayName: 'Mean Score Column',
        name: 'meanScoreColumn',
        type: 'string',
        default: 'meanScore',
      },
      {
        displayName: 'Consistency Column',
        name: 'consistencyColumn',
        type: 'string',
        default: 'overallConsistency',
      },
      {
        displayName: 'Stats JSON Column',
        name: 'statsColumn',
        type: 'string',
        default: 'stats',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    if (items.length === 0) {
      throw new NodeOperationError(this.getNode(), 'No aggregate results were connected');
    }

    const node = this.getNode();
    const groupByField = this.getNodeParameter('groupByField', 0) as string;
    const labelField = this.getNodeParameter('labelField', 0) as string;
    const consistencyBasis = this.getNodeParameter('consistencyBasis', 0) as ConsistencyBasis;
    const tableId = this.getNodeParameter('dataTableId', 0) as string;
    const writeMode = this.getNodeParameter('writeMode', 0) as string;
    const caseIdColumn = this.getNodeParameter('caseIdColumn', 0) as string;
    const meanScoreColumn = this.getNodeParameter('meanScoreColumn', 0) as string;
    const consistencyColumn = this.getNodeParameter('consistencyColumn', 0) as string;
    const statsColumn = this.getNodeParameter('statsColumn', 0) as string;

    const groups = new Map<string, { runs: AggregateRun[]; items: INodeExecutionData[] }>();
    for (const [itemIndex, item] of items.entries()) {
      const run = readAggregateRun(item);
      const groupKey = readGroupKey(run.evalContext, groupByField, node);
      const group = groups.get(groupKey) ?? { runs: [], items: [] };
      group.runs.push(run);
      group.items.push({ ...item, pairedItem: { item: itemIndex } });
      groups.set(groupKey, group);
    }

    const output: INodeExecutionData[] = [];
    for (const [, group] of groups) {
      const stats = computeCaseConsistency(group.runs, { labelField, consistencyBasis });
      const persistenceRow = {
        [caseIdColumn]: stats.caseId,
        [meanScoreColumn]: stats.meanScore,
        [consistencyColumn]: stats.overallConsistency,
        [statsColumn]: JSON.stringify({
          ...stats,
          labelDistribution: stats.labelDistribution
            ? Object.fromEntries(stats.labelDistribution)
            : undefined,
        }),
      };

      output.push({
        json: {
          ...persistenceRow,
          metric: 'Consistency',
          caseId: stats.caseId,
          runCount: stats.runCount,
          meanScore: stats.meanScore,
          overallConsistency: stats.overallConsistency,
          stats,
          sinkTableId: tableId,
          writeMode,
          evalContext: group.runs[0]?.evalContext,
        },
        pairedItem: group.items.map((item) => item.pairedItem).filter(Boolean) as Array<{
          item: number;
        }>,
      });
    }

    return [output];
  }
}
