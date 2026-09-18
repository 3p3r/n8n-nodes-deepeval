import type {
  DataTableProxyProvider,
  ILoadOptionsFunctions,
  INode,
  INodePropertyOptions,
  IWorkflowExecuteAdditionalData,
} from 'n8n-workflow';

/** Built-in type allowed by n8n's DataTableProxyService allowlist. */
const ALLOWED_DATA_TABLE_NODE_TYPE = 'n8n-nodes-base.dataTable';

interface LoadOptionsAdditionalData extends IWorkflowExecuteAdditionalData {
  dataTableProjectId?: string;
  'data-table'?: {
    dataTableProxyProvider?: DataTableProxyProvider;
  };
}

function additionalDataOf(ctx: ILoadOptionsFunctions): LoadOptionsAdditionalData | undefined {
  return (ctx as unknown as { additionalData?: LoadOptionsAdditionalData }).additionalData;
}

export async function getDataTableOptions(
  this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
  const additionalData = additionalDataOf(this);
  const provider = additionalData?.['data-table']?.dataTableProxyProvider;
  const projectId = additionalData?.dataTableProjectId ?? additionalData?.projectId;
  if (!provider) {
    throw new Error('Data tables are not available on this n8n instance');
  }
  if (!projectId) {
    throw new Error('Could not resolve the current n8n project for Data Tables');
  }

  // Community nodes are not on n8n's Data Table proxy allowlist. Call the same
  // in-process provider with an allowed node type so loadOptions can list tables.
  const node: INode = { ...this.getNode(), type: ALLOWED_DATA_TABLE_NODE_TYPE };
  const proxy = await provider.getDataTableAggregateProxy(
    { id: this.getWorkflow().id } as never,
    node,
    projectId,
  );
  const { data } = await proxy.getManyAndCount({ take: 1000, sortBy: 'name:asc' });
  return data.map((table) => ({ name: table.name, value: table.id }));
}
