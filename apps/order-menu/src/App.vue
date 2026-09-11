<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'

import type { CartSnapshot, FulfillmentMode, Selection, SubmittedOrder } from './domain/order-machine'
import type { AgentAction, MenuToolName } from './webmcp'

import { errorMessageFrom } from '@moeru/std'
import { computed, nextTick, onMounted, onUnmounted, reactive, shallowRef } from 'vue'

import MenuItemCard from './components/menuItemCard.vue'

import { defaultOptionsFor, menu } from './domain/order-machine'
import { resolveExpectedHostOrigin } from './embedding-origin'
import { createMenuToolRuntime, fulfillmentControlId } from './webmcp'

// A deployment can lock the service to one approved host. Otherwise, a page
// embedded by AIRI reads the browser-provided parent referrer origin, so local
// ports and kiosk domains work without a separate startup command.
const expectedAiriOrigin = resolveExpectedHostOrigin({
  configuredOrigin: import.meta.env.VITE_AIRI_ORIGIN,
  isEmbedded: window.parent !== window,
  referrer: document.referrer,
})
const action = shallowRef<AgentAction>({ label: '等待下一步操作' })
const agentOperationCount = shallowRef(0)
const cart = shallowRef<CartSnapshot>({ fulfillmentMode: undefined, lines: [], total: 0, itemCount: 0 })
const cursorTargetId = shallowRef<string>()
const cursorPosition = shallowRef({ x: 44, y: 14 })
const showAgentCursor = shallowRef(false)
const cartUpdated = shallowRef(false)
const orderStatus = shallowRef<string>()
const completedOrderId = shallowRef<string>()
const fulfillmentMode = shallowRef<FulfillmentMode>()
const addingItemId = shallowRef<string>()
const cardElements = new Map<string, HTMLElement>()
const controlElements = new Map<string, HTMLElement>()
let cartUpdateTimer: ReturnType<typeof setTimeout> | undefined
let unregisterNativeWebMcp: (() => void) | undefined
let nativeWebMcpUnmounted = false
const quantities = reactive<Record<string, number>>(Object.fromEntries(menu.map(item => [item.id, 1])))
const expandedCustomizations = reactive<Record<string, boolean>>(Object.fromEntries(menu.map(item => [item.id, false])))
const selectedOptionsByItem = reactive<Record<string, Record<string, string>>>(Object.fromEntries(
  menu.map(item => [item.id, defaultOptionsFor(item)]),
))

const menuSections = computed(() => [...new Set(menu.map(item => item.category))].map(category => ({
  category,
  items: menu.filter(item => item.category === category),
})))
const isAgentOperating = computed(() => agentOperationCount.value > 0)

function currency(amount: number) {
  return new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', maximumFractionDigits: 0 }).format(amount)
}

function setCardElement(id: string, element: Element | ComponentPublicInstance | null) {
  if (element instanceof HTMLElement)
    cardElements.set(id, element)
  else
    cardElements.delete(id)
}

function setControlElement(id: string, element: Element | ComponentPublicInstance | null) {
  if (element instanceof HTMLElement)
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
  onAgentOperationStart: () => agentOperationCount.value++,
  onAgentOperationEnd: () => agentOperationCount.value = Math.max(0, agentOperationCount.value - 1),
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
  onFulfillmentChange: mode => fulfillmentMode.value = mode,
  onSelectionChange: syncSelection,
  onOrderConfirmed: handleOrderConfirmed,
})

async function invoke(name: MenuToolName, args: Record<string, unknown> = {}, options: { animate?: boolean } = {}) {
  return await runtime.invoke(name, args, options.animate === false ? () => {} : undefined)
}

function syncSelection(selection: Selection) {
  quantities[selection.itemId] = selection.quantity
  selectedOptionsByItem[selection.itemId] = { ...selection.options }
}

function handleOrderConfirmed(order: SubmittedOrder) {
  if (completedOrderId.value === order.id)
    return

  completedOrderId.value = order.id
  orderStatus.value = '訂單已送出。'
  notifyHost('completed', {
    fulfillmentMode: order.cart.fulfillmentMode!,
    id: order.id,
    itemCount: order.cart.itemCount,
    simulated: order.status === 'simulated',
    total: order.cart.total,
  })
}

function notifyHost(type: 'activity' | 'completed', orderResult?: {
  fulfillmentMode: FulfillmentMode
  id: string
  itemCount: number
  simulated: boolean
  total: number
}) {
  if (window.parent === window)
    return

  // The host validates both the active iframe Window and this service origin.
  // The completion payload is intentionally limited to non-personal simulated
  // order data so the kiosk can evaluate its ordering conversation.
  if (import.meta.env.DEV)
    console.info('[DEBUG-feedback-lifecycle] menu sent lifecycle event', { type })
  window.parent.postMessage({ source: 'airi-interaction-lifecycle', type, orderResult }, { targetOrigin: '*' })
}

function notifyActivity() {
  cursorTargetId.value = undefined
  showAgentCursor.value = false
  notifyHost('activity')
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

async function setFulfillmentMode(mode: FulfillmentMode) {
  orderStatus.value = undefined
  await invoke('order_set_fulfillment', { mode }, { animate: false })
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

onMounted(() => {
  nativeWebMcpUnmounted = false
  if (!expectedAiriOrigin)
    return

  void runtime.registerNativeWebMcp({ exposedTo: [expectedAiriOrigin] })
    .then((unregister) => {
      if (!unregister)
        return

      // Registration is asynchronous. If Vite replaces this component while
      // it is pending, release the tools immediately instead of leaving their
      // names registered in the document.
      if (nativeWebMcpUnmounted)
        unregister()
      else
        unregisterNativeWebMcp = unregister
    })
    .catch((error) => {
      console.error('[order-menu] failed to register native WebMCP tools:', errorMessageFrom(error))
    })
})

onUnmounted(() => {
  nativeWebMcpUnmounted = true
  unregisterNativeWebMcp?.()
  unregisterNativeWebMcp = undefined
  runtime.disposeNativeWebMcp()
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

    <output :class="['agent-status', { 'is-active': isAgentOperating }]" aria-live="polite">
      <span class="status-dot" />
      <span>{{ isAgentOperating ? '代理操作中' : '等待下一步操作' }}</span>
      <small v-if="isAgentOperating">{{ action.label }}</small>
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
      <section class="fulfillment-panel" aria-labelledby="fulfillment-heading">
        <h3 id="fulfillment-heading">
          用餐方式
        </h3>
        <p>請選擇內用或外帶</p>
        <div class="fulfillment-actions">
          <button
            :ref="element => setControlElement(fulfillmentControlId('dine-in'), element)"
            :class="['fulfillment-button', { 'is-selected': fulfillmentMode === 'dine-in' }]"
            type="button"
            :disabled="!!completedOrderId"
            @click="setFulfillmentMode('dine-in')"
          >
            內用
          </button>
          <button
            :ref="element => setControlElement(fulfillmentControlId('takeout'), element)"
            :class="['fulfillment-button', { 'is-selected': fulfillmentMode === 'takeout' }]"
            type="button"
            :disabled="!!completedOrderId"
            @click="setFulfillmentMode('takeout')"
          >
            外帶
          </button>
        </div>
      </section>
      <button class="confirm-button" type="button" :disabled="cart.lines.length === 0 || !fulfillmentMode || !!completedOrderId" @click="confirmOrder">
        {{ completedOrderId ? '訂單已送出' : '送出訂單' }}
      </button>
      <p v-if="orderStatus" class="order-status">
        {{ orderStatus }}
      </p>
      <section v-if="completedOrderId" class="order-completion" role="status" aria-live="polite">
        <div class="i-solar:check-circle-bold-duotone" aria-hidden="true" />
        <div>
          <strong>訂單已送出</strong>
          <p>訂單編號：{{ completedOrderId }}</p>
        </div>
      </section>
    </aside>

    <div v-if="showAgentCursor" class="agent-cursor" :style="{ left: `${cursorPosition.x}px`, top: `${cursorPosition.y}px` }" aria-hidden="true">
      ✦
    </div>
  </main>
</template>
