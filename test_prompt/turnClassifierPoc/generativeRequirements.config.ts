import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: new URL('../../apps/server', import.meta.url).pathname,
  test: { include: ['tests/experiments/generativeRequirements.test.ts'] },
})
