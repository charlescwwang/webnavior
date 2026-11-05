import { resolve } from 'node:path'

import { loadConfigFromFile } from 'vite'
import { afterEach, expect, it, vi } from 'vitest'

const configFile = resolve(import.meta.dirname, '../../vite.config.ts')
afterEach(() => vi.unstubAllEnvs())

// Report: this chat, 2026-11-05 — the clean release omitted the existing local PIN.
it('refuses a public Kiosk build when its operator PIN was not carried into the build environment', async () => {
  vi.stubEnv('VITE_API_SERVER_URL', 'https://kiosk.example.test')
  vi.stubEnv('VITE_KIOSK_ADMIN_PIN', '')
  await expect(loadConfigFromFile({ command: 'build', mode: 'production' }, configFile)).rejects.toThrow('VITE_KIOSK_ADMIN_PIN')
})
it('accepts an explicitly inherited PIN for a public build without embedding its value in diagnostics', async () => {
  vi.stubEnv('VITE_API_SERVER_URL', 'https://kiosk.example.test')
  vi.stubEnv('VITE_KIOSK_ADMIN_PIN', 'test-only-build-pin')
  expect(await loadConfigFromFile({ command: 'build', mode: 'production' }, configFile)).not.toBeNull()
})
it('keeps local development builds usable without an operator PIN', async () => {
  vi.stubEnv('VITE_API_SERVER_URL', 'http://localhost:5168')
  vi.stubEnv('VITE_KIOSK_ADMIN_PIN', '')
  expect(await loadConfigFromFile({ command: 'build', mode: 'production' }, configFile)).not.toBeNull()
})
