<script setup lang="ts">
import { Button } from '@proj-airi/ui'
import { useDraggable, useElementSize } from '@vueuse/core'
import { computed, useTemplateRef, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ title: string, label: string, alignStart?: boolean }>()
const panel = useTemplateRef<HTMLElement>('panel')
const handle = useTemplateRef<HTMLElement>('handle')
const parent = computed(() => panel.value?.parentElement)
const bounds = useElementSize(parent)
const size = useElementSize(panel, { width: 512, height: 200 }, { box: 'border-box' })
const { t } = useI18n()
const { x, y, style } = useDraggable(panel, { handle, containerElement: parent, initialValue: { x: 12, y: 12 }, preventDefault: true })

function resetPosition() {
  x.value = props.alignStart ? 12 : Math.max(12, bounds.width.value - size.width.value - 12)
  y.value = 12
}
let positioned = false
// Native menu Views cover DOM layers. Keep each window inside its existing
// host region, including after orientation changes or a growing event list.
watchEffect(() => {
  if (bounds.width.value <= 0 || bounds.height.value <= 0)
    return
  if (!positioned) {
    resetPosition()
    positioned = true
  }
  x.value = Math.max(0, Math.min(x.value, bounds.width.value - size.width.value))
  y.value = Math.max(0, Math.min(y.value, bounds.height.value - size.height.value))
})
</script>

<template>
  <aside ref="panel" :style="style" :class="['diagnostic-window']" :aria-label="props.label" aria-live="polite">
    <header :class="['diagnostic-header']">
      <div ref="handle" :class="['diagnostic-handle']">
        <span :class="['i-solar:menu-dots-bold']" aria-hidden="true" />
        <strong>{{ props.title }}</strong>
        <slot name="summary" />
      </div>
      <Button size="sm" variant="ghost" :label="t('stage.kiosk.text-console.reset')" @click="resetPosition" />
    </header>
    <div :class="['diagnostic-content']">
      <slot />
    </div>
  </aside>
</template>

<style scoped>
.diagnostic-window { position: absolute; box-sizing: border-box; z-index: 95; display: flex; flex-direction: column; width: min(32rem, calc(100% - 1.5rem)); max-height: calc(100% - 1.5rem); overflow: hidden; border: 1px solid rgb(253 224 71 / 38%); border-radius: .8rem; color: rgb(254 252 232 / 92%); background: rgb(25 22 10 / 92%); box-shadow: 0 .5rem 1.5rem rgb(0 0 0 / 28%); font-size: .72rem; backdrop-filter: blur(.65rem); pointer-events: auto; }
.diagnostic-header { display: flex; flex: none; align-items: center; padding: .3rem .5rem; border-bottom: 1px solid rgb(254 240 138 / 15%); }
.diagnostic-handle { display: flex; flex: 1; gap: .4rem; align-items: center; padding: .3rem; cursor: grab; touch-action: none; user-select: none; }
.diagnostic-handle:active { cursor: grabbing; }
.diagnostic-content { min-height: 0; overflow: auto; display: grid; gap: .3rem; padding: .5rem .75rem; }
</style>
