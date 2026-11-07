import { resolve } from 'node:path'

import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: ['@proj-airi/stage-shared'] },
      lib: { entry: resolve(import.meta.dirname, 'src/main/index.ts') },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      lib: { entry: resolve(import.meta.dirname, 'src/preload/index.ts'), formats: ['cjs'], fileName: () => 'index.cjs' },
    },
  },
})
