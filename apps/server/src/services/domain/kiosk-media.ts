import type { Database } from '../../libs/db'
import type { KioskVisitorMediaKind } from '../../schemas/kiosk'

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { asc, eq } from 'drizzle-orm'

import * as schema from '../../schemas'

export interface KioskMediaUpload {
  data: Uint8Array
  endedAt?: Date
  interactionEntryId?: string
  kind: KioskVisitorMediaKind
  mimeType: string
  startedAt?: Date
  visitorSessionId: string
}

export interface KioskMediaFile {
  data: Uint8Array
  media: schema.KioskVisitorMedia
}

/** Stores private POC evidence bytes separately from the relational timeline. */
export interface KioskMediaService {
  cleanupFiles: (media: schema.KioskVisitorMedia[]) => Promise<void>
  getFile: (mediaId: string) => Promise<KioskMediaFile | undefined>
  listVisitorSessionMedia: (visitorSessionId: string) => Promise<schema.KioskVisitorMedia[]>
  save: (input: KioskMediaUpload) => Promise<schema.KioskVisitorMedia>
}

export function createKioskMediaService(db: Database, mediaDirectory: string): KioskMediaService {
  function filePath(mediaId: string) {
    return join(mediaDirectory, `${mediaId}.bin`)
  }

  async function save(input: KioskMediaUpload) {
    const [media] = await db.insert(schema.kioskVisitorMedia).values({
      byteSize: input.data.byteLength,
      endedAt: input.endedAt,
      interactionEntryId: input.interactionEntryId,
      kind: input.kind,
      mimeType: input.mimeType,
      startedAt: input.startedAt,
      visitorSessionId: input.visitorSessionId,
    }).returning()
    try {
      await mkdir(mediaDirectory, { recursive: true })
      await writeFile(filePath(media.id), input.data, { flag: 'wx' })
    }
    catch (cause) {
      await db.delete(schema.kioskVisitorMedia).where(eq(schema.kioskVisitorMedia.id, media.id))
      throw cause
    }
    return media
  }

  async function getFile(mediaId: string) {
    const media = await db.query.kioskVisitorMedia.findFirst({ where: eq(schema.kioskVisitorMedia.id, mediaId) })
    if (!media)
      return
    try {
      return { data: await readFile(filePath(media.id)), media }
    }
    catch (cause) {
      if (!isMissingFileError(cause))
        throw cause
      await db.delete(schema.kioskVisitorMedia).where(eq(schema.kioskVisitorMedia.id, media.id))
      throw cause
    }
  }

  async function listVisitorSessionMedia(visitorSessionId: string) {
    return await db.query.kioskVisitorMedia.findMany({
      where: eq(schema.kioskVisitorMedia.visitorSessionId, visitorSessionId),
      orderBy: [asc(schema.kioskVisitorMedia.createdAt)],
    })
  }

  async function cleanupFiles(media: schema.KioskVisitorMedia[]) {
    await Promise.all(media.map(async item => await rm(filePath(item.id), { force: true })))
  }

  return { cleanupFiles, getFile, listVisitorSessionMedia, save }
}

function isMissingFileError(cause: unknown): cause is NodeJS.ErrnoException {
  return typeof cause === 'object' && cause !== null && (cause as NodeJS.ErrnoException).code === 'ENOENT'
}
