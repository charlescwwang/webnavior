<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'

defineProps<{
  itemCount: number
  lines: Array<{
    id: string
    imageUrl?: string
    name: string
    quantity: number
    symbol?: string
  }>
  total: string
}>()

const emit = defineEmits<{
  open: []
  registerControl: [id: string, element: Element | ComponentPublicInstance | null]
}>()
</script>

<template>
  <footer class="order-summary-bar" aria-label="購物車摘要">
    <button
      :ref="element => emit('registerControl', 'order:view', element)"
      class="order-summary-trigger"
      type="button"
      aria-label="查看訂單"
      :disabled="itemCount === 0"
      @click="itemCount > 0 && emit('open')"
    >
      <span class="order-summary-copy">
        <strong>購物車</strong>
        <span>{{ itemCount > 0 ? `${itemCount} 項餐點・${total}` : '尚未加入餐點' }}</span>
      </span>
      <span v-if="lines.length" class="order-summary-lines">
        <span v-for="line in lines" :key="line.id" class="order-summary-line">
          <img v-if="line.imageUrl" :src="line.imageUrl" alt="">
          <span v-else class="order-summary-fallback" aria-hidden="true">{{ line.symbol ?? '餐' }}</span>
          <span class="order-summary-line-name">{{ line.name }}</span>
          <strong>×{{ line.quantity }}</strong>
        </span>
      </span>
      <span class="order-summary-action">查看訂單</span>
    </button>
  </footer>
</template>

<style scoped>
.order-summary-bar { min-width:0; border-top:1px solid #f0e4da; background:#fffdf9; box-shadow:0 -8px 24px #7a3b1414; }
.order-summary-trigger { display:flex; width:100%; min-width:0; align-items:center; gap:12px; border:0; border-radius:0; padding:10px 16px; background:transparent; font:inherit; text-align:left; cursor:pointer; }
.order-summary-trigger:enabled:hover { background:#fff5e9; }
.order-summary-trigger:enabled:active { background:#ffe9d4; }
.order-summary-trigger:focus-visible { outline:3px solid #d95327; outline-offset:-3px; }
.order-summary-trigger:disabled { cursor:default; }
.order-summary-copy { min-width:5.25rem; flex:none; }
.order-summary-copy strong,.order-summary-copy span { display:block; }
.order-summary-copy strong { color:#3d281c; font-size:14px; }
.order-summary-copy span { overflow:hidden; color:#876; font-size:12px; text-overflow:ellipsis; white-space:nowrap; }
.order-summary-lines { display:flex; min-width:0; flex:1; gap:.45rem; overflow-x:auto; scrollbar-width:thin; }
.order-summary-line { display:grid; min-width:0; grid-template-columns:2.3rem minmax(4.5rem, 1fr) auto; gap:.35rem; align-items:center; border:1px solid #f0e4da; border-radius:.65rem; padding:.25rem .45rem .25rem .25rem; background:#fff; }
.order-summary-lines img,.order-summary-fallback { width:2.3rem; height:2.3rem; border-radius:.45rem; object-fit:cover; }
.order-summary-fallback { display:grid; place-items:center; color:#803813; background:#ffe0c5; font-size:.85rem; font-weight:800; }
.order-summary-line-name { overflow:hidden; color:#5b3824; font-size:.78rem; font-weight:700; text-overflow:ellipsis; white-space:nowrap; }
.order-summary-lines strong { color:#803813; font-size:.8rem; white-space:nowrap; }
.order-summary-action { flex:none; border-radius:.65rem; padding:10px 13px; color:#fff; background:#d95327; font-weight:800; }
.order-summary-trigger:disabled .order-summary-action { background:#c6b8ae; }
@media (max-width:700px) {
  .order-summary-trigger { gap:.55rem; padding:8px 10px; }
  .order-summary-copy { min-width:4.3rem; }
  .order-summary-copy strong { font-size:.8rem; }
  .order-summary-copy span { font-size:.68rem; }
  .order-summary-line { min-width:8.2rem; }
  .order-summary-action { padding:9px 10px; font-size:.78rem; }
}
</style>
