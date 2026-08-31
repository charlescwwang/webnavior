<script setup lang="ts">
import { onMounted, onUnmounted, useTemplateRef } from 'vue'

import { orderMenuBridge } from '../services/order-menu-bridge'

const menuFrame = useTemplateRef<HTMLIFrameElement>('menuFrame')

function attachFrame() {
  orderMenuBridge.attach(menuFrame.value?.contentWindow ?? null)
}

onMounted(() => orderMenuBridge.resetForIframeReload())
onUnmounted(() => orderMenuBridge.attach(null))
</script>

<template>
  <section class="menu-surface" aria-label="AIRI 點餐菜單">
    <header class="menu-header">
      <span class="menu-kicker">AIRI 協助點餐</span>
      <strong class="menu-title">菜單與目前訂單</strong>
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
.menu-surface { display: grid; height: 100%; min-height: 0; overflow: hidden; border: 1px solid rgb(255 255 255 / 30%); border-radius: 1.5rem; background: #fff8ee; box-shadow: 0 1.25rem 4rem rgb(0 0 0 / 24%); grid-template-rows: auto minmax(0, 1fr); }
.menu-header { display: grid; gap: .1rem; padding: .8rem 1rem; color: #542b19; }
.menu-kicker { color: #a9562e; font-size: .7rem; font-weight: 800; letter-spacing: .08em; }
.menu-title { font-size: 1rem; }
iframe { min-height: 0; width: 100%; height: 100%; border: 0; }
</style>
