import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import pg from 'pg'

import { orderEvidenceAckSchema, orderEvidenceBindingSchema, sanitizeOrderBusinessPayload } from '@proj-airi/stage-shared/order-evidence'
import { Hono } from 'hono'
import { parse } from 'valibot'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDrizzle } from '../../libs/db'
import { createOrderEvidenceRoutes } from '../../routes/kiosk/orderEvidence'
import { ApiError } from '../../utils/error'
import { createKioskService } from './kiosk'
import { createOrderEvidenceService, orderEvidenceDeadline } from './kiosk-order-evidence'

it('retains ten UTC calendar years and clamps leap day without changing the time', () => {
  expect(orderEvidenceDeadline(new Date('2028-02-29T12:34:56.789Z')).toISOString()).toBe('2038-02-28T12:34:56.789Z')
})

// This is actual PostgreSQL in a random disposable schema, never mockDB/pushSchema.
// Run only with an explicitly provided test database; no production fallback URL.
const connectionString = process.env.ORDER_EVIDENCE_TEST_DATABASE_URL
describe.skipIf(!connectionString)('private order evidence PostgreSQL/archive boundary', () => {
  const namespace = `order_evidence_test_${randomUUID().replaceAll('-', '')}`
  const merchant = { origin: 'http://127.0.0.1:5188', store: '1kgJeql', flow: 'internal_use' as const }
  const registration = { schemaVersion: 1 as const, operationId: 'operation-a', visitorSessionId: 'visitor-a', serviceId: 'pb-local-test', documentId: 'document-a', source: 'ai' as const, merchant, expectedDigest: 'a'.repeat(64) }
  let directory: string
  let fixture: ReturnType<typeof createDrizzle>
  let bootstrap: pg.Client
  let clock = new Date('2028-02-29T12:34:56.789Z')
  function connect() {
    const scoped = new URL(connectionString!)
    scoped.searchParams.set('options', `-c search_path=${namespace}`)
    return createDrizzle({ DATABASE_URL: scoped.href, DB_POOL_MAX: 2, DB_POOL_IDLE_TIMEOUT_MS: 1000, DB_POOL_CONNECTION_TIMEOUT_MS: 2000, DB_POOL_KEEPALIVE_INITIAL_DELAY_MS: 1000 })
  }
  const service = () => createOrderEvidenceService(fixture.db, directory, () => new Date(clock))
  const envelope = (bindingId: string, evidenceId = 'evidence-a', payload = { order: { hash: 'order-a', totalmoney: 130 }, details: [{ product: '炸排骨便當', quantity: 1 }], invoices: [] }) => {
    const payloadJson = sanitizeOrderBusinessPayload(payload, merchant)
    return { schemaVersion: 1 as const, evidenceId, bindingId, source: 'page' as const, capturedAt: clock.toISOString(), sourcePath: '/order/store/1kgJeql/internal_use/orders/order-a/choosePayment', sanitizerVersion: 1 as const, payloadJson, payloadHash: createHash('sha256').update(payloadJson).digest('hex'), byteSize: Buffer.byteLength(payloadJson) }
  }

  beforeAll(async () => {
    bootstrap = new pg.Client({ connectionString })
    await bootstrap.connect()
    await bootstrap.query(`CREATE SCHEMA ${namespace}`)
    fixture = connect()
    directory = await mkdtemp(join(tmpdir(), 'order-evidence-archive-'))
    await fixture.pool.query(`
      CREATE TABLE kiosk_devices (id text PRIMARY KEY, site_id text NOT NULL, label text DEFAULT '', registration_method text DEFAULT 'development', settings jsonb DEFAULT '{}', disabled_at timestamp, deleted_at timestamp, created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now());
      CREATE TABLE kiosk_device_credentials (id text PRIMARY KEY, device_id text, token_hash text, created_at timestamp DEFAULT now(), revoked_at timestamp);
      CREATE TABLE kiosk_visitor_sessions (id text PRIMARY KEY, site_id text, device_id text, service_id text, state text, expires_at timestamp, access_released_at timestamp, profile_release_id text);
      CREATE TABLE kiosk_profile_releases (id text PRIMARY KEY, snapshot jsonb);
      INSERT INTO kiosk_devices(id,site_id) VALUES('device-a','site-a'),('device-b','site-b');
      INSERT INTO kiosk_visitor_sessions VALUES('visitor-a','site-a','device-a','pb-local-test','active','2029-01-01',NULL,'profile-a');
    `)
    await fixture.pool.query('INSERT INTO kiosk_profile_releases VALUES ($1,$2)', ['profile-a', JSON.stringify({ interactiveService: { id: registration.serviceId, url: `${merchant.origin}/order/store/1kgJeql/internal_use/menu/select-table` } })])
    await fixture.pool.query('INSERT INTO kiosk_device_credentials(id,device_id,token_hash) VALUES ($1,$2,$3)', ['credential-a', 'device-a', createHash('sha256').update('test-device-credential').digest('base64url')])
    const migration = await readFile(new URL('../../../drizzle/0050_order_evidence_archive.sql', import.meta.url), 'utf8')
    await fixture.pool.query(migration)
    await fixture.pool.query('INSERT INTO order_evidence_policies(site_id,scope,policy_version) VALUES (\'site-a\',\'field-research\',\'research-ten-calendar-years-v1\')')
  })
  afterAll(async () => {
    await fixture?.pool.end()
    if (bootstrap) {
      await bootstrap.query(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`)
      await bootstrap.end()
    }
    if (directory)
      await rm(directory, { recursive: true, force: true })
  })

  it('does not apply research retention to an unenrolled or disabled Site', async () => {
    await fixture.pool.query('UPDATE order_evidence_policies SET disabled_at=now() WHERE site_id=\'site-a\'')
    await expect(service().register('device-a', registration)).rejects.toThrow('no enabled research')
    expect((await fixture.pool.query('SELECT * FROM order_evidence_bindings')).rows).toHaveLength(0)
    await fixture.pool.query('UPDATE order_evidence_policies SET disabled_at=NULL WHERE site_id=\'site-a\'')
  })

  it('registers and stores through authenticated Hono routes, survives pool restart and ACK loss, and deduplicates content', async () => {
    const app = new Hono().onError((error, c) => error instanceof ApiError ? c.json({ code: error.errorCode }, error.statusCode) : c.json({ code: 'INTERNAL_ERROR' }, 500)).route('/api/kiosk', createOrderEvidenceRoutes(service(), createKioskService(fixture.db)))
    const request = (path: string, body?: unknown, cookie = 'test-device-credential') => app.request(`/api/kiosk${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'Cookie': `airi_kiosk_device=${cookie}` }, ...(body ? { body: JSON.stringify(body) } : {}) })
    expect((await request('/order-evidence/operations', registration, 'invalid')).status).toBe(401)
    const registered = await request('/order-evidence/operations', registration)
    expect(registered.status).toBe(201)
    const binding = parse(orderEvidenceBindingSchema, await registered.json())
    const captured = envelope(binding.bindingId)
    const uploaded = await request('/order-evidence', captured)
    expect(uploaded.status).toBe(201)
    const ack = parse(orderEvidenceAckSchema, await uploaded.json())
    const fetched = await request(`/order-evidence/${captured.evidenceId}`)
    expect(fetched.status).toBe(200)
    const readback = await fetched.json()
    expect(readback).toMatchObject({ payloadJson: captured.payloadJson, manifest: { retainUntil: '2038-02-28T12:34:56.789Z', consentReference: null } })

    await fixture.pool.end()
    fixture = connect()
    expect(await service().save('device-a', captured)).toEqual(ack)
    expect((await service().readForDevice('device-a', captured.evidenceId)).payloadJson).toBe(captured.payloadJson)
    expect((await service().save('device-a', { ...captured, evidenceId: 'same-content-second-id' })).payloadHash).toBe(ack.payloadHash)
    expect((await fixture.pool.query('SELECT * FROM order_evidence_snapshots')).rows).toHaveLength(1)
    expect((await fixture.pool.query('SELECT * FROM order_evidence_access')).rows).toHaveLength(2)
    await expect(service().save('device-a', { ...captured, sourcePath: '/order/store/1kgJeql/internal_use/orders/wrong' })).rejects.toThrow('different immutable')
    await expect(service().save('device-b', captured)).rejects.toThrow('does not belong')
    const wrongOrder = envelope(binding.bindingId, 'wrong-order', { order: { hash: 'other-order', totalmoney: 130 }, details: [{ product: '炸排骨便當', quantity: 1 }], invoices: [] })
    wrongOrder.sourcePath = '/order/store/1kgJeql/internal_use/orders/other-order/choosePayment'
    await expect(service().save('device-a', wrongOrder)).rejects.toThrow('another merchant order')
    expect((await fixture.pool.query('SELECT * FROM order_evidence_snapshots')).rows).toHaveLength(1)
  })

  it('accepts late evidence only under the original binding without reopening an expired visitor or extending retention', async () => {
    const binding = await service().register('device-a', registration)
    const original = envelope(binding.bindingId)
    const before = (await service().readForDevice('device-a', original.evidenceId)).manifest.retainUntil
    await fixture.pool.query('UPDATE kiosk_visitor_sessions SET state=\'completed\',access_released_at=now() WHERE id=\'visitor-a\'')
    clock = new Date('2030-01-01T00:00:00.000Z')
    expect(await service().save('device-a', original)).toMatchObject({ evidenceId: original.evidenceId })
    expect((await service().readForDevice('device-a', original.evidenceId)).manifest.retainUntil).toEqual(before)
    await expect(service().register('device-a', { ...registration, operationId: 'unregistered-after-close' })).rejects.toThrow('original active')
    expect((await fixture.pool.query('SELECT state,access_released_at FROM kiosk_visitor_sessions WHERE id=\'visitor-a\'')).rows[0].state).toBe('completed')
    await fixture.pool.query('DELETE FROM kiosk_visitor_sessions WHERE id=\'visitor-a\'')
    expect((await fixture.pool.query('SELECT * FROM order_evidence_snapshots')).rows).toHaveLength(1)
  })

  it('recovers an immutable file after PostgreSQL manifest failure and rejects corrupt existing content without ACK', async () => {
    const binding = await service().register('device-a', registration)
    const captured = envelope(binding.bindingId, 'fault-evidence', { order: { hash: 'order-a', totalmoney: 260 }, details: [{ product: '炸排骨便當', quantity: 2 }], invoices: [] })
    await fixture.pool.query('CREATE FUNCTION fail_manifest() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION \'injected-manifest-failure\'; END $$; CREATE TRIGGER archive_failure BEFORE INSERT ON order_evidence_snapshots FOR EACH ROW EXECUTE FUNCTION fail_manifest();')
    await expect(service().save('device-a', captured)).rejects.toMatchObject({ cause: { message: 'injected-manifest-failure' } })
    expect((await readdir(directory)).filter(name => name.endsWith(`${captured.payloadHash}.json`))).toHaveLength(1)
    expect((await fixture.pool.query('SELECT * FROM order_evidence_snapshots WHERE payload_hash=$1', [captured.payloadHash])).rows).toHaveLength(0)
    await fixture.pool.query('DROP TRIGGER archive_failure ON order_evidence_snapshots')
    expect(await service().save('device-a', captured)).toMatchObject({ payloadHash: captured.payloadHash })
    await writeFile(join(directory, `${binding.bindingId}.${captured.payloadHash}.json`), 'corrupt')
    await expect(service().save('device-a', captured)).rejects.toThrow('integrity')
    expect((await fixture.pool.query('SELECT * FROM order_evidence_snapshots WHERE payload_hash=$1', [captured.payloadHash])).rows).toHaveLength(1)
  })

  it('rejects unfiltered or invalid content before storage and refuses revoked credentials', async () => {
    const binding = await service().register('device-a', registration)
    const captured = envelope(binding.bindingId, 'bad-evidence')
    await expect(service().save('device-a', { ...captured, payloadHash: 'b'.repeat(64) })).rejects.toThrow('digest')
    const payloadJson = '{"order":{"access_token":"do-not-store"}}'
    await expect(service().save('device-a', { ...captured, payloadJson, payloadHash: createHash('sha256').update(payloadJson).digest('hex'), byteSize: Buffer.byteLength(payloadJson) })).rejects.toThrow('unapproved')
    await fixture.pool.query('UPDATE kiosk_device_credentials SET revoked_at=now() WHERE id=\'credential-a\'')
    const app = new Hono().onError((error, c) => error instanceof ApiError ? c.json({ code: error.errorCode }, error.statusCode) : c.json({ code: 'INTERNAL_ERROR' }, 500)).route('/api/kiosk', createOrderEvidenceRoutes(service(), createKioskService(fixture.db)))
    expect((await app.request('/api/kiosk/order-evidence', { method: 'POST', headers: { 'Cookie': 'airi_kiosk_device=test-device-credential', 'Content-Type': 'application/json' }, body: JSON.stringify(captured) })).status).toBe(401)
  })
})
