import { env } from 'node:process'

import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

import { toolValidationPlugin } from '../../apps/order-menu/toolValidationPlugin'

export default defineConfig({
  root: import.meta.dirname,
  plugins: [toolValidationPlugin()],
  test: {
    include: ['src/services/*.browser.test.ts'],
    browser: {
      api: { host: '127.0.0.1' },
      enabled: true,
      headless: true,
      provider: playwright({ launchOptions: { channel: env.VITEST_BROWSER_CHANNEL, executablePath: env.VITEST_BROWSER_EXECUTABLE } }),
      instances: [{ browser: env.VITEST_BROWSER_NAME === 'firefox' ? 'firefox' : 'chromium' }],
    },
  },
})
