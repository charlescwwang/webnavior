import type { Database } from '../../../libs/db'
import type { KioskSystemOneImplementation } from '../../../schemas/webnavior-ai'
import type { EnvelopeCrypto } from '../../../utils/envelope-crypto'

import { errorMessageFrom } from '@moeru/std'
import { asc, eq } from 'drizzle-orm'

import { createBadRequestError, createConflictError, createNotFoundError } from '../../../utils/error'
import { defaultDecisionInstruction } from '../kiosk-interaction-decision/prompt'

import * as schema from '../../../schemas'

const KEY_ENTRY_ID = 'default'
const POLICY_ID = 'default'

export interface SystemOneProfileInput {
  baseURL: string
  implementation: KioskSystemOneImplementation
  modelId: string
  name: string
  plaintextKey?: string
  timeoutMs: number
}

export interface SystemOneProfileUpdateInput extends SystemOneProfileInput {
  /** Clears a previously stored API key when no replacement is supplied. */
  clearApiKey?: boolean
}

/** The model actually loaded by one of the supported local System One servers. */
export interface SystemOneRuntimeModel {
  modelId: string
}

export interface SystemOneQuestion {
  criteria?: Record<string, string> | string[]
  instructions: string
  type: 'choice' | 'noul' | 'score'
}

/** Editable semantic instruction and optional store-specific addition for System One. */
export interface SystemOnePolicyInput {
  decisionInstruction: string
  storeInstruction: string
}

export function createKioskSystemOneService(options: { db: Database, envelopeCrypto: EnvelopeCrypto, fetchImpl?: typeof fetch }) {
  const fetchImpl = options.fetchImpl ?? fetch

  async function list() {
    return (await options.db.query.kioskSystemOneProfiles.findMany({ orderBy: [asc(schema.kioskSystemOneProfiles.name)] })).map(publicProfile)
  }

  async function getPolicy() {
    const policy = await options.db.query.kioskSystemOnePolicies.findFirst({
      where: eq(schema.kioskSystemOnePolicies.id, POLICY_ID),
    })
    return publicPolicy(policy)
  }

  async function savePolicy(input: SystemOnePolicyInput) {
    const requestedDecisionInstruction = input.decisionInstruction.trim()
    // Persisting the built-in text would make future code improvements invisible.
    // An exact default is therefore represented by an empty override.
    const decisionInstruction = requestedDecisionInstruction === defaultDecisionInstruction ? '' : requestedDecisionInstruction
    const storeInstruction = input.storeInstruction.trim()
    const [policy] = await options.db.insert(schema.kioskSystemOnePolicies).values({
      decisionInstruction,
      id: POLICY_ID,
      storeInstruction,
    }).onConflictDoUpdate({
      target: schema.kioskSystemOnePolicies.id,
      set: { decisionInstruction, storeInstruction, updatedAt: new Date() },
    }).returning()
    return publicPolicy(policy)
  }

  async function save(input: SystemOneProfileInput) {
    let created: schema.KioskSystemOneProfile
    try {
      [created] = await options.db.insert(schema.kioskSystemOneProfiles).values({
        baseURL: input.baseURL,
        implementation: input.implementation,
        modelId: input.modelId,
        name: input.name,
        timeoutMs: input.timeoutMs,
      }).returning()
    }
    catch (cause) {
      throwProfileNameConflict(cause)
    }
    if (!input.plaintextKey?.trim())
      return publicProfile(created)
    const [updated] = await options.db.update(schema.kioskSystemOneProfiles).set({
      apiKeyCiphertext: options.envelopeCrypto.encryptKey(input.plaintextKey, { keyEntryId: KEY_ENTRY_ID, modelName: keyLabel(created.id) }),
    }).where(eq(schema.kioskSystemOneProfiles.id, created.id)).returning()
    return publicProfile(updated)
  }

  /**
   * Reads the implementation-specific health payload rather than pretending
   * that both local servers expose a selectable model catalog. Dasein reports
   * `model`; lookski reports `model_id`.
   */
  async function inspectRuntimeModel(input: Pick<SystemOneProfileInput, 'baseURL' | 'implementation' | 'timeoutMs'>): Promise<SystemOneRuntimeModel> {
    const endpoint = new URL('health', `${input.baseURL.replace(/\/+$/u, '')}/`)
    let response: Response
    try {
      response = await fetchImpl(endpoint, { signal: AbortSignal.timeout(input.timeoutMs) })
    }
    catch (cause) {
      throw createBadRequestError('無法連線至 System One health endpoint，請確認服務位址與網路。', 'KIOSK_SYSTEM_ONE_HEALTH_UNAVAILABLE', cause)
    }
    if (!response.ok)
      throw createBadRequestError('System One health endpoint 拒絕請求。', 'KIOSK_SYSTEM_ONE_HEALTH_REJECTED')

    const payload: unknown = await response.json().catch(() => null)
    const modelKey = input.implementation === 'dasein' ? 'model' : 'model_id'
    const modelId = payload && typeof payload === 'object' && modelKey in payload
      ? (payload as Record<string, unknown>)[modelKey]
      : undefined
    if (typeof modelId !== 'string' || !modelId.trim())
      throw createBadRequestError(`System One health endpoint 未回傳 ${modelKey}。`, 'KIOSK_SYSTEM_ONE_HEALTH_INVALID')
    return { modelId: modelId.trim() }
  }

  async function update(profileId: string, input: SystemOneProfileUpdateInput) {
    const current = await find(profileId)
    if (input.clearApiKey && input.plaintextKey?.trim())
      throw createBadRequestError('不能同時清除與設定 API Key。', 'KIOSK_SYSTEM_ONE_PROFILE_KEY_CONFLICT')

    const apiKeyCiphertext = input.clearApiKey
      ? null
      : input.plaintextKey?.trim()
        ? options.envelopeCrypto.encryptKey(input.plaintextKey, { keyEntryId: KEY_ENTRY_ID, modelName: keyLabel(current.id) })
        : current.apiKeyCiphertext
    const connectionChanged = current.baseURL !== input.baseURL
      || current.implementation !== input.implementation
      || current.modelId !== input.modelId
      || current.timeoutMs !== input.timeoutMs
      || current.apiKeyCiphertext !== apiKeyCiphertext

    try {
      const [updated] = await options.db.update(schema.kioskSystemOneProfiles).set({
        apiKeyCiphertext,
        baseURL: input.baseURL,
        implementation: input.implementation,
        modelId: input.modelId,
        name: input.name,
        timeoutMs: input.timeoutMs,
        // A changed upstream must never remain eligible for the next voice turn.
        // The System Manager explicitly re-verifies and activates the new target.
        ...(connectionChanged ? { isActive: false, lastCheckedAt: null, lastCheckError: null, verifiedAt: null } : {}),
      }).where(eq(schema.kioskSystemOneProfiles.id, profileId)).returning()
      return publicProfile(updated)
    }
    catch (cause) {
      throwProfileNameConflict(cause)
    }
  }

  async function remove(profileId: string) {
    const profile = await find(profileId)
    if (profile.isActive)
      throw createConflictError('此 System One profile 目前正在使用；請先啟用另一個 profile。', 'KIOSK_SYSTEM_ONE_PROFILE_ACTIVE')
    await options.db.delete(schema.kioskSystemOneProfiles).where(eq(schema.kioskSystemOneProfiles.id, profile.id))
  }

  async function deactivate(profileId: string) {
    await find(profileId)
    const [updated] = await options.db.update(schema.kioskSystemOneProfiles)
      .set({ isActive: false })
      .where(eq(schema.kioskSystemOneProfiles.id, profileId))
      .returning()
    return publicProfile(updated)
  }

  async function readiness(profileId: string) {
    const profile = await find(profileId)
    try {
      const body = await invoke(profile, 'ready', { ready: { type: 'noul', instructions: 'Is the System One model ready?' } })
      if (!body.answers?.ready)
        throw new Error('System One response did not contain the readiness answer')
      const [updated] = await options.db.update(schema.kioskSystemOneProfiles).set({ lastCheckedAt: new Date(), lastCheckError: null, verifiedAt: new Date() }).where(eq(schema.kioskSystemOneProfiles.id, profile.id)).returning()
      return publicProfile(updated)
    }
    catch (cause) {
      const [updated] = await options.db.update(schema.kioskSystemOneProfiles).set({ lastCheckedAt: new Date(), lastCheckError: errorMessageFrom(cause) ?? 'System One readiness failed', verifiedAt: null }).where(eq(schema.kioskSystemOneProfiles.id, profile.id)).returning()
      throw createBadRequestError(updated.lastCheckError ?? 'System One readiness failed', 'KIOSK_SYSTEM_ONE_NOT_READY')
    }
  }
  async function decide(state: string, questions: Record<string, SystemOneQuestion>) {
    let profile = await options.db.query.kioskSystemOneProfiles.findFirst({ where: eq(schema.kioskSystemOneProfiles.isActive, true) })
    if (!profile)
      throw createBadRequestError('System One 尚未啟用。', 'KIOSK_SYSTEM_ONE_NOT_READY')

    // A failure clears verifiedAt. The next utterance probes the real decision
    // endpoint before any Fast Path action, so recovery is automatic without
    // replaying the failed transcript or requiring a Main Agent fallback.
    if (!profile.verifiedAt) {
      await readiness(profile.id)
      profile = await find(profile.id)
    }
    try {
      return await invoke(profile, state, questions)
    }
    catch (cause) {
      await markUnhealthy(profile.id, cause)
      throw cause
    }
  }
  /**
   * lookski/OpenJEV currently raises IndexError at 27 choice criteria. Reserve
   * four of its 26 safe slots for control outcomes; Dasein supports the normal
   * browser action ceiling.
   */
  async function maxActionCandidates() {
    const profile = await options.db.query.kioskSystemOneProfiles.findFirst({ where: eq(schema.kioskSystemOneProfiles.isActive, true) })
    return profile?.implementation === 'lookski' ? 22 : 253
  }
  async function activate(profileId: string) {
    const profile = await find(profileId)
    if (!profile.verifiedAt)
      throw createBadRequestError('請先通過 readiness 再啟用。', 'KIOSK_SYSTEM_ONE_NOT_READY')
    await options.db.update(schema.kioskSystemOneProfiles).set({ isActive: false })
    const [updated] = await options.db.update(schema.kioskSystemOneProfiles).set({ isActive: true }).where(eq(schema.kioskSystemOneProfiles.id, profileId)).returning()
    return publicProfile(updated)
  }
  async function find(id: string) {
    const profile = await options.db.query.kioskSystemOneProfiles.findFirst({ where: eq(schema.kioskSystemOneProfiles.id, id) })
    if (!profile)
      throw createNotFoundError('找不到 System One profile。', 'KIOSK_SYSTEM_ONE_PROFILE_NOT_FOUND')
    return profile
  }
  async function invoke(profile: schema.KioskSystemOneProfile, state: string, questions: Record<string, SystemOneQuestion>) {
    const key = decryptKey(profile)
    try {
      const response = await fetchImpl(new URL('v1/systemone', `${profile.baseURL.replace(/\/+$/, '')}/`), { body: JSON.stringify({ state, questions }), headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key.toString('utf8')}` } : {}) }, method: 'POST', signal: AbortSignal.timeout(profile.timeoutMs) })
      if (!response.ok)
        throw new Error(`System One returned HTTP ${response.status}`)
      return await response.json() as { answers?: Record<string, unknown> }
    }
    finally { key?.fill(0) }
  }
  async function markUnhealthy(profileId: string, cause: unknown) {
    await options.db.update(schema.kioskSystemOneProfiles).set({
      lastCheckedAt: new Date(),
      lastCheckError: errorMessageFrom(cause) ?? 'System One decision failed',
      verifiedAt: null,
    }).where(eq(schema.kioskSystemOneProfiles.id, profileId))
  }
  return { activate, deactivate, decide, delete: remove, getPolicy, inspectRuntimeModel, list, maxActionCandidates, readiness, save, savePolicy, update }

  function decryptKey(profile: schema.KioskSystemOneProfile) {
    return profile.apiKeyCiphertext
      ? options.envelopeCrypto.decryptKey(profile.apiKeyCiphertext, { keyEntryId: KEY_ENTRY_ID, modelName: keyLabel(profile.id) })
      : undefined
  }
}

function throwProfileNameConflict(cause: unknown): never {
  const databaseError = cause && typeof cause === 'object' && 'cause' in cause ? cause.cause : cause
  if (databaseError && typeof databaseError === 'object'
    && 'code' in databaseError && databaseError.code === '23505'
    && 'constraint' in databaseError && databaseError.constraint === 'kiosk_system_one_profiles_name_uidx') {
    throw createConflictError('已有相同名稱的 System One profile。請改用不同名稱或編輯既有 profile。', 'KIOSK_SYSTEM_ONE_PROFILE_NAME_CONFLICT')
  }
  throw cause
}
function keyLabel(id: string) {
  return `webnavior-kiosk-system-one:${id}`
}

function publicProfile(profile: schema.KioskSystemOneProfile) {
  const { apiKeyCiphertext, ...safe } = profile
  return { ...safe, hasApiKey: Boolean(apiKeyCiphertext) }
}

function publicPolicy(policy: schema.KioskSystemOnePolicy | undefined) {
  return policy
    ? { decisionInstruction: policy.decisionInstruction, defaultDecisionInstruction, storeInstruction: policy.storeInstruction, updatedAt: policy.updatedAt }
    : { decisionInstruction: '', defaultDecisionInstruction, storeInstruction: '', updatedAt: null }
}
