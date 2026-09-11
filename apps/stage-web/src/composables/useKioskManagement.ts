import { errorMessageFrom } from '@moeru/std'
import { authedFetch } from '@proj-airi/stage-ui/libs/auth-fetch'
import { SERVER_URL } from '@proj-airi/stage-ui/libs/server'
import { computed, shallowRef } from 'vue'

const managedSites = shallowRef<KioskSite[]>([])
const managedSiteId = shallowRef('')

export interface KioskSite {
  id: string
  name: string
  interactionRetentionDays: number
}

export interface KioskDevice {
  disabledAt: string | null
  id: string
  label: string
  registrationMethod: string
}

/** One retained customer interaction, without its transcript content. */
export interface KioskVisitorSessionSummary {
  createdAt: string
  deviceId: string
  deviceLabel: string
  endedAt: string | null
  id: string
  interactionCount: number
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
  kind: 'audio_recording' | 'continuous_video' | 'triggered_video'
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

/** The approved inventory, system defaults, and explicit choices for one kiosk site. */
export interface KioskSiteModelPolicy {
  available: Record<'asr' | 'llm' | 'tts' | 'vision', string[]>
  defaults: Record<'asr' | 'llm' | 'tts' | 'vision', string | null>
  overrides: Partial<Record<'asr' | 'llm' | 'tts' | 'vision', string>>
  sources: Record<'asr' | 'llm' | 'tts' | 'vision', Record<string, { baseURL: string, upstreamModel: string, voice?: string }>>
}

/** The versioned settings that a Webnavior kiosk receives when a Profile is published. */
export interface KioskProfileSnapshot {
  assistanceReminderPrompt: string
  agentInstructions: string
  characterName: string
  characterAsset?: {
    format: 'live2d_zip' | 'vrm'
    id: string
    name: string
    sha256: string
  }
  characterCard?: {
    description: string
    personality: string
    postHistoryInstructions: string
    scenario: string
    systemPrompt: string
  }
  greetingPrompt: string
  interactiveService: {
    description: string
    id: string
    title: string
    url: string
  }
  surveyUrl: string
  version: 1
  voiceConversationOnly: boolean
}

/** Editable management representation of one site's unpublished kiosk configuration. */
export interface KioskProfileDraft {
  id?: string
  name: string
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
  const sites = managedSites
  const devices = shallowRef<KioskDevice[]>([])
  const selectedSiteId = managedSiteId
  const profileDraft = shallowRef<KioskProfileDraft>()
  const profileDrafts = shallowRef<KioskProfileDraft[]>([])
  const publishedExperience = shallowRef<KioskProfileDraft>()
  const capabilities = shallowRef<KioskSiteManagementCapabilities>()
  const siteModelPolicy = shallowRef<KioskSiteModelPolicy>()
  const loading = shallowRef(false)
  const saving = shallowRef(false)
  const message = shallowRef('')
  const visitorHistoryError = shallowRef('')
  const visitorHistoryLoading = shallowRef(false)
  const visitorSessionDetail = shallowRef<KioskVisitorSessionDetail>()
  const visitorSessions = shallowRef<KioskVisitorSessionSummary[]>([])
  const selectedSite = computed(() => sites.value.find(site => site.id === selectedSiteId.value))
  const deviceCount = computed(() => devices.value.length)

  function endpoint(path: string) {
    return new URL(`/api/admin/kiosk${path}`, SERVER_URL).toString()
  }

  function request(path: string, init?: RequestInit): Promise<void>
  function request<T>(path: string, init?: RequestInit): Promise<T>
  async function request<T>(path: string, init?: RequestInit): Promise<T | undefined> {
    const response = await authedFetch(endpoint(path), init)
    if (!response.ok)
      throw new Error(await response.text() || `Request failed: ${response.status}`)

    // Successful mutation endpoints deliberately use 204 to avoid a body.
    // Parsing that response as JSON makes a completed device action look like
    // a client-side failure (`Unexpected end of JSON input`).
    if (response.status === 204)
      return undefined

    return await response.json() as T
  }

  async function loadSite() {
    if (!selectedSiteId.value) {
      devices.value = []
      profileDraft.value = undefined
      profileDrafts.value = []
      publishedExperience.value = undefined
      capabilities.value = undefined
      siteModelPolicy.value = undefined
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
      siteModelPolicy.value = nextCapabilities.canEditTechnicalSettings
        ? await request<KioskSiteModelPolicy>(`/sites/${selectedSiteId.value}/model-policy`)
        : undefined
    }
    catch (error) {
      message.value = errorMessageFrom(error) ?? '無法載入此店別的管理資料。'
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
      message.value = errorMessageFrom(error) ?? '請先以具管理權限的帳號登入。'
    }
    finally {
      loading.value = false
    }
  }

  async function loadVisitorSessions() {
    if (!selectedSiteId.value) {
      visitorSessions.value = []
      visitorSessionDetail.value = undefined
      return
    }

    visitorHistoryLoading.value = true
    visitorHistoryError.value = ''
    visitorSessionDetail.value = undefined
    try {
      visitorSessions.value = await request<KioskVisitorSessionSummary[]>(`/sites/${selectedSiteId.value}/visitor-sessions`)
    }
    catch (error) {
      visitorHistoryError.value = errorMessageFrom(error) ?? '無法載入使用歷程。'
    }
    finally {
      visitorHistoryLoading.value = false
    }
  }

  async function selectVisitorSession(visitorSessionId: string) {
    visitorHistoryLoading.value = true
    visitorHistoryError.value = ''
    try {
      visitorSessionDetail.value = await request<KioskVisitorSessionDetail>(`/visitor-sessions/${visitorSessionId}`)
    }
    catch (error) {
      visitorHistoryError.value = errorMessageFrom(error) ?? '無法載入這次互動的內容。'
    }
    finally {
      visitorHistoryLoading.value = false
    }
  }

  async function deleteVisitorSessions(visitorSessionIds: string[]) {
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
    }
    catch (error) {
      visitorHistoryError.value = errorMessageFrom(error) ?? '無法刪除選取的使用歷程。'
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

      message.value = publish
        ? '草稿已發布；設備會在下次取得設定時套用。'
        : '草稿已儲存。'
    }
    catch (error) {
      message.value = errorMessageFrom(error) ?? '儲存失敗，請檢查各欄位是否完整。'
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
      message.value = '店別已刪除。'
    }
    catch (error) {
      message.value = errorMessageFrom(error) ?? '無法刪除店別。'
    }
    finally {
      saving.value = false
    }
  }

  async function disableDevice(deviceId: string) {
    if (!selectedSiteId.value)
      return

    saving.value = true
    message.value = ''
    try {
      await request(`/sites/${selectedSiteId.value}/devices/${deviceId}/disable`, { method: 'POST' })
      devices.value = devices.value.map(device => device.id === deviceId
        ? { ...device, disabledAt: new Date().toISOString() }
        : device)
      message.value = '設備已停用，原本的瀏覽器憑證已撤銷。'
    }
    catch (error) {
      message.value = errorMessageFrom(error) ?? '無法停用設備。'
    }
    finally {
      saving.value = false
    }
  }

  async function deleteDevice(deviceId: string) {
    if (!selectedSiteId.value)
      return

    saving.value = true
    message.value = ''
    try {
      await request(`/sites/${selectedSiteId.value}/devices/${deviceId}`, { method: 'DELETE' })
      devices.value = devices.value.filter(device => device.id !== deviceId)
      message.value = '設備已刪除；既有訪客紀錄會依保存政策保留。'
    }
    catch (error) {
      message.value = errorMessageFrom(error) ?? '無法刪除設備。請先停用它。'
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
      message.value = '角色模型已上傳，請儲存草稿後再發布到 Kiosk。'
      return result
    }
    catch (error) {
      message.value = errorMessageFrom(error) ?? '角色模型上傳失敗。'
      throw error
    }
    finally {
      saving.value = false
    }
  }

  async function saveModelPolicy(overrides: KioskSiteModelPolicy['overrides']) {
    if (!selectedSiteId.value)
      return

    saving.value = true
    message.value = ''
    try {
      await request(`/sites/${selectedSiteId.value}/model-policy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(overrides),
      })
      if (siteModelPolicy.value)
        siteModelPolicy.value = { ...siteModelPolicy.value, overrides }
      message.value = '店別模型設定已儲存。LLM 覆寫會在下一次對話時生效。'
    }
    catch (error) {
      message.value = errorMessageFrom(error) ?? '無法儲存店別模型設定。'
    }
    finally {
      saving.value = false
    }
  }

  function selectProfileDraft(draft: KioskProfileDraft) {
    profileDraft.value = draft
  }

  function createProfileDraft() {
    profileDraft.value = createDefaultProfileDraft()
  }

  return {
    capabilities,
    deleteDevice,
    deleteSelectedSite,
    deviceCount,
    disableDevice,
    devices,
    deleteVisitorSessions,
    load,
    loadVisitorSessions,
    loading,
    message,
    profileDraft,
    profileDrafts,
    createProfileDraft,
    publishedExperience,
    save,
    saveModelPolicy,
    saving,
    siteModelPolicy,
    selectedSite,
    selectedSiteId,
    selectSite,
    selectProfileDraft,
    selectVisitorSession,
    sites,
    uploadCharacterAsset,
    visitorHistoryError,
    visitorHistoryLoading,
    visitorSessionDetail,
    visitorSessions,
  }
}
