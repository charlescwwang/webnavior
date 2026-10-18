<script setup lang="ts">
import type { MenuItem } from '../domain/order-machine'

import { computed } from 'vue'

import { orderingMessages } from '../../../../packages/i18n/src/orderingMessages'
import { menuPageState } from '../domain/order-machine'

const props = defineProps<{ isTargeted: boolean, item: MenuItem }>()
const emit = defineEmits<{ select: [itemId: string] }>()
const state = computed(() => menuPageState(props.item))
const disabled = computed(() => state.value === 'sold-out' || state.value === 'unknown')
const statusLabel = computed(() => state.value === 'unknown' ? orderingMessages['zh-Hant'].unknownLabel : orderingMessages['zh-Hant'].soldOutLabel)
function currency(amount: number) {
  return new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', maximumFractionDigits: 0 }).format(amount)
}
</script>

<template>
  <button
    :aria-label="disabled ? `${props.item.name}，${statusLabel}` : `查看${props.item.name}`"
    :class="['menu-card', { 'is-targeted': props.isTargeted, 'is-unavailable': disabled }]"
    :disabled="disabled"
    type="button"
    @click="emit('select', props.item.id)"
  >
    <img v-if="props.item.imageUrl" :src="props.item.imageUrl" :alt="props.item.name"><div v-else class="menu-symbol" role="img" :aria-label="props.item.name">
      {{ props.item.symbol ?? '🍽️' }}
    </div>
    <div class="menu-card-body">
      <div><h3>{{ props.item.name }}</h3><p>{{ props.item.description }}</p></div><strong>{{ currency(props.item.price) }}</strong>
    </div>
    <span v-if="disabled" class="unavailable">{{ statusLabel }}</span>
  </button>
</template>

<style scoped>
.menu-card { width:100%; height:100%; padding:0; color:inherit; text-align:left; }.menu-card:focus-visible { outline:4px solid #2679db; outline-offset:3px; }.menu-card:not(:disabled):active { transform:scale(.98); }.menu-symbol { display:grid; width:100%; aspect-ratio:4/3; place-items:center; background:#fff1e4; color:#803813; font-size:64px; }.menu-card-body { display:flex; align-items:start; justify-content:space-between; gap:12px; padding:16px; }.menu-card-body h3 { margin:0 0 7px; font-size:18px; }.menu-card-body p { margin:0; color:#765; font-size:14px; }.menu-card-body strong { white-space:nowrap; }.unavailable { display:block; margin:0 14px 14px; border-radius:10px; padding:10px; color:#85412a; background:#fff0e7;font-size:13px;font-weight:800;text-align:center}.menu-card.is-unavailable{cursor:not-allowed;opacity:.72}@media (max-width:700px){.menu-card-body{padding:12px}.menu-card-body h3{font-size:16px}.menu-card-body p{font-size:12px}.menu-symbol{font-size:52px}}
</style>
