import type { KioskCharacterPackageManifest, KioskCharacterSettings } from '@proj-airi/stage-shared/kiosk-character-package'

import type { KioskCharacterAssetService } from './kiosk-character-assets'

import { createHash } from 'node:crypto'

import JSZip from 'jszip'

import { kioskCharacterMotionSlots, KioskCharacterPackageManifestSchema, KioskCharacterSettingsSchema, kioskCharacterPackageLimits as limits } from '@proj-airi/stage-shared/kiosk-character-package'
import { safeParse } from 'valibot'

import { createBadRequestError } from '../../utils/error'

type PackageAsset = KioskCharacterPackageManifest['assets'][number]
type AssetReference = NonNullable<KioskCharacterSettings['characterAsset'] | KioskCharacterSettings['sceneBackground'] | KioskCharacterSettings['idleMotion']>

/** Exports the current editor state and only immutable files owned by the authorized Site. */
export async function exportCharacterPackage(input: { character: unknown, siteId: string, assets: KioskCharacterAssetService }): Promise<Uint8Array<ArrayBuffer>> {
  const parsed = safeParse(KioskCharacterSettingsSchema, input.character)
  if (!parsed.success)
    throw invalid('角色設定不完整或超過長度限制，請檢查後再下載。')
  const { characterAsset, sceneBackground, idleMotion, motionPack, ...character } = parsed.output
  const references: Array<{ slot: PackageAsset['slot'], reference: AssetReference | undefined }> = [
    { slot: 'avatar', reference: characterAsset },
    { slot: 'background', reference: sceneBackground },
    { slot: 'idleMotion', reference: idleMotion },
    ...kioskCharacterMotionSlots.map(slot => ({ slot, reference: motionPack?.[slot] })),
  ]
  const owned = new Map((await input.assets.listSiteFiles(input.siteId)).map(asset => [asset.id, asset.format]))
  const manifest: KioskCharacterPackageManifest = { format: 'webnavior-kiosk-character', version: 1, character, assets: [] }
  const zip = new JSZip()
  let total = 0
  for (const { slot, reference } of references) {
    if (!reference)
      continue
    if (owned.get(reference.id) !== reference.format)
      throw invalid('角色素材不屬於目前店別，請重新上傳素材後再下載套件。')
    const file = await input.assets.getFile(reference.id)
    if (!file || file.format !== reference.format)
      throw invalid('找不到角色素材，請重新上傳素材後再下載套件。')
    total += file.data.byteLength
    if (!file.data.byteLength || file.data.byteLength > limits.assetBytes || total > limits.extractedBytes)
      throw invalid('角色素材超過容量限制：單檔 128 MB、合計 256 MB。')
    if (digest(file.data) !== reference.sha256)
      throw invalid('角色素材與已儲存的雜湊不符，請重新上傳素材。')
    const extension = reference.format === 'live2d_zip' ? 'zip' : reference.format
    const path = `assets/${slot}.${extension}`
    manifest.assets.push({ slot, path, format: reference.format, name: reference.name, sha256: reference.sha256 })
    zip.file(path, file.data)
  }
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2))
  if (manifestBytes.byteLength > limits.manifestBytes)
    throw invalid('角色文字超過套件容量限制，請縮短內容後再下載。')
  zip.file('manifest.json', manifestBytes)
  // STORE keeps generation bounded and avoids recompressing nested Live2D ZIPs.
  // Use the same streaming cap as import so every successful download can reimport.
  return await readBounded(zip.generateNodeStream({ compression: 'STORE' }), limits.archiveBytes)
}

/** Validates the entire package before saving Site-owned assets; never saves or publishes a Profile. */
export async function importCharacterPackage(input: { data: Uint8Array, siteId: string, assets: KioskCharacterAssetService }): Promise<KioskCharacterSettings> {
  if (!input.data.byteLength || input.data.byteLength > limits.archiveBytes)
    throw invalid('角色套件必須是 1 byte 至 120 MB 的 ZIP 檔案。')
  let zip: JSZip
  try {
    // CRC-on-load inflates every member before budgets can be enforced. Read
    // declared files with bounded streams and verify their SHA-256 instead.
    zip = await JSZip.loadAsync(input.data)
  }
  catch {
    throw invalid('無法讀取角色套件，請選擇有效且未加密的 ZIP 檔案。')
  }
  const entries = Object.values(zip.files)
  if (entries.length > 12 || entries.some(file => file.unsafeOriginalName && file.unsafeOriginalName !== file.name))
    throw invalid('角色套件包含不允許的路徑或過多檔案。')
  const manifestFile = zip.file('manifest.json')
  if (!manifestFile)
    throw invalid('這不是 Webnavior 角色套件：缺少 manifest.json。')
  const manifestBytes = await readBounded(manifestFile.nodeStream(), limits.manifestBytes)
  let json: unknown
  try {
    json = JSON.parse(new TextDecoder().decode(manifestBytes))
  }
  catch {
    throw invalid('角色套件的 manifest.json 不是有效 JSON。')
  }
  const parsed = safeParse(KioskCharacterPackageManifestSchema, json)
  if (!parsed.success)
    throw invalid('角色套件版本或內容不受支援，請重新下載 Webnavior 角色套件。')
  const manifest = parsed.output
  const paths = new Set(manifest.assets.map(asset => asset.path))
  const slots = new Set(manifest.assets.map(asset => asset.slot))
  if (paths.size !== manifest.assets.length || slots.size !== manifest.assets.length
    || entries.some(file => !file.dir && file.name !== 'manifest.json' && !paths.has(file.name))) {
    throw invalid('角色套件包含重複的素材欄位或未宣告的檔案。')
  }

  let total = 0
  const files: Array<{ asset: PackageAsset, data: Uint8Array }> = []
  for (const asset of manifest.assets) {
    const file = zip.file(asset.path)
    if (!file)
      throw invalid(`角色套件缺少素材：${asset.name}`)
    const data = await readBounded(file.nodeStream(), Math.min(limits.assetBytes, limits.extractedBytes - total))
    total += data.byteLength
    if (!data.byteLength || digest(data) !== asset.sha256)
      throw invalid(`角色素材已損壞或雜湊不符：${asset.name}`)
    files.push({ asset, data })
  }

  const references = new Map<PackageAsset['slot'], AssetReference>()
  // All input is validated first. An I/O failure can leave unreferenced assets
  // in this Site, just like individual uploads; retry is content-deduplicated.
  // Never delete them here: a prior draft may already share that content hash.
  for (const { asset, data } of files) {
    const saved = await input.assets.save({ card: {}, data, format: asset.format, name: asset.name, siteId: input.siteId })
    references.set(asset.slot, saved)
  }
  const result = safeParse(KioskCharacterSettingsSchema, {
    ...manifest.character,
    characterAsset: references.get('avatar'),
    sceneBackground: references.get('background'),
    idleMotion: references.get('idleMotion'),
    motionPack: Object.fromEntries(kioskCharacterMotionSlots.filter(slot => references.has(slot)).map(slot => [slot, references.get(slot)])),
  })
  if (!result.success)
    throw invalid('儲存的角色素材格式不符，請檢查素材並重試。')
  return result.output
}

function digest(data: Uint8Array) {
  return createHash('sha256').update(data).digest('hex')
}

function invalid(message: string) {
  return createBadRequestError(message, 'INVALID_CHARACTER_PACKAGE')
}

/** Stop decompression/generation at the byte budget rather than allocating its full result first. */
function readBounded(stream: NodeJS.ReadableStream, maximum: number): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    let size = 0
    let failed = false
    stream.on('data', (chunk: Uint8Array) => {
      if (failed)
        return
      size += chunk.byteLength
      if (size > maximum) {
        failed = true
        stream.pause()
        chunks.length = 0
        reject(invalid('角色套件超過容量限制（ZIP 120 MB、單檔 128 MB、解壓合計 256 MB）。'))
        return
      }
      chunks.push(chunk)
    }).on('error', () => {
      failed = true
      chunks.length = 0
      reject(invalid('角色套件損壞或無法處理。'))
    }).on('end', () => {
      if (failed)
        return
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      resolve(bytes)
    }).resume()
  })
}
