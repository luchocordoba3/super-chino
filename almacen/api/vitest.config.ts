import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: './test/global-setup.ts',
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
    env: { UPLOAD_DIR: join(tmpdir(), 'almacen-test-uploads') },
  },
});
