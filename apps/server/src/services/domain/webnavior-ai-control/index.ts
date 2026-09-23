import type { Database } from '../../../libs/db'
import type { WebnaviorAiCapability, WebnaviorAiConnectionKind } from '../../../schemas/webnavior-ai'
import type { EnvelopeCrypto } from '../../../utils/envelope-crypto'

import { errorMessageFrom } from '@moeru/std'
import { asc, eq } from 'drizzle-orm'

import { createBadRequestError, createConflictError, createNotFoundError } from '../../../utils/error'
import { discoverModels, probeModelCatalog } from './discover-models'
import { verifyProviderProfile } from './verify-provider-profile'

import * as schema from '../../../schemas'

const CONNECTION_KEY_ENTRY_ID = 'default'

export interface AiProviderProfileInput {
  baseURL: string
  kind: WebnaviorAiConnectionKind
  modelId?: string
  name: string
  plaintextKey?: string
  timeoutMs: number
  voice?: string
}

/** A browser-safe Provider record. It deliberately excludes ciphertext. */
export interface ManagedAiProviderProfile extends Omit<schema.WebnaviorAiProviderProfile, 'apiKeyCiphertext'> {
  hasApiKey: boolean
}

/** The active Provider profile for a capability, when the manager has selected one. */
export interface ManagedAiCapabilitySelection extends schema.WebnaviorAiCapabilitySelection {
  providerProfile: ManagedAiProviderProfile
}

/**
 * Owns Provider profiles and active selections for each Kiosk AI capability.
 *
 * Provider profiles belong to exactly one capability. This prevents an LLM
 * setting from silently becoming a VLM, speech, or embedding dependency while
 * still allowing a System Manager to retain multiple tested options per role.
 */
export interface WebnaviorAiControlService {
  createProfile: (capability: WebnaviorAiCapability, input: AiProviderProfileInput) => Promise<ManagedAiProviderProfile>
  deleteProfile: (capability: WebnaviorAiCapability, profileId: string) => Promise<void>
  listProfiles: () => Promise<ManagedAiProviderProfile[]>
  listSelections: () => Promise<ManagedAiCapabilitySelection[]>
  refreshProfileModels: (capability: WebnaviorAiCapability, profileId: string) => Promise<ManagedAiProviderProfile>
  selectProfile: (capability: WebnaviorAiCapability, profileId: string) => Promise<ManagedAiCapabilitySelection>
  testProviderConnection: (input: Pick<AiProviderProfileInput, 'baseURL' | 'plaintextKey' | 'timeoutMs'>, existingProfile?: { capability: WebnaviorAiCapability, id: string }) => ReturnType<typeof probeModelCatalog>
  updateProfile: (capability: WebnaviorAiCapability, profileId: string, input: AiProviderProfileInput & { clearApiKey?: boolean }) => Promise<ManagedAiProviderProfile>
  verifyAndCreateProfile: (capability: WebnaviorAiCapability, input: AiProviderProfileInput) => Promise<ManagedAiProviderProfile>
  verifyAndUpdateProfile: (capability: WebnaviorAiCapability, profileId: string, input: AiProviderProfileInput) => Promise<ManagedAiProviderProfile>
  verifyProfile: (capability: WebnaviorAiCapability, profileId: string) => Promise<ManagedAiProviderProfile>
}

export function createWebnaviorAiControlService(options: {
  db: Database
  envelopeCrypto: EnvelopeCrypto
  fetchImpl?: typeof fetch
}): WebnaviorAiControlService {
  const fetchImpl = options.fetchImpl ?? fetch

  async function findProfile(capability: WebnaviorAiCapability, profileId: string) {
    const profile = await options.db.query.webnaviorAiProviderProfiles.findFirst({
      where: eq(schema.webnaviorAiProviderProfiles.id, profileId),
    })
    if (!profile || profile.capability !== capability)
      throw createNotFoundError('找不到此 AI 能力的 Provider 設定。', 'WEBNAVIOR_AI_PROVIDER_PROFILE_NOT_FOUND')
    return profile
  }

  async function createProfile(capability: WebnaviorAiCapability, input: AiProviderProfileInput) {
    const [profile] = await options.db.insert(schema.webnaviorAiProviderProfiles).values({
      baseURL: input.baseURL,
      capability,
      kind: input.kind,
      modelId: input.modelId?.trim() || null,
      name: input.name,
      timeoutMs: input.timeoutMs,
      voice: capability === 'tts' ? input.voice?.trim() || null : null,
    }).returning()

    if (!input.plaintextKey?.trim())
      return toManagedProfile(profile)

    const apiKeyCiphertext = options.envelopeCrypto.encryptKey(input.plaintextKey, {
      keyEntryId: CONNECTION_KEY_ENTRY_ID,
      modelName: profileKeyLabel(profile.id),
    })
    const [updated] = await options.db.update(schema.webnaviorAiProviderProfiles)
      .set({ apiKeyCiphertext })
      .where(eq(schema.webnaviorAiProviderProfiles.id, profile.id))
      .returning()
    return toManagedProfile(updated)
  }

  async function updateProfile(capability: WebnaviorAiCapability, profileId: string, input: AiProviderProfileInput & { clearApiKey?: boolean }) {
    const current = await findProfile(capability, profileId)
    if (input.clearApiKey && input.plaintextKey?.trim())
      throw createBadRequestError('不能同時清除與設定 API Key。', 'WEBNAVIOR_AI_PROVIDER_PROFILE_KEY_CONFLICT')

    const apiKeyCiphertext = input.clearApiKey
      ? null
      : input.plaintextKey?.trim()
        ? options.envelopeCrypto.encryptKey(input.plaintextKey, { keyEntryId: CONNECTION_KEY_ENTRY_ID, modelName: profileKeyLabel(current.id) })
        : current.apiKeyCiphertext
    const sourceChanged = current.baseURL !== input.baseURL || current.kind !== input.kind
    const selectedModelId = input.modelId?.trim() || null
    const selectedVoice = capability === 'tts' ? input.voice?.trim() || null : null
    const requiresRevalidation = sourceChanged || current.modelId !== selectedModelId || apiKeyCiphertext !== current.apiKeyCiphertext || current.voice !== selectedVoice
    const [updated] = await options.db.update(schema.webnaviorAiProviderProfiles).set({
      apiKeyCiphertext,
      baseURL: input.baseURL,
      ...(sourceChanged ? { discoveredAt: null, discoveredModels: [], lastCheckedAt: null, lastCheckError: null } : {}),
      ...(requiresRevalidation ? { lastVerificationError: null, verifiedAt: null } : {}),
      kind: input.kind,
      modelId: selectedModelId,
      name: input.name,
      timeoutMs: input.timeoutMs,
      voice: selectedVoice,
    }).where(eq(schema.webnaviorAiProviderProfiles.id, current.id)).returning()
    return toManagedProfile(updated)
  }

  async function listProfiles() {
    return (await options.db.query.webnaviorAiProviderProfiles.findMany({
      orderBy: [asc(schema.webnaviorAiProviderProfiles.capability), asc(schema.webnaviorAiProviderProfiles.name)],
    })).map(toManagedProfile)
  }

  async function listSelections() {
    const selections = await options.db.query.webnaviorAiCapabilitySelections.findMany({
      with: { providerProfile: true },
      orderBy: [asc(schema.webnaviorAiCapabilitySelections.capability)],
    })
    return selections.map(selection => ({ ...selection, providerProfile: toManagedProfile(selection.providerProfile) }))
  }

  async function refreshProfileModels(capability: WebnaviorAiCapability, profileId: string) {
    const profile = await findProfile(capability, profileId)
    const key = decryptProfileKey(profile)
    try {
      const discoveredModels = await discoverModels({
        baseURL: profile.baseURL,
        ...(key ? { plaintextKey: key.toString('utf8') } : {}),
      }, fetchImpl)
      const modelStillAvailable = !profile.modelId || discoveredModels.some(model => model.id === profile.modelId)
      const [updated] = await options.db.update(schema.webnaviorAiProviderProfiles).set({
        discoveredAt: new Date(),
        discoveredModels,
        lastCheckedAt: new Date(),
        lastCheckError: null,
        ...(modelStillAvailable ? {} : { lastVerificationError: '已選模型不再由此 Provider 提供。', verifiedAt: null }),
      }).where(eq(schema.webnaviorAiProviderProfiles.id, profile.id)).returning()
      return toManagedProfile(updated)
    }
    catch (cause) {
      await options.db.update(schema.webnaviorAiProviderProfiles).set({
        lastCheckedAt: new Date(),
        lastCheckError: errorMessageFrom(cause) ?? '無法讀取模型清單。',
      }).where(eq(schema.webnaviorAiProviderProfiles.id, profile.id))
      throw cause
    }
    finally {
      key?.fill(0)
    }
  }

  async function testProviderConnection(input: Pick<AiProviderProfileInput, 'baseURL' | 'plaintextKey' | 'timeoutMs'>, existingProfile?: { capability: WebnaviorAiCapability, id: string }) {
    const profile = existingProfile ? await findProfile(existingProfile.capability, existingProfile.id) : undefined
    const storedKey = input.plaintextKey?.trim() ? undefined : profile ? decryptProfileKey(profile) : undefined
    try {
      return await probeModelCatalog({
        baseURL: input.baseURL,
        ...(input.plaintextKey?.trim() ? { plaintextKey: input.plaintextKey.trim() } : storedKey ? { plaintextKey: storedKey.toString('utf8') } : {}),
        timeoutMs: input.timeoutMs,
      }, fetchImpl)
    }
    finally {
      storedKey?.fill(0)
    }
  }

  async function verifyAndCreateProfile(capability: WebnaviorAiCapability, input: AiProviderProfileInput) {
    const modelId = requireModelId(input)
    await verifyInput(capability, input, modelId, input.plaintextKey?.trim())
    const profile = await createProfile(capability, { ...input, modelId })
    const [verified] = await options.db.update(schema.webnaviorAiProviderProfiles).set({
      discoveredModels: [{ id: modelId }],
      lastCheckError: null,
      lastVerificationError: null,
      verifiedAt: new Date(),
    }).where(eq(schema.webnaviorAiProviderProfiles.id, profile.id)).returning()
    return toManagedProfile(verified)
  }

  async function verifyAndUpdateProfile(capability: WebnaviorAiCapability, profileId: string, input: AiProviderProfileInput) {
    const current = await findProfile(capability, profileId)
    const modelId = requireModelId(input)
    const storedKey = input.plaintextKey?.trim() ? undefined : decryptProfileKey(current)
    const plaintextKey = input.plaintextKey?.trim() ?? storedKey?.toString('utf8')
    try {
      await verifyInput(capability, input, modelId, plaintextKey)
      const apiKeyCiphertext = input.plaintextKey?.trim()
        ? options.envelopeCrypto.encryptKey(input.plaintextKey.trim(), { keyEntryId: CONNECTION_KEY_ENTRY_ID, modelName: profileKeyLabel(current.id) })
        : current.apiKeyCiphertext
      const discoveredModels = current.discoveredModels.some(model => model.id === modelId)
        ? current.discoveredModels
        : [...current.discoveredModels, { id: modelId }]
      const [verified] = await options.db.update(schema.webnaviorAiProviderProfiles).set({
        apiKeyCiphertext,
        baseURL: input.baseURL,
        discoveredModels,
        kind: input.kind,
        lastCheckError: null,
        lastVerificationError: null,
        modelId,
        name: input.name,
        timeoutMs: input.timeoutMs,
        verifiedAt: new Date(),
        voice: capability === 'tts' ? input.voice?.trim() || null : null,
      }).where(eq(schema.webnaviorAiProviderProfiles.id, current.id)).returning()
      return toManagedProfile(verified)
    }
    finally {
      storedKey?.fill(0)
    }
  }

  async function verifyInput(capability: WebnaviorAiCapability, input: AiProviderProfileInput, modelId: string, plaintextKey?: string) {
    await verifyProviderProfile({
      baseURL: input.baseURL,
      capability,
      kind: input.kind,
      modelId,
      ...(plaintextKey ? { plaintextKey } : {}),
      ...(capability === 'tts' && input.voice?.trim() ? { voice: input.voice.trim() } : {}),
    }, fetchImpl)
  }

  async function verifyProfile(capability: WebnaviorAiCapability, profileId: string) {
    const profile = await findProfile(capability, profileId)
    if (!profile.modelId || !profile.discoveredModels.some(model => model.id === profile.modelId)) {
      throw createBadRequestError('請先讀取模型清單並選擇此 Provider 的模型，再進行驗證。', 'WEBNAVIOR_AI_PROVIDER_PROFILE_MODEL_REQUIRED')
    }
    const key = decryptProfileKey(profile)
    try {
      await verifyProviderProfile({
        baseURL: profile.baseURL,
        capability,
        kind: profile.kind,
        modelId: profile.modelId,
        ...(key ? { plaintextKey: key.toString('utf8') } : {}),
        ...(profile.voice ? { voice: profile.voice } : {}),
      }, fetchImpl)
      const [updated] = await options.db.update(schema.webnaviorAiProviderProfiles).set({
        lastVerificationError: null,
        verifiedAt: new Date(),
      }).where(eq(schema.webnaviorAiProviderProfiles.id, profile.id)).returning()
      return toManagedProfile(updated)
    }
    catch (cause) {
      await options.db.update(schema.webnaviorAiProviderProfiles).set({
        lastVerificationError: errorMessageFrom(cause) ?? 'Provider 驗證失敗。',
        verifiedAt: null,
      }).where(eq(schema.webnaviorAiProviderProfiles.id, profile.id))
      throw cause
    }
    finally {
      key?.fill(0)
    }
  }

  async function selectProfile(capability: WebnaviorAiCapability, profileId: string) {
    const profile = await findProfile(capability, profileId)
    if (!profile.verifiedAt)
      throw createBadRequestError('只能啟用已通過驗證的 Provider。', 'WEBNAVIOR_AI_PROVIDER_PROFILE_NOT_VERIFIED')
    const [selection] = await options.db.insert(schema.webnaviorAiCapabilitySelections).values({
      capability,
      providerProfileId: profile.id,
    }).onConflictDoUpdate({
      target: schema.webnaviorAiCapabilitySelections.capability,
      set: { providerProfileId: profile.id, updatedAt: new Date() },
    }).returning()
    return { ...selection, providerProfile: toManagedProfile(profile) }
  }

  async function deleteProfile(capability: WebnaviorAiCapability, profileId: string) {
    const profile = await findProfile(capability, profileId)
    const selection = await options.db.query.webnaviorAiCapabilitySelections.findFirst({
      where: eq(schema.webnaviorAiCapabilitySelections.providerProfileId, profile.id),
    })
    if (selection)
      throw createConflictError('此 Provider 目前正在使用；請先切換到另一個已驗證的 Provider。', 'WEBNAVIOR_AI_PROVIDER_PROFILE_ACTIVE')
    await options.db.delete(schema.webnaviorAiProviderProfiles).where(eq(schema.webnaviorAiProviderProfiles.id, profile.id))
  }

  function decryptProfileKey(profile: schema.WebnaviorAiProviderProfile) {
    return profile.apiKeyCiphertext
      ? options.envelopeCrypto.decryptKey(profile.apiKeyCiphertext, { keyEntryId: CONNECTION_KEY_ENTRY_ID, modelName: profileKeyLabel(profile.id) })
      : undefined
  }

  return { createProfile, deleteProfile, listProfiles, listSelections, refreshProfileModels, selectProfile, testProviderConnection, updateProfile, verifyAndCreateProfile, verifyAndUpdateProfile, verifyProfile }
}

function requireModelId(input: AiProviderProfileInput) {
  const modelId = input.modelId?.trim()
  if (!modelId)
    throw createBadRequestError('請輸入或選擇 Model ID，再進行驗證。', 'WEBNAVIOR_AI_PROVIDER_PROFILE_MODEL_REQUIRED')
  return modelId
}

function profileKeyLabel(profileId: string) {
  return `webnavior-ai:provider-profile:${profileId}`
}

function toManagedProfile(profile: schema.WebnaviorAiProviderProfile): ManagedAiProviderProfile {
  const { apiKeyCiphertext, ...safeProfile } = profile
  return { ...safeProfile, hasApiKey: Boolean(apiKeyCiphertext) }
}
