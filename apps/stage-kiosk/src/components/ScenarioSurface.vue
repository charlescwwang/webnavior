<script setup lang="ts">
import { nextTick, onUnmounted, useTemplateRef, watch } from 'vue'

import { scenarioRegistry } from '../services/scenario-registry'

const scenarioFrame = useTemplateRef<HTMLIFrameElement>('scenarioFrame')

function attachFrame() {
  scenarioRegistry.activeBridge.value?.attach(scenarioFrame.value?.contentWindow ?? null)
}

watch(scenarioRegistry.activeScenarioId, async () => {
  const bridge = scenarioRegistry.activeBridge.value
  bridge?.resetForIframeReload()
  // Bind the bridge before the child app can announce readiness. This also
  // makes the source-window check in the bridge isolate sibling iframes that
  // are served from the same trusted origin.
  await nextTick()
  bridge?.attach(scenarioFrame.value?.contentWindow ?? null)
}, { immediate: true })

onUnmounted(() => scenarioRegistry.activeBridge.value?.attach(null))
</script>

<template>
  <section class="scenario-surface" aria-label="AIRI 互動服務">
    <header class="scenario-header">
      <span class="scenario-kicker">AIRI 互動服務</span>
      <strong class="scenario-title">{{ scenarioRegistry.activeBridge.value?.manifest.value?.title ?? scenarioRegistry.activeScenario.value?.title ?? '正在載入互動服務' }}</strong>
    </header>
    <iframe
      ref="scenarioFrame"
      :key="scenarioRegistry.activeScenario.value?.id"
      :src="scenarioRegistry.activeScenario.value?.serviceUrl"
      allow="tools"
      :title="scenarioRegistry.activeBridge.value?.manifest.value?.title ?? scenarioRegistry.activeScenario.value?.title ?? 'AIRI 互動服務'"
      @load="attachFrame"
    />
  </section>
</template>

<style scoped>
.scenario-surface { display: grid; height: 100%; min-height: 0; overflow: hidden; border: 1px solid rgb(255 255 255 / 30%); border-radius: 1.5rem; background: #fff8ee; box-shadow: 0 1.25rem 4rem rgb(0 0 0 / 24%); grid-template-rows: auto minmax(0, 1fr); }
.scenario-header { display: grid; gap: .1rem; padding: .8rem 1rem; color: #542b19; }
.scenario-kicker { color: #a9562e; font-size: .7rem; font-weight: 800; letter-spacing: .08em; }
.scenario-title { font-size: 1rem; }
iframe { min-height: 0; width: 100%; height: 100%; border: 0; }
</style>
