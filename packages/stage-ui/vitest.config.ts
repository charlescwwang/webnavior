import { join } from 'node:path'
import { cwd, env } from 'node:process'

import Vue from '@vitejs/plugin-vue'
import Info from 'unplugin-info/vite'

import { playwright } from '@vitest/browser-playwright'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

import { toolValidationPlugin } from '../../apps/order-menu/toolValidationPlugin'

export default defineConfig(({ mode }) => {
  return {
    root: import.meta.dirname,
    plugins: [
      Info(),
    ],
    test: {
      projects: [
        {
          extends: true,
          test: {
            name: 'node',
            include: ['src/**/*.test.ts'],
            exclude: ['src/**/*.browser.test.ts'],
            env: loadEnv(mode, join(cwd(), 'packages', 'stage-ui'), ''),
          },
        },
        {
          extends: true,
          plugins: [
            Vue(),
            toolValidationPlugin(),
          ],
          test: {
            name: 'browser',
            include: ['**/*.browser.{spec,test}.ts'],
            exclude: ['**/node_modules/**'],
            browser: {
              enabled: true,
              // Cross-origin fixtures swap localhost and 127.0.0.1; avoid an
              // IPv6-only localhost listener refusing their IPv4 requests.
              api: { host: '127.0.0.1' },
              provider: playwright({ launchOptions: { channel: env.VITEST_BROWSER_CHANNEL } }),
              instances: [
                { browser: 'chromium' },
              ],
            },
          },
        },
      ],
    },
  }
})
