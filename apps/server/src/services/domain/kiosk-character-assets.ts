import type { Database } from '../../libs/db'
import type { KioskCharacterAssetReference } from '../../schemas/kiosk'

import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { and, eq } from 'drizzle-orm'

import * as schema from '../../schemas'

/** A validated avatar payload ready to become a server-owned kiosk asset. */
export interface CharacterAssetUpload {
  card: Record<string, string>
  data: Uint8Array
  format: KioskCharacterAssetReference['format']
  name: string
  siteId: string
}

/** Resolves the binary response metadata for an immutable kiosk avatar. */
export interface CharacterAssetFile {
  data: Uint8Array
  format: KioskCharacterAssetReference['format']
}

/**
 * Owns the durable avatar asset boundary.
 *
 * Postgres stores metadata and profile references while the configured local
 * volume stores binary payloads. Content hashes make a repeated upload for one
 * site idempotent and give Kiosk a stable cache-validation token.
 */
export interface KioskCharacterAssetService {
  cleanupFiles: (assets: KioskCharacterAssetFileReference[]) => Promise<void>
  getFile: (assetId: string) => Promise<CharacterAssetFile | undefined>
  listSiteFiles: (siteId: string) => Promise<KioskCharacterAssetFileReference[]>
  save: (input: CharacterAssetUpload) => Promise<KioskCharacterAssetReference>
}

/** File references captured before the owning Site database row is deleted. */
export interface KioskCharacterAssetFileReference {
  format: KioskCharacterAssetReference['format']
  id: string
}

export function createKioskCharacterAssetService(db: Database, assetDirectory: string): KioskCharacterAssetService {
  function filePath(assetId: string, format: KioskCharacterAssetReference['format']) {
    return join(assetDirectory, `${assetId}.${format === 'vrm' ? 'vrm' : 'zip'}`)
  }

  async function save(input: CharacterAssetUpload): Promise<KioskCharacterAssetReference> {
    const sha256 = createHash('sha256').update(input.data).digest('hex')
    const existing = await db.query.kioskCharacterAssets.findFirst({
      where: and(eq(schema.kioskCharacterAssets.siteId, input.siteId), eq(schema.kioskCharacterAssets.sha256, sha256)),
    })
    if (existing) {
      return { id: existing.id, name: existing.name, format: existing.format, sha256: existing.sha256 }
    }

    const [asset] = await db.insert(schema.kioskCharacterAssets).values({
      byteSize: input.data.byteLength,
      card: input.card,
      format: input.format,
      name: input.name,
      sha256,
      siteId: input.siteId,
    }).returning()

    try {
      await mkdir(assetDirectory, { recursive: true })
      await writeFile(filePath(asset.id, asset.format), input.data, { flag: 'wx' })
    }
    catch (cause) {
      await db.delete(schema.kioskCharacterAssets).where(eq(schema.kioskCharacterAssets.id, asset.id))
      throw cause
    }

    return { id: asset.id, name: asset.name, format: asset.format, sha256: asset.sha256 }
  }

  async function getFile(assetId: string): Promise<CharacterAssetFile | undefined> {
    const asset = await db.query.kioskCharacterAssets.findFirst({ where: eq(schema.kioskCharacterAssets.id, assetId) })
    if (!asset)
      return

    try {
      return { data: await readFile(filePath(asset.id, asset.format)), format: asset.format }
    }
    catch (cause) {
      if (!isMissingFileError(cause))
        throw cause

      // A failed binary write is rolled back. If an operator later removes a
      // volume file, remove only that dangling metadata instead of serving an
      // invalid profile reference; permission and I/O failures must stay visible.
      await db.delete(schema.kioskCharacterAssets).where(eq(schema.kioskCharacterAssets.id, asset.id))
      throw cause
    }
  }

  async function listSiteFiles(siteId: string) {
    return await db.query.kioskCharacterAssets.findMany({
      where: eq(schema.kioskCharacterAssets.siteId, siteId),
      columns: { format: true, id: true },
    })
  }

  async function cleanupFiles(assets: KioskCharacterAssetFileReference[]) {
    await Promise.all(assets.map(async (asset) => {
      await rm(filePath(asset.id, asset.format), { force: true })
    }))
  }

  return { cleanupFiles, getFile, listSiteFiles, save }
}

function isMissingFileError(cause: unknown): cause is NodeJS.ErrnoException {
  return typeof cause === 'object' && cause !== null && (cause as NodeJS.ErrnoException).code === 'ENOENT'
}
