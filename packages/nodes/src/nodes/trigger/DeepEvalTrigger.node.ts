import { randomUUID } from 'node:crypto';
import {
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeType,
  type INodeTypeDescription,
  NodeConnectionTypes,
} from 'n8n-workflow';

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
    const limitRows = this.getNodeParameter('limitRows', 0) as boolean;
    const maxRows = this.getNodeParameter('maxRows', 0, 100) as number;

    const filterEntries = Object.entries(filters);
    const rows = this.getInputData()
      .filter((item) =>
        filterEntries.every(([columnName, value]) => item.json[columnName] === value),
      )
      .slice(0, limitRows ? maxRows : undefined);

    const runId = randomUUID();
    const items = rows.map((item, itemIndex) => {
      const row = item.json;
      const mapped = Object.fromEntries(
        Object.entries(columnMapping).map(([deepEvalField, columnName]) => [
          deepEvalField,
          row[String(columnName)],
        ]),
      );
      return {
        json: {
          ...mapped,
          evalContext: {
            runId,
            runName,
            isEvalRun: true,
            rowId: row.id ?? itemIndex,
            sourceTableId: tableId,
          },
        },
        pairedItem: { item: itemIndex },
      } satisfies INodeExecutionData;
    });

    return [items];
  }
}
