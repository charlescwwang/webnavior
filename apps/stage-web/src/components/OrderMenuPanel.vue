<script setup lang="ts">
import { onMounted, onUnmounted, shallowRef, useTemplateRef } from 'vue'

import { orderMenuBridge } from '../services/order-menu-bridge'

const visible = shallowRef(true)
const menuFrame = useTemplateRef<HTMLIFrameElement>('menuFrame')

function openPanel() {
  visible.value = true
}

function attachFrame() {
  orderMenuBridge.attach(menuFrame.value?.contentWindow ?? null)
}

onMounted(() => {
  // The embedded page can post `order:ready` before the iframe `load` event
  // reaches its parent. Resetting in `attachFrame` therefore erased a valid
  // ready signal and made the first tool call time out.
  orderMenuBridge.resetForIframeReload()
  window.addEventListener('airi:order-menu-open', openPanel)
})
onUnmounted(() => window.removeEventListener('airi:order-menu-open', openPanel))
</script>

<template>
  <section v-if="visible" class="order-menu-panel" aria-label="AIRI 點餐面板">
    <header>
      <div><span>由 AIRI 協作</span><strong>菜單與點餐</strong></div>
      <button type="button" title="隱藏菜單" @click="visible = false">
        <div class="i-solar:close-circle-linear" />
      </button>
    </header>
    <iframe
      ref="menuFrame"
      :src="orderMenuBridge.menuUrl"
      allow="tools"
      title="AIRI 點餐菜單"
      @load="attachFrame"
    />
  </section>
</template>

<style scoped>
.order-menu-panel { position: absolute; z-index: 20; top: 1rem; left: 1rem; width: min(54vw, 42rem); height: min(72vh, 48rem); overflow: hidden; border: 1px solid rgb(255 255 255 / .55); border-radius: 1.25rem; background: rgb(255 255 255 / .88); box-shadow: 0 1.25rem 3.5rem rgb(20 8 0 / .25); backdrop-filter: blur(1rem); }
header { display: flex; align-items: center; justify-content: space-between; height: 3.25rem; padding: 0 .75rem 0 1rem; color: #5b2b15; } header div:first-child { display: grid; gap: .1rem; } header span { color: #a9562e; font-size: .7rem; font-weight: 800; letter-spacing: .08em; } header strong { font-size: .95rem; } button { display: grid; width: 2rem; height: 2rem; place-items: center; border: 0; border-radius: 999px; background: transparent; color: #8e492d; cursor: pointer; font-size: 1.25rem; } button:hover { background: rgb(142 73 45 / .12); } iframe { width: 100%; height: calc(100% - 3.25rem); border: 0; background: #fff8ee; }
@media (max-width: 768px) { .order-menu-panel { top: .5rem; left: .5rem; width: calc(100vw - 1rem); height: 58vh; } }
</style>
