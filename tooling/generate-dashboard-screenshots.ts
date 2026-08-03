/**
 * Capture README dashboard screenshots from a live n8n session with DeepEval hooks.
 *
 * Usage (from repo root, after build + ensure-llamafile):
 *   npx vite-node tooling/generate-dashboard-screenshots.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type BrowserContext, chromium, type Page } from 'playwright';
import { startN8nSession } from '../e2e/n8n-session.js';

const root = resolve(import.meta.dirname, '..');
const docs = resolve(root, 'docs');

interface N8nEnvelope<T> {
  data: T;
}

async function api<T>(
  baseUrl: string,
  cookie: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Cookie: cookie,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const body = (await response.json()) as N8nEnvelope<T> | T;
  if (!response.ok) {
    throw new Error(`n8n API ${response.status}: ${JSON.stringify(body)}`);
  }
  return body && typeof body === 'object' && 'data' in body
    ? (body as N8nEnvelope<T>).data
    : (body as T);
}

function parseCookie(cookieHeader: string): { name: string; value: string } {
  const [pair] = cookieHeader.split(';', 1);
  const eq = pair?.indexOf('=') ?? -1;
  if (!pair || eq < 0) throw new Error(`Invalid session cookie: ${cookieHeader}`);
  return { name: pair.slice(0, eq), value: pair.slice(eq + 1) };
}

async function seedFixture(session: Awaited<ReturnType<typeof startN8nSession>>): Promise<string> {
  const { context } = session;
  const triggerType = context.nodeTypes['DeepEval Trigger'];
  const aggregateType = context.nodeTypes['DeepEval Aggregate'];
  const gEvalType = context.nodeTypes['DeepEval G-Eval'];
  const biasType = context.nodeTypes['DeepEval Bias'];
  if (!triggerType || !aggregateType || !gEvalType || !biasType) {
    throw new Error('DeepEval node types missing from live n8n');
  }

  await api(
    context.baseUrl,
    context.cookie,
    `/rest/projects/${context.projectId}/data-tables/${context.resultsTableId}/insert`,
    {
      method: 'POST',
      body: JSON.stringify({
        data: [
          {
            runId: 'screenshot-run-1',
            overallScore: 0.91,
            overallSuccess: true,
            metrics: JSON.stringify([
              {
                metric: 'DeepEval G-Eval',
                score: 0.95,
                success: true,
                reason: 'Aligned with criteria',
              },
              { metric: 'Bias', score: 0.88, success: true, reason: 'No bias detected' },
              {
                metric: 'Toxicity',
                score: 0.4,
                success: false,
                reason: 'Borderline toxicity on one claim',
              },
            ]),
          },
        ],
        returnType: 'all',
      }),
    },
  );

  const created = await api<{ id: string }>(context.baseUrl, context.cookie, '/rest/workflows', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Dashboard ABC Screenshot Fixture',
      active: false,
      nodes: [
        {
          id: 'manual',
          name: 'Manual',
          type: 'n8n-nodes-base.manualTrigger',
          typeVersion: 1,
          position: [0, 0],
          parameters: {},
        },
        {
          id: 'trigger',
          name: 'DeepEval Trigger',
          type: triggerType,
          typeVersion: 1,
          position: [220, 0],
          parameters: {
            dataTableId: context.sourceTableId,
            columnMapping: '{"input":"input","expectedOutput":"expectedOutput"}',
            runsPerRow: 1,
          },
        },
        {
          id: 'metric',
          name: 'DeepEval G-Eval',
          type: gEvalType,
          typeVersion: 1,
          position: [440, 0],
          parameters: { threshold: 0.5, cleanSession: true },
          credentials: {
            openAiApi: { id: context.credentialId, name: 'Local OpenAI-compatible endpoint' },
          },
        },
        {
          id: 'bias',
          name: 'DeepEval Bias',
          type: biasType,
          typeVersion: 1,
          position: [440, 160],
          parameters: { threshold: 0.5, cleanSession: false },
          credentials: {
            openAiApi: { id: context.credentialId, name: 'Local OpenAI-compatible endpoint' },
          },
        },
        {
          id: 'aggregate',
          name: 'DeepEval Aggregate',
          type: aggregateType,
          typeVersion: 1,
          position: [700, 80],
          parameters: {
            dataTableId: context.resultsTableId,
            passRule: 'allPass',
          },
        },
      ],
      connections: {},
      settings: { executionOrder: 'v1' },
    }),
  });

  await api(
    context.baseUrl,
    context.cookie,
    `/rest/deepeval-dashboard/workflows/${created.id}/questionnaire`,
    {
      method: 'PUT',
      body: JSON.stringify({
        'T.1': {
          status: 'pass',
          notes: 'Pinned DeepEval 4.0.7 and judge model in workflow sticky note.',
        },
        'T.7': {
          status: 'partial',
          notes: 'Spot-checked 20 source rows against expectedOutput.',
        },
      }),
    },
  );

  return created.id;
}

async function authedContext(
  browserContext: BrowserContext,
  baseUrl: string,
  cookieHeader: string,
): Promise<void> {
  const parsed = parseCookie(cookieHeader);
  const url = new URL(baseUrl);
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
}

async function dismissModals(page: Page): Promise<void> {
  for (const label of ['Skip', 'Get started', 'Close', 'Dismiss', "Don't show again"]) {
    const button = page.getByRole('button', { name: label });
    if ((await button.count()) > 0) {
      try {
        await button.first().click({ timeout: 1000 });
      } catch {
        // ignore
      }
    }
  }
  await page.keyboard.press('Escape').catch(() => undefined);
}

async function openDeepEvalTab(page: Page, baseUrl: string, workflowId: string): Promise<void> {
  await page.goto(`${baseUrl}/workflow/${workflowId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await dismissModals(page);

  // Wait for canvas / editor chrome
  await page.waitForFunction(
    () =>
      document.querySelector('[data-test-id="canvas"]') !== null ||
      document.querySelector('.vue-flow') !== null ||
      document.querySelector('label.n8n-radio-button') !== null,
    { timeout: 90_000 },
  );
  await dismissModals(page);

  // Bridge injects after Evaluations; MutationObserver may need a moment
  const tab = page.locator('[data-testid="deepeval-dashboard-tab"]').first();
  try {
    await tab.waitFor({ state: 'visible', timeout: 30_000 });
  } catch {
    // Force bridge bootstrap by navigating again / waiting for evaluations radio
    const evalRadio = page.locator('[data-test-id="radio-button-evaluation"]').first();
    if ((await evalRadio.count()) === 0) {
      await writeFile(
        resolve(docs, 'dashboard-capture-debug.png'),
        await page.screenshot({ fullPage: true }),
      );
      throw new Error(
        `Benchmarks tab not found. URL=${page.url()} debug=docs/dashboard-capture-debug.png`,
      );
    }
    await page.waitForTimeout(3000);
    await tab.waitFor({ state: 'visible', timeout: 30_000 });
  }

  await tab.click();
  await page.waitForTimeout(1000);

  const iframe = page.frameLocator('iframe[data-deepeval-dashboard-iframe]');
  await iframe
    .locator('[data-testid="deepeval-dashboard"], [data-testid="dashboard-setup"]')
    .waitFor({
      state: 'visible',
      timeout: 60_000,
    });
}

async function capture(): Promise<void> {
  await mkdir(docs, { recursive: true });
  console.info('Starting n8n session with DeepEval dashboard hooks…');
  const session = await startN8nSession({ testTarget: 'src' });
  const browser = await chromium.launch({ headless: true });

  try {
    const workflowId = await seedFixture(session);
    console.info(`Fixture workflow ${workflowId} at ${session.context.baseUrl}`);

    const browserContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      baseURL: session.context.baseUrl,
    });
    await authedContext(browserContext, session.context.baseUrl, session.context.cookie);
    const page = await browserContext.newPage();

    await openDeepEvalTab(page, session.context.baseUrl, workflowId);

    const iframe = page.frameLocator('iframe[data-deepeval-dashboard-iframe]');
    // Prefer report view; if setup, still capture but fail loudly after
    const hasReport = (await iframe.locator('[data-testid="dashboard-overall-score"]').count()) > 0;
    if (!hasReport) {
      await writeFile(
        resolve(docs, 'dashboard-capture-debug.png'),
        await page.screenshot({ fullPage: true }),
      );
      throw new Error(
        'Dashboard opened but ABC report did not load (see dashboard-capture-debug.png)',
      );
    }

    await iframe.locator('[data-testid="dashboard-overall-score"]').waitFor({ timeout: 30_000 });
    await iframe.locator('.dashboard__header').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    await page.screenshot({
      path: resolve(docs, 'dashboard-report.example.png'),
      fullPage: false,
    });
    console.info('Wrote docs/dashboard-report.example.png');

    // Questionnaire shot: scroll deep into manual items so Save answer / notes dominate
    const manualItem = iframe.locator('[data-testid="checklist-T.7"]');
    await manualItem.scrollIntoViewIfNeeded();
    await iframe.locator('[data-testid="checklist-T.7"] textarea').first().click();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: resolve(docs, 'dashboard-questionnaire.example.png'),
      fullPage: false,
    });
    console.info('Wrote docs/dashboard-questionnaire.example.png');

    await browserContext.close();
  } finally {
    await browser.close();
    await session.teardown();
  }
}

await capture();
