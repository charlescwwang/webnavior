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

  // Report: this chat Nov8 — local settings must not require per-field delegation.
  it('shares device overrides between both editors without prior delegation', async () => {
    const other = await service.createDevice({ siteId, label: 'Voice kiosk', registrationMethod: 'qr_code' })
    const initial = await service.getDeviceSettings(deviceId)
    const local = await service.updateDeviceSettings({ deviceId, siteId, userId: 'operator', source: 'local', body: { version: initial.settings.version, overrides: { textOnlyMode: true, faceDetectionConfidence: 0.7 } } })
    expect(local.effective.textOnlyMode).toBe(true)
    expect(local.settings.overrides.textOnlyMode).toBe(true)
    const admin = await service.updateDeviceSettings({ deviceId, siteId, userId: 'admin', source: 'admin', body: { version: local.settings.version, overrides: { ...local.settings.overrides, textOnlyMode: false } } })
    expect(admin.effective.textOnlyMode).toBe(false)
    expect(admin.effective.faceDetectionConfidence).toBe(0.7)
    expect((await service.getDeviceSettings(deviceId)).settings).toEqual(admin.settings)
    expect((await service.getDeviceSettings(other.id)).effective.textOnlyMode).toBe(false)
    await expect(service.updateDeviceSettings({ deviceId, siteId, userId: 'operator', source: 'local', body: { version: local.settings.version, overrides: { textOnlyMode: true } } })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('supports shared service/background choices while rejecting invalid changes', async () => {
    const initial = await service.getDeviceSettings(deviceId)
    expect(initial.effective.serviceMode).toBe('kiosk')
    expect(initial.effective.backgroundSpeechMode).toBe('off')
    await expect(service.updateDeviceSettings({ deviceId, siteId, userId: 'admin', source: 'admin', body: { version: initial.settings.version, overrides: { serviceMode: 'invalid' } } })).rejects.toThrow()
    const changed = await service.updateDeviceSettings({ deviceId, siteId, userId: 'admin', source: 'admin', body: { version: initial.settings.version, overrides: { serviceMode: 'table-service', backgroundSpeechMode: 'observe' } } })
    expect(changed.effective.serviceMode).toBe('table-service')
    expect(changed.effective.backgroundSpeechMode).toBe('observe')
  })

  // Report: this chat, 2026-10-28 — new machines must start with the field-test policy.
  it('creates independent overridden settings and permits local field adjustments', async () => {
    const initial = await service.getDeviceSettings(deviceId)
    expect(initial.settings.overrides).toMatchObject({ observationEnabled: true, greetingEnabled: true, reminderEnabled: true, triggerMode: 'mixed', voiceDiagnosticsEnabled: true })
    const updated = await service.updateDeviceSettings({ deviceId, siteId, userId: 'operator', source: 'local', body: { version: initial.settings.version, overrides: { voiceDiagnosticsEnabled: false, greetingEnabled: false } } })
    expect(updated.effective.voiceDiagnosticsEnabled).toBe(false)
    expect(updated.effective.greetingEnabled).toBe(false)
    const other = await service.createDevice({ siteId, label: 'new', registrationMethod: 'qr_code' })
    expect((await service.getDeviceSettings(other.id)).effective.voiceDiagnosticsEnabled).toBe(true)
    expect((await service.getDeviceSettings(other.id)).effective.greetingEnabled).toBe(true)
  })

  it('inherits site defaults, isolates devices, and shares changes in both directions', async () => {
    const other = await service.createDevice({ siteId, label: 'B', registrationMethod: 'qr_code' })
    const initial = await service.getDeviceSettings(deviceId)
    expect(initial.effective.observationEnabled).toBe(true)
    expect(initial.effective.faceDetectionConfidence).toBe(0.6)
    expect(initial.effective.presenceVisionMode).toBe('pose_plus_conditional_face')
    expect(initial.effective.voiceDiagnosticsEnabled).toBe(true)
    expect(initial.effective.conversationDiagnosticsEnabled).toBe(false)
    expect(initial.effective.voiceVadSettings).toEqual({ threshold: 0.5, minSpeechDurationMs: 250, maxSpeechDurationS: 9999, minSilenceDurationMs: 250, speechPadMs: 2000 })
    const admin = await service.updateDeviceSettings({ deviceId, siteId, userId: 'admin', source: 'admin', body: {
      version: 1,
      overrides: { observationEnabled: false },
    } })
    const local = await service.updateDeviceSettings({ deviceId, siteId, userId: 'operator', source: 'local', body: {
      version: admin.settings.version,
      overrides: { observationEnabled: true },
    } })
    expect(local.effective.observationEnabled).toBe(true)
    expect((await service.getDeviceSettings(other.id)).effective.observationEnabled).toBe(true)
    const adminChanged = await service.updateDeviceSettings({ deviceId, siteId, userId: 'admin', source: 'admin', body: {
      version: local.settings.version,
      overrides: { observationEnabled: false },
    } })
    expect(adminChanged.effective.observationEnabled).toBe(false)
    expect(adminChanged.settings.overrides).toEqual({ observationEnabled: false })
    const inherited = await service.updateDeviceSettings({ deviceId, siteId, userId: 'admin', source: 'admin', body: {
      version: adminChanged.settings.version,
      overrides: {},
    } })
    expect(inherited.effective.observationEnabled).toBe(false)
    const logs = await db.query.kioskAuditLogs.findMany({ where: eq(schema.kioskAuditLogs.targetId, deviceId) })
    expect(logs).toHaveLength(4)
    expect(logs[1].actorUserId).toBe('operator')
    expect(logs[1].details).toMatchObject({ source: 'local', before: { version: 2 }, after: { version: 3 } })
  })

  it('shares the presence vision mode', async () => {
    const admin = await service.updateDeviceSettings({ deviceId, siteId, userId: 'admin', source: 'admin', body: {
      version: 1,
      overrides: { presenceVisionMode: 'pose_only' },
    } })
    const local = await service.updateDeviceSettings({ deviceId, siteId, userId: 'operator', source: 'local', body: {
      version: admin.settings.version,
      overrides: { presenceVisionMode: 'face_only' },
    } })

    expect(local.effective.presenceVisionMode).toBe('face_only')
  })

  it('retains an administrator override for voice diagnostics', async () => {
    const updated = await service.updateDeviceSettings({ deviceId, siteId, userId: 'admin', source: 'admin', body: {
      version: 1,
      overrides: { voiceDiagnosticsEnabled: true },
    } })

    expect(updated.effective.voiceDiagnosticsEnabled).toBe(true)
  })

  it('persists the optional conversation duration display', async () => {
    const updated = await service.updateDeviceSettings({ deviceId, siteId, userId: 'admin', source: 'admin', body: {
      version: 1,
      overrides: { conversationDiagnosticsEnabled: true },
    } })

    expect(updated.effective.conversationDiagnosticsEnabled).toBe(true)
  })

  it('rejects unknown fields, invalid ranges, and cross-site operators without writes', async () => {
    await expect(service.updateDeviceSettings({ deviceId, siteId, userId: 'operator', source: 'local', body: {
      version: 1,
      overrides: {},
      localControls: ['observationEnabled'],
    } })).rejects.toMatchObject({ statusCode: 400 })
    await expect(service.updateDeviceSettings({ deviceId, siteId, userId: 'admin', source: 'admin', body: {
      version: 1,
      overrides: { voiceVadSettings: { threshold: 2, minSpeechDurationMs: 250, maxSpeechDurationS: 9999, minSilenceDurationMs: 250, speechPadMs: 2000 } },
    } })).rejects.toMatchObject({ statusCode: 400 })
    await expect(service.updateDeviceSettings({ deviceId, siteId, userId: 'admin', source: 'admin', body: {
      version: 1,
      overrides: { faceDetectionConfidence: 0.3 },
    } })).rejects.toMatchObject({ statusCode: 400 })
    await expect(service.updateDeviceSettings({ deviceId, siteId, userId: 'admin', source: 'admin', body: {
      version: 1,
      overrides: { zoneX: 0.9 },
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
      overrides: { observationEnabled: true },
    } }
    const results = await Promise.allSettled([service.updateDeviceSettings(write), service.updateDeviceSettings(write)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(result => result.status === 'rejected')
    expect(rejected?.status === 'rejected' && rejected.reason.statusCode).toBe(409)
    expect((await service.getDeviceSettings(deviceId)).settings.version).toBe(2)
    expect(await db.query.kioskAuditLogs.findMany()).toHaveLength(1)
  })

  it('allows shared VAD updates and blocks local writes to disabled devices', async () => {
    await service.updateDeviceSettings({ deviceId, siteId, userId: 'admin', source: 'admin', body: {
      version: 1,
      overrides: { voiceVadSettings: { threshold: 0.8, minSpeechDurationMs: 250, maxSpeechDurationS: 9999, minSilenceDurationMs: 250, speechPadMs: 2000 } },
    } })
    await service.updateDeviceSettings({ deviceId, siteId, userId: 'operator', source: 'local', body: {
      version: 2,
      overrides: { voiceVadSettings: { threshold: 0.6, minSpeechDurationMs: 250, maxSpeechDurationS: 9999, minSilenceDurationMs: 250, speechPadMs: 2000 } },
    } })
    const cleared = await service.updateDeviceSettings({ deviceId, siteId, userId: 'admin', source: 'admin', body: {
      version: 3,
      overrides: { voiceVadSettings: { threshold: 0.8, minSpeechDurationMs: 250, maxSpeechDurationS: 9999, minSilenceDurationMs: 250, speechPadMs: 2000 } },
    } })
    expect(cleared.effective.voiceVadSettings.threshold).toBe(0.8)
    expect(cleared.settings.overrides.voiceVadSettings?.threshold).toBe(0.8)
    await service.disableDevice({ deviceId, siteId, userId: 'admin' })
    await expect(service.updateDeviceSettings({ deviceId, siteId, userId: 'operator', source: 'local', body: {
      version: 4,
      overrides: { voiceVadSettings: { threshold: 0.5, minSpeechDurationMs: 250, maxSpeechDurationS: 9999, minSilenceDurationMs: 250, speechPadMs: 2000 } },
    } })).rejects.toMatchObject({ statusCode: 403 })
  })
})
