<script setup lang="ts">
import type { KioskDesktopBridge } from '@proj-airi/stage-shared/kiosk-desktop'

import { useDocumentVisibility, useElementBounding, useMutationObserver } from '@vueuse/core'
import { computed, onBeforeUnmount, shallowRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  bridge: KioskDesktopBridge
  serviceId: string
  documentKey: string
  url: string
  title: string
  occluded: boolean
}>()
const emit = defineEmits<{ activity: [], ready: [{ serviceId: string, documentKey: string, url: string }], navigating: [], unavailable: [] }>()
const { t } = useI18n()
const element = useTemplateRef<HTMLDivElement>('surface')
const { x, y, width, height } = useElementBounding(element)
const documentVisibility = useDocumentVisibility()
const dialogVisible = shallowRef(false)
const failed = shallowRef(false)
const loading = shallowRef(true)
let generation = 0
let disposed = false
let connectedKey: string | undefined
let requestedKey: string | undefined
const stopActivity = props.bridge.onActivity((activity) => {
  if (!disposed && activity.serviceId === props.serviceId && activity.documentKey === props.documentKey)
    emit('activity')
})
let navigationRevision = 0
const stopNavigation = props.bridge.onNavigation((navigation) => {
  // The service/document binding isolates windows; the native revision rejects
  // late events from an earlier load without treating navigation as activity.
  if (disposed || navigation.serviceId !== props.serviceId || navigation.documentKey !== props.documentKey || navigation.revision < navigationRevision)
    return
  navigationRevision = navigation.revision
  if (navigation.state === 'loading') {
    generation++
    loading.value = true
    failed.value = false
    connectedKey = undefined
    emit('navigating')
    return
  }
  loading.value = false
  failed.value = navigation.state === 'failed'
  if (failed.value) {
    connectedKey = undefined
    emit('unavailable')
    return
  }
  const key = JSON.stringify([props.serviceId, props.documentKey, props.url])
  if (connectedKey !== key) {
    connectedKey = key
    emit('ready', { serviceId: props.serviceId, documentKey: props.documentKey, url: props.url })
  }
})

// Native Views sit above DOM overlays. Hide the native surface while a host modal owns input.
useMutationObserver(document.body, () => {
  dialogVisible.value = Array.from(document.querySelectorAll('dialog[open], [role="dialog"], [role="alertdialog"]'))
    .some(dialog => dialog.getClientRects().length > 0 && getComputedStyle(dialog).visibility !== 'hidden')
}, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'hidden', 'aria-hidden', 'data-state', 'style'] })

const placement = computed(() => ({
  serviceId: props.serviceId,
  documentKey: props.documentKey,
  url: props.url,
  bounds: { x: x.value, y: y.value, width: width.value, height: height.value },
  visible: !props.occluded && !dialogVisible.value && documentVisibility.value === 'visible',
}))

watch(placement, async (input) => {
  const current = ++generation
  const key = JSON.stringify([input.serviceId, input.documentKey, input.url])
  // Placement changes share the current load; only a new document starts the indicator.
  if (requestedKey !== key) {
    requestedKey = key
    loading.value = true
    failed.value = false
    connectedKey = undefined
  }
  try {
    const result = await props.bridge.updateSurface(input)
    if (!disposed && current === generation && result.state !== 'superseded') {
      loading.value = result.state === 'loading'
      if (loading.value)
        return
      failed.value = result.state === 'failed'
      if (failed.value) {
        connectedKey = undefined
        emit('unavailable')
      }
      else if (connectedKey !== key) {
        connectedKey = key
        emit('ready', { serviceId: input.serviceId, documentKey: input.documentKey, url: input.url })
      }
    }
  }
  catch {
    if (!disposed && current === generation) {
      loading.value = false
      failed.value = true
      connectedKey = undefined
      emit('unavailable')
    }
  }
}, { immediate: true })

onBeforeUnmount(() => {
  disposed = true
  stopActivity()
  stopNavigation()
  // Hiding keeps the vendor login store; it does not clear an order or replay navigation.
  void props.bridge.updateSurface({ ...placement.value, visible: false }).catch(() => {})
})
</script>

<template>
  <div ref="surface" :class="['relative h-full min-h-0 w-full']" :aria-label="props.title" :aria-busy="loading">
    <div v-if="loading" role="status" aria-live="polite" :class="['menu-loading']">
      <span aria-hidden="true" :class="['loading-spinner i-solar:refresh-circle-line-duotone']" />
      <p :class="['m-0 text-sm text-slate-500 dark:text-slate-400']">
        {{ t('stage.kiosk.native-view-loading') }}
      </p>
    </div>
    <p v-else-if="failed" role="alert" :class="['m-0 p-4 text-center text-slate-600']">
      {{ t('stage.kiosk.native-view-failed') }}
    </p>
  </div>
</template>

<style scoped>
/* Short merchant navigations need no interstitial. Reveal only a small neutral
   status after 700ms; this visual delay never changes document readiness. */
.menu-loading { position: absolute; inset: 0; min-height: 2rem; display: flex; align-items: center; justify-content: center; gap: .5rem; animation: loading-reveal 0s .7s both; }
.loading-spinner { width: 1.25rem; height: 1.25rem; color: #64748b; animation: loading-spin 1.2s linear infinite; }
@keyframes loading-reveal { from { opacity: 0; } to { opacity: 1; } }
@keyframes loading-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .loading-spinner { animation: none; } }
</style>
