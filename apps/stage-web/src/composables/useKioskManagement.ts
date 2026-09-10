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
  id: string
  label: string
  registrationMethod: string
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
}

/** Editable management representation of one site's unpublished kiosk configuration. */
export interface KioskProfileDraft {
  name: string
  snapshot: KioskProfileSnapshot
}

interface KioskSiteProfile {
  draft?: KioskProfileDraft
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
  const publishedExperience = shallowRef<KioskProfileDraft>()
  const capabilities = shallowRef<KioskSiteManagementCapabilities>()
  const siteModelPolicy = shallowRef<KioskSiteModelPolicy>()
  const loading = shallowRef(false)
  const saving = shallowRef(false)
  const message = shallowRef('')
  const selectedSite = computed(() => sites.value.find(site => site.id === selectedSiteId.value))
  const deviceCount = computed(() => devices.value.length)

  function endpoint(path: string) {
    return new URL(`/api/admin/kiosk${path}`, SERVER_URL).toString()
  }

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await authedFetch(endpoint(path), init)
    if (!response.ok)
      throw new Error(await response.text() || `Request failed: ${response.status}`)

    return await response.json() as T
  }

  async function loadSite() {
    if (!selectedSiteId.value) {
      devices.value = []
      profileDraft.value = undefined
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
      profileDraft.value = profile.draft ?? createDefaultProfileDraft()
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
      await request(`/sites/${selectedSiteId.value}/profile-draft`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      profileDraft.value = draft
      if (publish)
        await request(`/sites/${selectedSiteId.value}/profile-draft/publish`, { method: 'POST' })

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

  return {
    capabilities,
    deleteSelectedSite,
    deviceCount,
    devices,
    load,
    loading,
    message,
    profileDraft,
    publishedExperience,
    save,
    saveModelPolicy,
    saving,
    siteModelPolicy,
    selectedSite,
    selectedSiteId,
    selectSite,
    sites,
    uploadCharacterAsset,
  }
}
