<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'

import type { CartSnapshot } from './domain/order-machine'
import type { AgentAction, MenuBridgeCall, MenuBridgeEvent, MenuBridgeResult, MenuToolName } from './webmcp'

import { errorMessageFrom } from '@moeru/std'
import { computed, nextTick, onMounted, onUnmounted, reactive, shallowRef } from 'vue'

import MenuItemCard from './components/menuItemCard.vue'

import { defaultOptionsFor, menu } from './domain/order-machine'
import { createMenuToolRuntime, menuScenarioManifest } from './webmcp'

const expectedAiriOrigin = import.meta.env.VITE_AIRI_ORIGIN ?? 'http://localhost:5173'
const action = shallowRef<AgentAction>({ label: '等待 AIRI 或使用者選擇餐點' })
const cart = shallowRef<CartSnapshot>({ lines: [], total: 0, itemCount: 0 })
const cursorTargetId = shallowRef<string>()
const cursorPosition = shallowRef({ x: 44, y: 14 })
const showAgentCursor = shallowRef(false)
const cartUpdated = shallowRef(false)
const orderStatus = shallowRef<string>()
const addingItemId = shallowRef<string>()
const cardElements = new Map<string, HTMLElement>()
const controlElements = new Map<string, HTMLElement>()
let cartUpdateTimer: ReturnType<typeof setTimeout> | undefined
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

function setControlElement(id: string, element: HTMLElement | null) {
  if (element)
    controlElements.set(id, element)
  else
    controlElements.delete(id)
}

async function animateAction(nextAction: AgentAction) {
  action.value = nextAction
  cursorTargetId.value = nextAction.targetId
  showAgentCursor.value = true

  if (nextAction.expandCustomization && nextAction.targetId)
    expandedCustomizations[nextAction.targetId] = true

  await nextTick()
  const target = nextAction.controlId
    ? controlElements.get(nextAction.controlId)
    : nextAction.targetId ? cardElements.get(nextAction.targetId) : undefined
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
  onCartChange: (nextCart) => {
    cart.value = nextCart
    cartUpdated.value = false
    void nextTick(() => {
      cartUpdated.value = true
      if (cartUpdateTimer)
        clearTimeout(cartUpdateTimer)
      cartUpdateTimer = setTimeout(() => cartUpdated.value = false, 720)
    })
  },
  onMenuSelection: () => {},
})

async function invoke(name: MenuToolName, args: Record<string, unknown> = {}, options: { animate?: boolean } = {}) {
  const result = await runtime.invoke(name, args, options.animate === false ? () => {} : undefined)
  if (name === 'order_confirm') {
    orderStatus.value = '模擬訂單已建立，尚未送往 POS。'
    notifyParent({ source: 'airi-scenario-bridge', type: 'scenario:event', event: 'completed' })
  }
  return result
}

function notifyParent(event: MenuBridgeEvent) {
  window.parent.postMessage(event, { targetOrigin: expectedAiriOrigin })
}

function notifyActivity() {
  cursorTargetId.value = undefined
  showAgentCursor.value = false
  notifyParent({ source: 'airi-scenario-bridge', type: 'scenario:event', event: 'activity' })
}

function resetForCustomerSession() {
  runtime.reset()
  for (const item of menu) {
    quantities[item.id] = 1
    expandedCustomizations[item.id] = false
    selectedOptionsByItem[item.id] = defaultOptionsFor(item)
  }
  cursorTargetId.value = undefined
  showAgentCursor.value = false
  orderStatus.value = undefined
  action.value = { label: '等待下一位顧客開始點餐' }
  return { cart: cart.value }
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

async function updateCartLineQuantity(lineId: string, quantity: number) {
  await invoke('cart_set_line_quantity', { lineId, quantity }, { animate: false })
}

async function removeCartLine(lineId: string) {
  await invoke('cart_remove_item', { lineId }, { animate: false })
}

async function confirmOrder() {
  await invoke('order_confirm', { confirmedByUser: true }, { animate: false })
}

async function addItem(itemId: string) {
  const item = menu.find(candidate => candidate.id === itemId)
  if (!item || addingItemId.value)
    return

  addingItemId.value = itemId
  orderStatus.value = undefined
  try {
    await invoke('menu_select_item', { itemId }, { animate: false })
    const initialOptions = defaultOptionsFor(item)
    for (const [groupId, valueId] of Object.entries(selectedOptionsByItem[itemId] ?? {})) {
      if (valueId === initialOptions[groupId])
        continue

      await invoke('menu_set_item_option', { groupId, valueId }, { animate: false })
    }
    await invoke('menu_set_quantity', { quantity: quantities[itemId] ?? 1 }, { animate: false })
    await invoke('cart_add_item', {}, { animate: false })
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
  if (request?.source !== 'airi-scenario-bridge' || request.type !== 'scenario:call')
    return

  let response: MenuBridgeResult
  try {
    const result = request.name === 'scenario_reset'
      ? resetForCustomerSession()
      : await invoke(request.name, request.args)
    response = { source: 'airi-scenario-bridge', type: 'scenario:result', requestId: request.requestId, result }
  }
  catch (error) {
    response = { source: 'airi-scenario-bridge', type: 'scenario:result', requestId: request.requestId, error: errorMessageFrom(error) ?? 'Unknown menu tool error.' }
  }
  event.source?.postMessage(response, { targetOrigin: expectedAiriOrigin })
}

onMounted(async () => {
  window.addEventListener('message', onBridgeMessage)
  await runtime.registerNativeWebMcp({ exposedTo: [expectedAiriOrigin] })
  window.parent.postMessage({ source: 'airi-scenario-bridge', type: 'scenario:ready', manifest: menuScenarioManifest }, { targetOrigin: expectedAiriOrigin })
})

onUnmounted(() => {
  window.removeEventListener('message', onBridgeMessage)
  if (cartUpdateTimer)
    clearTimeout(cartUpdateTimer)
})
</script>

<template>
  <main class="menu-app" @pointerdown="notifyActivity">
    <header class="menu-header">
      <div>
        <h1>周氏蝦捲菜單</h1>
      </div>
      <div :class="['cart-pill', { 'is-updated': cartUpdated }]">
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
          :agent-action="action"
          :customization-expanded="expandedCustomizations[item.id]"
          :is-targeted="cursorTargetId === item.id"
          :item="item"
          :quantity="quantities[item.id] ?? 1"
          :selected-options="selectedOptionsByItem[item.id] ?? {}"
          @add="addItem"
          @register-card="setCardElement"
          @register-control="setControlElement"
          @update-customization-expanded="updateCustomizationExpanded"
          @update-option="updateOption"
          @update-quantity="updateQuantity"
        />
      </div>
    </section>

    <aside :ref="element => setCardElement('cart', element)" :class="['cart-panel', { 'is-updated': cartUpdated, 'is-targeted': cursorTargetId === 'cart' }]">
      <div class="cart-heading">
        <h2>目前訂單</h2><span>{{ cart.itemCount }} 項</span>
      </div>
      <p v-if="cart.lines.length === 0" class="empty-cart">
        尚未加入餐點
      </p>
      <ul v-else>
        <li v-for="line in cart.lines" :key="line.id">
          <div><strong>{{ line.name }} × {{ line.quantity }}</strong><small>{{ optionLabel(line) }}</small></div>
          <div class="cart-line-actions">
            <div class="cart-quantity-control" :aria-label="`${line.name} 購物車數量`">
              <button type="button" :disabled="line.quantity === 1" aria-label="減少一份" @click="updateCartLineQuantity(line.id, line.quantity - 1)">
                −
              </button>
              <output>{{ line.quantity }}</output>
              <button type="button" aria-label="增加一份" @click="updateCartLineQuantity(line.id, line.quantity + 1)">
                ＋
              </button>
            </div>
            <span>{{ currency(line.unitPrice * line.quantity) }}</span><button type="button" @click="removeCartLine(line.id)">
              移除
            </button>
          </div>
        </li>
      </ul>
      <div class="cart-total">
        <span>總計</span><strong>{{ currency(cart.total) }}</strong>
      </div>
      <button class="confirm-button" type="button" :disabled="cart.lines.length === 0" @click="confirmOrder">
        確認模擬訂單
      </button>
      <p v-if="orderStatus" class="order-status">
        {{ orderStatus }}
      </p>
    </aside>

    <div v-if="showAgentCursor" class="agent-cursor" :style="{ left: `${cursorPosition.x}px`, top: `${cursorPosition.y}px` }" aria-hidden="true">
      ✦
    </div>
  </main>
</template>
