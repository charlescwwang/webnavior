import type { KioskVoiceVadSettings } from '@proj-airi/kiosk-proactive'
import type { KioskCharacterSettings } from '@proj-airi/stage-shared/kiosk-character-package'
import type { OrderingSite } from '@proj-airi/stage-shared/ordering-sites'

import { errorMessageFrom } from '@moeru/std'
import { kioskCharacterPackageLimits } from '@proj-airi/stage-shared/kiosk-character-package'
import { authedFetch } from '@proj-airi/stage-ui/libs/auth-fetch'
import { computed, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { kioskManagementEndpoint as endpoint, requestKioskManagement as request } from './kioskManagementApi'
import { useWebnaviorNotice } from './useWebnaviorNotice'

const managedSites = shallowRef<KioskSite[]>([])
const managedSiteId = shallowRef('')

export interface KioskSite {
  id: string
  name: string
  interactionRetentionDays: number
}

export interface KioskDevice {
  createdAt: string
  siteId: string
  disabledAt: string | null
  id: string
  label: string
  registrationMethod: string
}

/** The per-device outcome of a management action that may partially succeed. */
export interface KioskDeviceBatchResult {
  failedDeviceIds: string[]
  succeededDeviceIds: string[]
}

/** One retained customer interaction, without its transcript content. */
export interface KioskVisitorSessionSummary {
  createdAt: string
  deviceId: string
  deviceLabel: string
  endedAt: string | null
  id: string
  interactionCount: number
  presence: 'greeting_only' | 'interactive' | 'empty'
  serviceId: string
  state: 'active' | 'cancelled' | 'completed' | 'idle'
}

/** One saved customer-facing turn or kiosk event in a visitor session. */
export interface KioskInteractionEntry {
  content: string
  createdAt: string
  id: string
  kind: 'assistant_text' | 'asr_transcript' | 'order_result' | 'service_event' | 'tool_call' | 'tool_result' | 'user_text'
  metadata: Record<string, unknown>
  sequence: number
}

/** The full retained transcript returned after an administrator selects a session. */
export interface KioskVisitorSessionDetail {
  entries: KioskInteractionEntry[]
  media: KioskVisitorMedia[]
  session: { id: string }
}

/** A private POC recording associated with the selected visitor session. */
export interface KioskVisitorMedia {
  byteSize: number
  createdAt: string
  endedAt: string | null
  id: string
  interactionEntryId: string | null
  kind: 'audio_recording' | 'continuous_video' | 'triggered_image' | 'triggered_video'
  mimeType: string
  startedAt: string | null
}

/** Actions the current account may take for the selected site. */
export interface KioskSiteManagementCapabilities {
  canEditExperience: boolean
  canEditTechnicalSettings: boolean
  canManageDevices: boolean
  canPublishExperience: boolean
}

/** Per-site controls that affect device behavior, but never choose AI models. */
export interface KioskSiteTechnicalSettings {
  proactiveVlmEnabled: boolean
  performanceProfile: 'constrained' | 'balanced' | 'high'
  voiceVadSettings: KioskVoiceVadSettings
}

/** The versioned settings that a Webnavior kiosk receives when a Profile is published. */
export interface KioskProfileSnapshot {
  orderingSites?: OrderingSite[]
  assistanceReminderPrompt: string
  agentInstructions: string
  characterName: string
  characterAsset?: {
    format: 'live2d_zip' | 'vrm'
    id: string
    name: string
    sha256: string
  }
  sceneBackground?: {
    format: 'jpeg' | 'png' | 'webp'
    id: string
    name: string
    sha256: string
  }
  idleMotion?: {
    format: 'vrma'
    id: string
    name: string
    sha256: string
  }
  motionPack?: Partial<Record<'acknowledge' | 'greeting' | 'idle' | 'listening' | 'presentRecommendations' | 'thinking', {
    format: 'vrma'
    id: string
    name: string
    sha256: string
  }>>
  characterCard?: {
    description: string
    personality: string
    postHistoryInstructions: string
    scenario: string
    systemPrompt: string
  }
  greetingPrompt: string
  greetingPhrases?: string[]
  interactiveService: OrderingSite
  surveyUrl: string
  version: 1
  voiceConversationOnly: boolean
}

/** Editable management representation of one site's unpublished kiosk configuration. */
export interface KioskProfileDraft {
  id?: string
  name: string
  revision?: number
  sourceTemplateReleaseId?: string | null
  parentSiteReleaseId?: string | null
  changeScope?: 'site_override' | 'template_seed'
  snapshot: KioskProfileSnapshot
}

interface KioskSiteProfile {
  drafts: KioskProfileDraft[]
  release?: KioskProfileDraft
}

function createDefaultProfileDraft(): KioskProfileDraft {
  return {
    name: '預設互動體驗',
    snapshot: {
      version: 1,
      characterName: 'Webnavior 助手',
      greetingPrompt: '您好，請問需要什麼協助？',
      assistanceReminderPrompt: '若訪客停留一段時間，請簡短詢問是否需要協助，不要重複打擾。',
      agentInstructions: '以親切、精簡的繁體中文協助訪客。資訊不足時，先提出一個簡短澄清問題。',
      interactiveService: {
        id: 'interactive-service',
        title: '互動服務',
        description: '請填入實際要內嵌在 Kiosk 的互動網頁。',
        url: 'https://example.com',
      },
      surveyUrl: 'https://example.com/feedback',
      voiceConversationOnly: false,
    },
  }
}

/**
 * Loads the central Kiosk configuration that the signed-in administrator may manage.
 *
 * The server remains the source of truth: this composable only keeps an editable
 * local draft until the caller explicitly saves or publishes it.
 */
export function useKioskManagement() {
  const notice = useWebnaviorNotice()
  const { t } = useI18n()
  const sites = managedSites
  const devices = shallowRef<KioskDevice[]>([])
  const selectedSiteId = managedSiteId
  const profileDraft = shallowRef<KioskProfileDraft>()
  const profileDrafts = shallowRef<KioskProfileDraft[]>([])
  const publishedExperience = shallowRef<KioskProfileDraft>()
  const ownerTemplateDraft = shallowRef<KioskProfileDraft>()
  const publishedOwnerTemplate = shallowRef<KioskProfileDraft>()
  const capabilities = shallowRef<KioskSiteManagementCapabilities>()
  const siteTechnicalSettings = shallowRef<KioskSiteTechnicalSettings>()
  const loading = shallowRef(false)
  const saving = shallowRef(false)
  const message = shallowRef('')
  const visitorHistoryError = shallowRef('')
  const visitorHistoryLoading = shallowRef(false)
  const visitorSessionDetail = shallowRef<KioskVisitorSessionDetail>()
  const visitorSessions = shallowRef<KioskVisitorSessionSummary[]>([])
  const selectedSite = computed(() => sites.value.find(site => site.id === selectedSiteId.value))
  const deviceCount = computed(() => devices.value.length)

  async function loadSite() {
    if (!selectedSiteId.value) {
      devices.value = []
      profileDraft.value = undefined
      profileDrafts.value = []
      publishedExperience.value = undefined
      capabilities.value = undefined
      siteTechnicalSettings.value = undefined
      return
    }

    loading.value = true
    message.value = ''
    try {
      const [nextDevices, profile, nextCapabilities] = await Promise.all([
        request<KioskDevice[]>(`/sites/${selectedSiteId.value}/devices`),
        request<KioskSiteProfile>(`/sites/${selectedSiteId.value}/profile`),
        request<KioskSiteManagementCapabilities>(`/sites/${selectedSiteId.value}/capabilities`),
      ])
      devices.value = nextDevices
      profileDrafts.value = profile.drafts
      profileDraft.value = profile.drafts[0] ?? createDefaultProfileDraft()
      publishedExperience.value = profile.release
      capabilities.value = nextCapabilities
      siteTechnicalSettings.value = nextCapabilities.canEditTechnicalSettings
        ? await request<KioskSiteTechnicalSettings>(`/sites/${selectedSiteId.value}/technical-settings`)
        : undefined
    }
    catch (error) {
      notice.error(errorMessageFrom(error) ?? '無法載入此店別的管理資料。')
    }
    finally {
      loading.value = false
    }
  }

  async function load() {
    loading.value = true
    message.value = ''
    try {
      sites.value = await request<KioskSite[]>('/sites')
      selectedSiteId.value = sites.value[0]?.id ?? ''
      await loadSite()
    }
    catch (error) {
      notice.error(errorMessageFrom(error) ?? '請先以具管理權限的帳號登入。')
    }
    finally {
      loading.value = false
    }
  }

  async function loadOwnerExperienceTemplate() {
    loading.value = true
    try {
      const template = await request<{ draft?: KioskProfileDraft, release?: KioskProfileDraft }>('/experience-template')
      ownerTemplateDraft.value = template.draft ?? createDefaultProfileDraft()
      publishedOwnerTemplate.value = template.release
    }
    catch (error) {
      notice.error(errorMessageFrom(error) ?? '無法載入預設互動體驗。')
    }
    finally {
      loading.value = false
    }
  }

  async function saveOwnerExperienceTemplate(draft: KioskProfileDraft, publish: boolean) {
    saving.value = true
    try {
      const savedDraft = await request<KioskProfileDraft>('/experience-template/draft', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      ownerTemplateDraft.value = savedDraft
      if (publish)
        publishedOwnerTemplate.value = await request<KioskProfileDraft>('/experience-template/publish', { method: 'POST' })
      notice.success(publish ? '預設互動體驗已發布；新店別會套用此版本。' : '預設互動體驗草稿已儲存。')
    }
    catch (error) {
      notice.error(errorMessageFrom(error) ?? '無法儲存預設互動體驗。')
    }
    finally {
      saving.value = false
    }
  }

  let visitorHistoryGeneration = 0
  async function loadVisitorSessions(deviceId?: string) {
    visitorHistoryGeneration++
    if (!selectedSiteId.value) {
      visitorSessions.value = []
      visitorSessionDetail.value = undefined
      return
    }

    visitorHistoryLoading.value = true
    visitorHistoryError.value = ''
    visitorSessionDetail.value = undefined
    try {
      const query = deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : ''
      visitorSessions.value = await request<KioskVisitorSessionSummary[]>(`/sites/${selectedSiteId.value}/visitor-sessions${query}`)
    }
    catch (error) {
      notice.error(errorMessageFrom(error) ?? '無法載入使用歷程。')
    }
    finally {
      visitorHistoryLoading.value = false
    }
  }

  async function selectVisitorSession(visitorSessionId: string) {
    visitorHistoryGeneration++
    visitorHistoryLoading.value = true
    visitorHistoryError.value = ''
    try {
      visitorSessionDetail.value = await request<KioskVisitorSessionDetail>(`/visitor-sessions/${visitorSessionId}`)
    }
    catch (error) {
      notice.error(errorMessageFrom(error) ?? '無法載入這次互動的內容。')
    }
    finally {
      visitorHistoryLoading.value = false
    }
  }

  /** Refreshes an operator's current view without clearing it or interrupting the kiosk. */
  async function refreshVisitorHistory(deviceId: string, signal: AbortSignal) {
    const siteId = selectedSiteId.value
    const sessionId = visitorSessionDetail.value?.session.id
    const generation = visitorHistoryGeneration
    if (!siteId || visitorHistoryLoading.value)
      return
    const query = deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : ''
    const [sessions, detail] = await Promise.all([
      request<KioskVisitorSessionSummary[]>(`/sites/${siteId}/visitor-sessions${query}`, { signal }),
      sessionId ? request<KioskVisitorSessionDetail>(`/visitor-sessions/${sessionId}`, { signal }) : Promise.resolve(undefined),
    ])
    // A late poll cannot restore a selection that the operator changed/deleted,
    // or put another Site's records into the new Site's view.
    if (signal.aborted || generation !== visitorHistoryGeneration || siteId !== selectedSiteId.value || sessionId !== visitorSessionDetail.value?.session.id)
      return
    visitorSessions.value = sessions
    if (detail)
      visitorSessionDetail.value = detail
    return true
  }

  async function deleteVisitorSessions(visitorSessionIds: string[]) {
    visitorHistoryGeneration++
    if (!selectedSiteId.value || visitorSessionIds.length === 0)
      return

    visitorHistoryLoading.value = true
    visitorHistoryError.value = ''
    try {
      await request(`/sites/${selectedSiteId.value}/visitor-sessions`, {
        method: 'DELETE',
        body: JSON.stringify({ visitorSessionIds }),
        headers: { 'Content-Type': 'application/json' },
      })
      if (visitorSessionIds.includes(visitorSessionDetail.value?.session.id ?? ''))
        visitorSessionDetail.value = undefined
      await loadVisitorSessions()
      notice.success(`已刪除 ${visitorSessionIds.length} 筆使用歷程。`)
    }
    catch (error) {
      notice.error(errorMessageFrom(error) ?? '無法刪除選取的使用歷程。')
    }
    finally {
      visitorHistoryLoading.value = false
    }
  }

  async function downloadTrainingDataset(kind: 'asr' | 'llm', visitorSessionIds: string[]) {
    if (!selectedSiteId.value || visitorSessionIds.length === 0)
      return

    visitorHistoryLoading.value = true
    visitorHistoryError.value = ''
    try {
      const response = await authedFetch(endpoint(`/sites/${selectedSiteId.value}/training-data/${kind}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorSessionIds }),
      })
      if (!response.ok)
        throw new Error(await response.text() || `Request failed: ${response.status}`)

      const file = new Blob([await response.arrayBuffer()], { type: response.headers.get('Content-Type') ?? 'application/octet-stream' })
      const url = URL.createObjectURL(file)
      const link = document.createElement('a')
      link.href = url
      link.download = kind === 'asr' ? 'kiosk-asr-training.zip' : 'kiosk-llm-training.jsonl'
      link.click()
      URL.revokeObjectURL(url)
      notice.success(kind === 'asr' ? 'ASR 訓練資料已下載。' : 'LLM 訓練資料已下載。')
    }
    catch (error) {
      notice.error(errorMessageFrom(error) ?? '無法下載訓練資料。')
    }
    finally {
      visitorHistoryLoading.value = false
    }
  }

  async function selectSite(siteId: string) {
    if (siteId === selectedSiteId.value)
      return

    selectedSiteId.value = siteId
    await loadSite()
  }

  async function save(draft: KioskProfileDraft, publish: boolean) {
    if (!selectedSiteId.value)
      return

    saving.value = true
    message.value = ''
    try {
      const savedDraft = await request<KioskProfileDraft>(`/sites/${selectedSiteId.value}/profile-draft`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      profileDraft.value = savedDraft
      profileDrafts.value = [savedDraft, ...profileDrafts.value.filter(item => item.id !== savedDraft.id)]
      if (publish)
        await request(`/sites/${selectedSiteId.value}/profile-draft/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draftId: savedDraft.id }) })

      notice.success(publish
        ? '草稿已發布；設備會在下次取得設定時套用。'
        : '草稿已儲存。')
    }
    catch (error) {
      notice.error(errorMessageFrom(error) ?? '儲存失敗，請檢查各欄位是否完整。')
    }
    finally {
      saving.value = false
    }
  }

  async function deleteSelectedSite() {
    if (!selectedSiteId.value)
      return

    saving.value = true
    message.value = ''
    try {
      await request(`/sites/${selectedSiteId.value}`, { method: 'DELETE' })
      sites.value = sites.value.filter(site => site.id !== selectedSiteId.value)
      selectedSiteId.value = sites.value[0]?.id ?? ''
      await loadSite()
      notice.success('店別已刪除。')
    }
    catch (error) {
      notice.error(errorMessageFrom(error) ?? '無法刪除店別。')
    }
    finally {
      saving.value = false
    }
  }

  async function uploadCharacterAsset(file: File, kind: 'avatar' | 'role_card') {
    if (!selectedSiteId.value)
      throw new Error('請先選擇店別。')

    saving.value = true
    message.value = ''
    try {
      const body = new FormData()
      body.set('asset', file)
      body.set('kind', kind)
      const response = await authedFetch(endpoint(`/sites/${selectedSiteId.value}/character-assets`), {
        method: 'POST',
        body,
      })
      if (!response.ok)
        throw new Error(await response.text() || `Request failed: ${response.status}`)
      const result = await response.json() as { asset: NonNullable<KioskProfileSnapshot['characterAsset']>, card: Record<string, string> }
      notice.success('角色模型已上傳，請儲存草稿後再發布到 Kiosk。')
      return result
    }
    catch (error) {
      notice.error(errorMessageFrom(error) ?? '角色模型上傳失敗。')
      throw error
    }
    finally {
      saving.value = false
    }
  }

  async function downloadCharacterPackage(draft: KioskProfileDraft) {
    if (!selectedSiteId.value)
      return
    saving.value = true
    try {
      const response = await authedFetch(endpoint(`/sites/${selectedSiteId.value}/character-package/export`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft.snapshot),
      })
      await checkPackageResponse(response)
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = `${draft.snapshot.characterName}.webnavior-character.zip`
      link.click()
      // Keep the URL alive until the browser has accepted the download task.
      setTimeout(() => URL.revokeObjectURL(url), 1_000)
    }
    catch (error) {
      notice.error(errorMessageFrom(error) ?? t('stage.kiosk.character-package.download-failed'))
    }
    finally {
      saving.value = false
    }
  }

  async function uploadCharacterPackage(file: File): Promise<KioskCharacterSettings> {
    if (!selectedSiteId.value)
      throw new Error(t('stage.kiosk.character-package.select-site'))
    saving.value = true
    try {
      if (!file.size || file.size > kioskCharacterPackageLimits.archiveBytes)
        throw new Error(t('stage.kiosk.character-package.invalid-size'))
      const body = new FormData()
      body.set('package', file)
      const response = await authedFetch(endpoint(`/sites/${selectedSiteId.value}/character-package/import`), { method: 'POST', body })
      await checkPackageResponse(response)
      const result = await response.json() as { character: KioskCharacterSettings }
      return result.character
    }
    catch (error) {
      notice.error(errorMessageFrom(error) ?? t('stage.kiosk.character-package.import-failed'))
      throw error
    }
    finally {
      saving.value = false
    }
  }

  async function checkPackageResponse(response: Response) {
    if (response.ok)
      return
    const body = await response.json().catch(() => undefined) as { message?: string } | undefined
    throw new Error(body?.message || t(response.status === 413 ? 'stage.kiosk.character-package.too-large' : 'stage.kiosk.character-package.request-failed'))
  }

  async function uploadMotionAsset(file: File) {
    if (!selectedSiteId.value)
      throw new Error('請先選擇店別。')

    saving.value = true
    message.value = ''
    try {
      const body = new FormData()
      body.set('asset', file)
      const response = await authedFetch(endpoint(`/sites/${selectedSiteId.value}/motion-assets`), {
        method: 'POST',
        body,
      })
      if (!response.ok)
        throw new Error(await response.text() || `Request failed: ${response.status}`)
      const result = await response.json() as { asset: NonNullable<KioskProfileSnapshot['idleMotion']> }
      notice.success('角色動作已上傳，請儲存草稿後再發布到 Kiosk。')
      return result
    }
    catch (error) {
      notice.error(errorMessageFrom(error) ?? '角色動作上傳失敗。')
      throw error
    }
    finally {
      saving.value = false
    }
  }

  async function uploadSceneBackgroundAsset(file: File) {
    if (!selectedSiteId.value)
      throw new Error('請先選擇店別。')

    saving.value = true
    message.value = ''
    try {
      const body = new FormData()
      body.set('asset', file)
      const response = await authedFetch(endpoint(`/sites/${selectedSiteId.value}/background-assets`), {
        method: 'POST',
        body,
      })
      if (!response.ok)
        throw new Error(await response.text() || `Request failed: ${response.status}`)
      const result = await response.json() as { asset: NonNullable<KioskProfileSnapshot['sceneBackground']> }
      notice.success('場景背景已上傳，請儲存草稿後再發布到 Kiosk。')
      return result
    }
    catch (error) {
      notice.error(errorMessageFrom(error) ?? '場景背景上傳失敗。')
      throw error
    }
    finally {
      saving.value = false
    }
  }

  async function saveProactiveVlmEnabled(enabled: boolean) {
    if (!selectedSiteId.value)
      return
    saving.value = true
    try {
      await request(`/sites/${selectedSiteId.value}/proactive-vlm`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) })
      if (siteTechnicalSettings.value)
        siteTechnicalSettings.value = { ...siteTechnicalSettings.value, proactiveVlmEnabled: enabled }
      notice.success(`主動情境台詞生成已${enabled ? '啟用' : '停用'}。`)
    }
    catch (error) { notice.error(errorMessageFrom(error) ?? '無法更新 VLM 設定。') }
    finally { saving.value = false }
  }

  async function savePerformanceProfile(profile: KioskSiteTechnicalSettings['performanceProfile']) {
    if (!selectedSiteId.value)
      return
    saving.value = true
    try {
      await request(`/sites/${selectedSiteId.value}/performance-profile`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile }) })
      if (siteTechnicalSettings.value)
        siteTechnicalSettings.value = { ...siteTechnicalSettings.value, performanceProfile: profile }
      notice.success('Kiosk 效能設定檔已更新。設備重新載入後會套用。')
    }
    catch (error) { notice.error(errorMessageFrom(error) ?? '無法更新 Kiosk 效能設定檔。') }
    finally { saving.value = false }
  }

  async function saveVoiceVadSettings(settings: KioskVoiceVadSettings) {
    if (!selectedSiteId.value)
      return
    saving.value = true
    try {
      await request(`/sites/${selectedSiteId.value}/voice-vad-settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) })
      if (siteTechnicalSettings.value)
        siteTechnicalSettings.value = { ...siteTechnicalSettings.value, voiceVadSettings: settings }
      notice.success('Silero VAD 設定已更新，連線中的設備會在下一次同步時套用。')
    }
    catch (error) { notice.error(errorMessageFrom(error) ?? '無法更新 Silero VAD 設定。') }
    finally { saving.value = false }
  }

  function selectProfileDraft(draft: KioskProfileDraft) {
    profileDraft.value = draft
  }

  function createProfileDraft() {
    profileDraft.value = createDefaultProfileDraft()
  }

  return {
    capabilities,
    deleteSelectedSite,
    deviceCount,
    devices,
    deleteVisitorSessions,
    downloadTrainingDataset,
    load,
    loadVisitorSessions,
    refreshVisitorHistory,
    loading,
    message,
    profileDraft,
    profileDrafts,
    createProfileDraft,
    publishedExperience,
    ownerTemplateDraft,
    publishedOwnerTemplate,
    loadOwnerExperienceTemplate,
    saveOwnerExperienceTemplate,
    save,
    saveProactiveVlmEnabled,
    savePerformanceProfile,
    saveVoiceVadSettings,
    saving,
    siteTechnicalSettings,
    selectedSite,
    selectedSiteId,
    selectSite,
    selectProfileDraft,
    selectVisitorSession,
    sites,
    uploadCharacterAsset,
    downloadCharacterPackage,
    uploadCharacterPackage,
    uploadMotionAsset,
    uploadSceneBackgroundAsset,
    visitorHistoryError,
    visitorHistoryLoading,
    visitorSessionDetail,
    visitorSessions,
  }
}
