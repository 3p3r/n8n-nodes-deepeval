import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export type E2ETestTarget = 'src' | 'out';

const root = resolve(import.meta.dirname, '..');

export function parseE2ETestTarget(argv: readonly string[] = process.argv): E2ETestTarget {
  const flag = argv.find((arg) => arg.startsWith('--test='));
  if (!flag) return 'src';
  const value = flag.slice('--test='.length);
  if (value === 'src' || value === 'out') return value;
  throw new Error(`Invalid --test= value "${value}". Expected "src" or "out".`);
}

export function customExtensionsDirectory(target: E2ETestTarget = parseE2ETestTarget()): string {
  const directory = target === 'out' ? resolve(root, 'out') : resolve(root, 'packages/nodes/dist');
  if (target === 'out') {
    if (!existsSync(resolve(directory, 'package.json'))) {
      throw new Error('--test=out requires a built out/ directory. Run "npm run build" first.');
    }
    if (!existsSync(resolve(directory, 'dist'))) {
      throw new Error('--test=out requires out/dist. Run "npm run build" first.');
    }
  }
  return directory;
}
