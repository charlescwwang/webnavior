import { env } from 'node:process'

import Vue from '@vitejs/plugin-vue'
import Unocss from 'unocss/vite'
import Info from 'unplugin-info/vite'
import Yaml from 'unplugin-yaml/vite'

import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: import.meta.dirname,
  // NOTICE: OpenCC is reached through a workspace display module. Discovering
  // it after a browser test starts reloads that test and invalidates imports.
  // Keep it prebundled while Kiosk presentation uses this dependency.
  // Resolve from stage-ui, which owns OpenCC under pnpm's strict dependencies.
  optimizeDeps: { include: ['@proj-airi/stage-ui > opencc-js', '@ennuicastr/webrtcaec3.js', 'fft.js', '@mediapipe/tasks-vision'] },
  // Shared components consume build metadata; use the same provider as Vite.
  plugins: [Vue(), Info(), Yaml(), Unocss()],
  test: {
    env: { VITEST_FAKE_MEDIA: env.VITEST_FAKE_MEDIA ?? '' },
    api: { host: '127.0.0.1' },
    include: ['src/**/*.browser.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({ launchOptions: { channel: env.VITEST_BROWSER_CHANNEL, args: env.VITEST_FAKE_MEDIA === '1' ? ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] : [] } }),
      instances: [{ browser: 'chromium' }],
    },
  },
})
