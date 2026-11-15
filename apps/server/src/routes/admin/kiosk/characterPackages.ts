import type { KioskService } from '../../../services/domain/kiosk'
import type { KioskCharacterAssetService } from '../../../services/domain/kiosk-character-assets'
import type { HonoEnv } from '../../../types/hono'

import { kioskCharacterPackageLimits } from '@proj-airi/stage-shared/kiosk-character-package'
import { Hono } from 'hono'

import { exportCharacterPackage, importCharacterPackage } from '../../../services/domain/kioskCharacterPackage'
import { createBadRequestError, createForbiddenError } from '../../../utils/error'

/** Both operations require Site edit rights, including ownership checks before binary export. */
export function createAdminKioskCharacterPackageRoutes(options: { assets: KioskCharacterAssetService, kioskService: Pick<KioskService, 'getSiteManagementCapabilities'> }) {
  return new Hono<HonoEnv>()
    .use('/sites/:siteId/character-package/*', async (c, next) => {
      const capabilities = await options.kioskService.getSiteManagementCapabilities({ siteId: c.req.param('siteId')!, userId: c.get('user')!.id })
      if (!capabilities.canEditExperience)
        throw createForbiddenError()
      await next()
    })
    .post('/sites/:siteId/character-package/export', async (c) => {
      const data = await exportCharacterPackage({ character: await c.req.json().catch(() => null), siteId: c.req.param('siteId'), assets: options.assets })
      c.header('Content-Type', 'application/zip')
      c.header('Content-Disposition', 'attachment; filename="kiosk-character.zip"')
      c.header('Cache-Control', 'no-store')
      return c.body(data)
    })
    .post('/sites/:siteId/character-package/import', async (c) => {
      const body = await c.req.parseBody()
      const file = body.package
      if (!(file instanceof File) || !file.name.toLowerCase().endsWith('.zip') || file.size === 0 || file.size > kioskCharacterPackageLimits.archiveBytes)
        throw createBadRequestError('請選擇不超過 120 MB 的 Webnavior 角色套件 ZIP。', 'INVALID_CHARACTER_PACKAGE')
      const character = await importCharacterPackage({ data: new Uint8Array(await file.arrayBuffer()), siteId: c.req.param('siteId'), assets: options.assets })
      return c.json({ character }, 201)
    })
}
