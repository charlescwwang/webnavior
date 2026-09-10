import type { KioskCharacterAssetService } from '../../services/domain/kiosk-character-assets'
import type { HonoEnv } from '../../types/hono'

import { Hono } from 'hono'

import { createNotFoundError } from '../../utils/error'

/** Serves immutable public avatar bytes; opaque asset ids contain no credentials or user data. */
export function createKioskCharacterAssetRoutes(assets: KioskCharacterAssetService) {
  return new Hono<HonoEnv>()
    .get('/:assetId', async (c) => {
      const asset = await assets.getFile(c.req.param('assetId'))
      if (!asset)
        throw createNotFoundError('Character asset not found')

      c.header('Cache-Control', 'public, max-age=31536000, immutable')
      c.header('Content-Type', asset.format === 'vrm' ? 'model/gltf-binary' : 'application/zip')
      return c.body(asset.data.buffer as ArrayBuffer)
    })
}
