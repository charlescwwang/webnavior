import type { KioskCharacterAssetService } from '../../../services/domain/kiosk-character-assets'
import type { HonoEnv } from '../../../types/hono'

import JSZip from 'jszip'

import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'

import { authGuard } from '../../../middlewares/auth'
import { ApiError } from '../../../utils/error'
import { createAdminKioskCharacterPackageRoutes } from './characterPackages'

function fixture(canEdit = true, signedIn = true) {
  const getSiteManagementCapabilities = vi.fn(async () => ({ canEditExperience: canEdit, canEditTechnicalSettings: false, canManageDevices: false, canPublishExperience: false }))
  const assets: KioskCharacterAssetService = {
    async cleanupFiles() {},
    listSiteFiles: vi.fn(async () => []),
    getFile: vi.fn(async () => undefined),
    save: vi.fn(async () => { throw new Error('Text-only package must not save binaries') }),
  }
  const app = new Hono<HonoEnv>()
    .use('*', async (c, next) => {
      c.set('user', signedIn ? { id: 'operator' } as HonoEnv['Variables']['user'] : null)
      await next()
    })
    .use('*', authGuard)
    .route('/api/admin/kiosk', createAdminKioskCharacterPackageRoutes({ assets, kioskService: { getSiteManagementCapabilities } }))
    .onError((error, c) => {
      if (error instanceof ApiError)
        return c.json({ error: error.errorCode, message: error.message }, error.statusCode)
      return c.json({ error: 'internal' }, 500)
    })
  return { app, assets, getSiteManagementCapabilities }
}

const path = '/api/admin/kiosk/sites/target/character-package'
const character = { characterName: '助手', greetingPrompt: '您好' }

describe('admin character package endpoints', () => {
  it('exports unsaved text as an uncached ZIP and imports it as character data without publishing', async () => {
    const { app, assets, getSiteManagementCapabilities } = fixture()
    const exported = await app.request(`${path}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(character) })
    expect(exported.status).toBe(200)
    expect(exported.headers.get('Content-Type')).toBe('application/zip')
    expect(exported.headers.get('Cache-Control')).toBe('no-store')
    expect(exported.headers.get('Content-Disposition')).toContain('attachment')
    const bytes = await exported.arrayBuffer()
    const zip = await JSZip.loadAsync(bytes)
    expect(JSON.parse(await zip.file('manifest.json')!.async('string')).character).toEqual(character)
    const body = new FormData()
    body.set('package', new File([new Uint8Array(bytes)], 'character.zip'))
    const imported = await app.request(`${path}/import`, { method: 'POST', body })
    expect(imported.status).toBe(201)
    await expect(imported.json()).resolves.toMatchObject({ character })
    expect(getSiteManagementCapabilities).toHaveBeenCalledWith({ siteId: 'target', userId: 'operator' })
    expect(assets.save).not.toHaveBeenCalled()
  })

  it.each(['import', 'export'])('blocks a viewer from %s before reading or writing assets', async (operation) => {
    const { app, assets } = fixture(false)
    const response = await app.request(`${path}/${operation}`, { method: 'POST' })
    expect(response.status).toBe(403)
    expect(assets.listSiteFiles).not.toHaveBeenCalled()
    expect(assets.save).not.toHaveBeenCalled()
  })

  it.each(['import', 'export'])('requires authentication for %s', async (operation) => {
    const { app, getSiteManagementCapabilities } = fixture(true, false)
    const response = await app.request(`${path}/${operation}`, { method: 'POST' })
    expect(response.status).toBe(401)
    expect(getSiteManagementCapabilities).not.toHaveBeenCalled()
  })

  it('rejects a malformed upload with an actionable message', async () => {
    const { app, assets } = fixture()
    const body = new FormData()
    body.set('package', new File(['not a ZIP'], 'character.zip'))
    const response = await app.request(`${path}/import`, { method: 'POST', body })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'INVALID_CHARACTER_PACKAGE', message: expect.stringContaining('ZIP') })
    expect(assets.save).not.toHaveBeenCalled()
  })
})
