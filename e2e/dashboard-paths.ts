import { accessSync } from 'node:fs';
import { resolve } from 'node:path';
import type { E2ETestTarget } from './test-target.js';

const root = resolve(import.meta.dirname, '..');

/** Absolute path to dashboard hooks.cjs for EXTERNAL_HOOK_FILES. */
export function dashboardHooksPath(testTarget: E2ETestTarget): string {
  const path =
    testTarget === 'out'
      ? resolve(root, 'out/dashboard/backend/hooks.cjs')
      : resolve(root, 'packages/dashboard/dist/backend/hooks.cjs');
  accessSync(path);
  return path;
}

export function dashboardBridgeUrl(baseUrl: string): string {
  return `${baseUrl}/rest/deepeval-dashboard/bridge.js`;
}
