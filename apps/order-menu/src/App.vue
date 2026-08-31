<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'

import type { CartSnapshot } from './domain/order-machine'
import type { AgentAction, MenuBridgeCall, MenuBridgeResult, MenuToolName } from './webmcp'

import { errorMessageFrom } from '@moeru/std'
import { computed, nextTick, onMounted, onUnmounted, shallowRef } from 'vue'

import { menu } from './domain/order-machine'
import { createMenuToolRuntime } from './webmcp'

const expectedAiriOrigin = import.meta.env.VITE_AIRI_ORIGIN ?? 'http://localhost:5173'
const selectedItemId = shallowRef<string>()
const action = shallowRef<AgentAction>({ label: '等待 AIRI 或使用者選擇餐點' })
const cart = shallowRef<CartSnapshot>({ lines: [], total: 0, itemCount: 0 })
const activeSelection = shallowRef<Record<string, string>>({})
const cursorTargetId = shallowRef<string>()
const cursorPosition = shallowRef({ x: 44, y: 14 })
const orderStatus = shallowRef<string>()
const cardElements = new Map<string, HTMLElement>()

const selectedItem = computed(() => menu.find(item => item.id === selectedItemId.value))
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
}

async function animateAction(nextAction: AgentAction) {
  action.value = nextAction
  cursorTargetId.value = nextAction.targetId
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
  onMenuSelection: (itemId) => {
    selectedItemId.value = itemId
    activeSelection.value = {}
  },
})

async function invoke(name: MenuToolName, args: Record<string, unknown> = {}) {
  const result = await runtime.invoke(name, args)
  if (name === 'menu_select_item' || name === 'menu_set_item_option' || name === 'menu_set_quantity') {
    const selection = (result as { selection?: { options: Record<string, string> } }).selection
    if (selection)
      activeSelection.value = selection.options
  }
  if (name === 'order_confirm')
    orderStatus.value = '模擬訂單已建立，尚未送往 POS。'
  return result
}

async function chooseItem(itemId: string) {
  await invoke('menu_select_item', { itemId })
}

async function chooseOption(groupId: string, valueId: string) {
  await invoke('menu_set_item_option', { groupId, valueId })
}

async function addSelection() {
  await invoke('cart_add_item')
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
        <p class="eyebrow">
          AIRI ORDERING DEMO · 周氏蝦捲風味模擬
        </p>
        <h1>府城小吃菜單</h1>
        <p class="menu-note">
          品項參考公開資料；價格與份量為 WebMCP 示範設定。
        </p>
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
        <article
          v-for="item in section.items"
          :key="item.id"
          :ref="element => setCardElement(item.id, element)"
          :class="['menu-card', { 'is-selected': selectedItemId === item.id, 'is-targeted': cursorTargetId === item.id }]"
        >
          <img :src="item.imageUrl" :alt="item.name">
          <div class="menu-card-body">
            <div>
              <h3>{{ item.name }}</h3>
              <p>{{ item.description }}</p>
            </div>
            <strong>{{ currency(item.price) }}</strong>
          </div>
          <button type="button" @click="chooseItem(item.id)">
            選擇餐點
          </button>
        </article>
      </div>
    </section>

    <section v-if="selectedItem" :ref="element => setCardElement('selection', element)" class="selection-panel">
      <div>
        <p class="eyebrow">
          正在設定
        </p>
        <h2>{{ selectedItem.name }}</h2>
      </div>
      <div v-for="group in selectedItem.optionGroups" :key="group.id" class="option-group">
        <span>{{ group.label }}</span>
        <div class="option-list">
          <button
            v-for="option in group.values"
            :key="option.id"
            type="button"
            :class="{ selected: activeSelection[group.id] === option.id }"
            @click="chooseOption(group.id, option.id)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
      <button class="add-button" type="button" @click="addSelection">
        加入購物車
      </button>
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
