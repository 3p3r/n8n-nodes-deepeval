import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright';
import {
  type DeepEvalE2EContext,
  type N8nSession,
  startN8nSession,
} from '../../e2e/n8n-session.js';
import {
  addFromNodePlus,
  addNodeViaCreator,
  clickExecute,
  closeNDV,
  closeNodeCreator,
  dismissModals,
  dragConnect,
  dragConnectAiModel,
  dumpDebug,
  fillJsonParameter,
  fillParameter,
  hold,
  installVisibleCursor,
  ndvIsOpen,
  nodeExists,
  openBenchmarksTab,
  openNamedDataTable,
  openNode,
  openOutputPanel,
  openProjectDataTables,
  openWorkflowEditor,
  parkMouse,
  renameNode,
  renameWorkflow,
  selectDataTable,
  takeWriteLock,
  tidyUp,
  tourDataTableGrid,
  waitForNodeSuccess,
  zoomToFit,
} from './n8n-ui.js';
import {
  debugDir,
  ensureDirs,
  recordingsDir,
  SCENE_IDS,
  type SceneId,
  timestampsPath,
} from './paths.js';
import {
  api,
  configureEvalNodes,
  createWorkflow,
  RESULTS_TABLE_NAME,
  SOURCE_TABLE_NAME,
  seedDashboardData,
  seedSupportReply,
  seedSupportTables,
  WORKFLOW_NAME,
} from './workflow.js';

const EXECUTE_TIMEOUT_MS = 180_000;
const COLUMN_MAPPING =
  '{"input":"input","expectedOutput":"expectedOutput","actualOutput":"actualOutput","output":"actualOutput"}';

function parseCookie(cookieHeader: string): { name: string; value: string } {
  const [pair] = cookieHeader.split(';', 1);
  const eq = pair?.indexOf('=') ?? -1;
  if (!pair || eq < 0) throw new Error(`Invalid session cookie: ${cookieHeader}`);
  return { name: pair.slice(0, eq), value: pair.slice(eq + 1) };
}

async function authedContext(
  browser: Browser,
  context: DeepEvalE2EContext,
): Promise<BrowserContext> {
  const parsed = parseCookie(context.cookie);
  const url = new URL(context.baseUrl);
  const browserContext = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    baseURL: context.baseUrl,
    recordVideo: {
      dir: recordingsDir,
      size: { width: 1920, height: 1080 },
    },
  });
  await browserContext.addCookies([
    {
      name: parsed.name,
      value: parsed.value,
      domain: url.hostname,
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
  return browserContext;
}

async function showNode(page: Page, name: string, fill?: Array<[string, string]>): Promise<void> {
  if (!(await ndvIsOpen(page))) {
    const opened = await openNode(page, name);
    if (!opened) {
      await dumpDebug(page, `missing-${name.replaceAll(' ', '-')}`);
      return;
    }
  }
  if (fill) {
    for (const [parameter, value] of fill) {
      if (parameter === 'columnMapping') await fillJsonParameter(page, parameter, value);
      else if (parameter === 'dataTableId') await selectDataTable(page, value);
      else await fillParameter(page, parameter, value);
    }
  }
  await hold(page, 1_200);
  await closeNDV(page);
}

async function addConnected(
  page: Page,
  fromName: string,
  search: string,
  itemName: string,
  plus: 'right' | 'bottom' = 'right',
): Promise<boolean> {
  if (await ndvIsOpen(page)) await closeNDV(page);
  const existed = await nodeExists(page, itemName);
  let viaCreator = false;
  let added = await addFromNodePlus(page, fromName, search, itemName, plus);
  if (!added) {
    console.info(`Plus-add missed ${itemName}; falling back to creator`);
    added = await addNodeViaCreator(page, search, itemName);
    viaCreator = true;
  }
  if (!added && !(await nodeExists(page, itemName))) return false;
  await hold(page, 600);
  if (await ndvIsOpen(page)) await closeNDV(page);
  if (plus === 'right') {
    if (existed || viaCreator) await dragConnect(page, fromName, itemName);
  } else await dragConnectAiModel(page, itemName, fromName);
  await parkMouse(page);
  return true;
}

type ExecutionRow = { id: string; status: string; workflowId?: string; finished?: boolean };

async function waitForExecution(
  n8n: DeepEvalE2EContext,
  workflowId: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let lastId: string | undefined;
  while (Date.now() < deadline) {
    try {
      const body = await api<ExecutionRow[] | { results?: ExecutionRow[] }>(
        n8n,
        `/rest/executions?limit=10`,
      );
      const rows = Array.isArray(body) ? body : (body.results ?? []);
      const match = rows.find((row) => !row.workflowId || row.workflowId === workflowId);
      if (match) {
        lastId = match.id;
        if (['success', 'error', 'canceled', 'crashed'].includes(match.status) || match.finished) {
          return match.status === 'success';
        }
      }
    } catch {
      // keep polling
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_500));
  }
  console.info(`Execution wait timed out (last id=${lastId ?? 'none'})`);
  return false;
}

async function waitForResultsRow(n8n: DeepEvalE2EContext, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const path = `/rest/projects/${n8n.projectId}/data-tables/${n8n.resultsTableId}/rows?take=20`;
  while (Date.now() < deadline) {
    try {
      const rows = await api<{ count?: number; data?: Array<Record<string, unknown>> }>(n8n, path);
      const list = Array.isArray(rows) ? rows : (rows.data ?? []);
      if (list.some((row) => row.runId !== undefined && row.runId !== '')) return true;
    } catch {
      // keep polling
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_200));
  }
  return false;
}

async function canvasNodeNames(page: Page): Promise<string[]> {
  return await page
    .locator('[data-node-name]')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => node.getAttribute('data-node-name') ?? '')
        .filter((name) => name.length > 0),
    );
}

async function addDataTableFrom(
  page: Page,
  fromName: string,
  desiredName: string,
  actionName: string,
): Promise<void> {
  const before = new Set(await canvasNodeNames(page));
  await addFromNodePlus(page, fromName, 'Data table', 'Data table', 'right', { actionName });
  await hold(page, 500);
  let created = (await canvasNodeNames(page)).find((name) => !before.has(name));
  if (!created) {
    console.info(`Plus-add missed ${desiredName}; falling back to creator`);
    await addNodeViaCreator(page, 'Data table', 'Data table', {
      allowDuplicate: true,
      actionName,
    });
    await hold(page, 500);
    created = (await canvasNodeNames(page)).find((name) => !before.has(name));
  }
  if (!created) {
    const labels = await page
      .locator('[data-test-id="node-creator-item-name"]')
      .allTextContents()
      .catch(() => []);
    console.info(`Creator items: ${labels.slice(0, 12).join(' | ')}`);
    await dumpDebug(page, `missing-data-table-${desiredName.replaceAll(' ', '-')}`);
    throw new Error(`Data table node was not added from ${fromName}`);
  }
  if (created !== desiredName) {
    await zoomToFit(page);
    const renamed = await renameNode(page, created, desiredName);
    if (!renamed) console.info(`Could not rename ${created} to ${desiredName}`);
  }
  if (await ndvIsOpen(page)) await closeNDV(page);
  await closeNodeCreator(page);
}

async function record(session: N8nSession, browser: Browser): Promise<string> {
  const n8n = session.context;
  await seedSupportTables(n8n);
  const created = await createWorkflow(n8n, WORKFLOW_NAME);
  await seedSupportReply(n8n, created.id);

  const browserContext = await authedContext(browser, n8n);
  await installVisibleCursor(browserContext);
  const page = await browserContext.newPage();
  const originMs = Date.now();
  const marks: Array<{ id: SceneId; startSec: number; endSec?: number }> = [];
  const markStart = (id: SceneId): void => {
    const startSec = (Date.now() - originMs) / 1000;
    marks.push({ id, startSec });
    console.info(`Scene ${id} start @ ${startSec.toFixed(2)}s`);
  };
  const markEnd = (id: SceneId): void => {
    const row = marks.find((markRow) => markRow.id === id);
    if (row) row.endSec = (Date.now() - originMs) / 1000;
  };

  try {
    await openWorkflowEditor(page, n8n.baseUrl, created.id);
    await dismissModals(page);
    await takeWriteLock(page);
    await hold(page, 500);

    markStart('dt-01-workflow');
    try {
      await renameWorkflow(page, WORKFLOW_NAME);
    } catch {
      // name field may already match
    }
    await tidyUp(page);
    await hold(page, 700);
    await showNode(page, 'Ticket');
    await showNode(page, 'Draft Reply');
    await parkMouse(page);
    await hold(page, 600);
    markEnd('dt-01-workflow');

    await openProjectDataTables(page, n8n.baseUrl, n8n.projectId);
    await hold(page, 300);

    markStart('dt-02-tables');
    const sourceCard = page.getByText(SOURCE_TABLE_NAME, { exact: true }).first();
    if ((await sourceCard.count()) > 0) {
      await sourceCard.hover().catch(() => undefined);
      await hold(page, 500);
    }
    await openNamedDataTable(
      page,
      n8n.baseUrl,
      n8n.projectId,
      n8n.sourceTableId,
      SOURCE_TABLE_NAME,
    );
    await tourDataTableGrid(page);
    await hold(page, 500);
    await openProjectDataTables(page, n8n.baseUrl, n8n.projectId);
    const resultsCard = page.getByText(RESULTS_TABLE_NAME, { exact: true }).first();
    if ((await resultsCard.count()) > 0) {
      await resultsCard.hover().catch(() => undefined);
      await hold(page, 400);
    }
    await openNamedDataTable(
      page,
      n8n.baseUrl,
      n8n.projectId,
      n8n.resultsTableId,
      RESULTS_TABLE_NAME,
    );
    await tourDataTableGrid(page);
    await hold(page, 400);
    markEnd('dt-02-tables');

    await openWorkflowEditor(page, n8n.baseUrl, created.id);
    await dismissModals(page);
    await takeWriteLock(page);
    await hold(page, 400);

    markStart('dt-03-trigger');
    await zoomToFit(page);
    await addDataTableFrom(page, 'When clicking Execute Workflow', 'Load Cases', 'Get row(s)');
    await dragConnect(page, 'When clicking Execute Workflow', 'Load Cases');
    await showNode(page, 'Load Cases', [['dataTableId', SOURCE_TABLE_NAME]]);
    await addConnected(page, 'Load Cases', 'DeepEval Trigger', 'DeepEval Trigger');
    await dragConnect(page, 'Load Cases', 'DeepEval Trigger');
    await showNode(page, 'DeepEval Trigger', [
      ['runName', WORKFLOW_NAME],
      ['dataTableId', SOURCE_TABLE_NAME],
      ['columnMapping', COLUMN_MAPPING],
    ]);
    await tidyUp(page);
    await hold(page, 500);
    markEnd('dt-03-trigger');

    markStart('dt-04-metrics');
    await addConnected(page, 'DeepEval Trigger', 'DeepEval G-Eval', 'DeepEval G-Eval');
    await showNode(page, 'DeepEval G-Eval', [
      [
        'criteria',
        'The reply apologizes for the duplicate charge and does not promise an immediate refund.',
      ],
    ]);
    await addConnected(page, 'DeepEval Trigger', 'DeepEval Bias', 'DeepEval Bias');
    await showNode(page, 'DeepEval Bias');
    await dragConnectAiModel(page, 'OpenAI Chat Model', 'DeepEval G-Eval');
    await dragConnectAiModel(page, 'OpenAI Chat Model', 'DeepEval Bias');
    await tidyUp(page);
    await hold(page, 500);
    markEnd('dt-04-metrics');

    markStart('dt-05-persist');
    await addConnected(page, 'DeepEval G-Eval', 'DeepEval Aggregate', 'DeepEval Aggregate');
    if (await ndvIsOpen(page)) await closeNDV(page);
    const biasConnected = await dragConnect(page, 'DeepEval Bias', 'DeepEval Aggregate');
    if (!biasConnected) {
      await dumpDebug(page, 'dt-05-bias-not-connected');
      throw new Error('DeepEval Bias did not connect to DeepEval Aggregate');
    }
    await dragConnect(page, 'DeepEval G-Eval', 'DeepEval Aggregate');
    await addDataTableFrom(page, 'DeepEval Aggregate', 'Persist Results', 'Insert row');
    const persistConnected = await dragConnect(page, 'DeepEval Aggregate', 'Persist Results');
    if (!persistConnected) {
      await dumpDebug(page, 'dt-05-persist-not-connected');
      throw new Error('DeepEval Aggregate did not connect to Persist Results');
    }
    await showNode(page, 'Persist Results', [['dataTableId', RESULTS_TABLE_NAME]]);
    await showNode(page, 'DeepEval Aggregate', [['dataTableId', RESULTS_TABLE_NAME]]);
    await tidyUp(page);
    await parkMouse(page);
    await page.keyboard.press('Control+s').catch(() => undefined);
    await hold(page, 1_200);
    await configureEvalNodes(n8n, created.id);
    await openWorkflowEditor(page, n8n.baseUrl, created.id);
    await tidyUp(page);
    await showNode(page, 'Persist Results');
    await parkMouse(page);
    await hold(page, 500);
    markEnd('dt-05-persist');

    markStart('dt-06-execute');
    const clicked = await clickExecute(page);
    if (!clicked) {
      await api(n8n, `/rest/workflows/${created.id}/run`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
    }
    await hold(page, 1_500);
    const uiSuccess = await waitForNodeSuccess(page, 'DeepEval G-Eval', EXECUTE_TIMEOUT_MS);
    const persistOk = uiSuccess ? await waitForNodeSuccess(page, 'Persist Results', 60_000) : false;
    const apiSuccess = uiSuccess || (await waitForExecution(n8n, created.id, 20_000));
    const wroteRow = await waitForResultsRow(n8n, persistOk || apiSuccess ? 20_000 : 5_000);
    console.info(
      `Execute finished ui=${uiSuccess} persist=${persistOk} api=${apiSuccess} resultsRow=${wroteRow}`,
    );
    if (!uiSuccess) await dumpDebug(page, 'dt-06-execute-no-geval-success');
    if (!wroteRow) await dumpDebug(page, 'dt-06-execute-no-results-row');
    await hold(page, 600);
    await showNode(page, 'DeepEval G-Eval');
    await openOutputPanel(page);
    await hold(page, 1_800);
    await closeNDV(page);
    await hold(page, 400);
    markEnd('dt-06-execute');

    await openProjectDataTables(page, n8n.baseUrl, n8n.projectId);
    await hold(page, 300);

    markStart('dt-07-results');
    const resultsList = page.getByText(RESULTS_TABLE_NAME, { exact: true }).first();
    if ((await resultsList.count()) > 0) {
      await resultsList.hover().catch(() => undefined);
      await hold(page, 400);
    }
    await openNamedDataTable(
      page,
      n8n.baseUrl,
      n8n.projectId,
      n8n.resultsTableId,
      RESULTS_TABLE_NAME,
    );
    await tourDataTableGrid(page);
    await hold(page, 700);
    markEnd('dt-07-results');

    await seedDashboardData(n8n, created.id).catch((error: unknown) => {
      console.info(
        `Dashboard seed skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    await openWorkflowEditor(page, n8n.baseUrl, created.id);
    await dismissModals(page);
    await takeWriteLock(page);
    await hold(page, 400);

    markStart('dt-08-dashboard');
    const opened = await openBenchmarksTab(page);
    if (!opened) {
      await dumpDebug(page, 'dt-08-dashboard-no-tab');
      throw new Error('Benchmarks tab not found');
    }
    const iframe = page.frameLocator('iframe[data-deepeval-dashboard-iframe]');
    try {
      await iframe
        .locator(
          '[data-testid="dashboard-overall-score"], [data-testid="dashboard-metrics"], [data-testid="deepeval-dashboard"]',
        )
        .first()
        .waitFor({ state: 'visible', timeout: 60_000 });
    } catch {
      await dumpDebug(page, 'dt-08-dashboard-no-iframe');
    }
    await hold(page, 2_200);
    const score = iframe.locator('[data-testid="dashboard-overall-score"]');
    if ((await score.count()) > 0) await hold(page, 1_200);
    const metrics = iframe.locator('[data-testid="dashboard-metrics"]');
    if ((await metrics.count()) > 0) {
      await metrics.first().scrollIntoViewIfNeeded();
      await hold(page, 1_600);
    }
    await hold(page, 400);
    markEnd('dt-08-dashboard');
  } catch (error) {
    await dumpDebug(page, 'record-error').catch(() => undefined);
    throw error;
  } finally {
    const endSec = (Date.now() - originMs) / 1000;
    const scenes = SCENE_IDS.filter((id) => marks.some((markRow) => markRow.id === id)).map(
      (id, index, ids) => {
        const row = marks.find((markRow) => markRow.id === id);
        const startSec = row?.startSec ?? 0;
        const nextId = ids[index + 1];
        const end =
          row?.endSec ??
          (nextId === undefined
            ? endSec
            : (marks.find((markRow) => markRow.id === nextId)?.startSec ?? endSec));
        return { id, startSec, endSec: Math.max(startSec + 0.4, end) };
      },
    );
    await writeFile(timestampsPath, `${JSON.stringify({ file: 'full.webm', scenes }, null, 2)}\n`);
    const video = page.video();
    await page.close();
    await browserContext.close();
    if (video) {
      const dest = resolve(recordingsDir, 'full.webm');
      try {
        await video.saveAs(dest);
      } catch {
        await rename(await video.path(), dest);
      }
    }
  }

  return created.id;
}

async function main(): Promise<void> {
  await ensureDirs();
  await mkdir(debugDir, { recursive: true });
  await mkdir(recordingsDir, { recursive: true });
  for (const entry of await readdir(recordingsDir)) {
    if (entry.endsWith('.webm') || entry.endsWith('.jpg') || entry.endsWith('.png')) {
      await rm(resolve(recordingsDir, entry), { force: true });
    }
  }
  console.info('Starting n8n session (out/) with llamafile judge for Data Tables demo…');
  const session = await startN8nSession({ testTarget: 'out' });
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  try {
    const workflowId = await record(session, browser);
    console.info(`Recorded Data Tables take for workflow ${workflowId}`);
  } finally {
    await browser.close();
    await session.teardown();
  }
}

await main();
