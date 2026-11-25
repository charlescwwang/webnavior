import { fileURLToPath } from 'node:url'

import vue from '@vitejs/plugin-vue'

import { build } from 'vite'

/** Bundle the real Kiosk payment control for the offline Electron merchant journey. */
export async function buildPaymentReturnFixture() {
  const [bundle] = await build({
    configFile: false,
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    logLevel: 'error',
    plugins: [vue()],
    build: {
      write: false,
      lib: { entry: fileURLToPath(new URL('../tests/paymentReturnFixture.ts', import.meta.url)), name: 'KioskPaymentFixture', formats: ['iife'] },
    },
  })
  return bundle.output.find(file => file.type === 'chunk' && file.isEntry).code
}
