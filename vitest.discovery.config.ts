import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['e2e/generated/*.e2e.test.ts'],
  },
});
