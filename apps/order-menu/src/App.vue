<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'

import type { CheckoutSnapshot } from './domain/checkout-flow'
import type { CartSnapshot, FulfillmentMode, MenuItem, Selection, SubmissionEnvironment, SubmissionStatus, SubmittedOrder } from './domain/order-machine'
import type { PaymentMethod, PaymentStatus } from './pos-bridge'
import type { AgentAction, MenuToolName, RecommendationPresentation } from './webmcp'

import { errorMessageFrom } from '@moeru/std'
import { computed, nextTick, onMounted, onUnmounted, reactive, shallowRef, watch } from 'vue'

import CheckoutInvoice from './components/CheckoutInvoice.vue'
import CheckoutMembership from './components/CheckoutMembership.vue'
import CheckoutPayment from './components/CheckoutPayment.vue'
import CheckoutTaxId from './components/CheckoutTaxId.vue'
import MenuCatalogState from './components/MenuCatalogState.vue'
import MenuItemCard from './components/menuItemCard.vue'
import MenuItemDialog from './components/MenuItemDialog.vue'
import MenuRecommendationRail from './components/MenuRecommendationRail.vue'
import OrderReview from './components/OrderReview.vue'
import OrderSummaryBar from './components/OrderSummaryBar.vue'

import { usePosCatalog } from './composables/usePosCatalog'
import { beginCheckout, chooseInvoiceMethod, confirmTaxId, requestTaxId, returnToInvoice, setTaxIdDraft, skipMembership } from './domain/checkout-flow'
import { defaultOptionsFor } from './domain/order-machine'
import { resolveExpectedHostOrigin } from './embedding-origin'
import { createPayment, createPosBridgeGateway, getPayment } from './pos-bridge'
import { createMenuToolRuntime } from './webmcp'

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
const submissionStatus = shallowRef<SubmissionStatus>()
const completedOrderId = shallowRef<string>()
const completedOrderEnvironment = shallowRef<SubmissionEnvironment>()
const fulfillmentMode = shallowRef<FulfillmentMode>()
const addingItemId = shallowRef<string>()
const recommendations = shallowRef<RecommendationPresentation>()
const recommendationsCollapsed = shallowRef(false)
const activeCategory = shallowRef<string>()
const recommendedCategoryId = '__recommendations__'
const comparedItemIds = shallowRef<string[]>([])
const selectedItemId = shallowRef<string>()
const orderReviewOpen = shallowRef(false)
const checkout = shallowRef<CheckoutSnapshot>()
const paymentMethod = shallowRef<PaymentMethod>()
const paymentStatus = shallowRef<PaymentStatus>()
const paymentError = shallowRef<string>()
const cardElements = new Map<string, HTMLElement>()
const controlElements = new Map<string, HTMLElement>()
let cartUpdateTimer: ReturnType<typeof setTimeout> | undefined
let checkoutTimeoutTimer: ReturnType<typeof setTimeout> | undefined
let paymentPollTimer: ReturnType<typeof setTimeout> | undefined
let paymentAttempt = 0
let unregisterNativeWebMcp: (() => void) | undefined
let nativeWebMcpUnmounted = false
const quantities = reactive<Record<string, number>>({})
const expandedCustomizations = reactive<Record<string, boolean>>({})
const selectedOptionsByItem = reactive<Record<string, Record<string, string>>>({})
const { catalog: posCatalog, error: catalogError, load: loadPosCatalog, state: catalogState } = usePosCatalog(import.meta.env.VITE_ORDER_MENU_SERVER_URL)
const menuItems = computed(() => posCatalog.value?.items ?? [])

const categories = computed(() => [...new Set(menuItems.value.map(item => item.category))])
const recommendedItems = computed(() => recommendations.value
  ? recommendations.value.itemIds
      .map(itemId => menuItems.value.find(item => item.id === itemId))
      .filter((item): item is MenuItem => item !== undefined)
  : [])
const visibleMenuItems = computed(() => {
  if (activeCategory.value === recommendedCategoryId)
    return recommendedItems.value
  return activeCategory.value ? menuItems.value.filter(item => item.category === activeCategory.value) : menuItems.value
})
const activeCategoryLabel = computed(() => activeCategory.value === recommendedCategoryId ? '推薦餐點' : activeCategory.value ?? '全部餐點')
const selectedItem = computed(() => menuItems.value.find(item => item.id === selectedItemId.value))
const comparedItems = computed(() => comparedItemIds.value.map(id => menuItems.value.find(item => item.id === id)).filter((item): item is MenuItem => item !== undefined))
const isAgentOperating = computed(() => agentOperationCount.value > 0)
const reviewLines = computed(() => cart.value.lines.map(line => ({
  id: line.id,
  name: line.name,
  options: optionLabel(line),
  quantity: line.quantity,
  total: currency(line.unitPrice * line.quantity),
})))
const completedOrderLabel = computed(() => completedOrderEnvironment.value === 'live'
  ? '訂單已送往 POS'
  : '測試訂單已確認')

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
  checkout: {
    assertCanRestart,
    cancel: cancelCheckout,
    chooseInvoice,
    confirmTaxId: confirmTaxIdNumber,
    requestTaxId: openTaxId,
    restart: restartOrder,
    selectPayment,
    setTaxId: updateTaxId,
    skipMembership: skipCheckoutMembership,
    start: startCheckout,
  },
  gateway: createPosBridgeGateway(import.meta.env.VITE_ORDER_MENU_SERVER_URL),
  menu: [],
  onAction: animateAction,
  onAgentOperationStart: () => agentOperationCount.value++,
  onAgentOperationEnd: () => agentOperationCount.value = Math.max(0, agentOperationCount.value - 1),
  onCartChange: (nextCart) => {
    cart.value = nextCart
    if (submissionStatus.value !== 'accepted') {
      submissionStatus.value = undefined
      orderStatus.value = undefined
    }
    cartUpdated.value = false
    void nextTick(() => {
      cartUpdated.value = true
      if (cartUpdateTimer)
        clearTimeout(cartUpdateTimer)
      cartUpdateTimer = setTimeout(() => cartUpdated.value = false, 720)
    })
  },
  onMenuSelection: itemId => itemId && openItem(itemId),
  onFulfillmentChange: mode => fulfillmentMode.value = mode,
  onSelectionChange: syncSelection,
  onOrderConfirmed: handleOrderConfirmed,
  onOrderSubmission: handleOrderSubmission,
  onRecommendationsChange: (presentation) => {
    recommendations.value = presentation
    recommendationsCollapsed.value = false
    activeCategory.value = recommendedCategoryId
  },
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
  completedOrderEnvironment.value = order.receipt.environment
  orderStatus.value = order.receipt.customerMessage
  checkout.value = undefined
  orderReviewOpen.value = true
  notifyHost('completed', {
    environment: order.receipt.environment,
    fulfillmentMode: order.cart.fulfillmentMode!,
    id: order.id,
    itemCount: order.cart.itemCount,
    ...(order.receipt.posOrderId ? { posOrderId: order.receipt.posOrderId } : {}),
    status: 'accepted',
    total: order.cart.total,
  })
}

function handleOrderSubmission(order: SubmittedOrder) {
  submissionStatus.value = order.receipt.status
  orderStatus.value = order.receipt.customerMessage
}

function notifyHost(type: 'activity' | 'completed', orderResult?: {
  environment: SubmissionEnvironment
  fulfillmentMode: FulfillmentMode
  id: string
  itemCount: number
  posOrderId?: string
  status: 'accepted'
  total: number
}) {
  if (window.parent === window)
    return

  // The host validates both the active iframe Window and this service origin.
  // The completion payload carries only the non-personal accepted-order result
  // needed for the kiosk lifecycle; it never carries POS credentials or cart lines.
  if (import.meta.env.DEV)
    console.info('[DEBUG-feedback-lifecycle] menu sent lifecycle event', { type })
  window.parent.postMessage({ source: 'airi-interaction-lifecycle', type, orderResult }, { targetOrigin: '*' })
}

function notifyActivity() {
  cursorTargetId.value = undefined
  showAgentCursor.value = false
  notifyHost('activity')
}

function collapseRecommendations() {
  if (!recommendations.value || recommendationsCollapsed.value)
    return

  recommendationsCollapsed.value = true
}

function handleMenuPointerDown(event: PointerEvent) {
  // The recommendation rail is deliberately non-blocking. Browsing the
  // original menu compacts it, while choosing a recommended item keeps the
  // collection available for a second choice.
  if (event.target instanceof Element && event.target.closest('[data-recommendation-rail]'))
    return

  collapseRecommendations()
  notifyActivity()
}

function addRecommendedItem(itemId: string) {
  // Recommendation cards are excluded from the broad pointer handler so they
  // do not collapse before the customer can compare them. They still count as
  // a real customer action and must refresh the Kiosk session.
  notifyActivity()
  openItem(itemId)
}

function expandRecommendations() {
  recommendationsCollapsed.value = false
  notifyActivity()
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

async function updateCartLineQuantity(lineId: string, quantity: number) {
  await invoke('cart_set_line_quantity', { lineId, quantity }, { animate: false })
}

async function removeCartLine(lineId: string) {
  await invoke('cart_remove_item', { lineId }, { animate: false })
}

function startCheckout() {
  if (cart.value.lines.length === 0)
    throw new Error('Cart is empty.')
  if (!fulfillmentMode.value)
    throw new Error('Choose dine-in or take-out before starting checkout.')
  if (completedOrderId.value)
    throw new Error('This order has already been completed.')

  selectedItemId.value = undefined
  orderReviewOpen.value = false
  resetPaymentAttempt()
  checkout.value = beginCheckout()
  return checkout.value
}

function skipCheckoutMembership() {
  if (!checkout.value)
    throw new Error('Checkout has not started.')

  checkout.value = skipMembership(checkout.value)
  return checkout.value
}

function chooseInvoice(method: 'carrier' | 'donation') {
  if (!checkout.value)
    throw new Error('Checkout has not started.')
  checkout.value = chooseInvoiceMethod(checkout.value, method)
  return checkout.value
}

function openTaxId() {
  if (!checkout.value)
    throw new Error('Checkout has not started.')
  checkout.value = requestTaxId(checkout.value)
  return checkout.value
}

function updateTaxId(taxId: string) {
  if (!checkout.value)
    throw new Error('Checkout has not started.')
  checkout.value = setTaxIdDraft(checkout.value, taxId)
  return checkout.value
}

function confirmTaxIdNumber() {
  if (!checkout.value)
    throw new Error('Checkout has not started.')
  checkout.value = confirmTaxId(checkout.value)
  return checkout.value
}

function backToInvoice() {
  if (!checkout.value)
    return
  checkout.value = returnToInvoice(checkout.value)
}

function returnToOrderReview() {
  resetPaymentAttempt()
  checkout.value = undefined
  orderReviewOpen.value = true
}

function assertCanRestart() {
  if (paymentStatus.value === 'pending' || paymentStatus.value === 'uncertain')
    throw new Error('Cannot restart while a payment is pending or awaiting reconciliation.')
}

function cancelCheckout() {
  if (!checkout.value)
    throw new Error('Checkout has not started.')
  assertCanRestart()
  returnToOrderReview()
}

function restartOrder() {
  resetPaymentAttempt()
  checkout.value = undefined
  orderReviewOpen.value = false
  selectedItemId.value = undefined
}

function resetPaymentAttempt() {
  paymentAttempt++
  if (paymentPollTimer)
    clearTimeout(paymentPollTimer)
  paymentPollTimer = undefined
  paymentMethod.value = undefined
  paymentStatus.value = undefined
  paymentError.value = undefined
}

async function submitAuthorizedPayment(paymentId: string, attempt: number) {
  if (attempt !== paymentAttempt)
    return undefined
  const order = await runtime.confirmPaidOrder(paymentId)
  if (attempt !== paymentAttempt)
    return undefined
  if (order.receipt.status === 'rejected') {
    paymentStatus.value = 'rejected'
    paymentError.value = order.receipt.customerMessage
  }
  else if (order.receipt.status === 'uncertain') {
    paymentStatus.value = 'uncertain'
    paymentError.value = order.receipt.customerMessage
  }
  return order
}

async function waitForPayment(paymentId: string, attempt: number, deadline: number) {
  if (attempt !== paymentAttempt)
    return
  try {
    const payment = await getPayment(import.meta.env.VITE_ORDER_MENU_SERVER_URL, paymentId)
    if (attempt !== paymentAttempt)
      return
    paymentStatus.value = payment.status
    if (payment.status === 'authorized') {
      await submitAuthorizedPayment(payment.id, attempt)
      return
    }
    if (payment.status === 'rejected') {
      paymentError.value = '付款未完成，請重新選擇付款方式。'
      return
    }
    if (payment.status === 'uncertain') {
      paymentError.value = '付款結果尚未確認。為避免重複扣款，此筆交易已鎖定。'
      return
    }
    if (Date.now() >= deadline) {
      paymentMethod.value = undefined
      paymentStatus.value = undefined
      paymentError.value = '支付終端等候逾時，請重新選擇付款方式。'
      return
    }
    paymentPollTimer = setTimeout(() => void waitForPayment(paymentId, attempt, deadline), 1_000)
  }
  catch (error) {
    paymentStatus.value = 'uncertain'
    paymentError.value = errorMessageFrom(error) ?? '付款結果無法確認，請由門市人員查詢。'
  }
}

async function selectPayment(method: PaymentMethod) {
  if (checkout.value?.stage !== 'payment')
    throw new Error('A payment method can only be selected during payment.')
  if (paymentStatus.value === 'pending' || paymentStatus.value === 'uncertain')
    throw new Error('This payment attempt is already pending or awaiting reconciliation.')

  resetPaymentAttempt()
  const attempt = paymentAttempt
  let terminalAuthorized = false
  paymentMethod.value = method
  paymentStatus.value = 'pending'
  try {
    const payment = await createPayment(import.meta.env.VITE_ORDER_MENU_SERVER_URL, cart.value.total, method)
    if (attempt !== paymentAttempt)
      return { customerMessage: '付款操作已取消。', status: 'cancelled' }
    terminalAuthorized = payment.status === 'authorized'
    paymentStatus.value = payment.status
    const order = payment.status === 'authorized'
      ? await submitAuthorizedPayment(payment.id, attempt)
      : undefined
    if (payment.status === 'pending')
      await waitForPayment(payment.id, attempt, Date.now() + 30_000)
    else if (payment.status === 'rejected')
      paymentError.value = '付款未完成，請重新選擇付款方式。'
    else if (payment.status === 'uncertain')
      paymentError.value = '付款結果尚未確認。為避免重複扣款，此筆交易已鎖定。'
    return {
      customerMessage: payment.status === 'authorized'
        ? order?.receipt.customerMessage ?? '付款終端已授權，系統正在自動確認 POS 訂單。'
        : payment.status === 'pending'
          ? '已啟動支付終端，正在等待顧客完成付款。'
          : paymentError.value ?? '付款未完成。',
      status: paymentStatus.value ?? payment.status,
    }
  }
  catch (error) {
    if (attempt !== paymentAttempt)
      return { customerMessage: '付款操作已取消。', status: 'cancelled' }
    if (terminalAuthorized) {
      paymentStatus.value = 'uncertain'
      paymentError.value = '付款已授權，但訂單結果無法確認。為避免重複扣款，此筆交易已鎖定。'
      return { customerMessage: paymentError.value, status: 'uncertain' }
    }
    paymentMethod.value = undefined
    paymentStatus.value = undefined
    paymentError.value = errorMessageFrom(error) ?? '無法啟動付款終端，請稍後再試。'
    return { customerMessage: paymentError.value, status: 'rejected' }
  }
}

watch(checkout, (nextCheckout) => {
  if (checkoutTimeoutTimer)
    clearTimeout(checkoutTimeoutTimer)
  if (!nextCheckout)
    return

  checkoutTimeoutTimer = setTimeout(() => {
    if (checkout.value?.stage !== nextCheckout.stage)
      return
    if (nextCheckout.stage === 'membership')
      skipCheckoutMembership()
    else if (nextCheckout.stage === 'invoice')
      chooseInvoice(nextCheckout.carrierCode ? 'carrier' : 'donation')
    else if (nextCheckout.stage === 'tax-id')
      chooseInvoice('donation')
    else if (!paymentMethod.value)
      returnToOrderReview()
  }, 30_000)
})

async function setFulfillmentMode(mode: FulfillmentMode) {
  await invoke('order_set_fulfillment', { mode }, { animate: false })
}

async function addItem(itemId: string) {
  const item = menuItems.value.find(candidate => candidate.id === itemId)
  if (!item || addingItemId.value)
    return

  addingItemId.value = itemId
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

function openItem(itemId: string) {
  const item = menuItems.value.find(candidate => candidate.id === itemId)
  if (!item || item.available === false)
    return
  orderReviewOpen.value = false
  selectedItemId.value = itemId
}

async function addSelectedItem(itemId: string) {
  await addItem(itemId)
  selectedItemId.value = undefined
}

function toggleComparedItem(itemId: string) {
  comparedItemIds.value = comparedItemIds.value.includes(itemId)
    ? comparedItemIds.value.filter(candidate => candidate !== itemId)
    : [...comparedItemIds.value, itemId].slice(-2)
}

function optionLabel(line: CartSnapshot['lines'][number]) {
  const item = menuItems.value.find(candidate => candidate.id === line.itemId)
  return Object.entries(line.options)
    .map(([groupId, valueId]) => item?.optionGroups.find(group => group.id === groupId)?.values.find(value => value.id === valueId)?.label)
    .filter((label): label is string => !!label)
    .join('、')
}

async function registerNativeWebMcp() {
  nativeWebMcpUnmounted = false
  if (!expectedAiriOrigin)
    return

  try {
    const unregister = await runtime.registerNativeWebMcp({ exposedTo: [expectedAiriOrigin] })
    if (!unregister)
      return

    // Registration is asynchronous. If Vite replaces this component while
    // it is pending, release the tools immediately instead of leaving their
    // names registered in the document.
    if (nativeWebMcpUnmounted)
      unregister()
    else
      unregisterNativeWebMcp = unregister
  }
  catch (error) {
    console.error('[order-menu] failed to register native WebMCP tools:', errorMessageFrom(error))
  }
}

async function loadCatalog() {
  const catalog = await loadPosCatalog()
  if (!catalog)
    return

  runtime.setMenu(catalog.items, catalog.revision)
  for (const item of catalog.items) {
    quantities[item.id] = 1
    expandedCustomizations[item.id] = false
    selectedOptionsByItem[item.id] = defaultOptionsFor(item)
  }
  await registerNativeWebMcp()
}

onMounted(() => {
  void loadCatalog()
})

onUnmounted(() => {
  nativeWebMcpUnmounted = true
  unregisterNativeWebMcp?.()
  unregisterNativeWebMcp = undefined
  runtime.disposeNativeWebMcp()
  if (cartUpdateTimer)
    clearTimeout(cartUpdateTimer)
  if (checkoutTimeoutTimer)
    clearTimeout(checkoutTimeoutTimer)
  if (paymentPollTimer)
    clearTimeout(paymentPollTimer)
})
</script>

<template>
  <MenuCatalogState
    v-if="catalogState !== 'ready'"
    :error="catalogError"
    :state="catalogState"
    @retry="loadCatalog"
  />
  <main v-else class="menu-app" @pointerdown="handleMenuPointerDown">
    <output :class="['agent-status', { 'is-active': isAgentOperating }]" aria-live="polite">
      <span class="status-dot" />
      <span>{{ isAgentOperating ? '正在為你整理餐點' : '菜單可直接點選' }}</span>
      <small v-if="isAgentOperating">{{ action.label }}</small>
    </output>

    <CheckoutMembership
      v-if="checkout?.stage === 'membership'"
      :total="currency(cart.total)"
      @back="returnToOrderReview"
      @skip="skipCheckoutMembership"
    />
    <CheckoutInvoice
      v-else-if="checkout?.stage === 'invoice'"
      :carrier-code="checkout.carrierCode"
      :total="currency(cart.total)"
      @back="returnToOrderReview"
      @carrier="chooseInvoice('carrier')"
      @donation="chooseInvoice('donation')"
      @tax-id="openTaxId"
    />
    <CheckoutTaxId
      v-else-if="checkout?.stage === 'tax-id'"
      :tax-id="checkout.taxId ?? ''"
      @back="backToInvoice"
      @confirm="confirmTaxIdNumber"
      @update-tax-id="updateTaxId"
    />
    <CheckoutPayment
      v-else-if="checkout?.stage === 'payment'"
      :error="paymentError"
      :method="paymentMethod"
      :status="paymentStatus"
      :total="currency(cart.total)"
      @back="returnToOrderReview"
      @select="selectPayment"
    />
    <OrderReview
      v-else-if="orderReviewOpen"
      :completed="!!completedOrderId"
      :completed-label="completedOrderLabel"
      :fulfillment-mode="fulfillmentMode"
      :lines="reviewLines"
      :order-status="orderStatus"
      :submission-status="submissionStatus"
      :total="currency(cart.total)"
      @back="orderReviewOpen = false"
      @checkout="startCheckout"
      @remove="removeCartLine"
      @set-fulfillment="setFulfillmentMode"
      @update-quantity="updateCartLineQuantity"
    />

    <template v-else>
      <div class="menu-browser">
        <nav class="category-navigation" aria-label="餐點分類">
          <button :class="['category-button', { 'is-selected': activeCategory === recommendedCategoryId }]" type="button" :disabled="recommendedItems.length === 0" @click="activeCategory = recommendedCategoryId">
            推薦餐點 <span>{{ recommendedItems.length }}</span>
          </button>
          <button :class="['category-button', { 'is-selected': !activeCategory }]" type="button" @click="activeCategory = undefined">
            全部 <span>{{ menuItems.length }}</span>
          </button>
          <button v-for="category in categories" :key="category" :class="['category-button', { 'is-selected': activeCategory === category }]" type="button" @click="activeCategory = category">
            {{ category }} <span>{{ menuItems.filter(item => item.category === category).length }}</span>
          </button>
        </nav>
        <section class="menu-section">
          <h2>{{ activeCategoryLabel }}</h2>
          <MenuRecommendationRail
            v-if="activeCategory === recommendedCategoryId && recommendations && recommendedItems.length > 0"
            :adding-item-id="addingItemId"
            :collapsed="recommendationsCollapsed"
            :items="recommendedItems"
            :presentation="recommendations"
            @select="addRecommendedItem"
            @expand="expandRecommendations"
          />
          <div class="menu-grid">
            <div v-for="item in visibleMenuItems" :key="item.id" :ref="element => setCardElement(item.id, element)">
              <MenuItemCard
                :is-compared="comparedItemIds.includes(item.id)"
                :is-targeted="cursorTargetId === item.id"
                :item="item"
                @compare="toggleComparedItem"
                @select="openItem"
              />
            </div>
          </div>
        </section>
      </div>

      <section v-if="comparedItems.length > 0" class="comparison-workspace" aria-label="正在比較的餐點">
        <div class="comparison-heading">
          <h2>正在比較</h2><button type="button" @click="comparedItemIds = []">
            收起比較
          </button>
        </div>
        <div class="comparison-grid">
          <span>品項</span><strong v-for="item in comparedItems" :key="item.id">{{ item.name }}</strong><span>價格</span><span v-for="item in comparedItems" :key="`${item.id}:price`">{{ currency(item.price) }}</span><span>特色</span><span v-for="item in comparedItems" :key="`${item.id}:description`">{{ item.description }}</span><span>可調整</span><span v-for="item in comparedItems" :key="`${item.id}:options`">{{ item.optionGroups.map(group => group.label).join('、') || '無' }}</span><span /><button v-for="item in comparedItems" :key="`${item.id}:select`" type="button" @click="openItem(item.id)">
            看{{ item.name }}
          </button>
        </div>
      </section>

      <MenuItemDialog :item="selectedItem" :quantity="selectedItem ? quantities[selectedItem.id] ?? 1 : 1" :selected-options="selectedItem ? selectedOptionsByItem[selectedItem.id] ?? {} : {}" @add="addSelectedItem" @close="selectedItemId = undefined" @update-option="(groupId, valueId) => selectedItem && updateOption(selectedItem.id, groupId, valueId)" @update-quantity="quantity => selectedItem && updateQuantity(selectedItem.id, quantity)" />

      <div :ref="element => setCardElement('cart', element)" :class="['order-summary-container', { 'is-updated': cartUpdated, 'is-targeted': cursorTargetId === 'cart' }]">
        <OrderSummaryBar :item-count="cart.itemCount" :total="currency(cart.total)" @open="orderReviewOpen = true" />
      </div>
    </template>

    <div v-if="showAgentCursor" class="agent-cursor" :style="{ left: `${cursorPosition.x}px`, top: `${cursorPosition.y}px` }" aria-hidden="true">
      ✦
    </div>
  </main>
</template>
