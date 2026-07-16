import {
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeType,
  type INodeTypeDescription,
  NodeConnectionTypes,
  NodeOperationError,
} from 'n8n-workflow';
import { getExecutingWorkflowGraph, hashCanonicalWorkflow } from '../../shared/workflowCaseId.js';

function parseObject(value: unknown, label: string): Record<string, unknown> {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError(`${label} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

export class DeepEvalTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'DeepEval Trigger',
    name: 'deepEvalTrigger',
    icon: 'fa:flask',
    group: ['transform'],
    version: 1,
    description: 'Read evaluation cases from an n8n Data Table',
    defaults: { name: 'DeepEval Trigger' },
    codex: {
      categories: ['AI, LLM & Voice'],
      alias: ['DeepEval Benchmarking', 'evaluation dataset', 'benchmark trigger'],
    },
    inputs: [{ type: NodeConnectionTypes.Main, displayName: 'Start', required: true }],
    outputs: [{ type: NodeConnectionTypes.Main, displayName: 'Test Cases' }],
    properties: [
      {
        displayName: 'Run Name',
        name: 'runName',
        type: 'string',
        required: true,
        default: 'DeepEval Benchmark',
      },
      {
        displayName: 'Data Table ID',
        name: 'dataTableId',
        type: 'string',
        required: true,
        default: '',
      },
      {
        displayName: 'Column Mapping',
        name: 'columnMapping',
        type: 'json',
        required: true,
        default: '{"input":"input","expectedOutput":"expectedOutput"}',
        description: 'Map DeepEval field names to Data Table column names',
      },
      {
        displayName: 'Filters',
        name: 'filters',
        type: 'json',
        default: '{}',
        description: 'Optional equality filters keyed by Data Table column name',
      },
      {
        displayName: 'Runs Per Row',
        name: 'runsPerRow',
        type: 'number',
        default: 1,
        typeOptions: { minValue: 1 },
        description: 'Emit this many runs per source row for consistency scoring',
      },
      {
        displayName: 'Limit Rows',
        name: 'limitRows',
        type: 'boolean',
        default: false,
      },
      {
        displayName: 'Maximum Rows',
        name: 'maxRows',
        type: 'number',
        default: 100,
        typeOptions: { minValue: 1 },
        displayOptions: { show: { limitRows: [true] } },
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const tableId = this.getNodeParameter('dataTableId', 0) as string;
    const runName = this.getNodeParameter('runName', 0) as string;
    const columnMapping = parseObject(this.getNodeParameter('columnMapping', 0), 'Column Mapping');
    const filters = parseObject(this.getNodeParameter('filters', 0), 'Filters');
    const runsPerRow = this.getNodeParameter('runsPerRow', 0) as number;
    const limitRows = this.getNodeParameter('limitRows', 0) as boolean;
    const maxRows = this.getNodeParameter('maxRows', 0, 100) as number;

    const workflowHash = hashCanonicalWorkflow(getExecutingWorkflowGraph(this));

    const filterEntries = Object.entries(filters);
    const rows = this.getInputData()
      .filter((item) =>
        filterEntries.every(([columnName, value]) => item.json[columnName] === value),
      )
      .slice(0, limitRows ? maxRows : undefined);

    const items: INodeExecutionData[] = [];
    for (const [itemIndex, item] of rows.entries()) {
      const row = item.json;
      if (row.id === undefined || row.id === null) {
        throw new NodeOperationError(this.getNode(), 'Every source row must include an id');
      }
      const rowId = String(row.id);
      const caseId = `${workflowHash}:${rowId}`;
      const mapped = Object.fromEntries(
        Object.entries(columnMapping).map(([deepEvalField, columnName]) => [
          deepEvalField,
          row[String(columnName)],
        ]),
      );

      for (let runIndex = 0; runIndex < runsPerRow; runIndex++) {
        items.push({
          json: {
            ...mapped,
            evalContext: {
              workflowHash,
              caseId,
              runIndex,
              runId: `${caseId}:${runIndex}`,
              runName,
              isEvalRun: true,
              rowId,
              sourceTableId: tableId,
            },
          },
          pairedItem: { item: itemIndex },
        });
      }
    }

    return [items];
  }
}
