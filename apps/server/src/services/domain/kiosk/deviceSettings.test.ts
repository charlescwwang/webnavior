import type { Database } from '../../../libs/db'

import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { mockDB } from '../../../libs/mock-db'
import { createKioskService } from './index'

import * as schema from '../../../schemas'

describe('device policy authorization and concurrency', () => {
  let db: Database
  let service: ReturnType<typeof createKioskService>
  let siteId: string
  let deviceId: string
  beforeEach(async () => {
    db = await mockDB(schema)
    service = createKioskService(db)
    await db.insert(schema.user).values([
      { id: 'admin', name: 'Admin', email: 'admin@test.local', role: 'admin' },
      { id: 'operator', name: 'Operator', email: 'operator@test.local' },
      { id: 'outsider', name: 'Outsider', email: 'outsider@test.local' },
    ])
    siteId = (await service.createSite({ name: 'Site' })).id
    await service.addMember({ siteId, userId: 'operator', role: 'site_admin' })
    deviceId = (await service.createDevice({ siteId, label: 'A', registrationMethod: 'qr_code' })).id
  })

  it('inherits site defaults, isolates devices, and never revives a revoked local override', async () => {
    const other = await service.createDevice({ siteId, label: 'B', registrationMethod: 'qr_code' })
    const initial = await service.getDeviceSettings(deviceId)
    expect(initial.effective.observationEnabled).toBe(false)
    expect(initial.effective.faceDetectionConfidence).toBe(0.6)
    expect(initial.effective.presenceVisionMode).toBe('pose_plus_conditional_face')
    expect(initial.effective.voiceVadSettings).toEqual({ threshold: 0.5, minSpeechDurationMs: 250, maxSpeechDurationS: 9999, minSilenceDurationMs: 250, speechPadMs: 2000 })
    const admin = await service.updateDeviceSettings({ deviceId, siteId, userId: 'admin', source: 'admin', body: {
      version: 1,
      localControls: ['observationEnabled'],
      overrides: { observationEnabled: false },
    } })
    const local = await service.updateDeviceSettings({ deviceId, siteId, userId: 'operator', source: 'local', body: {
      version: admin.settings.version,
      overrides: { observationEnabled: true },
    } })
    expect(local.effective.observationEnabled).toBe(true)
    expect((await service.getDeviceSettings(other.id)).effective.observationEnabled).toBe(false)
    const locked = await service.updateDeviceSettings({ deviceId, siteId, userId: 'admin', source: 'admin', body: {
      version: local.settings.version,
      localControls: [],
      overrides: { observationEnabled: false },
    } })
    expect(locked.effective.observationEnabled).toBe(false)
    expect(locked.settings.localOverrides).toEqual({})
    const delegatedAgain = await service.updateDeviceSettings({ deviceId, siteId, userId: 'admin', source: 'admin', body: {
      version: locked.settings.version,
      localControls: ['observationEnabled'],
      overrides: {},
    } })
    expect(delegatedAgain.effective.observationEnabled).toBe(false)
    const logs = await db.query.kioskAuditLogs.findMany({ where: eq(schema.kioskAuditLogs.targetId, deviceId) })
    expect(logs).toHaveLength(4)
    expect(logs[1].actorUserId).toBe('operator')
    expect(logs[1].details).toMatchObject({ source: 'local', before: { version: 2 }, after: { version: 3 } })
  })

  it('persists and delegates the presence vision mode', async () => {
    const admin = await service.updateDeviceSettings({ deviceId, siteId, userId: 'admin', source: 'admin', body: {
      version: 1,
      localControls: ['presenceVisionMode'],
      overrides: { presenceVisionMode: 'pose_only' },
    } })
    const local = await service.updateDeviceSettings({ deviceId, siteId, userId: 'operator', source: 'local', body: {
      version: admin.settings.version,
      overrides: { presenceVisionMode: 'face_only' },
    } })

    expect(local.effective.presenceVisionMode).toBe('face_only')
  })

  it('rejects locked fields, forged delegation, invalid ranges, and cross-site operators without writes', async () => {
    await expect(service.updateDeviceSettings({ deviceId, siteId, userId: 'operator', source: 'local', body: {
      version: 1,
      overrides: { observationEnabled: true },
    } })).rejects.toMatchObject({ statusCode: 403 })
    await expect(service.updateDeviceSettings({ deviceId, siteId, userId: 'operator', source: 'local', body: {
      version: 1,
      overrides: {},
      localControls: ['observationEnabled'],
    } })).rejects.toMatchObject({ statusCode: 400 })
    await expect(service.updateDeviceSettings({ deviceId, siteId, userId: 'admin', source: 'admin', body: {
      version: 1,
      overrides: { voiceVadSettings: { threshold: 2, minSpeechDurationMs: 250, maxSpeechDurationS: 9999, minSilenceDurationMs: 250, speechPadMs: 2000 } },
      localControls: [],
    } })).rejects.toMatchObject({ statusCode: 400 })
    await expect(service.updateDeviceSettings({ deviceId, siteId, userId: 'admin', source: 'admin', body: {
      version: 1,
      overrides: { faceDetectionConfidence: 0.3 },
      localControls: [],
    } })).rejects.toMatchObject({ statusCode: 400 })
    await expect(service.updateDeviceSettings({ deviceId, siteId, userId: 'admin', source: 'admin', body: {
      version: 1,
      overrides: { zoneX: 0.9 },
      localControls: [],
    } })).rejects.toMatchObject({ statusCode: 400 })
    await expect(service.updateDeviceSettings({ deviceId, siteId, userId: 'outsider', source: 'local', body: {
      version: 1,
      overrides: {},
    } })).rejects.toMatchObject({ statusCode: 403 })
    expect((await service.getDeviceSettings(deviceId)).settings.version).toBe(1)
    expect(await db.query.kioskAuditLogs.findMany()).toHaveLength(0)
  })

  it('rejects stale writes and records exactly one accepted update', async () => {
    const write = { deviceId, siteId, userId: 'admin', source: 'admin' as const, body: {
      version: 1,
      localControls: [],
      overrides: { observationEnabled: true },
    } }
    const results = await Promise.allSettled([service.updateDeviceSettings(write), service.updateDeviceSettings(write)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(result => result.status === 'rejected')
    expect(rejected?.status === 'rejected' && rejected.reason.statusCode).toBe(409)
    expect((await service.getDeviceSettings(deviceId)).settings.version).toBe(2)
    expect(await db.query.kioskAuditLogs.findMany()).toHaveLength(1)
  })

  it('allows explicit clearing while retaining delegation and blocks local writes to disabled devices', async () => {
    await service.updateDeviceSettings({ deviceId, siteId, userId: 'admin', source: 'admin', body: {
      version: 1,
      localControls: ['voiceVadSettings'],
      overrides: { voiceVadSettings: { threshold: 0.8, minSpeechDurationMs: 250, maxSpeechDurationS: 9999, minSilenceDurationMs: 250, speechPadMs: 2000 } },
    } })
    await service.updateDeviceSettings({ deviceId, siteId, userId: 'operator', source: 'local', body: {
      version: 2,
      overrides: { voiceVadSettings: { threshold: 0.6, minSpeechDurationMs: 250, maxSpeechDurationS: 9999, minSilenceDurationMs: 250, speechPadMs: 2000 } },
    } })
    const cleared = await service.updateDeviceSettings({ deviceId, siteId, userId: 'admin', source: 'admin', body: {
      version: 3,
      localControls: ['voiceVadSettings'],
      overrides: { voiceVadSettings: { threshold: 0.8, minSpeechDurationMs: 250, maxSpeechDurationS: 9999, minSilenceDurationMs: 250, speechPadMs: 2000 } },
      clearLocalOverrides: ['voiceVadSettings'],
    } })
    expect(cleared.effective.voiceVadSettings.threshold).toBe(0.8)
    expect(cleared.settings.localControls).toEqual(['voiceVadSettings'])
    await service.disableDevice({ deviceId, siteId, userId: 'admin' })
    await expect(service.updateDeviceSettings({ deviceId, siteId, userId: 'operator', source: 'local', body: {
      version: 4,
      overrides: { voiceVadSettings: { threshold: 0.5, minSpeechDurationMs: 250, maxSpeechDurationS: 9999, minSilenceDurationMs: 250, speechPadMs: 2000 } },
    } })).rejects.toMatchObject({ statusCode: 403 })
  })
})
