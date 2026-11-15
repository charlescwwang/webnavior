import type { InferOutput } from 'valibot'

import { array, check, literal, maxLength, minLength, object, optional, picklist, pipe, regex, strictObject, string } from 'valibot'

/** Budgets cover the complete ZIP; HTTP multipart framing has a separate allowance. */
export const kioskCharacterPackageLimits = {
  archiveBytes: 120 * 1024 * 1024,
  extractedBytes: 256 * 1024 * 1024,
  assetBytes: 128 * 1024 * 1024,
  manifestBytes: 256 * 1024,
} as const

const name = pipe(string(), minLength(1), maxLength(255))
const sha256 = pipe(string(), regex(/^[a-f0-9]{64}$/))
const id = pipe(string(), minLength(1), maxLength(120))
const text = pipe(string(), maxLength(8_000))
const motion = object({ id, name, sha256, format: literal('vrma') })
const characterText = {
  characterName: pipe(string(), minLength(1), maxLength(120)),
  characterCard: optional(object({ description: text, personality: text, postHistoryInstructions: text, scenario: text, systemPrompt: text })),
  greetingPrompt: pipe(string(), minLength(1), maxLength(2_000)),
  greetingPhrases: optional(pipe(array(pipe(string(), minLength(1), maxLength(500))), minLength(1), maxLength(50))),
}

/** Only character presentation is portable; merchant, provider and device policy stay local. */
export const KioskCharacterSettingsSchema = object({
  ...characterText,
  characterAsset: optional(object({ id, name, sha256, format: picklist(['vrm', 'live2d_zip']) })),
  sceneBackground: optional(object({ id, name, sha256, format: picklist(['png', 'jpeg', 'webp']) })),
  idleMotion: optional(motion),
  motionPack: optional(object({ acknowledge: optional(motion), greeting: optional(motion), idle: optional(motion), listening: optional(motion), presentRecommendations: optional(motion), thinking: optional(motion) })),
})

export const kioskCharacterMotionSlots = ['acknowledge', 'greeting', 'idle', 'listening', 'presentRecommendations', 'thinking'] as const

const assetSchema = pipe(strictObject({
  slot: picklist(['avatar', 'background', 'idleMotion', ...kioskCharacterMotionSlots]),
  path: pipe(string(), regex(/^assets\/[a-zA-Z]+\.(?:vrm|zip|vrma|png|jpeg|webp)$/)),
  name,
  sha256,
  format: picklist(['vrm', 'live2d_zip', 'vrma', 'png', 'jpeg', 'webp']),
}), check((asset) => {
  if (asset.slot === 'avatar')
    return asset.format === 'vrm' || asset.format === 'live2d_zip'
  if (asset.slot === 'background')
    return ['png', 'jpeg', 'webp'].includes(asset.format)
  return asset.format === 'vrma'
}, 'Asset format does not match its character slot.'))

/** Versioned on-disk contract contains relative binary paths, never source-server asset IDs. */
export const KioskCharacterPackageManifestSchema = strictObject({
  format: literal('webnavior-kiosk-character'),
  version: literal(1),
  character: strictObject(characterText),
  assets: pipe(array(assetSchema), maxLength(9)),
})

export type KioskCharacterSettings = InferOutput<typeof KioskCharacterSettingsSchema>
export type KioskCharacterPackageManifest = InferOutput<typeof KioskCharacterPackageManifestSchema>
