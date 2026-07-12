import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['e2e/generated/*.e2e.test.ts'],
    globalSetup: ['e2e/global-setup.ts'],
    isolate: false,
    fileParallelism: false,
    hookTimeout: 600_000,
    testTimeout: 1_500_000,
    sequence: {
      concurrent: false,
    },
  },
});
