import process from 'node:process'

import { firefox } from 'playwright'

import { firefoxPrivacyPreferences } from './firefoxPreferences.mjs'

/**
 * Opens the isolated Kiosk profile using installed Firefox and WebDriver BiDi.
 * Only the existing local Kiosk/PB pair can share unpartitioned login state.
 */
export async function launchFirefox(profileDirectory, { headless = false, env = process.env } = {}) {
  // NOTICE: Playwright 1.60's persistent BiDi startup waits for a load event on
  // its newly created about:blank, which Firefox 159 does not emit. Preserve
  // bidiFirefox.ts's startup arguments explicitly, skipping only that wait.
  // Remove when an upstream fix passes scripts/verifyFirefoxCookiePolicy.mjs
  // without ignoreDefaultArgs. See coreBundle.js loadDefaultContextAsIs and
  // https://github.com/microsoft/playwright/issues/32577.
  return firefox.launchPersistentContext(profileDirectory, {
    channel: 'moz-firefox',
    headless,
    timeout: 30000,
    ignoreDefaultArgs: true,
    args: ['--remote-debugging-port=0', headless ? '--headless' : '--foreground', '--profile', profileDirectory, '-no-remote'],
    env,
    locale: 'zh-TW',
    viewport: { width: 1080, height: 1920 },
    firefoxUserPrefs: {
      ...firefoxPrivacyPreferences,
      // Mozilla's pair format matches both origins, including scheme/port.
      // No wildcard or global storage-partitioning override is used.
      // https://github.com/mozilla-firefox/firefox/blob/main/toolkit/components/antitracking/PartitioningExceptionList.cpp
      'privacy.restrict3rdpartystorage.skip_list': 'http://localhost:5169,https://app.esgpb.com',
    },
  })
}
