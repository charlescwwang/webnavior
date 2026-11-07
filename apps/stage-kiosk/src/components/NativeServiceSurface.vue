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
const emit = defineEmits<{ activity: [], ready: [{ serviceId: string, documentKey: string, url: string }], unavailable: [] }>()
const { t } = useI18n()
const element = useTemplateRef<HTMLDivElement>('surface')
const { x, y, width, height } = useElementBounding(element)
const documentVisibility = useDocumentVisibility()
const dialogVisible = shallowRef(false)
const failed = shallowRef(false)
let generation = 0
let disposed = false
let connectedKey: string | undefined
const stopActivity = props.bridge.onActivity((activity) => {
  if (!disposed && activity.serviceId === props.serviceId && activity.documentKey === props.documentKey)
    emit('activity')
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
  try {
    const result = await props.bridge.updateSurface(input)
    if (!disposed && current === generation && result.state !== 'superseded') {
      failed.value = result.state === 'failed'
      const key = JSON.stringify([input.serviceId, input.documentKey, input.url])
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
    if (!disposed && current === generation)
      failed.value = true
    if (!disposed && current === generation) {
      connectedKey = undefined
      emit('unavailable')
    }
  }
}, { immediate: true })

onBeforeUnmount(() => {
  disposed = true
  stopActivity()
  // Hiding keeps the vendor login store; it does not clear an order or replay navigation.
  void props.bridge.updateSurface({ ...placement.value, visible: false }).catch(() => {})
})
</script>

<template>
  <div ref="surface" :class="['h-full min-h-0 w-full']" :aria-label="props.title">
    <p v-if="failed" role="alert" :class="['m-0 p-4 text-center text-slate-600']">
      {{ t('stage.kiosk.native-view-failed') }}
    </p>
  </div>
</template>
