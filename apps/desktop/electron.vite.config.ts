import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

// The core package is TypeScript source in the workspace, so it is bundled
// rather than externalized. Native and runtime-downloaded modules stay external.
const bundled = ['@meeting-assistant/core'];

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: bundled },
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'transcription-worker': resolve(__dirname, 'src/main/transcription/worker.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      // Sandboxed preloads must be single files: the two preloads share no modules,
      // so no shared chunk is emitted (see test/preload.test.ts).
      externalizeDeps: false,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          capture: resolve(__dirname, 'src/preload/capture.ts'),
        },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    build: {
      minify: true,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          capture: resolve(__dirname, 'src/renderer/capture.html'),
        },
      },
    },
  },
});
