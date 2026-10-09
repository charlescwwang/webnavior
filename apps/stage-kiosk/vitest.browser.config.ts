import { env } from 'node:process'

import Vue from '@vitejs/plugin-vue'
import Info from 'unplugin-info/vite'

import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Shared components consume build metadata; use the same provider as Vite.
  plugins: [Vue(), Info()],
  test: {
    include: ['src/**/*.browser.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({ launchOptions: { channel: env.VITEST_BROWSER_CHANNEL } }),
      instances: [{ browser: 'chromium' }],
    },
  },
})
