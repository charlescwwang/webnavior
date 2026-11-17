import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it } from 'vitest'

import { readPortableSettings } from './portableSettings'

const temporary: string[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function settingsFile(text: string) {
  const directory = await mkdtemp(join(tmpdir(), 'kiosk settings '))
  temporary.push(directory)
  const path = join(directory, 'kiosk.settings.json')
  await writeFile(path, text)
  return path
}

it('reads a Notepad UTF-8 configuration from a directory containing spaces', async () => {
  const settings = { kioskUrl: 'https://webnavior.aikcitri.qzz.io/kiosk/', windowed: false, diagnosticPort: 0 }
  const path = await settingsFile(`\uFEFF${JSON.stringify(settings)}`)
  expect(await readPortableSettings(path)).toEqual(settings)
})

it.each([
  { kioskUrl: 'http://192.168.1.2/kiosk/' },
  { kioskUrl: 'https://user:password@example.com/kiosk/' },
  { kioskUrl: 'https://example.com/admin/' },
  { kioskUrl: 'https://example.com/kiosk/?key=secret' },
  { windowed: 'false' },
  { diagnosticPort: 80 },
  { diagnosticPort: 70000 },
  { diagnosticPort: 9222.5 },
])('rejects an unsafe or malformed setting: %j', async (change) => {
  const path = await settingsFile(JSON.stringify({ kioskUrl: 'https://example.com/kiosk/', windowed: false, diagnosticPort: 0, ...change }))
  await expect(readPortableSettings(path)).rejects.toThrow()
})

it('rejects invalid JSON and a missing file instead of silently using another server', async () => {
  const path = await settingsFile('{')
  await expect(readPortableSettings(path)).rejects.toThrow()
  await rm(path)
  await expect(readPortableSettings(path)).rejects.toThrow()
})

it('reads the configured LAN Kiosk entry', async () => {
  const settings = { kioskUrl: 'http://100.92.1.80:5169/kiosk/', windowed: true, diagnosticPort: 0 }
  expect(await readPortableSettings(await settingsFile(JSON.stringify(settings)))).toEqual(settings)
})
