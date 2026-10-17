<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'

import type { MenuItem } from '../domain/order-machine'

import { computed } from 'vue'

import { addItemControlId, optionControlId, quantityControlId } from '../webmcp'

const props = defineProps<{ locked?: boolean, item?: MenuItem, quantity: number, selectedOptions: Record<string, string> }>()
const emit = defineEmits<{
  add: [itemId: string]
  close: []
  registerControl: [id: string, element: Element | ComponentPublicInstance | null]
  updateOption: [groupId: string, valueId: string]
  updateQuantity: [quantity: number]
}>()

const missingRequiredOptions = computed(() => props.item?.optionGroups.filter(group => group.required && !group.values.some(value => value.id === props.selectedOptions[group.id])) ?? [])

function registerControl(id: string, element: Element | ComponentPublicInstance | null) {
  emit('registerControl', id, element)
}

function optionControlRef(itemId: string, groupId: string, valueId: string) {
  const controlId = optionControlId(itemId, groupId, valueId)
  return (element: Element | ComponentPublicInstance | null) => registerControl(controlId, element)
}

function quantityControlRef(itemId: string) {
  const controlId = quantityControlId(itemId)
  return (element: Element | ComponentPublicInstance | null) => registerControl(controlId, element)
}

function addItemControlRef(itemId: string) {
  const controlId = addItemControlId(itemId)
  return (element: Element | ComponentPublicInstance | null) => registerControl(controlId, element)
}

function currency(amount: number) {
  return new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', maximumFractionDigits: 0 }).format(amount)
}
</script>

<template>
  <Teleport to="body">
    <section v-if="props.item" :inert="props.locked" class="item-dialog-backdrop" role="presentation" @click.self="emit('close')">
      <article class="item-dialog" role="dialog" aria-modal="true" :aria-label="`選擇${props.item.name}`">
        <header>
          <div><p>選擇餐點</p><h2>{{ props.item.name }}</h2><strong>{{ currency(props.item.price) }}</strong></div><button type="button" aria-label="關閉" @click="emit('close')">
            ×
          </button>
        </header><section v-for="group in props.item.optionGroups" :key="group.id" class="option-group">
          <div><strong>{{ group.label }}</strong><small>{{ group.required ? '必選' : '可略過' }}</small></div><div>
            <button v-for="option in group.values" :key="option.id" :ref="optionControlRef(props.item.id, group.id, option.id)" type="button" :class="['option-button', { 'is-selected': props.selectedOptions[group.id] === option.id }]" @click="emit('updateOption', group.id, option.id)">
              {{ option.label }}<span v-if="option.priceDelta"> +{{ currency(option.priceDelta) }}</span>
            </button>
          </div>
        </section><div class="dialog-actions">
          <div :ref="quantityControlRef(props.item.id)" class="quantity-control">
            <button type="button" :disabled="props.quantity === 1" @click="emit('updateQuantity', props.quantity - 1)">
              −
            </button><output>{{ props.quantity }}</output><button type="button" @click="emit('updateQuantity', props.quantity + 1)">
              ＋
            </button>
          </div><button :ref="addItemControlRef(props.item.id)" type="button" class="confirm-add" :disabled="missingRequiredOptions.length > 0" @click="emit('add', props.item.id)">
            加入購物車
          </button>
        </div>
        <p v-if="missingRequiredOptions.length" role="status">
          請先選擇{{ missingRequiredOptions.map(group => group.label).join('、') }}。
        </p>
      </article>
    </section>
  </Teleport>
</template>

<style scoped>
.item-dialog-backdrop { position:fixed; z-index:20; inset:0; display:grid; place-items:center; padding:20px; background:#2a140866; }.item-dialog { width:min(520px,100%); border-radius:20px; padding:20px; background:#fff; color:#3d281c; }.item-dialog header { display:flex; align-items:start; justify-content:space-between; gap:12px; }.item-dialog header p,.item-dialog h2 { margin:0 0 5px; }.item-dialog header p,.item-dialog small { color:#876; font-size:12px; }.item-dialog header button { background:transparent; color:#765; font-size:24px; }.option-group { margin-top:16px; border-top:1px solid #f0e4da; padding-top:14px; }.option-group > div:first-child { display:flex; justify-content:space-between; }.option-button { margin:9px 7px 0 0; border:1px solid #ead7c9; background:#fff9f3; color:#765; padding:8px 10px; }.option-button.is-selected { border-color:#d95327; background:#ffe0c5; color:#803813; font-weight:800; }.dialog-actions { display:grid; grid-template-columns:130px 1fr; gap:10px; margin-top:20px; }.quantity-control { display:grid; grid-template-columns:38px 1fr 38px; align-items:center; border:1px solid #ead7c9; border-radius:10px; text-align:center; }.quantity-control button { background:transparent; color:#803813; font-size:19px; }.confirm-add { background:#d95327; color:#fff; font-weight:800; }
</style>
