import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { BrowserContext, Locator, Page } from 'playwright';
import { debugDir } from './paths.js';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type DemoCursorWindow = Window & {
  __deepevalEnsureCursor?: () => void;
  __deepevalCursorMove?: (x: number, y: number, clicking?: boolean) => void;
};

function installCursorInWindow(): void {
  try {
    if (window.self !== window.top) return;
  } catch {
    return;
  }
  const w = window as DemoCursorWindow;
  const ensure = (): void => {
    const root = document.documentElement;
    if (!root) return;
    let style = document.getElementById('deepeval-demo-cursor-style') as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = 'deepeval-demo-cursor-style';
      style.textContent = `
        html, body, * { cursor: none !important; }
        #deepeval-demo-cursor {
          position: fixed; left: 0; top: 0; width: 40px; height: 40px;
          pointer-events: none; z-index: 2147483647;
          transform: translate(-3px, -2px);
          filter: drop-shadow(0 1px 2px rgba(0,0,0,0.55));
        }
        #deepeval-demo-cursor.clicking svg { filter: brightness(0.75); }
        #deepeval-demo-click {
          position: fixed; width: 36px; height: 36px; border-radius: 50%;
          border: 4px solid #ff6d5a; pointer-events: none; z-index: 2147483646;
          transform: translate(-50%, -50%) scale(0.4); opacity: 0;
        }
        #deepeval-demo-click.pulse { animation: deepeval-click-pulse 0.45s ease-out; }
        @keyframes deepeval-click-pulse {
          0% { opacity: 0.95; transform: translate(-50%, -50%) scale(0.4); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(2.4); }
        }
      `;
    }
    let pointer = document.getElementById('deepeval-demo-cursor');
    if (!pointer) {
      pointer = document.createElement('div');
      pointer.id = 'deepeval-demo-cursor';
      pointer.innerHTML =
        '<svg viewBox="0 0 24 24" width="40" height="40"><path d="M3.5 2.5 L3.5 20.5 L9.6 15.2 L13.4 23.2 L16.8 21.6 L13 13.6 L21.2 13.6 Z" fill="#ff6d5a" stroke="#111827" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    }
    let click = document.getElementById('deepeval-demo-click');
    if (!click) {
      click = document.createElement('div');
      click.id = 'deepeval-demo-click';
    }
    if (!style.isConnected) root.appendChild(style);
    if (!pointer.isConnected) root.appendChild(pointer);
    if (!click.isConnected) root.appendChild(click);
  };
  w.__deepevalEnsureCursor = ensure;
  w.__deepevalCursorMove = (x: number, y: number, clicking?: boolean) => {
    ensure();
    const pointer = document.getElementById('deepeval-demo-cursor');
    const click = document.getElementById('deepeval-demo-click');
    if (pointer) {
      pointer.style.left = `${x}px`;
      pointer.style.top = `${y}px`;
      pointer.classList.toggle('clicking', Boolean(clicking));
    }
    if (click) {
      click.style.left = `${x}px`;
      click.style.top = `${y}px`;
      if (clicking) {
        click.classList.remove('pulse');
        void click.offsetWidth;
        click.classList.add('pulse');
      }
    }
  };
  ensure();
  if (!w.document.documentElement?.dataset.deepevalCursorListeners) {
    if (w.document.documentElement)
      w.document.documentElement.dataset.deepevalCursorListeners = '1';
    document.addEventListener(
      'mousemove',
      (event) => w.__deepevalCursorMove?.(event.clientX, event.clientY),
      true,
    );
    document.addEventListener(
      'mousedown',
      (event) => w.__deepevalCursorMove?.(event.clientX, event.clientY, true),
      true,
    );
    document.addEventListener(
      'mouseup',
      (event) => w.__deepevalCursorMove?.(event.clientX, event.clientY, false),
      true,
    );
    new MutationObserver(() => ensure()).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }
}

export async function installVisibleCursor(context: BrowserContext): Promise<void> {
  await context.addInitScript(installCursorInWindow);
  context.on('page', (page) => {
    const inject = (): void => {
      void page
        .mainFrame()
        .evaluate(installCursorInWindow)
        .catch(() => undefined);
    };
    page.on('load', inject);
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) inject();
    });
  });
}

export async function ensureVisibleCursor(page: Page): Promise<void> {
  await page
    .mainFrame()
    .evaluate(installCursorInWindow)
    .catch(() => undefined);
}

async function syncCursor(page: Page, x: number, y: number, clicking = false): Promise<void> {
  await page
    .evaluate(
      ({ x, y, clicking }) => {
        const w = window as DemoCursorWindow;
        w.__deepevalEnsureCursor?.();
        w.__deepevalCursorMove?.(x, y, clicking);
      },
      { x, y, clicking },
    )
    .catch(() => undefined);
}

export async function hold(page: Page, ms: number): Promise<void> {
  await page.waitForTimeout(Math.round(ms * 2));
}

export async function clickLocator(page: Page, locator: Locator, steps = 24): Promise<void> {
  const target = locator.first();
  await target.waitFor({ state: 'visible', timeout: 15_000 });
  await ensureVisibleCursor(page);
  const box = await target.boundingBox();
  if (box) {
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y, { steps });
    await syncCursor(page, x, y);
    await hold(page, 400);
    await syncCursor(page, x, y, true);
  }
  try {
    await target.click({ timeout: 8_000 });
  } catch {
    await closeNodeCreator(page);
    await dismissModals(page);
    await target.click({ timeout: 8_000, force: true });
  }
  if (box) {
    await syncCursor(page, box.x + box.width / 2, box.y + box.height / 2, false);
  }
}

export async function dismissModals(page: Page): Promise<void> {
  for (const label of [
    'Skip',
    'Get started',
    'Close',
    'Dismiss',
    "Don't show again",
    'Build manually',
    'Maybe later',
    'Not now',
  ]) {
    const button = page.getByRole('button', { name: label });
    if ((await button.count()) > 0) {
      try {
        await button.first().click({ timeout: 800 });
        await hold(page, 250);
      } catch {
        // ignore
      }
    }
  }
  const buildManually = page.locator('[data-test-id="instance-ai-canvas-build-manually"]');
  if ((await buildManually.count()) > 0) {
    try {
      await buildManually.first().click({ timeout: 800 });
      await hold(page, 300);
    } catch {
      // ignore
    }
  }
  const editHere = page.getByRole('button', { name: 'Edit here' });
  if ((await editHere.count()) > 0) {
    try {
      await editHere.first().click({ timeout: 1_200 });
      await hold(page, 400);
    } catch {
      // ignore
    }
  }
  await page.keyboard.press('Escape').catch(() => undefined);
  await hold(page, 200);
}

export async function dumpDebug(page: Page, name: string): Promise<void> {
  await writeFile(resolve(debugDir, `${name}.png`), await page.screenshot({ fullPage: true }));
}

export async function takeWriteLock(page: Page): Promise<void> {
  const editHere = page.getByRole('button', { name: 'Edit here' });
  if ((await editHere.count()) === 0) return;
  try {
    await clickLocator(page, editHere, 6);
    await waitForCanvas(page);
    await hold(page, 700);
  } catch {
    // Banner already gone.
  }
}

export async function waitForCanvas(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      document.querySelector('[data-test-id="canvas"]') !== null ||
      document.querySelector('[data-test-id="workflow-canvas-host"]') !== null ||
      document.querySelector('.vue-flow') !== null,
    { timeout: 90_000 },
  );
  await hold(page, 600);
  await dismissModals(page);
}

export async function parkMouse(page: Page): Promise<void> {
  await ensureVisibleCursor(page);
  await page.mouse.move(960, 720, { steps: 18 });
  await syncCursor(page, 960, 720);
}

export async function closeNodeCreator(page: Page): Promise<void> {
  const closeBtn = page.locator(
    '[data-test-id="close-node-creator"], [data-test-id="node-creator-close-button"]',
  );
  if ((await closeBtn.count()) > 0) {
    try {
      await closeBtn.first().click({ timeout: 800 });
      await hold(page, 200);
    } catch {
      // fall through to Escape
    }
  }
  const creator = page.locator('[data-test-id="node-creator"]');
  for (let attempt = 0; attempt < 5; attempt++) {
    if ((await creator.count()) === 0) return;
    const visible = await creator
      .first()
      .isVisible()
      .catch(() => false);
    if (!visible) return;
    await page.keyboard.press('Escape').catch(() => undefined);
    await hold(page, 220);
  }
}

export async function openWorkflowEditor(
  page: Page,
  baseUrl: string,
  workflowId: string,
): Promise<void> {
  page.once('dialog', (dialog) => {
    void dialog.accept().catch(() => undefined);
  });
  await page.goto(`${baseUrl}/workflow/${workflowId}`, {
    waitUntil: 'domcontentloaded',
  });
  await ensureVisibleCursor(page);
  await waitForCanvas(page);
  await dismissModals(page);
  await takeWriteLock(page);
  await closeNodeCreator(page);
  await parkMouse(page);
}

export async function tidyUp(page: Page): Promise<void> {
  const button = page.locator('[data-test-id="tidy-up-button"]');
  if ((await button.count()) === 0) return;
  try {
    await clickLocator(page, button, 8);
    await hold(page, 700);
  } catch {
    // Tidy Up is optional.
  }
}

export async function ndvIsOpen(page: Page): Promise<boolean> {
  const ndv = page.locator('[data-test-id="ndv"], [data-test-id="ndv-modal"]');
  if ((await ndv.count()) === 0) return false;
  return await ndv
    .first()
    .isVisible()
    .catch(() => false);
}

export async function canvasNode(page: Page, name: string): Promise<Locator> {
  return page.locator(`[data-node-name="${name}"]`).first();
}

export async function nodeExists(page: Page, name: string): Promise<boolean> {
  const node = await canvasNode(page, name);
  return (await node.count()) > 0;
}

export async function openNode(page: Page, name: string): Promise<boolean> {
  const node = await canvasNode(page, name);
  if ((await node.count()) === 0) return false;
  await clickLocator(page, node, 12);
  await hold(page, 250);
  await node.dblclick();
  const ndv = page.locator('[data-test-id="ndv"], [data-test-id="ndv-modal"]');
  try {
    await ndv.first().waitFor({ state: 'visible', timeout: 8_000 });
    await hold(page, 400);
    return true;
  } catch {
    return false;
  }
}

export async function closeNDV(page: Page): Promise<void> {
  const close = page.locator('[data-test-id="ndv-close-button"], [data-test-id="back-to-canvas"]');
  if ((await close.count()) > 0) {
    try {
      await close.first().click({ timeout: 2_000 });
      await hold(page, 400);
      await parkMouse(page);
      return;
    } catch {
      // fall through
    }
  }
  await page.keyboard.press('Escape').catch(() => undefined);
  await hold(page, 300);
  await parkMouse(page);
}

async function openNodeCreator(page: Page): Promise<boolean> {
  const already = page.locator('[data-test-id="node-creator"]');
  if (
    (await already.count()) > 0 &&
    (await already
      .first()
      .isVisible()
      .catch(() => false))
  ) {
    return true;
  }

  const triggers = [
    '[data-test-id="canvas-add-first-step-button"]',
    '[data-test-id="instance-ai-canvas-build-manually"]',
    '[data-test-id="canvas-plus-button"]',
    '[data-test-id="node-creator-plus-button"]',
    '[data-test-id="canvas-add-button"]',
  ];
  for (const selector of triggers) {
    const locator = page.locator(selector);
    if ((await locator.count()) === 0) continue;
    try {
      await clickLocator(page, locator, 8);
      await hold(page, 400);
      if ((await already.count()) > 0) return true;
    } catch {
      // try next
    }
  }

  await page.keyboard.press('Tab').catch(() => undefined);
  await hold(page, 400);
  if ((await already.count()) > 0) return true;

  const canvas = page.locator('[data-test-id="canvas"], [data-test-id="workflow-canvas-host"]');
  if ((await canvas.count()) > 0) {
    const box = await canvas.first().boundingBox();
    if (box) {
      await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
      await hold(page, 400);
    }
  }
  return (await already.count()) > 0;
}

export async function addNodeViaCreator(
  page: Page,
  search: string,
  itemName: string,
): Promise<boolean> {
  if (await nodeExists(page, itemName)) return true;
  const opened = await openNodeCreator(page);
  if (!opened) return false;

  const searchBar = page.locator('[data-test-id="node-creator-search-bar"]');
  try {
    await searchBar.first().waitFor({ state: 'visible', timeout: 8_000 });
    const input = searchBar.locator('input').first();
    if ((await input.count()) > 0) {
      await clickLocator(page, input, 6);
      await input.fill('');
      await input.pressSequentially(search, { delay: 90 });
    } else {
      await clickLocator(page, searchBar, 6);
      await page.keyboard.type(search, { delay: 90 });
    }
  } catch {
    await page.keyboard.type(search, { delay: 90 });
  }
  await hold(page, 700);

  const items = page.locator('[data-test-id="node-creator-item-name"]');
  const exact = items.filter({ hasText: new RegExp(`^${escapeRegExp(itemName)}$`) }).first();
  const match = (await exact.count()) > 0 ? exact : items.filter({ hasText: itemName }).first();
  try {
    if ((await match.count()) > 0) {
      await clickLocator(page, match, 8);
    } else {
      await page.getByText(itemName, { exact: true }).first().click({ timeout: 5_000 });
    }
  } catch {
    await page.keyboard.press('Escape').catch(() => undefined);
    return false;
  }

  await hold(page, 900);
  await closeNodeCreator(page);
  await parkMouse(page);
  return await nodeExists(page, itemName);
}

export async function fillMultiline(page: Page, value: string): Promise<void> {
  const editor = page
    .locator('.cm-content, [data-test-id="parameter-input-jsCode"] .cm-content')
    .first();
  if ((await editor.count()) > 0) {
    await clickLocator(page, editor, 6);
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(value);
    await hold(page, 400);
    return;
  }
  await fillParameter(page, 'jsCode', value);
}

export async function fillJsonParameter(
  page: Page,
  parameter: string,
  value: string,
): Promise<void> {
  const field = page
    .locator(
      `[data-parameter-path="parameters.${parameter}"] .cm-content, [data-test-id="parameter-input-${parameter}"] .cm-content, [data-parameter-path="parameters.${parameter}"]`,
    )
    .first();
  if ((await field.count()) > 0) {
    await clickLocator(page, field, 6);
    await fillMultiline(page, value);
    return;
  }
  await fillParameter(page, parameter, value);
}

export async function selectDataTable(page: Page, tableName: string): Promise<void> {
  const fromList = page.getByText('From list', { exact: false }).first();
  if ((await fromList.count()) > 0) {
    try {
      await clickLocator(page, fromList, 12);
      await hold(page, 300);
    } catch {
      // already on list mode
    }
  }

  const field = page
    .locator(
      '[data-test-id="parameter-input-dataTableId"], [data-parameter-path="parameters.dataTableId"]',
    )
    .first();
  if ((await field.count()) > 0) {
    try {
      await clickLocator(page, field, 16);
      await hold(page, 500);
    } catch {
      // try the option search below
    }
  }

  const option = page.getByText(tableName, { exact: true }).first();
  try {
    await option.waitFor({ state: 'visible', timeout: 6_000 });
    await clickLocator(page, option, 16);
    await hold(page, 600);
    return;
  } catch {
    // fall through to typing the name
  }

  await fillParameter(page, 'dataTableId', tableName);
}

export async function fillParameter(page: Page, name: string, value: string): Promise<void> {
  const candidates = [
    page.locator(`[data-parameter-path="parameters.${name}"] input, textarea`).first(),
    page.locator(`[data-parameter-path="${name}"] input, textarea`).first(),
    page.locator(`[data-test-id="parameter-input-${name}"] input, textarea`).first(),
  ];
  for (const locator of candidates) {
    try {
      if ((await locator.count()) === 0) continue;
      await locator.waitFor({ state: 'visible', timeout: 2_000 });
      await clickLocator(page, locator, 6);
      await locator.fill('');
      await locator.pressSequentially(value, { delay: 90 });
      await hold(page, 300);
      return;
    } catch {
      // try next selector
    }
  }
}

export async function renameWorkflow(page: Page, name: string): Promise<void> {
  const input = page.locator('[data-test-id="workflow-name-input"]');
  await input.first().waitFor({ state: 'visible', timeout: 20_000 });
  await clickLocator(page, input, 8);
  await input.first().click({ clickCount: 3 });
  await page.keyboard.press('Control+A');
  await input.first().fill(name);
  await page.keyboard.press('Enter');
  await hold(page, 700);
}

export async function clickExecute(page: Page): Promise<boolean> {
  const button = page.locator(
    '[data-test-id="execute-workflow-button"], [data-test-id="run-workflow-direct-button"]',
  );
  if ((await button.count()) === 0) return false;
  await clickLocator(page, button, 10);
  await parkMouse(page);
  await hold(page, 800);
  return true;
}

export async function waitForNodeSuccess(
  page: Page,
  nodeName: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const node = await canvasNode(page, nodeName);
    const success = node.locator('[data-test-id="canvas-node-status-success"]');
    if (
      (await success.count()) > 0 &&
      (await success
        .first()
        .isVisible()
        .catch(() => false))
    ) {
      return true;
    }
    await hold(page, 1_000);
  }
  return false;
}

export async function openOutputPanel(page: Page): Promise<void> {
  const output = page.locator('[data-test-id="ndv-output-panel"]');
  if ((await output.count()) > 0) {
    try {
      await output.first().click({ timeout: 2_000 });
    } catch {
      // already visible
    }
  }
  await hold(page, 600);
}

export async function openBenchmarksTab(page: Page): Promise<boolean> {
  const tab = page.locator('[data-testid="deepeval-dashboard-tab"]').first();
  try {
    await tab.waitFor({ state: 'visible', timeout: 30_000 });
  } catch {
    const evalRadio = page.locator('[data-test-id="radio-button-evaluation"]').first();
    if ((await evalRadio.count()) === 0) return false;
    await hold(page, 3_000);
    try {
      await tab.waitFor({ state: 'visible', timeout: 20_000 });
    } catch {
      return false;
    }
  }
  await clickLocator(page, tab, 8);
  await hold(page, 1_200);
  return true;
}

export function workflowIdFromUrl(url: string): string | null {
  const match = url.match(/\/workflow\/([^/?#]+)/);
  const id = match?.[1];
  if (!id || id === 'new') return null;
  return id;
}

export async function nodeNameByType(page: Page, type: string): Promise<string | undefined> {
  const node = page.locator(`[data-node-type="${type}"]`).first();
  if ((await node.count()) === 0) return undefined;
  return (await node.getAttribute('data-node-name')) ?? undefined;
}

async function clickNodePlus(
  page: Page,
  name: string,
  position: 'right' | 'bottom',
): Promise<boolean> {
  const node = await canvasNode(page, name);
  if ((await node.count()) === 0) return false;
  await clickLocator(page, node, 8);
  await node.hover();
  await hold(page, 350);

  const scoped = page.locator(`[data-node-name="${name}"]`);
  const plusSelectors = [
    position === 'bottom'
      ? scoped.locator('.vue-flow__handle-bottom [data-test-id*="plus"], .vue-flow__handle-bottom')
      : scoped.locator('.vue-flow__handle-right [data-test-id*="plus"], .vue-flow__handle-right'),
    scoped.locator('[data-test-id="canvas-plus-button"]'),
    scoped.locator('[data-test-id="canvas-node-plus"]'),
    scoped.locator('[data-test-id*="plus"]').last(),
  ];
  for (const locator of plusSelectors) {
    if ((await locator.count()) === 0) continue;
    try {
      await locator.first().click({ timeout: 2_000, force: true });
      await hold(page, 400);
      const creator = page.locator('[data-test-id="node-creator"]');
      if (
        (await creator.count()) > 0 &&
        (await creator
          .first()
          .isVisible()
          .catch(() => false))
      ) {
        return true;
      }
    } catch {
      // try next
    }
  }
  return await openNodeCreator(page);
}

export async function addFromNodePlus(
  page: Page,
  sourceName: string,
  search: string,
  itemName: string,
  plus: 'right' | 'bottom' = 'right',
): Promise<boolean> {
  if (await nodeExists(page, itemName)) return true;
  if (await ndvIsOpen(page)) await closeNDV(page);
  const opened = await clickNodePlus(page, sourceName, plus);
  if (!opened) return false;
  return await addNodeViaCreator(page, search, itemName);
}

async function edgeCount(page: Page): Promise<number> {
  return page
    .locator('.vue-flow__edge, [data-test-id="edge"], [data-test-id="canvas-edge"]')
    .count();
}

export async function canvasHasEdge(
  page: Page,
  fromName: string,
  toName: string,
): Promise<boolean> {
  return page.evaluate(
    ({ fromName, toName }) => {
      const from = document.querySelector(`[data-node-name="${fromName}"]`);
      const to = document.querySelector(`[data-node-name="${toName}"]`);
      if (!from || !to) return false;
      const fromIds = [
        from.getAttribute('data-node-id'),
        from.getAttribute('data-id'),
        from.id,
      ].filter((id): id is string => Boolean(id));
      const toIds = [to.getAttribute('data-node-id'), to.getAttribute('data-id'), to.id].filter(
        (id): id is string => Boolean(id),
      );
      const edges = [
        ...document.querySelectorAll(
          '.vue-flow__edge, [data-test-id="edge"], [data-test-id="canvas-edge"]',
        ),
      ];
      return edges.some((edge) => {
        const src = edge.getAttribute('data-source') ?? '';
        const tgt = edge.getAttribute('data-target') ?? '';
        const blob = `${src} ${tgt} ${edge.getAttribute('data-id') ?? ''} ${edge.id}`;
        const fromHit = fromIds.some((id) => src === id || blob.includes(id));
        const toHit = toIds.some((id) => tgt === id || blob.includes(id));
        return fromHit && toHit;
      });
    },
    { fromName, toName },
  );
}

export async function dragConnect(page: Page, fromName: string, toName: string): Promise<boolean> {
  if (await ndvIsOpen(page)) await closeNDV(page);
  await closeNodeCreator(page);
  const fromNode = page.locator(`[data-node-name="${fromName}"]`);
  const toNode = page.locator(`[data-node-name="${toName}"]`);
  if ((await fromNode.count()) === 0 || (await toNode.count()) === 0) return false;
  try {
    await fromNode.first().waitFor({ state: 'visible', timeout: 5_000 });
    await toNode.first().waitFor({ state: 'visible', timeout: 5_000 });
  } catch {
    return false;
  }
  if (await canvasHasEdge(page, fromName, toName)) return true;

  const before = await edgeCount(page);
  const connected = async (): Promise<boolean> => {
    if (await canvasHasEdge(page, fromName, toName)) return true;
    return (await edgeCount(page)) > before;
  };

  const source = fromNode
    .locator('[data-handlepos="right"], .vue-flow__handle-right, .vue-flow__handle.source')
    .first();
  const targets = [
    toNode
      .locator('[data-handlepos="left"], .vue-flow__handle-left, .vue-flow__handle.target')
      .first(),
    toNode.first(),
  ];
  if ((await source.count()) === 0) return false;
  for (const target of targets) {
    if ((await target.count()) === 0) continue;
    if (!(await dragHandles(page, source, target))) continue;
    await hold(page, 400);
    if (await connected()) return true;
  }
  return false;
}

export async function dragConnectAiModel(
  page: Page,
  fromName: string,
  toName: string,
): Promise<void> {
  const fromNode = page.locator(`[data-node-name="${fromName}"]`);
  const toNode = page.locator(`[data-node-name="${toName}"]`);
  const source = fromNode
    .locator('.vue-flow__handle.source, .vue-flow__handle-top, [data-handlepos="top"]')
    .first();
  const target = toNode
    .locator('.vue-flow__handle-bottom, [data-handlepos="bottom"], .vue-flow__handle.target')
    .last();
  if ((await source.count()) === 0 || (await target.count()) === 0) return;
  await dragHandles(page, source, target);
}

async function dragHandles(page: Page, source: Locator, target: Locator): Promise<boolean> {
  try {
    await source.scrollIntoViewIfNeeded();
    await target.scrollIntoViewIfNeeded();
    const from = await source.boundingBox();
    const to = await target.boundingBox();
    if (!from || !to) return false;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2, {
      steps: 16,
    });
    await hold(page, 250);
    await page.mouse.down();
    await hold(page, 200);
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
      steps: 32,
    });
    await hold(page, 200);
    await page.mouse.up();
    await hold(page, 500);
    return true;
  } catch {
    return false;
  }
}

export async function configureOpenAiChatModel(
  page: Page,
  credentialName: string,
  model: string,
  baseURL: string,
): Promise<void> {
  if (!(await ndvIsOpen(page))) {
    await openNode(page, 'OpenAI Chat Model');
  }
  const cred = page.locator(
    '[data-test-id="node-credentials-select"], [data-test-id="credential-select"]',
  );
  if ((await cred.count()) > 0) {
    try {
      await clickLocator(page, cred, 6);
      const option = page.getByText(credentialName, { exact: false }).first();
      await option.click({ timeout: 5_000 });
      await hold(page, 400);
    } catch {
      await page.keyboard.press('Escape').catch(() => undefined);
    }
  }

  await fillParameter(page, 'model', model);

  const extra = page.getByText('Add Option', { exact: false }).or(page.getByText('Options'));
  if ((await extra.count()) > 0) {
    try {
      await extra.first().click({ timeout: 1_500 });
      await hold(page, 250);
    } catch {
      // already open
    }
  }
  const baseUrlField = page
    .getByLabel('Base URL', { exact: false })
    .or(page.locator('[data-parameter-path="parameters.options.baseURL"] input'));
  if ((await baseUrlField.count()) > 0) {
    try {
      await baseUrlField.first().fill(baseURL);
      await hold(page, 300);
    } catch {
      // ignore
    }
  }
  await hold(page, 1_200);
  await closeNDV(page);
}

export async function openProjectDataTables(
  page: Page,
  baseUrl: string,
  projectId: string,
): Promise<void> {
  await page.goto(`${baseUrl}/projects/${projectId}/datatables`, {
    waitUntil: 'domcontentloaded',
  });
  await ensureVisibleCursor(page);
  await page
    .getByText(/DeepEval Source|DeepEval Results|Data tables|Data Tables/i)
    .first()
    .waitFor({ state: 'visible', timeout: 45_000 });
  await dismissModals(page);
  await hold(page, 700);
}

export async function openNamedDataTable(
  page: Page,
  baseUrl: string,
  projectId: string,
  tableId: string,
  tableName: string,
): Promise<void> {
  const fromList = page.getByText(tableName, { exact: true }).first();
  if ((await fromList.count()) > 0) {
    try {
      await clickLocator(page, fromList, 8);
      await page.getByText(tableName, { exact: false }).first().waitFor({ timeout: 20_000 });
      await hold(page, 800);
      return;
    } catch {
      // fall through to the details URL
    }
  }
  await page.goto(`${baseUrl}/projects/${projectId}/datatables/${tableId}`, {
    waitUntil: 'domcontentloaded',
  });
  await ensureVisibleCursor(page);
  await page.getByText(tableName, { exact: false }).first().waitFor({ timeout: 30_000 });
  await hold(page, 800);
}

export async function tourDataTableGrid(page: Page): Promise<void> {
  const header = page.locator('.ag-header-cell, [role="columnheader"]');
  const headerCount = await header.count();
  for (let i = 0; i < Math.min(headerCount, 6); i++) {
    const cell = header.nth(i);
    if (await cell.isVisible().catch(() => false)) {
      await cell.hover().catch(() => undefined);
      await hold(page, 420);
    }
  }

  const cells = page.locator('.ag-cell, [role="gridcell"]');
  const cellCount = await cells.count();
  for (let i = 0; i < Math.min(cellCount, 8); i++) {
    const cell = cells.nth(i);
    if (await cell.isVisible().catch(() => false)) {
      await cell.hover().catch(() => undefined);
      await hold(page, 380);
    }
  }

  const highlight = page
    .getByText('The answer is 4.', { exact: false })
    .or(page.getByText('actualOutput', { exact: true }))
    .or(page.getByText('overallScore', { exact: true }))
    .or(page.getByText('runId', { exact: true }));
  if ((await highlight.count()) > 0) {
    try {
      await highlight.first().scrollIntoViewIfNeeded();
      await highlight.first().click({ timeout: 2_000 });
      await hold(page, 1_400);
    } catch {
      // cell click is optional
    }
  }

  const viewport = page.locator('.ag-body-horizontal-scroll-viewport, .ag-center-cols-viewport');
  if ((await viewport.count()) > 0) {
    await viewport
      .first()
      .evaluate((el) => {
        el.scrollLeft = el.scrollWidth;
      })
      .catch(() => undefined);
    await hold(page, 1_200);
    await viewport
      .first()
      .evaluate((el) => {
        el.scrollLeft = 0;
      })
      .catch(() => undefined);
    await hold(page, 600);
  }

  const addRow = page.getByRole('button', { name: /Add row/i });
  if ((await addRow.count()) > 0) {
    await addRow
      .first()
      .hover()
      .catch(() => undefined);
    await hold(page, 800);
  }
}
