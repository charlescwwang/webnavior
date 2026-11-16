<script setup lang="ts">
import type { FastPathTiming } from '../services/kiosk-fast-path'

import { Button } from '@proj-airi/ui'
import { useDraggable, useElementSize, useWindowSize } from '@vueuse/core'
import { computed, shallowRef, useTemplateRef, watch, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'

import KioskAsrSimulationPanel from './KioskAsrSimulationPanel.vue'

import { useTextConsoleWindow } from '../composables/useTextConsoleWindow'

const props = defineProps<{ status?: string, reply?: string, trace?: string, timing?: FastPathTiming, dockTarget?: string, nativePopup?: boolean }>()
const emit = defineEmits<{ simulate: [transcript: string], floatingChange: [floating: boolean] }>()
const { t } = useI18n()
const panel = useTemplateRef<HTMLElement>('panel')
const handle = useTemplateRef<HTMLElement>('handle')
const collapsed = shallowRef(false)
const nativeWindow = useTextConsoleWindow(() => Boolean(props.nativePopup), () => t('stage.kiosk.text-console.title'))
const nativeTarget = nativeWindow.target
const isDocked = computed(() => Boolean(props.dockTarget) && !nativeTarget.value)
watch(nativeTarget, target => emit('floatingChange', Boolean(target)), { immediate: true })
watch([nativeTarget, collapsed], ([target, value]) => {
  if (target)
    nativeWindow.setCollapsed(value, panel.value?.querySelector('header')?.getBoundingClientRect().height ?? 50)
})
const viewport = useWindowSize()
const size = useElementSize(panel, { width: 440, height: 400 }, { box: 'border-box' })
const { x, y, style } = useDraggable(panel, {
  handle,
  disabled: computed(() => Boolean(props.dockTarget) || Boolean(nativeTarget.value)),
  initialValue: { x: Math.max(12, viewport.width.value - 452), y: Math.max(12, viewport.height.value - 440) },
  preventDefault: true,
})

// Keep the entire console reachable after dragging, expanding a trace, or
// rotating the display. The header alone owns dragging, leaving text selectable.
watchEffect(() => {
  if (props.dockTarget)
    return
  x.value = Math.max(12, Math.min(x.value, viewport.width.value - size.width.value - 12))
  y.value = Math.max(12, Math.min(y.value, viewport.height.value - size.height.value - 12))
})

function resetPosition() {
  if (nativeTarget.value) {
    nativeWindow.resetPosition()
    return
  }
  x.value = Math.max(12, viewport.width.value - size.width.value - 12)
  y.value = Math.max(12, viewport.height.value - size.height.value - 12)
}
</script>

<template>
  <Teleport :to="nativeTarget ?? props.dockTarget ?? 'body'" defer>
    <section
      ref="panel"
      :aria-label="t('stage.kiosk.text-console.title')"
      :style="props.dockTarget || nativeTarget ? undefined : style"
      :class="['text-console', { 'is-docked': isDocked, 'is-native-window': nativeTarget }]"
    >
      <header class="console-header">
        <div ref="handle" class="console-handle">
          <span :class="['i-solar:menu-dots-bold h-4 w-4 shrink-0']" aria-hidden="true" />
          <span>{{ t('stage.kiosk.text-console.title') }}</span>
        </div>
        <Button v-if="isDocked && props.nativePopup" size="sm" variant="ghost" :label="t('stage.kiosk.text-console.float')" @click="nativeWindow.open" />
        <Button v-else size="sm" variant="ghost" :label="t('stage.kiosk.text-console.reset')" @click="resetPosition" />
        <Button size="sm" variant="ghost" :aria-expanded="!collapsed" :label="t(collapsed ? 'stage.kiosk.text-console.expand' : 'stage.kiosk.text-console.collapse')" @click="collapsed = !collapsed" />
      </header>
      <div v-show="!collapsed" class="console-content">
        <p v-if="nativeWindow.failed.value" role="alert">
          {{ t('stage.kiosk.text-console.popup-failed') }}
        </p>
        <p v-if="props.reply" class="console-reply" aria-live="polite">
          {{ props.reply }}
        </p>
        <KioskAsrSimulationPanel :compact="isDocked" :status="status" :trace="trace" :timing="timing" @simulate="emit('simulate', $event)" />
      </div>
    </section>
  </Teleport>
</template>

<style scoped>
.text-console { position: fixed; z-index: 60; display: flex; flex-direction: column; box-sizing: border-box; width: min(440px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); overflow: hidden; border: 1px solid rgb(94 234 212 / 35%); border-radius: 1rem; color: white; background: #082c30; box-shadow: 0 1.5rem 3rem rgb(0 0 0 / 35%); }
/* Native website Views outrank every DOM overlay. The host reserves this row
   outside PB's rectangle so input remains visible and receives real clicks. */
.text-console.is-docked { position: relative; width: 100%; max-height: min(280px, 34dvh); }
.text-console.is-native-window { position: relative; width: 100%; max-height: 100dvh; border-radius: 0; box-shadow: none; }
.is-native-window .console-handle { -webkit-app-region: drag; cursor: move; }
.is-docked .console-handle { cursor: default; }
.console-header { display: flex; flex-shrink: 0; align-items: center; gap: .5rem; border-bottom: 1px solid rgb(255 255 255 / 15%); padding: .5rem; }
.console-handle { display: flex; flex: 1; min-width: 0; align-items: center; gap: .5rem; padding: .25rem .5rem; cursor: grab; touch-action: none; user-select: none; font-size: .875rem; font-weight: 600; }
.console-handle:active { cursor: grabbing; }
.console-content { min-height: 0; overflow: auto; overscroll-behavior: contain; padding: .5rem; }
.console-reply { margin: 0 0 .5rem; max-height: 8rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
