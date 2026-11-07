import { resolve } from 'node:path'

import { build } from 'vite'

await build({
  configFile: false,
  root: resolve(import.meta.dirname, '../packages/stage-ui'),
  build: {
    outDir: resolve(import.meta.dirname, '../apps/stage-kiosk-desktop/out/service'),
    emptyOutDir: true,
    lib: { entry: 'src/services/pbBrowserNativeEntry.ts', name: 'PbService', formats: ['iife'], fileName: () => 'pb.js' },
  },
})
