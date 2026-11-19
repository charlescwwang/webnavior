import { Buffer } from 'node:buffer'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it, vi } from 'vitest'

import { Diagnostics } from './diagnostics'

const directories: string[] = []
const recorders: Diagnostics[] = []
async function recorder() {
  const directory = await mkdtemp(join(tmpdir(), 'kiosk-diagnostics-unit-'))
  directories.push(directory)
  const diagnostics = new Diagnostics(directory, () => [])
  recorders.push(diagnostics)
  return { directory, diagnostics }
}

afterEach(async () => {
  for (const diagnostics of recorders.splice(0))
    await diagnostics.dispose()
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
  vi.restoreAllMocks()
})

// Report: this chat, Nov19 — diagnose intermittent PB stalls without recording order/customer data.
it('persists only declared operation names and hashed correlation, and drops late work after disposal', async () => {
  const { directory, diagnostics } = await recorder()
  const finish = diagnostics.operation('browser_start_ordering', 'private-operation-id')
  finish()
  diagnostics.operation('private-customer-text', 'private-operation-id')()
  await diagnostics.dispose()
  const before = await readFile(join(directory, 'current.jsonl'), 'utf8')
  finish()
  await diagnostics.flush()
  expect(await readFile(join(directory, 'current.jsonl'), 'utf8')).toBe(before)
  expect(before).not.toContain('private-operation-id')
  expect(before).not.toContain('private-customer-text')
  const rows = before.trim().split('\n').map(line => JSON.parse(line))
  expect(rows.find(row => row.event === 'operation-start').name).toBe('browser_start_ordering')
  expect(rows.find(row => row.event === 'operation-finished').correlation).toBe(rows.find(row => row.event === 'operation-start').correlation)
  expect(rows.at(-1).event).toBe('recorder-stop')
})

it('rotates to three bounded files and explicitly reports dropped records under a burst', async () => {
  const { directory, diagnostics } = await recorder()
  await writeFile(join(directory, 'current.jsonl'), Buffer.alloc(4 * 1024 * 1024, 32))
  await writeFile(join(directory, 'previous.jsonl'), 'previous')
  await writeFile(join(directory, 'older.jsonl'), 'discarded')
  for (let index = 0; index < 1000; index++)
    diagnostics.operation('browser_cart_get', String(index))()
  await diagnostics.flush()
  expect((await readdir(directory)).sort()).toEqual(['current.jsonl', 'older.jsonl', 'previous.jsonl'])
  expect(await readFile(join(directory, 'older.jsonl'), 'utf8')).toBe('previous')
  const rows = (await readFile(join(directory, 'current.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  expect(rows.length).toBeLessThanOrEqual(512)
  expect(rows.at(-1).event).toBe('records-dropped')
  expect(rows.at(-1).count).toBeGreaterThan(1000)
})

it('contains a disk failure and permits subsequent diagnostic writes', async () => {
  const { directory } = await recorder()
  const target = join(directory, 'blocked')
  await writeFile(target, 'not a directory')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const diagnostics = new Diagnostics(target, () => [])
  recorders.push(diagnostics)
  await expect(diagnostics.flush()).resolves.toBeUndefined()
  await rm(target)
  diagnostics.operation('browser_customer_reset', 'operation')()
  await diagnostics.flush()
  expect(await readFile(join(target, 'current.jsonl'), 'utf8')).toContain('browser_customer_reset')
})
