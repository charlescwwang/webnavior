<script setup lang="ts">
import type { MenuItem } from '../domain/order-machine'

const props = defineProps<{ isCompared: boolean, isTargeted: boolean, item: MenuItem }>()
const emit = defineEmits<{ compare: [itemId: string], select: [itemId: string] }>()
function currency(amount: number) {
  return new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', maximumFractionDigits: 0 }).format(amount)
}
</script>

<template>
  <article :class="['menu-card', { 'is-compared': props.isCompared, 'is-targeted': props.isTargeted, 'is-unavailable': props.item.available === false }]">
    <img v-if="props.item.imageUrl" :src="props.item.imageUrl" :alt="props.item.name"><div v-else class="menu-symbol" role="img" :aria-label="props.item.name">
      {{ props.item.symbol ?? '🍽️' }}
    </div>
    <div class="menu-card-body">
      <div><h3>{{ props.item.name }}</h3><p>{{ props.item.description }}</p></div><strong>{{ currency(props.item.price) }}</strong>
    </div>
    <div class="card-actions">
      <span v-if="props.item.available === false" class="unavailable">今日售完</span><template v-else>
        <button type="button" class="compare-button" @click="emit('compare', props.item.id)">
          比較
        </button><button type="button" class="add-to-cart" @click="emit('select', props.item.id)">
          選擇
        </button>
      </template>
    </div>
  </article>
</template>

<style scoped>
.menu-symbol { display:grid; min-height:132px; place-items:center; background:#fff1e4; color:#803813; font-size:54px; }.menu-card-body { display:flex; align-items:start; justify-content:space-between; gap:12px; padding:14px; }.menu-card-body h3 { margin:0 0 6px; }.menu-card-body p { margin:0; color:#765; font-size:13px; }.menu-card-body strong { white-space:nowrap; }.card-actions { display:flex; gap:9px; padding:0 14px 14px; }.card-actions button { min-height:40px; flex:1; }.compare-button { border:1px solid #ead7c9; background:#fff9f3; color:#803813; }.add-to-cart { background:#d95327; color:#fff; font-weight:800; }.unavailable { width:100%; border-radius:10px; padding:10px; color:#85412a; background:#fff0e7; font-size:13px; font-weight:800; text-align:center; }.menu-card.is-compared { border-color:#d95327; }.menu-card.is-unavailable { opacity:.72; }
</style>
