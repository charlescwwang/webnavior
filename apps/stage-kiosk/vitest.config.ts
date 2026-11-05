import { defineConfig } from 'vitest/config'

import { toolValidationPlugin } from '../order-menu/toolValidationPlugin'

/**
 * Keeps Kiosk unit tests independent from the monorepo's browser-development
 * Vite plugins, which otherwise open an excessive number of macOS file watches.
 */
export default defineConfig({
  plugins: [toolValidationPlugin()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.browser.test.ts'],
  },
})
