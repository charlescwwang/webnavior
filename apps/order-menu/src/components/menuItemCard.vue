<script setup lang="ts">
import type { MenuItem } from '../domain/order-machine'

import { onMounted, onUnmounted, useTemplateRef } from 'vue'

const props = defineProps<{
  adding: boolean
  customizationExpanded: boolean
  isTargeted: boolean
  item: MenuItem
  quantity: number
  selectedOptions: Record<string, string>
}>()

const emit = defineEmits<{
  add: [itemId: string]
  registerCard: [itemId: string, element: HTMLElement | null]
  updateCustomizationExpanded: [itemId: string, expanded: boolean]
  updateOption: [itemId: string, groupId: string, valueId: string]
  updateQuantity: [itemId: string, quantity: number]
}>()

const card = useTemplateRef<HTMLElement>('card')

function currency(amount: number) {
  return new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', maximumFractionDigits: 0 }).format(amount)
}

function decreaseQuantity() {
  emit('updateQuantity', props.item.id, Math.max(1, props.quantity - 1))
}

function increaseQuantity() {
  emit('updateQuantity', props.item.id, Math.min(20, props.quantity + 1))
}

function updateCustomizationExpanded(event: Event) {
  if (!(event.currentTarget instanceof HTMLDetailsElement))
    return

  emit('updateCustomizationExpanded', props.item.id, event.currentTarget.open)
}

onMounted(() => emit('registerCard', props.item.id, card.value))
onUnmounted(() => emit('registerCard', props.item.id, null))
</script>

<template>
  <article ref="card" :class="['menu-card', { 'is-targeted': isTargeted }]">
    <img :src="item.imageUrl" :alt="item.name">
    <div class="menu-card-body">
      <div>
        <h3>{{ item.name }}</h3>
        <p>{{ item.description }}</p>
      </div>
      <strong>{{ currency(item.price) }}</strong>
    </div>
    <details
      v-if="item.optionGroups.length > 0"
      :open="customizationExpanded"
      class="customization"
      @toggle="updateCustomizationExpanded"
    >
      <summary>客製選項</summary>
      <div v-for="group in item.optionGroups" :key="group.id" class="customization-group">
        <span>{{ group.label }}</span>
        <div class="option-list">
          <button
            v-for="option in group.values"
            :key="option.id"
            type="button"
            :aria-pressed="selectedOptions[group.id] === option.id"
            :class="['option-button', { 'is-selected': selectedOptions[group.id] === option.id }]"
            @click="emit('updateOption', item.id, group.id, option.id)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
    </details>
    <div class="card-actions">
      <div class="quantity-control" :aria-label="`${item.name} 數量`">
        <button type="button" :disabled="quantity === 1 || adding" aria-label="減少一份" @click="decreaseQuantity">
          −
        </button>
        <output>{{ quantity }}</output>
        <button type="button" :disabled="quantity === 20 || adding" aria-label="增加一份" @click="increaseQuantity">
          ＋
        </button>
      </div>
      <button class="add-to-cart" type="button" :disabled="adding" @click="emit('add', item.id)">
        {{ adding ? '加入中…' : '加入購物車' }}
      </button>
    </div>
  </article>
</template>

<style scoped>
.card-actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr);
  gap: 10px;
  padding: 0 14px 14px;
}

.customization {
  margin: 0 14px 14px;
  border-top: 1px solid #f0e4da;
}

.customization summary {
  padding: 10px 0;
  color: #803813;
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
}

.customization-group {
  display: grid;
  gap: 7px;
  margin-bottom: 12px;
  color: #765;
  font-size: 13px;
}

.option-list {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.option-button {
  min-height: 32px;
  padding: 6px 10px;
  border: 1px solid #ead7c9;
  background: #fff9f3;
  color: #765;
  font-size: 12px;
}

.option-button.is-selected {
  border-color: #d95327;
  background: #ffe0c5;
  color: #803813;
  font-weight: 700;
}

.quantity-control {
  display: grid;
  grid-template-columns: 32px minmax(42px, 1fr) 32px;
  align-items: center;
  overflow: hidden;
  border: 1px solid #ead7c9;
  border-radius: 12px;
  background: #fff9f3;
}

.quantity-control button {
  width: 32px;
  height: 38px;
  padding: 0;
  border-radius: 0;
  background: transparent;
  color: #803813;
  font-size: 19px;
}

.quantity-control output {
  color: #5b3824;
  font-size: 13px;
  font-weight: 700;
  text-align: center;
}

.add-to-cart {
  min-height: 38px;
  padding: 8px 10px;
  background: #d95327;
  color: #fff;
  font-weight: 800;
}

.add-to-cart:disabled,
.quantity-control button:disabled {
  cursor: not-allowed;
  opacity: .55;
}
</style>
