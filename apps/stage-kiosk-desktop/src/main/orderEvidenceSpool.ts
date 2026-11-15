import type { OrderEvidenceEnvelope } from '@proj-airi/stage-shared/order-evidence'

import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readdir, readFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'

import { errorMessageFrom } from '@moeru/std'
import { orderEvidenceAckSchema, orderEvidenceEnvelopeSchema, orderEvidenceMaxBytes } from '@proj-airi/stage-shared/order-evidence'
import { parse } from 'valibot'

function validate(input: unknown): OrderEvidenceEnvelope {
  const item = parse(orderEvidenceEnvelopeSchema, input)
  if (Buffer.byteLength(item.payloadJson, 'utf8') !== item.byteSize || createHash('sha256').update(item.payloadJson, 'utf8').digest('hex') !== item.payloadHash)
    throw new Error('Order evidence integrity mismatch')
  return item
}

/**
 * Owns one private installation queue under Electron's single-instance lock.
 * Only sanitized, already-bound evidence enters this queue; merchant submission
 * is never retried here. Visitor reset does not dispose or relabel pending work.
 * Successful enqueue flushes file and directory before returning. Windows
 * power-loss guarantees require separate platform validation, not Linux tests.
 */
export class OrderEvidenceSpool {
  private work: Promise<unknown> = Promise.resolve()

  constructor(private readonly directory: string) {}

  private serialize<T>(run: () => Promise<T>): Promise<T> {
    const result = this.work.then(run)
    // A failed upload or file operation must not permanently poison the queue.
    this.work = result.catch(() => {})
    return result
  }

  private path(evidenceId: string) {
    // External identifiers never become filesystem components.
    return join(this.directory, `${createHash('sha256').update(evidenceId).digest('hex')}.json`)
  }

  private async syncDirectory() {
    const handle = await open(this.directory, 'r')
    try {
      await handle.sync()
    }
    finally { await handle.close() }
  }

  /** Commits exact immutable bytes; retrying an identity cannot change its owner or content. */
  enqueue(input: OrderEvidenceEnvelope): Promise<void> {
    return this.serialize(async () => {
      const item = validate(input)
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      const target = this.path(item.evidenceId)
      const existing = await readFile(target, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT')
          return undefined
        throw error
      })
      if (existing !== undefined) {
        if (JSON.stringify(validate(JSON.parse(existing))) !== JSON.stringify(item))
          throw new Error('Order evidence identity conflict')
        return
      }
      const temporary = join(this.directory, `${randomUUID()}.tmp`)
      const handle = await open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(JSON.stringify(item), 'utf8')
        await handle.sync()
      }
      finally { await handle.close() }
      // Only this installation owner mutates the queue. Rename publishes a
      // complete record; a crash before it leaves an uncommitted .tmp, ignored
      // by recovery rather than parsed as a complete business observation.
      await rename(temporary, target)
      await this.syncDirectory()
    })
  }

  private async readPending() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const names = (await readdir(this.directory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort()
    const results = await Promise.allSettled(names.map(async (name) => {
      const path = join(this.directory, name)
      const handle = await open(path, 'r')
      try {
        if ((await handle.stat()).size > orderEvidenceMaxBytes * 7)
          throw new Error('Order evidence queue record exceeds size limit')
        const item = validate(JSON.parse(await handle.readFile('utf8')))
        if (path !== this.path(item.evidenceId))
          throw new Error('Order evidence queue identity mismatch')
        return item
      }
      finally { await handle.close() }
    }))
    const items: OrderEvidenceEnvelope[] = []
    const errors: { evidenceId: string, message: string }[] = []
    for (const [index, result] of results.entries()) {
      if (result.status === 'fulfilled')
        items.push(result.value)
      else
        errors.push({ evidenceId: names[index], message: errorMessageFrom(result.reason) ?? 'Invalid evidence queue record' })
    }
    return { items, errors }
  }

  /** Reads flushed records from disk, including observations from retired visitors. */
  pending(): Promise<OrderEvidenceEnvelope[]> {
    return this.serialize(async () => {
      const result = await this.readPending()
      if (result.errors.length)
        throw new Error(`Order evidence queue contains ${result.errors.length} invalid record(s)`)
      return result.items
    })
  }

  /** Retries archival IO only; exact server durability ACK is required before local deletion. */
  flush(upload: (item: OrderEvidenceEnvelope) => Promise<unknown>): Promise<{ stored: number, errors: { evidenceId: string, message: string }[] }> {
    return this.serialize(async () => {
      let stored = 0
      const recovered = await this.readPending()
      const errors = recovered.errors
      for (const item of recovered.items) {
        try {
          const ack = parse(orderEvidenceAckSchema, await upload(item))
          if (ack.evidenceId !== item.evidenceId || ack.payloadHash !== item.payloadHash || ack.byteSize !== item.byteSize)
            throw new Error('Order evidence ACK mismatch')
          await unlink(this.path(item.evidenceId))
          await this.syncDirectory()
          stored++
        }
        catch (error) {
          errors.push({ evidenceId: item.evidenceId, message: errorMessageFrom(error) ?? 'Evidence archival failed' })
        }
      }
      return { stored, errors }
    })
  }
}
