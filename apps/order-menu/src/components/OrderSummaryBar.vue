<script setup lang="ts">
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
}>()
</script>

<template>
  <footer class="order-summary-bar" aria-label="購物車摘要">
    <div class="order-summary-copy">
      <div>
        <strong>購物車</strong>
        <span>{{ itemCount > 0 ? `${itemCount} 項餐點・${total}` : '尚未加入餐點' }}</span>
      </div>
    </div>
    <ul v-if="lines.length" class="order-summary-lines" aria-label="已加入的餐點">
      <li v-for="line in lines" :key="line.id">
        <img v-if="line.imageUrl" :src="line.imageUrl" :alt="line.name">
        <span v-else class="order-summary-fallback" aria-hidden="true">{{ line.symbol ?? '餐' }}</span>
        <span class="order-summary-line-name">{{ line.name }}</span>
        <strong>×{{ line.quantity }}</strong>
      </li>
    </ul>
    <button type="button" :disabled="itemCount === 0" @click="emit('open')">
      查看訂單
    </button>
  </footer>
</template>

<style scoped>
.order-summary-bar { display:flex; min-width:0; align-items:center; gap:12px; border-top:1px solid #f0e4da; padding:10px 16px; background:#fffdf9; box-shadow:0 -8px 24px #7a3b1414; }.order-summary-copy { min-width:5.25rem; flex:none; }.order-summary-copy strong,.order-summary-copy span { display:block; }.order-summary-copy strong { color:#3d281c; font-size:14px; }.order-summary-copy span { overflow:hidden; color:#876; font-size:12px; text-overflow:ellipsis; white-space:nowrap; }.order-summary-lines { display:flex; min-width:0; flex:1; gap:.45rem; margin:0; padding:0; overflow-x:auto; list-style:none; scrollbar-width:thin; }.order-summary-lines li { display:grid; min-width:0; grid-template-columns:2.3rem minmax(4.5rem, 1fr) auto; gap:.35rem; align-items:center; border:1px solid #f0e4da; border-radius:.65rem; padding:.25rem .45rem .25rem .25rem; background:#fff; }.order-summary-lines img,.order-summary-fallback { width:2.3rem; height:2.3rem; border-radius:.45rem; object-fit:cover; }.order-summary-fallback { display:grid; place-items:center; color:#803813; background:#ffe0c5; font-size:.85rem; font-weight:800; }.order-summary-line-name { overflow:hidden; color:#5b3824; font-size:.78rem; font-weight:700; text-overflow:ellipsis; white-space:nowrap; }.order-summary-lines strong { color:#803813; font-size:.8rem; white-space:nowrap; }.order-summary-bar button { flex:none; padding:10px 13px; color:#fff; background:#d95327; font-weight:800; }.order-summary-bar button:disabled { cursor:not-allowed; background:#c6b8ae; }@media (max-width:700px) { .order-summary-bar { gap:.55rem; padding:8px 10px; }.order-summary-copy { min-width:4.3rem; }.order-summary-copy strong { font-size:.8rem; }.order-summary-copy span { font-size:.68rem; }.order-summary-lines li { min-width:8.2rem; }.order-summary-bar button { padding:9px 10px; font-size:.78rem; } }
</style>
