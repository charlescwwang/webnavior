import { env } from 'node:process'

import Vue from '@vitejs/plugin-vue'
import Info from 'unplugin-info/vite'
import Yaml from 'unplugin-yaml/vite'

import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: import.meta.dirname,
  // NOTICE: OpenCC is reached through a workspace display module. Discovering
  // it after a browser test starts reloads that test and invalidates imports.
  // Keep it prebundled while Kiosk presentation uses this dependency.
  optimizeDeps: { include: ['opencc-js'] },
  // Shared components consume build metadata; use the same provider as Vite.
  plugins: [Vue(), Info(), Yaml()],
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
