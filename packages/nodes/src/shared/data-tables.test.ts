import type { ILoadOptionsFunctions, INode } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';
import { getDataTableOptions } from './data-tables.js';

const node: INode = {
  id: 'node-1',
  name: 'DeepEval Trigger',
  type: 'CUSTOM.deepEvalTrigger',
  typeVersion: 1,
  position: [0, 0],
  parameters: {},
};

function loadOptionsContext(additionalData: unknown): ILoadOptionsFunctions {
  return {
    helpers: {},
    getNode: () => node,
    getWorkflow: () => ({ id: 'wf-1', name: 'Workflow', active: false }),
    additionalData,
  } as unknown as ILoadOptionsFunctions;
}

describe('getDataTableOptions', () => {
  it('maps table name to label and id to value via the in-process provider', async () => {
    const getManyAndCount = vi.fn().mockResolvedValue({
      count: 2,
      data: [
        { id: 'tbl-results', name: 'Results' },
        { id: 'tbl-source', name: 'Source' },
      ],
    });
    const getDataTableAggregateProxy = vi.fn().mockResolvedValue({ getManyAndCount });
    const ctx = loadOptionsContext({
      projectId: 'proj-1',
      'data-table': { dataTableProxyProvider: { getDataTableAggregateProxy } },
    });

    const options = await getDataTableOptions.call(ctx);

    expect(getDataTableAggregateProxy).toHaveBeenCalledWith(
      { id: 'wf-1' },
      { ...node, type: 'n8n-nodes-base.dataTable' },
      'proj-1',
    );
    expect(getManyAndCount).toHaveBeenCalledWith({ take: 1000, sortBy: 'name:asc' });
    expect(options).toEqual([
      { name: 'Results', value: 'tbl-results' },
      { name: 'Source', value: 'tbl-source' },
    ]);
  });

  it('prefers dataTableProjectId over projectId', async () => {
    const getManyAndCount = vi.fn().mockResolvedValue({ count: 0, data: [] });
    const getDataTableAggregateProxy = vi.fn().mockResolvedValue({ getManyAndCount });
    const ctx = loadOptionsContext({
      projectId: 'proj-ignored',
      dataTableProjectId: 'proj-from-controller',
      'data-table': { dataTableProxyProvider: { getDataTableAggregateProxy } },
    });

    await getDataTableOptions.call(ctx);

    expect(getDataTableAggregateProxy).toHaveBeenCalledWith(
      { id: 'wf-1' },
      expect.objectContaining({ type: 'n8n-nodes-base.dataTable' }),
      'proj-from-controller',
    );
  });

  it('throws when the data table provider is unavailable', async () => {
    const ctx = loadOptionsContext({ projectId: 'proj-1' });
    await expect(getDataTableOptions.call(ctx)).rejects.toThrow(
      'Data tables are not available on this n8n instance',
    );
  });

  it('throws when the project id cannot be resolved', async () => {
    const ctx = loadOptionsContext({
      'data-table': { dataTableProxyProvider: { getDataTableAggregateProxy: vi.fn() } },
    });
    await expect(getDataTableOptions.call(ctx)).rejects.toThrow(
      'Could not resolve the current n8n project for Data Tables',
    );
  });
});
