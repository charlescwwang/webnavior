<script setup lang="ts">
import type { MenuItem } from '../domain/order-machine'

import { formatOrderingPrice } from '@proj-airi/stage-shared/kiosk-conversation'

import { orderingMessages } from '../../../../packages/i18n/src/orderingMessages'
import { menuPageState } from '../domain/order-machine'

const props = defineProps<{ item: MenuItem, isTargeted: boolean }>()
const emit = defineEmits<{ select: [itemId: string] }>()
</script>

<template>
  <button type="button" :class="['supplier-product', { 'is-targeted': isTargeted }]" :disabled="menuPageState(item) !== 'available'" @click="emit('select', item.id)">
    <div :class="['supplier-product-copy']">
      <h3>{{ props.item.name }}</h3>
      <p v-if="props.item.description !== props.item.name">
        {{ props.item.description }}
      </p>
      <strong>{{ formatOrderingPrice(props.item.price) }}</strong>
    </div>
    <img v-if="props.item.imageUrl" :src="props.item.imageUrl" :alt="props.item.name" loading="lazy">
    <span v-else :class="['supplier-no-photo']">{{ orderingMessages['zh-Hant'].noProductPhoto }}</span>
  </button>
</template>

<style scoped>
.supplier-product { display:flex; justify-content:space-between; gap:16px; width:100%; min-height:150px; padding:18px; border:1px solid #e2e8e4; border-radius:12px; background:#fff; color:#243d32; text-align:left; }
.supplier-product:focus-visible,.supplier-product.is-targeted { outline:3px solid #237b58; outline-offset:3px; }
.supplier-product-copy { display:flex; flex-direction:column; gap:8px; }
h3,p { margin:0; } p { color:#607467; font-size:14px; } strong { margin-top:auto; }
img,.supplier-no-photo { width:110px; height:110px; flex:none; border-radius:8px; object-fit:cover; }
.supplier-no-photo { display:grid; place-items:center; background:#f0f4f1; color:#64746b; font-size:13px; }
</style>
