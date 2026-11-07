import { env } from 'node:process'

import Vue from '@vitejs/plugin-vue'
import Info from 'unplugin-info/vite'
import Yaml from 'unplugin-yaml/vite'

import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: import.meta.dirname,
  plugins: [Vue(), Info(), Yaml()],
  test: {
    api: { host: '127.0.0.1' },
    include: ['src/**/*.browser.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({ launchOptions: { channel: env.VITEST_BROWSER_CHANNEL } }),
      instances: [{ browser: 'chromium' }],
    },
  },
})
