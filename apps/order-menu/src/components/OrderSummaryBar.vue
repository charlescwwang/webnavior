<script setup lang="ts">
defineProps<{
  itemCount: number
  total: string
}>()

const emit = defineEmits<{
  open: []
}>()
</script>

<template>
  <footer class="order-summary-bar" aria-label="購物車摘要">
    <div class="order-summary-copy">
      <span class="order-summary-count">{{ itemCount }}</span>
      <div>
        <strong>購物車</strong>
        <span>{{ itemCount > 0 ? `${itemCount} 項餐點・${total}` : '尚未加入餐點' }}</span>
      </div>
    </div>
    <button type="button" :disabled="itemCount === 0" @click="emit('open')">
      查看訂單
    </button>
  </footer>
</template>

<style scoped>
.order-summary-bar { display:flex; align-items:center; justify-content:space-between; gap:12px; border-top:1px solid #f0e4da; padding:12px 16px; background:#fffdf9; box-shadow:0 -8px 24px #7a3b1414; }.order-summary-copy { display:flex; min-width:0; align-items:center; gap:10px; }.order-summary-copy > div { min-width:0; }.order-summary-copy strong,.order-summary-copy span { display:block; }.order-summary-copy strong { color:#3d281c; font-size:14px; }.order-summary-copy span:not(.order-summary-count) { overflow:hidden; color:#876; font-size:12px; text-overflow:ellipsis; white-space:nowrap; }.order-summary-count { width:30px; height:30px; display:grid; flex:none; place-items:center; border-radius:50%; color:#803813; background:#ffe0c5; font-size:13px; font-weight:800; }.order-summary-bar button { flex:none; padding:10px 13px; color:#fff; background:#d95327; font-weight:800; }.order-summary-bar button:disabled { cursor:not-allowed; background:#c6b8ae; }
</style>
