<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'

import type { CartSnapshot } from './domain/order-machine'
import type { AgentAction, MenuBridgeCall, MenuBridgeResult, MenuToolName } from './webmcp'

import { errorMessageFrom } from '@moeru/std'
import { computed, nextTick, onMounted, onUnmounted, reactive, shallowRef } from 'vue'

import MenuItemCard from './components/menuItemCard.vue'

import { defaultOptionsFor, menu } from './domain/order-machine'
import { createMenuToolRuntime } from './webmcp'

const expectedAiriOrigin = import.meta.env.VITE_AIRI_ORIGIN ?? 'http://localhost:5173'
const action = shallowRef<AgentAction>({ label: '等待 AIRI 或使用者選擇餐點' })
const cart = shallowRef<CartSnapshot>({ lines: [], total: 0, itemCount: 0 })
const cursorTargetId = shallowRef<string>()
const cursorPosition = shallowRef({ x: 44, y: 14 })
const orderStatus = shallowRef<string>()
const addingItemId = shallowRef<string>()
const cardElements = new Map<string, HTMLElement>()
const quantities = reactive<Record<string, number>>(Object.fromEntries(menu.map(item => [item.id, 1])))
const expandedCustomizations = reactive<Record<string, boolean>>(Object.fromEntries(menu.map(item => [item.id, false])))
const selectedOptionsByItem = reactive<Record<string, Record<string, string>>>(Object.fromEntries(
  menu.map(item => [item.id, defaultOptionsFor(item)]),
))

const menuSections = computed(() => [...new Set(menu.map(item => item.category))].map(category => ({
  category,
  items: menu.filter(item => item.category === category),
})))

function currency(amount: number) {
  return new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', maximumFractionDigits: 0 }).format(amount)
}

function setCardElement(id: string, element: Element | ComponentPublicInstance | null) {
  if (element instanceof HTMLElement)
    cardElements.set(id, element)
  else
    cardElements.delete(id)
}

async function animateAction(nextAction: AgentAction) {
  action.value = nextAction
  cursorTargetId.value = nextAction.targetId

  if (nextAction.expandCustomization && nextAction.targetId)
    expandedCustomizations[nextAction.targetId] = true

  await nextTick()
  const target = nextAction.targetId ? cardElements.get(nextAction.targetId) : undefined
  if (!target)
    return

  target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
  // Let the browser finish positioning the target before measuring it. The
  // cursor is fixed to the menu viewport, so measuring before scrolling would
  // leave it pointing at the target's old screen position.
  await new Promise(resolve => setTimeout(resolve, 360))
  const rect = target.getBoundingClientRect()
  cursorPosition.value = { x: rect.left + rect.width * 0.5, y: rect.top + Math.min(rect.height * 0.35, 76) }
  await new Promise(resolve => setTimeout(resolve, 260))
}

const runtime = createMenuToolRuntime({
  onAction: animateAction,
  onCartChange: nextCart => cart.value = nextCart,
  onMenuSelection: () => {},
})

async function invoke(name: MenuToolName, args: Record<string, unknown> = {}) {
  const result = await runtime.invoke(name, args)
  if (name === 'order_confirm')
    orderStatus.value = '模擬訂單已建立，尚未送往 POS。'
  return result
}

function updateQuantity(itemId: string, quantity: number) {
  quantities[itemId] = quantity
}

function updateOption(itemId: string, groupId: string, valueId: string) {
  selectedOptionsByItem[itemId] = {
    ...selectedOptionsByItem[itemId],
    [groupId]: valueId,
  }
}

function updateCustomizationExpanded(itemId: string, expanded: boolean) {
  expandedCustomizations[itemId] = expanded
}

async function addItem(itemId: string) {
  const item = menu.find(candidate => candidate.id === itemId)
  if (!item || addingItemId.value)
    return

  addingItemId.value = itemId
  orderStatus.value = undefined
  try {
    await invoke('menu_select_item', { itemId })
    const initialOptions = defaultOptionsFor(item)
    for (const [groupId, valueId] of Object.entries(selectedOptionsByItem[itemId] ?? {})) {
      if (valueId === initialOptions[groupId])
        continue

      await invoke('menu_set_item_option', { groupId, valueId })
    }
    await invoke('menu_set_quantity', { quantity: quantities[itemId] ?? 1 })
    await invoke('cart_add_item')
  }
  finally {
    addingItemId.value = undefined
  }
}

function optionLabel(line: CartSnapshot['lines'][number]) {
  const item = menu.find(candidate => candidate.id === line.itemId)
  return Object.entries(line.options)
    .map(([groupId, valueId]) => item?.optionGroups.find(group => group.id === groupId)?.values.find(value => value.id === valueId)?.label)
    .filter((label): label is string => !!label)
    .join('、')
}

async function onBridgeMessage(event: MessageEvent<MenuBridgeCall>) {
  if (event.origin !== expectedAiriOrigin)
    return
  const request = event.data
  if (request?.source !== 'airi-order-bridge' || request.type !== 'order:call')
    return

  let response: MenuBridgeResult
  try {
    response = { source: 'airi-order-bridge', type: 'order:result', requestId: request.requestId, result: await invoke(request.name, request.args) }
  }
  catch (error) {
    response = { source: 'airi-order-bridge', type: 'order:result', requestId: request.requestId, error: errorMessageFrom(error) ?? 'Unknown menu tool error.' }
  }
  event.source?.postMessage(response, { targetOrigin: expectedAiriOrigin })
}

onMounted(async () => {
  window.addEventListener('message', onBridgeMessage)
  await runtime.registerNativeWebMcp({ exposedTo: [expectedAiriOrigin] })
  window.parent.postMessage({ source: 'airi-order-bridge', type: 'order:ready' }, { targetOrigin: expectedAiriOrigin })
})

onUnmounted(() => window.removeEventListener('message', onBridgeMessage))
</script>

<template>
  <main class="menu-app">
    <header class="menu-header">
      <div>
        <h1>周氏蝦捲菜單</h1>
      </div>
      <div class="cart-pill">
        購物車 {{ cart.itemCount }} 項 · {{ currency(cart.total) }}
      </div>
    </header>

    <output class="agent-status" aria-live="polite">
      <span class="status-dot" />
      {{ action.label }}
    </output>

    <section v-for="section in menuSections" :key="section.category" class="menu-section">
      <h2>{{ section.category }}</h2>
      <div class="menu-grid">
        <MenuItemCard
          v-for="item in section.items"
          :key="item.id"
          :adding="addingItemId === item.id"
          :customization-expanded="expandedCustomizations[item.id]"
          :is-targeted="cursorTargetId === item.id"
          :item="item"
          :quantity="quantities[item.id] ?? 1"
          :selected-options="selectedOptionsByItem[item.id] ?? {}"
          @add="addItem"
          @register-card="setCardElement"
          @update-customization-expanded="updateCustomizationExpanded"
          @update-option="updateOption"
          @update-quantity="updateQuantity"
        />
      </div>
    </section>

    <aside :ref="element => setCardElement('cart', element)" class="cart-panel">
      <div class="cart-heading">
        <h2>目前訂單</h2><span>{{ cart.itemCount }} 項</span>
      </div>
      <p v-if="cart.lines.length === 0" class="empty-cart">
        尚未加入餐點
      </p>
      <ul v-else>
        <li v-for="line in cart.lines" :key="line.id">
          <div><strong>{{ line.name }} × {{ line.quantity }}</strong><small>{{ optionLabel(line) }}</small></div>
          <div>
            <span>{{ currency(line.unitPrice * line.quantity) }}</span><button type="button" @click="invoke('cart_remove_item', { lineId: line.id })">
              移除
            </button>
          </div>
        </li>
      </ul>
      <div class="cart-total">
        <span>總計</span><strong>{{ currency(cart.total) }}</strong>
      </div>
      <button class="confirm-button" type="button" :disabled="cart.lines.length === 0" @click="invoke('order_confirm', { confirmedByUser: true })">
        確認模擬訂單
      </button>
      <p v-if="orderStatus" class="order-status">
        {{ orderStatus }}
      </p>
    </aside>

    <div class="agent-cursor" :style="{ left: `${cursorPosition.x}px`, top: `${cursorPosition.y}px` }" aria-hidden="true">
      ✦
    </div>
  </main>
</template>
