import { resolve } from 'node:path'

import { loadConfigFromFile } from 'vite'
import { afterEach, expect, it, vi } from 'vitest'

const configFile = resolve(import.meta.dirname, '../../vite.config.ts')
afterEach(() => vi.unstubAllEnvs())

// Report: this chat Nov8 — operator credentials now belong to the Server.
it('builds a public Kiosk without a browser-embedded operator PIN', async () => {
  vi.stubEnv('VITE_API_SERVER_URL', 'https://kiosk.example.test')
  vi.stubEnv('VITE_KIOSK_ADMIN_PIN', '')
  expect(await loadConfigFromFile({ command: 'build', mode: 'production' }, configFile)).not.toBeNull()
})
it('keeps local development builds usable without a browser PIN', async () => {
  vi.stubEnv('VITE_API_SERVER_URL', 'http://localhost:5168')
  vi.stubEnv('VITE_KIOSK_ADMIN_PIN', '')
  expect(await loadConfigFromFile({ command: 'build', mode: 'production' }, configFile)).not.toBeNull()
})
