import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { mockDB } from '../../libs/mock-db'
import { createKioskService } from './kiosk'
import { createKioskMediaService } from './kiosk-media'

import * as schema from '../../schemas'

describe('retained original media', () => {
  const directories: string[] = []
  afterEach(async () => {
    await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
  })

  it('retains original audio/image/video bytes after session link expiry and detects corruption without deleting metadata', async () => {
    const db = await mockDB(schema)
    const kiosk = createKioskService(db)
    const { device } = await kiosk.registerDevelopmentDevice({ registrationCode: '123456' })
    const profile = await kiosk.getDeviceProfile(device.id)
    const session = await kiosk.startVisitorSession({ deviceId: device.id, profileReleaseId: profile!.id, serviceId: profile!.snapshot.interactiveService.id })
    const directory = await mkdtemp(join(tmpdir(), 'kiosk-archive-test-'))
    directories.push(directory)
    const media = createKioskMediaService(db, directory)
    const bytes = new Uint8Array([1, 2, 3, 4])
    for (const kind of ['audio_recording', 'triggered_image', 'triggered_video'] as const) {
      const saved = await media.save({ data: bytes, kind, mimeType: 'application/octet-stream', visitorSessionId: session.id })
      expect(saved.sha256).toHaveLength(64)
      expect(new Uint8Array(await readFile(join(directory, `${saved.id}.bin`)))).toEqual(bytes)
    }
    await kiosk.endDeviceVisitorSession({ deviceId: device.id, visitorSessionId: session.id, state: 'completed' })
    await kiosk.releaseExpiredVisitorLinks(new Date('2100-01-01'))
    const records = await media.listVisitorSessionMedia(session.id)
    expect(records).toHaveLength(3)
    const id = records[0]!.id
    expect((await media.getFile(id))?.data).toEqual(Buffer.from(bytes))
    await writeFile(join(directory, `${id}.bin`), new Uint8Array([4, 3, 2, 1]))
    await expect(media.getFile(id)).rejects.toThrow('integrity')
    expect(await media.listVisitorSessionMedia(session.id)).toHaveLength(3)
    await rm(join(directory, `${id}.bin`))
    await expect(media.getFile(id)).rejects.toThrow()
    expect(await media.listVisitorSessionMedia(session.id)).toHaveLength(3)
  })

  it('rejects an evidence reference from another visitor session', async () => {
    const db = await mockDB(schema)
    const kiosk = createKioskService(db)
    const { device } = await kiosk.registerDevelopmentDevice({ registrationCode: '123456' })
    const profile = await kiosk.getDeviceProfile(device.id)
    const first = await kiosk.startVisitorSession({ deviceId: device.id, profileReleaseId: profile!.id, serviceId: profile!.snapshot.interactiveService.id })
    const second = await kiosk.startVisitorSession({ deviceId: device.id, profileReleaseId: profile!.id, serviceId: profile!.snapshot.interactiveService.id })
    const entry = await kiosk.appendInteractionEntry({ visitorSessionId: first.id, kind: 'user_text', content: '你好' })
    const directory = await mkdtemp(join(tmpdir(), 'kiosk-archive-test-'))
    directories.push(directory)
    const media = createKioskMediaService(db, directory)
    await expect(media.save({ visitorSessionId: second.id, interactionEntryId: entry.id, kind: 'audio_recording', mimeType: 'audio/wav', data: new Uint8Array([1]) })).rejects.toThrow('same visitor session')
    expect(await media.listVisitorSessionMedia(second.id)).toEqual([])
  })
})
