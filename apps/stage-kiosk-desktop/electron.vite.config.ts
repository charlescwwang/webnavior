import { resolve } from 'node:path'

import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: {
      // The portable app ships compiled JavaScript, without a Node dependency tree.
      externalizeDeps: false,
      lib: { entry: resolve(import.meta.dirname, 'src/main/index.ts'), formats: ['es'], fileName: () => 'index.js' },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      lib: { entry: resolve(import.meta.dirname, 'src/preload/index.ts'), formats: ['cjs'], fileName: () => 'index.cjs' },
    },
  },
})
