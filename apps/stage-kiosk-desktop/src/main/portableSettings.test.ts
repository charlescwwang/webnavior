import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it } from 'vitest'

import { defaultConnections, readPortableSettings } from './portableSettings'

const connections = [
  { label: '現場區域網路', url: 'http://172.17.69.17:5169/kiosk/' },
  { label: 'Tailscale 內網', url: 'http://100.92.1.80:5169/kiosk/' },
  { label: 'Webnavior 公開網域', url: 'https://webnavior.aikcitri.qzz.io/kiosk/' },
]
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
  const settings = { kioskUrl: 'https://webnavior.aikcitri.qzz.io/kiosk/', windowed: false, diagnosticPort: 0, connections }
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
  const path = await settingsFile(JSON.stringify({ kioskUrl: connections[2]!.url, windowed: false, diagnosticPort: 0, connections, ...change }))
  expect(() => readPortableSettings(path)).toThrow()
})

it('rejects invalid JSON and a missing file instead of silently using another server', async () => {
  const path = await settingsFile('{')
  expect(() => readPortableSettings(path)).toThrow()
  await rm(path)
  expect(() => readPortableSettings(path)).toThrow()
})

it('reads the configured LAN Kiosk entry', async () => {
  const settings = { kioskUrl: 'http://100.92.1.80:5169/kiosk/', windowed: true, diagnosticPort: 0, connections }
  expect(await readPortableSettings(await settingsFile(JSON.stringify(settings)))).toEqual(settings)
})

// Report: this chat, 2026-11-18 — the 0.4.0 Host rejects the new on-site connection.
it('reads all three entries and lets the operator change their URLs without rebuilding', async () => {
  const settings = { kioskUrl: connections[0]!.url, connections, windowed: false, diagnosticPort: 0 }
  expect(readPortableSettings(await settingsFile(JSON.stringify(settings)))).toEqual(settings)
  const changed = { ...settings, kioskUrl: 'http://192.168.8.20:5169/kiosk/', connections: [{ label: '搬移後的現場', url: 'http://192.168.8.20:5169/kiosk/' }, ...connections.slice(1)] }
  expect(readPortableSettings(await settingsFile(JSON.stringify(changed)))).toEqual(changed)
})

it.each([
  [],
  [connections[0], connections[0]],
  [{ label: '', url: connections[0]!.url }],
  [{ label: 'bad', url: 'https://user:secret@example.com/kiosk/' }],
  [{ label: 'bad', url: 'http://172.17.69.17:5169/menu/' }],
].map(entries => ({ entries })))('rejects an invalid connection list: %j', async ({ entries }) => {
  const path = await settingsFile(JSON.stringify({ kioskUrl: connections[0]!.url, windowed: false, diagnosticPort: 0, connections: entries }))
  expect(() => readPortableSettings(path)).toThrow()
})

it('rejects a default that is not one of the configured entries', async () => {
  const path = await settingsFile(JSON.stringify({ kioskUrl: 'https://other.example/kiosk/', windowed: false, diagnosticPort: 0, connections }))
  expect(() => readPortableSettings(path)).toThrow()
})

it('ships the same three editable entries used by source launches', () => {
  const settings = readPortableSettings(new URL('../../kiosk.settings.example.json', import.meta.url).pathname)
  expect(settings.connections).toEqual(defaultConnections)
  expect(settings.kioskUrl).toBe('http://172.17.69.17:5169/kiosk/')
})
