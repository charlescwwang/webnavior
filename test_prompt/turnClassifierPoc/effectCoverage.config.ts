import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: new URL('../../apps/order-menu', import.meta.url).pathname,
  test: { include: ['src/experiments/effectCoveragePoc.test.ts'] },
})
