import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const n8nPort = process.env.N8N_PORT ?? '5678';

export default defineConfig({
  plugins: [react()],
  root: path.resolve(rootDir, 'src/app'),
  base: '/rest/deepeval-dashboard/app/',
  build: {
    outDir: path.resolve(rootDir, 'dist/app'),
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/rest': {
        target: `http://127.0.0.1:${n8nPort}`,
        changeOrigin: true,
        // Vite serves the app; everything else under /rest goes to n8n.
        bypass: (req) =>
          req.url?.startsWith('/rest/deepeval-dashboard/app') ? req.url : undefined,
      },
    },
  },
});
