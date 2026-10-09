import type { Database } from '../../libs/db'
import type { KioskVisitorMediaKind } from '../../schemas/kiosk'

import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { and, asc, eq } from 'drizzle-orm'

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

/** Stores original private evidence bytes separately from the retained relational timeline. */
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
    if (input.interactionEntryId) {
      const entry = await db.query.kioskInteractionEntries.findFirst({ where: and(eq(schema.kioskInteractionEntries.id, input.interactionEntryId), eq(schema.kioskInteractionEntries.visitorSessionId, input.visitorSessionId)) })
      if (!entry)
        throw new Error('Media evidence must reference an entry in the same visitor session.')
    }
    const [media] = await db.insert(schema.kioskVisitorMedia).values({
      byteSize: input.data.byteLength,
      sha256: createHash('sha256').update(input.data).digest('hex'),
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
    // Reads never remove metadata, including missing or corrupt evidence.
    // Operators need that manifest to diagnose and restore an archive.
    const data = await readFile(filePath(media.id))
    if (data.byteLength !== media.byteSize || (media.sha256 && createHash('sha256').update(data).digest('hex') !== media.sha256))
      throw new Error('Archived media failed its integrity check.')
    return { data, media }
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
