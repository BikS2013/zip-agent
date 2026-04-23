import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Disable PostCSS lookup so a parent directory's postcss.config.js
  // doesn't accidentally apply to this Node-only test runner.
  css: {
    postcss: { plugins: [] },
  },
  test: {
    include: ['test_scripts/**/*.spec.ts'],
    environment: 'node',
    globals: false,
    reporters: 'default',
    pool: 'forks',
    testTimeout: 15_000,
  },
});
