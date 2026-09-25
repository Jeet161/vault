import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    alias: {
      '@vault/shared': path.resolve(__dirname, './packages/shared/src/index.ts'),
      '@vault/db': path.resolve(__dirname, './packages/db/src/index.ts')
    }
  }
});
