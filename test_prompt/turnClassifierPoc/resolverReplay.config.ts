import { defineConfig } from 'vitest/config'

// Scope execution to the consuming app's real dependency boundary. The model
// artifacts remain independent and the live benchmark is explicitly opt-in.
export default defineConfig({
  root: new URL('../../apps/order-menu', import.meta.url).pathname,
  test: { include: ['src/resolverPoc.test.ts'], testTimeout: 120_000 },
})
