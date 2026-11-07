import { env } from 'node:process'

import Vue from '@vitejs/plugin-vue'
import Info from 'unplugin-info/vite'
import Yaml from 'unplugin-yaml/vite'

import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

import { toolValidationPlugin } from '../order-menu/toolValidationPlugin'

export default defineConfig({
  root: import.meta.dirname,
  // NOTICE: OpenCC is reached through a workspace display module. Discovering
  // it after a browser test starts reloads that test and invalidates imports.
  // Keep it prebundled while Kiosk presentation uses this dependency.
  // Resolve from stage-ui, which owns OpenCC under pnpm's strict dependencies.
  // NOTICE: lazy MediaPipe discovery during a test reloads other running tests.
  // Prebundle the same real dependency; do not bypass its browser entrypoint.
  optimizeDeps: { include: ['@proj-airi/stage-ui > opencc-js', '@mediapipe/tasks-vision'] },
  // Shared components consume build metadata; use the same provider as Vite.
  plugins: [Vue(), Info(), Yaml(), toolValidationPlugin()],
  test: {
    api: { host: '127.0.0.1' },
    include: ['src/**/*.browser.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({ launchOptions: { channel: env.VITEST_BROWSER_CHANNEL, executablePath: env.VITEST_BROWSER_EXECUTABLE, args: env.VITEST_BROWSER_NAME === 'firefox' ? [] : ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'], firefoxUserPrefs: env.VITEST_BROWSER_NAME === 'firefox' ? { 'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true, 'media.autoplay.default': 0 } : undefined } }),
      instances: [{ browser: env.VITEST_BROWSER_NAME === 'firefox' ? 'firefox' : 'chromium' }],
    },
  },
})
