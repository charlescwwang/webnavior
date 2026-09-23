import type { KioskStoredAssetFormat } from '../../schemas/kiosk'
import type { KioskCharacterAssetService } from '../../services/domain/kiosk-character-assets'
import type { HonoEnv } from '../../types/hono'

import { Hono } from 'hono'

import { createNotFoundError } from '../../utils/error'

/** Serves immutable kiosk asset bytes; opaque asset ids contain no credentials or user data. */
export function createKioskCharacterAssetRoutes(assets: KioskCharacterAssetService) {
  return new Hono<HonoEnv>()
    .get('/:assetId', async (c) => {
      const asset = await assets.getFile(c.req.param('assetId'))
      if (!asset)
        throw createNotFoundError('Kiosk asset not found')

      c.header('Cache-Control', 'public, max-age=31536000, immutable')
      c.header('Content-Type', contentTypeFor(asset.format))
      return c.body(asset.data.buffer as ArrayBuffer)
    })
}

function contentTypeFor(format: KioskStoredAssetFormat) {
  if (format === 'vrm')
    return 'model/gltf-binary'
  if (format === 'vrma')
    return 'application/octet-stream'
  if (format === 'jpeg')
    return 'image/jpeg'
  if (format === 'png')
    return 'image/png'
  if (format === 'webp')
    return 'image/webp'
  return 'application/zip'
}
