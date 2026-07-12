import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const projectRoot = import.meta.dirname;
const sourceRoot = resolve(projectRoot, 'src');

function collectNodeEntries(directory: string): Record<string, string> {
  const entries: Record<string, string> = {};

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      Object.assign(entries, collectNodeEntries(absolutePath));
      continue;
    }

    if (!entry.name.endsWith('.node.ts')) continue;
    const outputName = relative(sourceRoot, absolutePath).replaceAll(sep, '/').replace(/\.ts$/, '');
    entries[outputName] = absolutePath;
  }

  return entries;
}

function copyRuntimeAssets(): Plugin {
  return {
    name: 'copy-deepeval-assets',
    closeBundle() {
      const distRoot = resolve(projectRoot, 'dist');
      const runtimeAssets = resolve(projectRoot, '../runtime/assets');
      if (existsSync(runtimeAssets)) {
        cpSync(runtimeAssets, resolve(distRoot, 'assets'), { recursive: true });
      }

      const copyCodex = (directory: string) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          const absolutePath = resolve(directory, entry.name);
          if (entry.isDirectory()) {
            copyCodex(absolutePath);
          } else if (entry.name.endsWith('.node.json')) {
            const target = resolve(distRoot, relative(sourceRoot, absolutePath));
            mkdirSync(dirname(target), { recursive: true });
            cpSync(absolutePath, target);
          }
        }
      };
      copyCodex(sourceRoot);
    },
  };
}

export default defineConfig({
  plugins: [copyRuntimeAssets()],
  build: {
    target: 'node20',
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      preserveEntrySignatures: 'strict',
      input: collectNodeEntries(sourceRoot),
      external: ['n8n-workflow', 'pyodide', /^node:/, /^@langchain\//],
      output: {
        format: 'cjs',
        entryFileNames: '[name].js',
        chunkFileNames: 'shared/[name]-[hash].js',
        exports: 'named',
      },
    },
    sourcemap: true,
    minify: false,
  },
});
