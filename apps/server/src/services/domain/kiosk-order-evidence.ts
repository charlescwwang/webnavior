import type { OrderEvidenceAck, OrderEvidenceEnvelope, OrderEvidenceRegistration } from '@proj-airi/stage-shared/order-evidence'

import type { Database } from '../../libs/db'

import { createHash, randomUUID } from 'node:crypto'
import { link, mkdir, open, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { isOrderEvidencePath, orderEvidenceEnvelopeSchema, orderEvidenceMaxBytes, orderEvidenceRegistrationSchema, sanitizeOrderBusinessPayload } from '@proj-airi/stage-shared/order-evidence'
import { selectOrderingSite } from '@proj-airi/stage-shared/ordering-sites'
import { readPbJourney } from '@proj-airi/stage-shared/pb-journey'
import { and, eq, isNull } from 'drizzle-orm'
import { parse } from 'valibot'

import { createBadRequestError, createConflictError, createForbiddenError, createNotFoundError } from '../../utils/error'

import * as schema from '../../schemas'

/** UTC calendar years clamp leap day; retries never recalculate a stored deadline. */
export function orderEvidenceDeadline(capturedAt: Date) {
  const deadline = new Date(capturedAt)
  const day = deadline.getUTCDate()
  deadline.setUTCDate(1)
  deadline.setUTCFullYear(deadline.getUTCFullYear() + 10)
  const last = new Date(Date.UTC(deadline.getUTCFullYear(), deadline.getUTCMonth() + 1, 0)).getUTCDate()
  deadline.setUTCDate(Math.min(day, last))
  return deadline
}

const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')

/**
 * Owns archival storage only, never merchant requests, customer replies or tool authority.
 * Files commit before manifests; an orphan immutable file is recoverable by exact retry.
 * The ACK requires both durable file verification and committed PostgreSQL metadata.
 */
export function createOrderEvidenceService(db: Database, directory: string, now = () => new Date()) {
  async function device(deviceId: string) {
    const [record] = await db.select({ id: schema.kioskDevices.id, siteId: schema.kioskDevices.siteId }).from(schema.kioskDevices).where(and(eq(schema.kioskDevices.id, deviceId), isNull(schema.kioskDevices.disabledAt), isNull(schema.kioskDevices.deletedAt)))
    if (!record)
      throw createForbiddenError('The archival device is disabled or revoked')
    return record
  }

  async function register(deviceId: string, value: OrderEvidenceRegistration) {
    const input = parse(orderEvidenceRegistrationSchema, value)
    const owner = await device(deviceId)
    const serialized = JSON.stringify(input)
    return db.transaction(async (tx) => {
      // Serialize first registration with normal session completion. An existing
      // immutable binding may be read again after closure without reopening it.
      const [session] = await tx.select({ id: schema.kioskVisitorSessions.id, siteId: schema.kioskVisitorSessions.siteId, deviceId: schema.kioskVisitorSessions.deviceId, serviceId: schema.kioskVisitorSessions.serviceId, state: schema.kioskVisitorSessions.state, expiresAt: schema.kioskVisitorSessions.expiresAt, accessReleasedAt: schema.kioskVisitorSessions.accessReleasedAt, profileReleaseId: schema.kioskVisitorSessions.profileReleaseId }).from(schema.kioskVisitorSessions).where(eq(schema.kioskVisitorSessions.id, input.visitorSessionId)).for('update')
      const [existing] = await tx.select().from(schema.orderEvidenceBindings).where(and(eq(schema.orderEvidenceBindings.deviceId, deviceId), eq(schema.orderEvidenceBindings.operationId, input.operationId)))
      if (existing) {
        if (existing.siteId !== owner.siteId || existing.registrationJson !== serialized)
          throw createConflictError('The order operation already has different archival ownership')
        return { schemaVersion: 1 as const, bindingId: existing.id, siteId: existing.siteId, deviceId, createdAt: existing.createdAt.toISOString() }
      }
      if (!session || session.deviceId !== deviceId || session.siteId !== owner.siteId || session.serviceId !== input.serviceId || session.state !== 'active' || session.accessReleasedAt || session.expiresAt <= now())
        throw createForbiddenError('Register the original active visitor before archival capture')
      const [policy] = await tx.select().from(schema.orderEvidencePolicies).where(and(eq(schema.orderEvidencePolicies.siteId, owner.siteId), isNull(schema.orderEvidencePolicies.disabledAt)))
      if (!policy || policy.scope !== 'field-research')
        throw createForbiddenError('This Site has no enabled research order evidence policy')
      const [profile] = await tx.select({ snapshot: schema.kioskProfileReleases.snapshot }).from(schema.kioskProfileReleases).where(eq(schema.kioskProfileReleases.id, session.profileReleaseId))
      if (!profile)
        throw createForbiddenError('The original visitor profile is unavailable')
      const site = selectOrderingSite(profile.snapshot, input.serviceId)
      const journey = readPbJourney(site.url)
      if (!journey || journey.origin !== input.merchant.origin || journey.store !== input.merchant.store || journey.flow !== input.merchant.flow)
        throw createForbiddenError('The evidence merchant differs from the original published service')
      const createdAt = now()
      const bindingId = randomUUID()
      await tx.insert(schema.orderEvidenceBindings).values({ id: bindingId, siteId: owner.siteId, deviceId, visitorSessionId: input.visitorSessionId, serviceId: input.serviceId, documentId: input.documentId, operationId: input.operationId, source: input.source, merchantOrigin: journey.origin, merchantStore: journey.store, merchantFlow: journey.flow, expectedDigest: input.expectedDigest, registrationJson: serialized, policyScope: policy.scope, policyVersion: policy.policyVersion, consentReference: policy.consentReference, createdAt })
      return { schemaVersion: 1 as const, bindingId, siteId: owner.siteId, deviceId, createdAt: createdAt.toISOString() }
    })
  }

  function filePath(bindingId: string, payloadHash: string) {
    // Both identifiers come from our validated row/hash, never a caller's path.
    return join(directory, `${bindingId}.${payloadHash}.json`)
  }

  async function readChecked(bindingId: string, digest: string, byteSize: number) {
    const bytes = await readFile(filePath(bindingId, digest))
    if (bytes.byteLength !== byteSize || hash(bytes) !== digest)
      throw createConflictError('Archived order evidence failed its integrity check')
    return bytes
  }

  async function writeDurably(bindingId: string, digest: string, bytes: Uint8Array) {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const temporary = join(directory, `.${randomUUID()}.pending`)
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    }
    finally { await handle.close() }
    try {
      try {
        await link(temporary, filePath(bindingId, digest))
      }
      catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST')
          throw error
        await readChecked(bindingId, digest, bytes.byteLength)
      }
    }
    finally { await rm(temporary, { force: true }) }
    // Linux Server directory metadata must be flushed as well as file contents.
    // Unsupported storage fails rather than acknowledging unproved durability.
    const folder = await open(directory, 'r')
    try {
      await folder.sync()
    }
    finally { await folder.close() }
    await readChecked(bindingId, digest, bytes.byteLength)
  }

  async function save(deviceId: string, value: OrderEvidenceEnvelope): Promise<OrderEvidenceAck> {
    const input = parse(orderEvidenceEnvelopeSchema, value)
    const receivedAt = now()
    const owner = await device(deviceId)
    const bytes = new TextEncoder().encode(input.payloadJson)
    if (bytes.byteLength !== input.byteSize || bytes.byteLength > orderEvidenceMaxBytes || hash(bytes) !== input.payloadHash)
      throw createBadRequestError('Order evidence size or digest does not match its bytes')
    return db.transaction(async (tx) => {
      // One operation lock also serializes duplicate uploads/ACK loss, without
      // changing the active visitor or taking a general commerce lock.
      const [binding] = await tx.select().from(schema.orderEvidenceBindings).where(eq(schema.orderEvidenceBindings.id, input.bindingId)).for('update')
      if (!binding || binding.deviceId !== deviceId || binding.siteId !== owner.siteId)
        throw createForbiddenError('Evidence does not belong to this registered operation')
      const merchant = { origin: binding.merchantOrigin, store: binding.merchantStore, flow: parse(orderEvidenceRegistrationSchema, JSON.parse(binding.registrationJson)).merchant.flow }
      if (!isOrderEvidencePath(input.sourcePath, merchant))
        throw createBadRequestError('Evidence must come from the same merchant business route')
      let sanitized: string
      try {
        sanitized = sanitizeOrderBusinessPayload(JSON.parse(input.payloadJson), merchant)
      }
      catch { throw createBadRequestError('Evidence is not a valid sanitized business object') }
      if (sanitized !== input.payloadJson)
        throw createBadRequestError('Evidence contains unapproved fields or noncanonical bytes')
      const capturedAt = new Date(input.capturedAt)
      if (capturedAt.getTime() < binding.createdAt.getTime() - 300000 || capturedAt.getTime() > now().getTime() + 300000)
        throw createBadRequestError('Evidence capture time is outside the registered operation clock bounds')
      const envelopeDigest = hash(JSON.stringify(input))
      const [alias] = await tx.select().from(schema.orderEvidenceAliases).where(and(eq(schema.orderEvidenceAliases.deviceId, deviceId), eq(schema.orderEvidenceAliases.evidenceId, input.evidenceId)))
      if (alias && alias.envelopeDigest !== envelopeDigest)
        throw createConflictError('Evidence identity already refers to different immutable content')
      const resultHash = input.sourcePath.slice(`/order/store/${merchant.store}/${merchant.flow}/orders/`.length).split('/')[0]
      if (resultHash !== 'create') {
        const payload = JSON.parse(input.payloadJson)
        const observedHash = payload.order?.hash
        if ((binding.merchantOrderHash && binding.merchantOrderHash !== resultHash) || (typeof observedHash === 'string' && observedHash !== resultHash))
          throw createConflictError('Evidence result belongs to another merchant order')
        // This binds observed identity only, never acceptance/payment. Unknown
        // payload formats remain archived pending the separate result parser.
        if (!binding.merchantOrderHash && observedHash === resultHash)
          await tx.update(schema.orderEvidenceBindings).set({ merchantOrderHash: resultHash }).where(eq(schema.orderEvidenceBindings.id, binding.id))
      }
      const [existing] = await tx.select().from(schema.orderEvidenceSnapshots).where(and(eq(schema.orderEvidenceSnapshots.bindingId, binding.id), eq(schema.orderEvidenceSnapshots.payloadHash, input.payloadHash)))
      // Reusing an immutable file after DB rollback repairs the file/DB cutpoint.
      // Existing manifests are checked too: missing/corrupt bytes never get ACKed.
      if (existing)
        await readChecked(binding.id, existing.payloadHash, existing.byteSize)
      else
        await writeDurably(binding.id, input.payloadHash, bytes)
      const snapshot = existing ?? (await tx.insert(schema.orderEvidenceSnapshots).values({ id: randomUUID(), bindingId: binding.id, payloadHash: input.payloadHash, byteSize: input.byteSize, source: input.source, sourcePath: input.sourcePath, sanitizerVersion: input.sanitizerVersion, capturedAt, receivedAt, storedAt: now(), retainUntil: orderEvidenceDeadline(capturedAt), scope: binding.policyScope, policyVersion: binding.policyVersion, consentReference: binding.consentReference, parseState: 'pending' }).returning())[0]!
      if (!alias)
        await tx.insert(schema.orderEvidenceAliases).values({ deviceId, evidenceId: input.evidenceId, snapshotId: snapshot.id, envelopeDigest })
      return { schemaVersion: 1, evidenceId: input.evidenceId, payloadHash: snapshot.payloadHash, byteSize: snapshot.byteSize, storedAt: snapshot.storedAt.toISOString(), durabilityVersion: 1 }
    })
  }

  async function readForDevice(deviceId: string, evidenceId: string) {
    const owner = await device(deviceId)
    const [record] = await db.select({ snapshot: schema.orderEvidenceSnapshots, binding: schema.orderEvidenceBindings }).from(schema.orderEvidenceAliases).innerJoin(schema.orderEvidenceSnapshots, eq(schema.orderEvidenceAliases.snapshotId, schema.orderEvidenceSnapshots.id)).innerJoin(schema.orderEvidenceBindings, eq(schema.orderEvidenceSnapshots.bindingId, schema.orderEvidenceBindings.id)).where(and(eq(schema.orderEvidenceAliases.deviceId, deviceId), eq(schema.orderEvidenceAliases.evidenceId, evidenceId)))
    if (!record || record.binding.siteId !== owner.siteId)
      throw createNotFoundError('Archived order evidence was not found for this device')
    // Authorization completes before private content is touched. This endpoint
    // never restores operational session access or runs a merchant read.
    await db.insert(schema.orderEvidenceAccess).values({ id: randomUUID(), siteId: owner.siteId, deviceId, snapshotId: record.snapshot.id, action: 'read-original', createdAt: now() })
    return { manifest: record.snapshot, payloadJson: (await readChecked(record.binding.id, record.snapshot.payloadHash, record.snapshot.byteSize)).toString('utf8') }
  }

  return { register, save, readForDevice }
}
