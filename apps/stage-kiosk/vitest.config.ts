import { defineConfig } from 'vitest/config'

/**
 * Keeps Kiosk unit tests independent from the monorepo's browser-development
 * Vite plugins, which otherwise open an excessive number of macOS file watches.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    exclude: ['src/**/*.browser.test.ts'],
  },
})
