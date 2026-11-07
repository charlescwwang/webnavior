import { env } from 'node:process'

import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

import { toolValidationPlugin } from '../../apps/order-menu/toolValidationPlugin'
import { firefoxPrivacyPreferences } from '../../apps/stage-kiosk/scripts/firefoxPreferences.mjs'

const browserName = env.VITEST_BROWSER_NAME ?? 'chromium'
if (browserName !== 'chromium' && browserName !== 'firefox')
  throw new Error('VITEST_BROWSER_NAME must be chromium or firefox.')

export default defineConfig({
  root: import.meta.dirname,
  plugins: [toolValidationPlugin()],
  test: {
    include: ['src/services/*.browser.test.ts'],
    browser: {
      api: { host: '127.0.0.1' },
      enabled: true,
      headless: true,
      provider: playwright({ launchOptions: { channel: browserName === 'chromium' ? env.VITEST_BROWSER_CHANNEL : undefined, firefoxUserPrefs: browserName === 'firefox' ? firefoxPrivacyPreferences : undefined } }),
      instances: [{ browser: browserName }],
    },
  },
})
