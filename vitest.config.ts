import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    globalSetup: ['./tests/setup.ts'],
    hookTimeout: 60_000,
    testTimeout: 20_000,
  },
});
