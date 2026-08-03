type ExternalHookStore = Record<string, unknown>;
type MountHook = (store: ExternalHookStore, meta: Record<string, unknown>) => void;

const PANEL_ID = 'deepeval-dashboard-panel';
const TAB_ATTR = 'data-deepeval-dashboard-tab';
const IFRAME_ATTR = 'data-deepeval-dashboard-iframe';
const WIRED_ATTR = 'data-deepeval-dashboard-wired';

let active = false;
let appBaseUrl = '/rest/deepeval-dashboard/app/';
let observer: MutationObserver | null = null;
let configLoaded = false;

function workflowIdFromLocation(): string | null {
  const match = window.location.pathname.match(/\/workflow\/([^/?#]+)/);
  return match?.[1] ?? null;
}

function iframeUrl(): string {
  const url = new URL(appBaseUrl, window.location.origin);
  const workflowId = workflowIdFromLocation();
  if (workflowId) url.searchParams.set('workflowId', workflowId);
  return url.origin === window.location.origin ? `${url.pathname}${url.search}` : url.href;
}

async function fetchConfig(): Promise<{ appUrl: string }> {
  const response = await fetch('/rest/deepeval-dashboard/config', { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Failed to load DeepEval dashboard config (${response.status})`);
  }
  return response.json() as Promise<{ appUrl: string }>;
}

function findEvaluationsLabel(): HTMLLabelElement | null {
  return (
    [...document.querySelectorAll<HTMLLabelElement>('label.n8n-radio-button')].find((label) => {
      if (label.hasAttribute(TAB_ATTR)) return false;
      return label.querySelector('[data-test-id="radio-button-evaluation"]') !== null;
    }) ?? null
  );
}

function contentMain(): HTMLElement {
  const header = document.querySelector('header');
  const main = header?.parentElement?.querySelector('main');
  if (!main) throw new Error('n8n main content not found');
  return main;
}

function ensurePanel(): HTMLElement {
  const existing = document.getElementById(PANEL_ID);
  if (existing) {
    const iframe = existing.querySelector<HTMLIFrameElement>(`iframe[${IFRAME_ATTR}]`);
    const next = iframeUrl();
    // Only touch src when the URL changes — reassigning reloads the iframe.
    if (iframe && iframe.dataset.src !== next) {
      iframe.dataset.src = next;
      iframe.src = next;
    }
    return existing;
  }

  const main = contentMain();
  if (getComputedStyle(main).position === 'static') main.style.position = 'relative';

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.style.cssText =
    'display:none;position:absolute;inset:0;z-index:1;background:var(--color--background, #fafafa)';

  const next = iframeUrl();
  const iframe = document.createElement('iframe');
  iframe.setAttribute(IFRAME_ATTR, 'true');
  iframe.title = 'Benchmarks';
  iframe.dataset.src = next;
  iframe.src = next;
  iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;background:inherit';
  panel.appendChild(iframe);
  main.appendChild(panel);
  return panel;
}

function setPanelVisible(visible: boolean): void {
  const panel = document.getElementById(PANEL_ID);
  if (panel) panel.style.display = visible ? 'block' : 'none';
}

function setTabActive(tab: HTMLElement, isActive: boolean): void {
  const button = tab.querySelector<HTMLElement>('[data-deepeval-dashboard-button]');
  if (!button) throw new Error('DeepEval dashboard tab button missing');
  tab.setAttribute('aria-checked', isActive ? 'true' : 'false');
  button.classList.toggle('_active_15iso_131', isActive);
}

function deactivateNativeRadios(group: HTMLElement): void {
  for (const label of group.querySelectorAll<HTMLLabelElement>('label.n8n-radio-button')) {
    if (label.hasAttribute(TAB_ATTR)) continue;
    label.setAttribute('aria-checked', 'false');
    label.querySelector('[data-test-id^="radio-button-"]')?.classList.remove('_active_15iso_131');
  }
}

function deactivateDashboard(): void {
  if (!active) return;
  active = false;
  setPanelVisible(false);
  const tab = document.querySelector<HTMLElement>(`label[${TAB_ATTR}]`);
  if (tab) setTabActive(tab, false);
}

function activateDashboard(tab: HTMLElement): void {
  active = true;
  ensurePanel();
  setPanelVisible(true);
  setTabActive(tab, true);
  const group = tab.closest('.n8n-radio-buttons');
  if (!(group instanceof HTMLElement)) throw new Error('n8n radio group not found');
  deactivateNativeRadios(group);
}

function wireRadioGroup(tab: HTMLElement): void {
  const group = tab.closest('.n8n-radio-buttons');
  if (!(group instanceof HTMLElement) || group.hasAttribute(WIRED_ATTR)) return;
  group.setAttribute(WIRED_ATTR, 'true');
  group.addEventListener(
    'click',
    (event) => {
      const target = event.target as HTMLElement;
      if (target.closest(`[${TAB_ATTR}]`)) return;
      if (!target.closest('label.n8n-radio-button')) return;
      deactivateDashboard();
    },
    true,
  );
}

function createDashboardTab(templateLabel: HTMLLabelElement): HTMLElement {
  const templateButton = templateLabel.querySelector<HTMLElement>(
    '[data-test-id^="radio-button-"]',
  );
  if (!templateButton) throw new Error('n8n radio button template missing');

  const tab = document.createElement('label');
  tab.setAttribute(TAB_ATTR, 'true');
  tab.setAttribute('role', 'radio');
  tab.setAttribute('tabindex', '-1');
  tab.setAttribute('aria-checked', 'false');
  tab.className = templateLabel.className;

  const button = document.createElement('div');
  button.setAttribute('data-deepeval-dashboard-button', 'true');
  button.setAttribute('data-testid', 'deepeval-dashboard-tab');
  button.textContent = 'Benchmarks';
  button.className = templateButton.className;
  button.classList.remove('_active_15iso_131');
  tab.appendChild(button);

  tab.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (active) deactivateDashboard();
    else activateDashboard(tab);
  });

  return tab;
}

function injectTab(): void {
  if (document.querySelector(`label[${TAB_ATTR}]`)) {
    if (active) ensurePanel();
    return;
  }

  const evaluations = findEvaluationsLabel();
  if (!evaluations) return;

  const tab = createDashboardTab(evaluations);
  evaluations.insertAdjacentElement('afterend', tab);
  wireRadioGroup(tab);
}

async function bootstrap(): Promise<void> {
  if (!configLoaded) {
    appBaseUrl = (await fetchConfig()).appUrl;
    configLoaded = true;
  }
  injectTab();
  if (!observer) {
    observer = new MutationObserver(() => injectTab());
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

const mountHooks: MountHook[] = [() => void bootstrap()];

const hooks = {
  app: { mount: mountHooks },
  nodeView: { mount: mountHooks },
  main: { routeChange: mountHooks },
};

declare global {
  interface Window {
    n8nExternalHooks?: typeof hooks;
  }
}

window.n8nExternalHooks = hooks;

export default hooks;
