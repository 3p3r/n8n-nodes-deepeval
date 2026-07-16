import {
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeType,
  type INodeTypeDescription,
  NodeConnectionTypes,
  NodeOperationError,
} from 'n8n-workflow';

interface MetricResult {
  metric: string;
  score: number;
  reason: string | null;
  success: boolean;
}

function readMetric(item: INodeExecutionData): MetricResult {
  const { metric, score, reason, success } = item.json;
  if (typeof metric !== 'string' || typeof score !== 'number' || typeof success !== 'boolean') {
    throw new TypeError('Every Aggregate input must be a DeepEval metric result');
  }
  return {
    metric,
    score,
    reason: typeof reason === 'string' ? reason : null,
    success,
  };
}

function readRunId(
  item: INodeExecutionData,
  node: ReturnType<IExecuteFunctions['getNode']>,
): string {
  const evalContext = item.json.evalContext;
  if (!evalContext || typeof evalContext !== 'object' || Array.isArray(evalContext)) {
    throw new NodeOperationError(node, 'Every Aggregate input must include evalContext.runId');
  }
  const runId = (evalContext as Record<string, unknown>).runId;
  if (typeof runId !== 'string' || runId.length === 0) {
    throw new NodeOperationError(node, 'Every Aggregate input must include evalContext.runId');
  }
  return runId;
}

export class DeepEvalAggregate implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'DeepEval Aggregate',
    name: 'deepEvalAggregate',
    icon: 'fa:flask',
    group: ['transform'],
    version: 1,
    description: 'Aggregate metric results and persist them to an n8n Data Table',
    defaults: { name: 'DeepEval Aggregate' },
    codex: {
      categories: ['AI, LLM & Voice'],
      alias: ['DeepEval Benchmarking', 'evaluation aggregate', 'benchmark results'],
    },
    inputs: [{ type: NodeConnectionTypes.Main, displayName: 'Metric Results', required: true }],
    outputs: [{ type: NodeConnectionTypes.Main, displayName: 'Aggregate Result' }],
    properties: [
      {
        displayName: 'Data Table ID',
        name: 'dataTableId',
        type: 'string',
        required: true,
        default: '',
      },
      {
        displayName: 'Pass Rule',
        name: 'passRule',
        type: 'options',
        default: 'allPass',
        options: [
          { name: 'All Metrics Pass', value: 'allPass' },
          { name: 'Any Metric Passes', value: 'anyPass' },
          { name: 'Majority Passes', value: 'majorityPass' },
        ],
      },
      {
        displayName: 'Write Mode',
        name: 'writeMode',
        type: 'options',
        default: 'upsert',
        options: [
          { name: 'Append', value: 'append' },
          { name: 'Upsert by Run ID', value: 'upsert' },
        ],
      },
      {
        displayName: 'Run ID Column',
        name: 'runIdColumn',
        type: 'string',
        default: 'runId',
      },
      {
        displayName: 'Overall Score Column',
        name: 'scoreColumn',
        type: 'string',
        default: 'overallScore',
      },
      {
        displayName: 'Overall Success Column',
        name: 'successColumn',
        type: 'string',
        default: 'overallSuccess',
      },
      {
        displayName: 'Metrics JSON Column',
        name: 'metricsColumn',
        type: 'string',
        default: 'metrics',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    if (items.length === 0) {
      throw new NodeOperationError(this.getNode(), 'No metric results were connected');
    }

    const node = this.getNode();
    const passRule = this.getNodeParameter('passRule', 0) as string;
    const tableId = this.getNodeParameter('dataTableId', 0) as string;
    const runIdColumn = this.getNodeParameter('runIdColumn', 0) as string;
    const scoreColumn = this.getNodeParameter('scoreColumn', 0) as string;
    const successColumn = this.getNodeParameter('successColumn', 0) as string;
    const metricsColumn = this.getNodeParameter('metricsColumn', 0) as string;
    const writeMode = this.getNodeParameter('writeMode', 0) as string;

    const groups = new Map<string, { items: INodeExecutionData[]; metrics: MetricResult[] }>();
    for (const [itemIndex, item] of items.entries()) {
      const runId = readRunId(item, node);
      const metric = readMetric(item);
      const group = groups.get(runId) ?? { items: [], metrics: [] };
      group.items.push({ ...item, pairedItem: { item: itemIndex } });
      group.metrics.push(metric);
      groups.set(runId, group);
    }

    const output: INodeExecutionData[] = [];
    for (const [runId, group] of groups) {
      const metrics = group.metrics;
      const score = metrics.reduce((total, metric) => total + metric.score, 0) / metrics.length;
      const passing = metrics.filter((metric) => metric.success).length;
      const success =
        passRule === 'anyPass'
          ? passing > 0
          : passRule === 'majorityPass'
            ? passing > metrics.length / 2
            : passing === metrics.length;

      const evalContext = group.items.find((item) => item.json.evalContext)?.json.evalContext as
        | Record<string, unknown>
        | undefined;

      const persistenceRow = {
        [runIdColumn]: runId,
        [scoreColumn]: score,
        [successColumn]: success,
        [metricsColumn]: JSON.stringify(metrics),
      };

      output.push({
        json: {
          ...persistenceRow,
          metric: 'Aggregate',
          runId,
          score,
          success,
          metrics,
          sinkTableId: tableId,
          writeMode,
          evalContext,
        },
        pairedItem: group.items.map((item) => item.pairedItem).filter(Boolean) as Array<{
          item: number;
        }>,
      });
    }

    return [output];
  }
}
