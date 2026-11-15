import type { OrderEvidenceEnvelope } from '@proj-airi/stage-shared/order-evidence'

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it } from 'vitest'

import { OrderEvidenceSpool } from './orderEvidenceSpool'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'pb-evidence-spool-'))
  directories.push(directory)
  return { directory, spool: new OrderEvidenceSpool(directory) }
}
function evidence(id = 'evidence-1'): OrderEvidenceEnvelope {
  const payloadJson = '{"order":{"hash":"original-order","totalmoney":50}}'
  return { schemaVersion: 1, evidenceId: id, bindingId: 'original-visitor-binding', source: 'page', capturedAt: '2026-11-15T12:00:00.000Z', sourcePath: '/order/store/store/internal_use/orders/original-order', sanitizerVersion: 1, payloadJson, payloadHash: createHash('sha256').update(payloadJson).digest('hex'), byteSize: Buffer.byteLength(payloadJson) }
}
const ack = (item: OrderEvidenceEnvelope) => ({ schemaVersion: 1, evidenceId: item.evidenceId, payloadHash: item.payloadHash, byteSize: item.byteSize, storedAt: '2026-11-15T12:01:00.000Z', durabilityVersion: 1 })

// Report: this chat, 2026-11-15; process restart must not lose pending original-order evidence.
it('recovers identical bytes and original binding after constructing a fresh spool', async () => {
  const { directory, spool } = await setup()
  await spool.enqueue(evidence())
  expect(await new OrderEvidenceSpool(directory).pending()).toEqual([evidence()])
  const files = await readdir(directory)
  expect(files).toHaveLength(1)
  expect(JSON.parse(await readFile(join(directory, files[0]), 'utf8'))).toEqual(evidence())
})
it('keeps evidence after offline upload and removes only after an exact durable ACK', async () => {
  const { spool } = await setup()
  await spool.enqueue(evidence())
  const offline = await spool.flush(async () => {
    throw new Error('offline')
  })
  expect(offline.stored).toBe(0)
  expect(offline.errors).toHaveLength(1)
  expect(await spool.pending()).toEqual([evidence()])
  expect(await spool.flush(async item => ack(item))).toEqual({ stored: 1, errors: [] })
  expect(await spool.pending()).toEqual([])
})
it.each(['evidenceId', 'payloadHash', 'byteSize', 'durabilityVersion'] as const)('retains queued evidence when ACK %s is wrong', async (field) => {
  const { spool } = await setup()
  await spool.enqueue(evidence())
  const response = { ...ack(evidence()), [field]: field === 'byteSize' ? 999 : field === 'durabilityVersion' ? 2 : 'wrong' }
  const result = await spool.flush(async () => response)
  expect(result.stored).toBe(0)
  expect(result.errors).toHaveLength(1)
  expect(await spool.pending()).toEqual([evidence()])
})
it('deduplicates an exact retry and rejects the same evidence identity with changed bytes', async () => {
  const { spool } = await setup()
  await Promise.all([spool.enqueue(evidence()), spool.enqueue(evidence())])
  expect(await spool.pending()).toEqual([evidence()])
  await expect(spool.enqueue({ ...evidence(), bindingId: 'different-visitor' })).rejects.toThrow('identity')
  expect(await spool.pending()).toEqual([evidence()])
})
it('validates content hash and UTF-8 size before writing any file', async () => {
  const { directory, spool } = await setup()
  await expect(spool.enqueue({ ...evidence(), payloadJson: '{"order":"changed"}' })).rejects.toThrow('integrity')
  expect(await readdir(directory)).toEqual([])
})

// Report: independent acceptance review, 2026-11-15; one corrupt record must not block healthy uploads.
it('retains a corrupt record for diagnosis while flushing unrelated valid evidence', async () => {
  const { directory, spool } = await setup()
  await spool.enqueue(evidence())
  const corruptName = `${'a'.repeat(64)}.json`
  await writeFile(join(directory, corruptName), '{broken', { mode: 0o600 })
  const result = await spool.flush(async item => ack(item))
  expect(result.stored).toBe(1)
  expect(result.errors).toHaveLength(1)
  expect(await readdir(directory)).toEqual([corruptName])
})
