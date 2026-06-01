import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': new URL('./src', import.meta.url).pathname }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup/dom.ts'],
    include: ['tests/unit/**/*.test.ts'],
    coverage: { provider: 'v8', reporter: ['text', 'html'], reportsDirectory: 'coverage' }
  }
});
