import type { KioskCharacterPackageManifest, KioskCharacterSettings } from '@proj-airi/stage-shared/kiosk-character-package'

import type { KioskStoredAssetFormat } from '../../schemas/kiosk'
import type { KioskAssetFile, KioskAssetUpload, KioskCharacterAssetService } from './kiosk-character-assets'

import { createHash } from 'node:crypto'

import JSZip from 'jszip'

import { kioskCharacterPackageLimits } from '@proj-airi/stage-shared/kiosk-character-package'
import { describe, expect, it } from 'vitest'

import { exportCharacterPackage, importCharacterPackage } from './kioskCharacterPackage'

function fixture() {
  const files = new Map<string, KioskAssetFile & { siteId: string }>()
  const writes: KioskAssetUpload[] = []
  const assets: KioskCharacterAssetService = {
    async cleanupFiles() {},
    async listSiteFiles(siteId) {
      return [...files].filter(([, file]) => file.siteId === siteId).map(([id, file]) => ({ id, format: file.format }))
    },
    async getFile(id) { return files.get(id) },
    async save<TFormat extends KioskStoredAssetFormat>(input: KioskAssetUpload<TFormat>) {
      const id = `stored-${writes.length}`
      writes.push(input)
      files.set(id, input)
      return { id, name: input.name, format: input.format, sha256: hash(input.data) }
    },
  }
  return { assets, files, writes }
}

function hash(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}
const text = { characterName: '可攜角色', greetingPrompt: '歡迎光臨', greetingPhrases: ['您好', '午安'], characterCard: { description: '角色介紹', personality: '親切', scenario: '協助點餐', systemPrompt: '簡短回答', postHistoryInstructions: '維持角色' } }

async function packageBytes(manifest: unknown, entries: Record<string, string | Uint8Array> = {}) {
  const zip = new JSZip().file('manifest.json', JSON.stringify(manifest))
  for (const [path, data] of Object.entries(entries))
    zip.file(path, data)
  return await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

describe('portable kiosk characters', () => {
  it.each(['vrm', 'live2d_zip'] as const)('roundtrips %s, all motion assignments, text and background into another Site without source IDs or local settings', async (format) => {
    const { assets, writes } = fixture()
    const characterAsset = await assets.save({ siteId: 'source', card: {}, name: '人物', format, data: new TextEncoder().encode('model') })
    const motion = await assets.save({ siteId: 'source', card: {}, name: '動作.vrma', format: 'vrma', data: new TextEncoder().encode('motion') })
    const sceneBackground = await assets.save({ siteId: 'source', card: {}, name: '背景.png', format: 'png', data: new TextEncoder().encode('background') })
    const character: KioskCharacterSettings = {
      ...text,
      characterAsset,
      sceneBackground,
      idleMotion: motion,
      motionPack: { idle: motion, greeting: motion, thinking: motion, listening: motion, acknowledge: motion, presentRecommendations: motion },
    }
    const bytes = await exportCharacterPackage({ assets, siteId: 'source', character: { ...character, interactiveService: { url: 'https://private-store.invalid' }, agentInstructions: 'private store instructions', apiKey: 'private-key' } })
    const zip = await JSZip.loadAsync(bytes)
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as KioskCharacterPackageManifest
    expect(manifest.character).toEqual(text)
    expect(manifest.assets).toHaveLength(9)
    expect(JSON.stringify(manifest)).not.toContain(characterAsset.id)
    expect(JSON.stringify(manifest)).not.toContain('private')
    const imported = await importCharacterPackage({ assets, siteId: 'destination', data: bytes })
    expect(imported.characterName).toBe(text.characterName)
    expect(imported.characterCard).toEqual(text.characterCard)
    expect(imported.greetingPhrases).toEqual(text.greetingPhrases)
    expect(imported.characterAsset?.format).toBe(format)
    expect(imported.characterAsset?.id).not.toBe(characterAsset.id)
    expect(imported.characterAsset?.sha256).toBe(characterAsset.sha256)
    expect(imported.sceneBackground?.sha256).toBe(sceneBackground.sha256)
    expect(Object.keys(imported.motionPack!)).toHaveLength(6)
    expect(imported.idleMotion?.sha256).toBe(motion.sha256)
    expect(writes.slice(3).every(write => write.siteId === 'destination')).toBe(true)
  })

  it('roundtrips a text-only character using the built-in model without requiring an avatar', async () => {
    const { assets, writes } = fixture()
    const data = await exportCharacterPackage({ assets, siteId: 'source', character: { characterName: '內建角色', greetingPrompt: '您好' } })
    const imported = await importCharacterPackage({ assets, siteId: 'destination', data })
    expect(imported.characterName).toBe('內建角色')
    expect(imported.characterAsset).toBeUndefined()
    expect(imported.characterCard).toBeUndefined()
    expect(writes).toHaveLength(0)
  })

  it('rejects another Site asset before reading its bytes', async () => {
    const { assets } = fixture()
    const characterAsset = await assets.save({ siteId: 'private', card: {}, format: 'vrm', name: 'private.vrm', data: new Uint8Array([1]) })
    await expect(exportCharacterPackage({ assets, siteId: 'other', character: { ...text, characterAsset } })).rejects.toMatchObject({ errorCode: 'INVALID_CHARACTER_PACKAGE' })
  })

  it('rejects missing or changed immutable source bytes instead of exporting an incomplete package', async () => {
    const { assets, files } = fixture()
    const characterAsset = await assets.save({ siteId: 'source', card: {}, format: 'vrm', name: 'model.vrm', data: new Uint8Array([1]) })
    files.get(characterAsset.id)!.data = new Uint8Array([2])
    await expect(exportCharacterPackage({ assets, siteId: 'source', character: { ...text, characterAsset } })).rejects.toMatchObject({ errorCode: 'INVALID_CHARACTER_PACKAGE' })
  })

  it.each(['hash', 'missing', 'extra', 'duplicate', 'format', 'version', 'path', 'unknown-setting'] as const)('rejects invalid %s before saving any asset', async (problem) => {
    const { assets, writes } = fixture()
    const model = new Uint8Array([1, 2, 3])
    const asset = { slot: 'avatar', path: 'assets/avatar.vrm', format: 'vrm', name: 'model.vrm', sha256: hash(model) }
    const manifest = { format: 'webnavior-kiosk-character', version: 1, character: { ...text }, assets: [asset] }
    const entries: Record<string, Uint8Array> = { 'assets/avatar.vrm': model }
    if (problem === 'hash') {
      // The first model is valid: a later corrupt clip must prevent ALL writes.
      manifest.assets.push({ slot: 'idleMotion', path: 'assets/idleMotion.vrma', format: 'vrma', name: 'idle.vrma', sha256: hash(model) })
      entries['assets/idleMotion.vrma'] = new Uint8Array([4])
    }
    if (problem === 'missing')
      delete entries['assets/avatar.vrm']
    if (problem === 'extra')
      entries['secret.txt'] = model
    if (problem === 'duplicate')
      manifest.assets.push({ ...asset })
    if (problem === 'format')
      asset.format = 'png'
    if (problem === 'version')
      manifest.version = 2
    if (problem === 'path')
      entries['../secret.txt'] = model
    if (problem === 'unknown-setting')
      Object.assign(manifest.character, { interactiveService: { url: 'https://wrong-store.invalid' } })
    const data = await packageBytes(manifest, entries)
    await expect(importCharacterPackage({ assets, siteId: 'destination', data })).rejects.toMatchObject({ errorCode: 'INVALID_CHARACTER_PACKAGE' })
    expect(writes).toHaveLength(0)
  })

  it('stops an oversized compressed manifest during extraction without persisting assets', async () => {
    const { assets, writes } = fixture()
    const data = await packageBytes({ padding: 'x'.repeat(kioskCharacterPackageLimits.manifestBytes + 1) })
    expect(data.byteLength).toBeLessThan(kioskCharacterPackageLimits.manifestBytes)
    await expect(importCharacterPackage({ assets, siteId: 'destination', data })).rejects.toMatchObject({ errorCode: 'INVALID_CHARACTER_PACKAGE' })
    expect(writes).toHaveLength(0)
  })
})
