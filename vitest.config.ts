import { defineConfig } from 'vitest/config';

// One runner for every workspace. Component tests opt into a browser-like
// environment with a `@vitest-environment jsdom` comment at the top of the file.
export default defineConfig({
  test: {
    include: [
      'packages/*/test/**/*.test.{ts,tsx}',
      'example/test/**/*.test.{ts,tsx}',
      'tool/test/**/*.test.mjs',
    ],
    environment: 'node',
    restoreMocks: true,
  },
});
