import { errorMessageFrom } from '@moeru/std'
import { authedFetch } from '@proj-airi/stage-ui/libs/auth-fetch'
import { SERVER_URL } from '@proj-airi/stage-ui/libs/server'
import { computed, shallowRef } from 'vue'

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

interface KioskProfile {
  name: string
  snapshot: unknown
}

interface KioskSiteProfile {
  draft?: KioskProfile
}

/**
 * Loads the central Kiosk configuration that the signed-in administrator may manage.
 *
 * The server remains the source of truth: this composable only keeps an editable
 * local draft until the caller explicitly saves or publishes it.
 */
export function useKioskManagement() {
  const sites = shallowRef<KioskSite[]>([])
  const devices = shallowRef<KioskDevice[]>([])
  const selectedSiteId = shallowRef('')
  const draftName = shallowRef('')
  const snapshotText = shallowRef('')
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
      return
    }

    loading.value = true
    message.value = ''
    try {
      const [nextDevices, profile] = await Promise.all([
        request<KioskDevice[]>(`/sites/${selectedSiteId.value}/devices`),
        request<KioskSiteProfile>(`/sites/${selectedSiteId.value}/profile`),
      ])
      devices.value = nextDevices
      draftName.value = profile.draft?.name ?? 'Kiosk Profile'
      snapshotText.value = JSON.stringify(profile.draft?.snapshot ?? {}, null, 2)
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

  async function save(publish: boolean) {
    if (!selectedSiteId.value)
      return

    saving.value = true
    message.value = ''
    try {
      const snapshot = JSON.parse(snapshotText.value) as unknown
      await request(`/sites/${selectedSiteId.value}/profile-draft`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: draftName.value, snapshot }),
      })
      if (publish)
        await request(`/sites/${selectedSiteId.value}/profile-draft/publish`, { method: 'POST' })

      message.value = publish
        ? '草稿已發布；設備會在下次取得設定時套用。'
        : '草稿已儲存。'
    }
    catch (error) {
      message.value = errorMessageFrom(error) ?? '儲存失敗，請檢查 Profile JSON。'
    }
    finally {
      saving.value = false
    }
  }

  return {
    deviceCount,
    devices,
    draftName,
    load,
    loading,
    message,
    save,
    saving,
    selectedSite,
    selectedSiteId,
    selectSite,
    sites,
    snapshotText,
  }
}
