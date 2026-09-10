import type { KioskService } from '../../../services/domain/kiosk'
import type { KioskCharacterAssetService } from '../../../services/domain/kiosk-character-assets'
import type { HonoEnv } from '../../../types/hono'

import { basename } from 'node:path'

import JSZip from 'jszip'

import { Hono } from 'hono'

import { createBadRequestError, createForbiddenError } from '../../../utils/error'

const maximumUploadBytes = 64 * 1024 * 1024
const maximumExtractedModelBytes = 128 * 1024 * 1024

interface ImportedCardPackage {
  card: Record<string, string>
  data: Uint8Array
  format: 'live2d_zip' | 'vrm'
  name: string
}

type UploadKind = 'avatar' | 'role_card'

/**
 * Parses the portable AIRI character-card package without importing its runtime
 * provider configuration. Webnavior accepts the textual CCv3 fields plus one
 * VRM or Live2D archive, and deliberately rejects every other embedded file.
 */
export function createAdminKioskCharacterAssetRoutes(options: { assets: KioskCharacterAssetService, kioskService: KioskService }) {
  return new Hono<HonoEnv>()
    .post('/sites/:siteId/character-assets', async (c) => {
      const siteId = c.req.param('siteId')
      const capabilities = await options.kioskService.getSiteManagementCapabilities({ siteId, userId: c.get('user')!.id })
      if (!capabilities.canEditExperience)
        throw createForbiddenError()
      const body = await c.req.parseBody()
      const uploaded = body.asset
      const kind: UploadKind = body.kind === 'avatar' ? 'avatar' : 'role_card'
      if (!(uploaded instanceof File))
        throw createBadRequestError('Please choose a VRM file or a character-card package.', 'INVALID_CHARACTER_ASSET')
      if (uploaded.size === 0 || uploaded.size > maximumUploadBytes)
        throw createBadRequestError('Character asset must be between 1 byte and 64 MB.', 'INVALID_CHARACTER_ASSET')

      const imported = await importCharacterAsset(uploaded, kind)
      const asset = await options.assets.save({ ...imported, siteId })
      return c.json({ asset, card: imported.card }, 201)
    })
}

async function importCharacterAsset(file: File, kind: UploadKind): Promise<ImportedCardPackage> {
  if (file.name.toLowerCase().endsWith('.vrm')) {
    return {
      card: {},
      data: new Uint8Array(await file.arrayBuffer()),
      format: 'vrm',
      name: safeName(file.name, '角色模型'),
    }
  }

  if (!file.name.toLowerCase().endsWith('.zip'))
    throw createBadRequestError('Only .vrm and AIRI character-card .zip files are supported.', 'INVALID_CHARACTER_ASSET')

  if (kind === 'avatar') {
    return {
      card: {},
      data: new Uint8Array(await file.arrayBuffer()),
      format: 'live2d_zip',
      name: safeName(file.name, 'Live2D 模型'),
    }
  }

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer(), { checkCRC32: true })
  }
  catch {
    throw createBadRequestError('The character-card package is not a valid ZIP file.', 'INVALID_CHARACTER_ASSET')
  }

  const manifest = await readJson(zip, 'manifest.json')
  if (!isRecord(manifest) || manifest.format !== 'airi-character-card' || manifest.version !== 1 || !isRecord(manifest.card) || manifest.card.path !== 'card.json')
    throw createBadRequestError('The ZIP must use the AIRI character-card v1 manifest.', 'INVALID_CHARACTER_ASSET')

  const cardJson = await readJson(zip, 'card.json')
  const card = readCard(cardJson)
  const resource = isRecord(manifest.resources) && isRecord(manifest.resources.displayModel) ? manifest.resources.displayModel : undefined
  if (!resource || typeof resource.path !== 'string' || typeof resource.name !== 'string')
    throw createBadRequestError('The character-card package does not include a display model.', 'INVALID_CHARACTER_ASSET')

  const format = resource.format === 'vrm' ? 'vrm' : resource.format === 'live2d-zip' ? 'live2d_zip' : undefined
  if (!format)
    throw createBadRequestError('Only VRM and Live2D display models are supported.', 'INVALID_CHARACTER_ASSET')

  const modelFile = zip.file(resource.path)
  if (!modelFile)
    throw createBadRequestError('The display model declared by manifest.json is missing.', 'INVALID_CHARACTER_ASSET')
  const data = new Uint8Array(await modelFile.async('arraybuffer'))
  if (data.byteLength === 0 || data.byteLength > maximumExtractedModelBytes)
    throw createBadRequestError('The extracted display model must be between 1 byte and 128 MB.', 'INVALID_CHARACTER_ASSET')

  return { card, data, format, name: safeName(resource.name, card.name || '角色模型') }
}

async function readJson(zip: JSZip, path: string): Promise<unknown> {
  const file = zip.file(path)
  if (!file)
    throw createBadRequestError(`Missing ${path} in the character-card package.`, 'INVALID_CHARACTER_ASSET')
  try {
    return JSON.parse(await file.async('string'))
  }
  catch {
    throw createBadRequestError(`Invalid JSON in ${path}.`, 'INVALID_CHARACTER_ASSET')
  }
}

function readCard(value: unknown): Record<string, string> {
  if (!isRecord(value) || value.spec !== 'chara_card_v3' || !isRecord(value.data))
    throw createBadRequestError('card.json must be a Character Card v3 document.', 'INVALID_CHARACTER_ASSET')

  const card: Record<string, string> = {}
  for (const field of ['name', 'nickname', 'description', 'personality', 'scenario', 'first_mes', 'system_prompt', 'post_history_instructions']) {
    const valueAtField = value.data[field]
    if (typeof valueAtField === 'string')
      card[field] = valueAtField.slice(0, 8_000)
  }
  return card
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeName(value: string, fallback: string) {
  return basename(value).replace(/[\\/:*?"<>|]/g, '_').slice(0, 255) || fallback
}
