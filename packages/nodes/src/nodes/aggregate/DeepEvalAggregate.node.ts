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

    const metrics = items.map(readMetric);
    const score = metrics.reduce((total, metric) => total + metric.score, 0) / metrics.length;
    const passing = metrics.filter((metric) => metric.success).length;
    const passRule = this.getNodeParameter('passRule', 0) as string;
    const success =
      passRule === 'anyPass'
        ? passing > 0
        : passRule === 'majorityPass'
          ? passing > metrics.length / 2
          : passing === metrics.length;

    const evalContext = items.find((item) => item.json.evalContext)?.json.evalContext as
      | Record<string, unknown>
      | undefined;
    const runId =
      evalContext && typeof evalContext.runId === 'string'
        ? evalContext.runId
        : this.getExecutionId();

    const tableId = this.getNodeParameter('dataTableId', 0) as string;
    const runIdColumn = this.getNodeParameter('runIdColumn', 0) as string;
    const scoreColumn = this.getNodeParameter('scoreColumn', 0) as string;
    const successColumn = this.getNodeParameter('successColumn', 0) as string;
    const metricsColumn = this.getNodeParameter('metricsColumn', 0) as string;
    const writeMode = this.getNodeParameter('writeMode', 0) as string;
    const persistenceRow = {
      [runIdColumn]: runId,
      [scoreColumn]: score,
      [successColumn]: success,
      [metricsColumn]: JSON.stringify(metrics),
    };

    return [
      [
        {
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
          pairedItem: items.map((_, item) => ({ item })),
        },
      ],
    ];
  }
}
