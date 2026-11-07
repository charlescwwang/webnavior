import type { KioskDevice, KioskDeviceBatchResult, KioskSite, KioskSiteManagementCapabilities } from './useKioskManagement'

import { errorMessageFrom } from '@moeru/std'
import { computed, onScopeDispose, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { requestKioskManagement as request } from './kioskManagementApi'
import { useWebnaviorNotice } from './useWebnaviorNotice'

/** A directory row retains its owning site and permissions through sorting. */
export interface ManagedKioskDevice extends KioskDevice {
  site: KioskSite
  capabilities: KioskSiteManagementCapabilities
}

export type DeviceSort = 'createdAt' | 'label' | 'site'
export type DeviceAction = 'delete' | 'disable' | 'enable'

/** Owns the authorized multi-site directory; writes always use each row's site. */
export function useKioskDevices() {
  const { t, locale } = useI18n()
  const notice = useWebnaviorNotice()
  const sites = shallowRef<KioskSite[]>([])
  const devices = shallowRef<ManagedKioskDevice[]>([])
  const selectedSiteId = shallowRef('all')
  const sortBy = shallowRef<DeviceSort>('createdAt')
  const descending = shallowRef(true)
  const loading = shallowRef(false)
  const saving = shallowRef(false)
  const message = shallowRef('')
  let activeLoad: AbortController | undefined

  const visibleDevices = computed(() => {
    const collator = new Intl.Collator(locale.value, { numeric: true, sensitivity: 'base' })
    return devices.value.filter(device => selectedSiteId.value === 'all' || device.siteId === selectedSiteId.value).toSorted((a, b) => {
      let order: number
      if (sortBy.value === 'createdAt')
        order = Date.parse(a.createdAt) - Date.parse(b.createdAt)
      else if (sortBy.value === 'site')
        order = collator.compare(a.site.name, b.site.name)
      else
        order = collator.compare(a.label, b.label)
      // Name and ID break ties without changing the underlying server order.
      return (descending.value ? -order : order) || collator.compare(a.label, b.label) || a.id.localeCompare(b.id)
    })
  })

  async function load() {
    activeLoad?.abort()
    const controller = new AbortController()
    activeLoad = controller
    loading.value = true
    message.value = ''
    try {
      const nextSites = await request<KioskSite[]>('/sites', { signal: controller.signal })
      const rows = await Promise.all(nextSites.map(async (site) => {
        const [siteDevices, capabilities] = await Promise.all([
          request<KioskDevice[]>(`/sites/${site.id}/devices`, { signal: controller.signal }),
          request<KioskSiteManagementCapabilities>(`/sites/${site.id}/capabilities`, { signal: controller.signal }),
        ])
        return siteDevices.map(device => ({ ...device, site, capabilities }))
      }))
      // One load owns the entire snapshot. An aborted older refresh cannot
      // restore removed devices or another account's previous permissions.
      if (controller.signal.aborted)
        return
      sites.value = nextSites
      devices.value = rows.flat()
      if (!nextSites.some(site => site.id === selectedSiteId.value))
        selectedSiteId.value = 'all'
    }
    catch (error) {
      if (!controller.signal.aborted) {
        devices.value = []
        message.value = t('stage.kiosk-devices.load-failed')
        notice.error(errorMessageFrom(error) ?? message.value)
      }
    }
    finally {
      if (activeLoad === controller)
        loading.value = false
    }
  }

  async function applyAction(kind: DeviceAction, deviceIds: string[]) {
    if (saving.value || !deviceIds.length)
      return
    const result: KioskDeviceBatchResult = { succeededDeviceIds: [], failedDeviceIds: [] }
    const bySite = new Map<string, string[]>()
    for (const id of new Set(deviceIds)) {
      const device = devices.value.find(row => row.id === id)
      if (!device?.capabilities.canManageDevices || (kind === 'delete' && !device.disabledAt)) {
        result.failedDeviceIds.push(id)
        continue
      }
      bySite.set(device.siteId, [...(bySite.get(device.siteId) ?? []), id])
    }
    saving.value = true
    try {
      // Each site retains its existing authorization endpoint. A failure in
      // one site does not undo another site's receipts; writes are never retried.
      const groups = [...bySite]
      const outcomes = await Promise.allSettled(groups.map(async ([siteId, ids]) => {
        if (kind === 'enable') {
          const outcomes = await Promise.allSettled(ids.map(id => request(`/sites/${siteId}/devices/${id}/enable`, { method: 'POST' })))
          return {
            succeededDeviceIds: ids.filter((_, index) => outcomes[index]!.status === 'fulfilled'),
            failedDeviceIds: ids.filter((_, index) => outcomes[index]!.status === 'rejected'),
          }
        }
        return await request<KioskDeviceBatchResult>(`/sites/${siteId}/devices/batch-${kind}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceIds: ids }),
        })
      }))
      for (const [index, outcome] of outcomes.entries()) {
        if (outcome.status === 'fulfilled') {
          result.succeededDeviceIds.push(...outcome.value.succeededDeviceIds)
          result.failedDeviceIds.push(...outcome.value.failedDeviceIds)
        }
        else {
          result.failedDeviceIds.push(...groups[index]![1])
        }
      }
      await load()
      return result
    }
    finally {
      saving.value = false
    }
  }

  async function saveRetention(siteId: string, days: number) {
    if (saving.value || !Number.isInteger(days) || days < 0 || !devices.value.some(device => device.siteId === siteId && device.capabilities.canEditTechnicalSettings))
      return
    saving.value = true
    try {
      const site = await request<KioskSite>(`/sites/${siteId}/interaction-retention`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days }),
      })
      sites.value = sites.value.map(current => current.id === site.id ? site : current)
      devices.value = devices.value.map(device => device.siteId === site.id ? { ...device, site } : device)
      notice.success(t('stage.kiosk-devices.retention-saved'))
    }
    catch (error) {
      notice.error(errorMessageFrom(error) ?? t('stage.kiosk-devices.save-failed'))
    }
    finally {
      saving.value = false
    }
  }

  onScopeDispose(() => activeLoad?.abort())
  return { applyAction, descending, devices, load, loading, message, saveRetention, saving, selectedSiteId, sites, sortBy, visibleDevices }
}
