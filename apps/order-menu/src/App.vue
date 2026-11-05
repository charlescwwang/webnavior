<script setup lang="ts">
import type { InteractionLifecycleMessage, InteractiveServiceOrderResult } from '@proj-airi/stage-shared/interaction-lifecycle'
import type { OrderingContext } from '@proj-airi/stage-shared/kiosk-service-mode'
import type { ComponentPublicInstance } from 'vue'

import type { ContinuationAccess } from './continuation'
import type { CheckoutSnapshot } from './domain/checkout-flow'
import type { CartSnapshot, FulfillmentMode, MenuItem, Selection, SubmissionStatus, SubmittedOrder } from './domain/order-machine'
import type { PaymentMethod, PaymentStatus } from './pos-bridge'
import type { AgentAction, MenuPresentationToolName, MenuToolName, RecommendationPresentation } from './webmcp'

import { errorMessageFrom } from '@moeru/std'
import { formatOrderingPrice } from '@proj-airi/stage-shared/kiosk-conversation'
import { computed, nextTick, onMounted, onUnmounted, reactive, shallowRef, watch } from 'vue'

import CheckoutInvoice from './components/CheckoutInvoice.vue'
import CheckoutPayment from './components/CheckoutPayment.vue'
import CheckoutTaxId from './components/CheckoutTaxId.vue'
import MenuCatalogState from './components/MenuCatalogState.vue'
import MenuItemCard from './components/menuItemCard.vue'
import MenuItemDialog from './components/MenuItemDialog.vue'
import MenuPresentationSkeleton from './components/MenuPresentationSkeleton.vue'
import MenuPresentationSubjects from './components/MenuPresentationSubjects.vue'
import MenuRecommendationRail from './components/MenuRecommendationRail.vue'
import OrderReview from './components/OrderReview.vue'
import OrderSummaryBar from './components/OrderSummaryBar.vue'

import { orderingMessages } from '../../../packages/i18n/src/orderingMessages'
import { usePaymentSelectionCountdown } from './composables/usePaymentSelectionCountdown'
import { usePosCatalog } from './composables/usePosCatalog'
import { continuationUrl } from './continuation'
import { beginCheckout, chooseInvoiceMethod, confirmInvoiceDetails, confirmInvoiceDraft, confirmTaxId, requestTaxId, returnToPreviousStep, setInvoiceDraft, setTaxIdDraft, skipMembership } from './domain/checkout-flow'
import { defaultOptionsFor, ItemSelectionError } from './domain/order-machine'
import { resolveExpectedHostOrigin } from './embedding-origin'
import { connectInteractiveService } from './interactiveService'
import { scrollViewport } from './menuScroll'
import { createPayment, createPosBridgeGateway, getPayment, loadOrderingContext, paymentLabels, testPaymentMethods } from './pos-bridge'
import { createMenuToolRuntime } from './webmcp'

// A deployment can lock the service to one approved host. Otherwise, a page
// embedded by AIRI reads the browser-provided parent referrer origin, so local
// ports and kiosk domains work without a separate startup command.
const expectedAiriOrigin = resolveExpectedHostOrigin({
  configuredOrigin: import.meta.env.VITE_AIRI_ORIGIN,
  isEmbedded: window.parent !== window,
  referrer: document.referrer,
})
const cart = shallowRef<CartSnapshot>({ fulfillmentMode: undefined, lines: [], total: 0, itemCount: 0 })
const cursorTargetId = shallowRef<string>()
const cursorPosition = shallowRef({ x: 44, y: 14 })
const cursorTravelMs = shallowRef(700)
const cursorPhase = shallowRef<'moving' | 'pressing' | 'resting'>('resting')
const showAgentCursor = shallowRef(false)
const cartUpdated = shallowRef(false)
const orderStatus = shallowRef<string>()
const submissionStatus = shallowRef<SubmissionStatus>()
const completedOrderId = shallowRef<string>()
const completedOrder = shallowRef<SubmittedOrder>()
const fulfillmentMode = shallowRef<FulfillmentMode>()
const addingItemId = shallowRef<string>()
const recommendations = shallowRef<RecommendationPresentation>()
const menuPresentationLoadingTools = shallowRef<MenuPresentationToolName[]>([])
const selectedPresentationSubjectId = shallowRef<string>()
const activeCategory = shallowRef<string>()
const recommendedCategoryId = '__recommendations__'
const selectedItemId = shallowRef<string>()
const orderReviewOpen = shallowRef(false)
const menuInteractionMessage = shallowRef<string>()
const checkout = shallowRef<CheckoutSnapshot>()
const orderingContext = shallowRef<OrderingContext>()
const tableSubmitting = shallowRef(false)
const paymentMethod = shallowRef<PaymentMethod>()
const paymentStatus = shallowRef<PaymentStatus>()
const paymentError = shallowRef<string>()
const receiptAccess = shallowRef<ContinuationAccess>()
const receiptUrl = computed(() => receiptAccess.value ? continuationUrl(receiptAccess.value, import.meta.env.VITE_ORDER_MENU_PUBLIC_URL || window.location.href) : undefined)
let checkoutRevision = 0
// Synchronous observation preserves every checkout/payment write, including
// a change that is undone before the next System One request arrives.
watch([checkout, paymentMethod, paymentStatus], () => {
  checkoutRevision += 1
}, { flush: 'sync' })
const cardElements = new Map<string, HTMLElement>()
const controlElements = new Map<string, HTMLElement>()
let cartUpdateTimer: ReturnType<typeof setTimeout> | undefined
let paymentPollTimer: ReturnType<typeof setTimeout> | undefined
let paymentAttempt = 0
let disconnectService: (() => void) | undefined
let menuUnmounted = false
const quantities = reactive<Record<string, number>>({})
const expandedCustomizations = reactive<Record<string, boolean>>({})
const selectedOptionsByItem = reactive<Record<string, Record<string, string>>>({})
const { catalog: posCatalog, error: catalogError, load: loadPosCatalog, state: catalogState } = usePosCatalog(import.meta.env.VITE_ORDER_MENU_SERVER_URL)
const menuItems = computed(() => posCatalog.value?.items ?? [])
const menuPresentationLoadingTool = computed(() => menuPresentationLoadingTools.value.at(-1))
const menuPresentationLoading = computed(() => menuPresentationLoadingTool.value !== undefined)
const menuPresentationLoadingLabel = computed(() => menuPresentationLoadingTool.value === 'menu_recommend' || menuPresentationLoadingTool.value === 'menu_show_recommendations'
  ? '正在找推薦餐點…'
  : '正在整理相關餐點…')

const categories = computed(() => [...new Set(menuItems.value.map(item => item.category))])
const presentationSubjects = computed(() => recommendations.value?.kind === 'query-results'
  ? recommendations.value.subjects ?? []
  : [])
const recommendedItemIds = computed(() => {
  const presentation = recommendations.value
  if (!presentation)
    return []
  const selectedSubject = presentationSubjects.value.find(subject => subject.id === selectedPresentationSubjectId.value)
  if (selectedSubject)
    return selectedSubject.itemIds
  // A single subject is a browse result, so retain all of it rather than
  // silently applying the compact multi-subject preview limit.
  if (presentationSubjects.value.length === 1)
    return presentationSubjects.value[0]!.itemIds
  return presentation.itemIds
})
const recommendedItems = computed(() => recommendations.value
  ? recommendedItemIds.value
      .map(itemId => menuItems.value.find(item => item.id === itemId))
      .filter((item): item is MenuItem => item !== undefined)
  : [])
const presentationItemCount = computed(() => new Set(presentationSubjects.value.flatMap(subject => subject.itemIds)).size || recommendedItems.value.length)
const visibleMenuItems = computed(() => {
  if (activeCategory.value === recommendedCategoryId)
    return recommendedItems.value
  return activeCategory.value ? menuItems.value.filter(item => item.category === activeCategory.value) : menuItems.value
})
const activeCategoryLabel = computed(() => {
  if (menuPresentationLoading.value)
    return menuPresentationLoadingLabel.value
  if (activeCategory.value !== recommendedCategoryId)
    return activeCategory.value ?? '全部餐點'
  return recommendations.value?.title ?? (recommendations.value?.kind === 'query-results' ? '相關餐點' : '推薦餐點')
})
const presentationContext = computed(() => {
  if (activeCategory.value !== recommendedCategoryId || recommendations.value?.kind !== 'query-results')
    return undefined
  const selectedSubject = presentationSubjects.value.find(subject => subject.id === selectedPresentationSubjectId.value)
  if (selectedSubject)
    return `「${selectedSubject.label}」共有 ${selectedSubject.itemIds.length} 項`
  return presentationSubjects.value.length > 1
    ? `已保留 ${presentationSubjects.value.length} 個需求方向，先顯示 ${visibleMenuItems.value.length} 項`
    : `已依顧客提到的品項篩選，共 ${visibleMenuItems.value.length} 項`
})
const presentationNavigationLabel = computed(() => recommendations.value?.kind === 'query-results' ? '相關餐點' : '推薦餐點')
const selectedItem = computed(() => menuItems.value.find(item => item.id === selectedItemId.value))
const reviewLines = computed(() => cart.value.lines.map(line => ({
  id: line.id,
  name: line.name,
  options: optionLabel(line),
  quantity: line.quantity,
  total: currency(line.unitPrice * line.quantity),
})))
const cartSummaryLines = computed(() => cart.value.lines.map((line) => {
  const menuItem = menuItems.value.find(item => item.id === line.itemId)
  return {
    id: line.id,
    imageUrl: menuItem?.imageUrl,
    name: line.name,
    quantity: line.quantity,
    symbol: menuItem?.symbol,
  }
}))
const completedOrderLabel = '訂單已確認'

function currency(amount: number) {
  return formatOrderingPrice(amount)
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

// NOTICE: Agent movement is intentionally slower than ordinary UI animation.
// Customers need enough time to see the target, understand the intended action,
// and observe a press before state changes; otherwise automation feels erratic.
const agentCursorTiming = {
  dwellMs: 520,
  maximumTravelMs: 1_150,
  minimumTravelMs: 650,
  pressMs: 180,
  scrollSettleMs: 420,
  speedPixelsPerSecond: 720,
} as const

function waitForAgentCursor(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function settleAgentTarget(target: HTMLElement) {
  const rect = target.getBoundingClientRect()
  const needsScroll = rect.top < 0 || rect.bottom > window.innerHeight
  target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
  if (!needsScroll)
    return

  // Prefer the browser's actual scroll completion signal. The timeout keeps
  // older embedded WebViews usable when scrollend is not implemented.
  await new Promise<void>((resolve) => {
    let timeout: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      if (timeout)
        clearTimeout(timeout)
      window.removeEventListener('scrollend', finish)
      resolve()
    }
    window.addEventListener('scrollend', finish, { once: true })
    timeout = setTimeout(finish, agentCursorTiming.scrollSettleMs)
  })
}

function travelDuration(from: { x: number, y: number }, to: { x: number, y: number }) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y)
  const duration = distance / agentCursorTiming.speedPixelsPerSecond * 1_000
  return Math.round(Math.min(agentCursorTiming.maximumTravelMs, Math.max(agentCursorTiming.minimumTravelMs, duration)))
}

let itemBrowsePosition: { x: number, y: number } | undefined

async function animateAction(nextAction: AgentAction) {
  // Selecting a card may scroll it into view before the dialog opens. Return
  // to the customer's original browsing position when that dialog closes.
  if (!selectedItemId.value && !nextAction.controlId && nextAction.targetId && menuItems.value.some(item => item.id === nextAction.targetId))
    itemBrowsePosition ??= { x: window.scrollX, y: window.scrollY }
  cursorTargetId.value = nextAction.targetId
  showAgentCursor.value = true

  if (nextAction.expandCustomization && nextAction.targetId)
    expandedCustomizations[nextAction.targetId] = true

  await nextTick()
  const target = nextAction.controlId
    ? controlElements.get(nextAction.controlId) ?? (nextAction.targetId ? cardElements.get(nextAction.targetId) : undefined)
    : nextAction.targetId ? cardElements.get(nextAction.targetId) : undefined
  if (!target) {
    if (nextAction.controlId?.startsWith('cart:remove:') || nextAction.controlId?.startsWith('order:fulfillment:'))
      throw new Error('The requested order control is not visible.')
    cursorPhase.value = 'resting'
    await waitForAgentCursor(agentCursorTiming.dwellMs)
    return
  }

  // The cursor is fixed to the menu viewport, so measure only after the
  // browser has finished moving the target into view.
  await settleAgentTarget(target)
  const rect = target.getBoundingClientRect()
  // Use the actual control center. The old top-biased offset pointed at the
  // image area of tall cards and missed compact dialog buttons.
  const targetPosition = { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 }
  cursorTravelMs.value = travelDuration(cursorPosition.value, targetPosition)
  cursorPhase.value = 'moving'
  cursorPosition.value = targetPosition
  await waitForAgentCursor(cursorTravelMs.value)
  cursorPhase.value = 'resting'
  await waitForAgentCursor(agentCursorTiming.dwellMs)
  cursorPhase.value = 'pressing'
  // Show a press without dispatching a browser click. The owning tool applies
  // the state change once this animation completes, avoiding duplicate writes.
  target.classList.remove('is-agent-target')
  void target.offsetWidth
  target.classList.add('is-agent-target')
  await waitForAgentCursor(agentCursorTiming.pressMs)
  target.classList.remove('is-agent-target')
  cursorPhase.value = 'resting'
}

const agentControlsOrder = shallowRef(false)
watch(selectedItemId, async (itemId, previousId) => {
  if (itemId) {
    itemBrowsePosition ??= { x: window.scrollX, y: window.scrollY }
    return
  }
  const position = itemBrowsePosition
  itemBrowsePosition = undefined
  if (!previousId || !position)
    return
  await nextTick()
  // An immediately reopened dialog owns its own position; an older close
  // must not move the viewport underneath it.
  if (!selectedItemId.value && !orderReviewOpen.value && !checkout.value)
    window.scrollTo({ left: position.x, top: position.y, behavior: 'instant' })
})
const runtime = createMenuToolRuntime({
  testing: import.meta.env.DEV,
  onMenuChanged: (items) => {
    if (posCatalog.value)
      posCatalog.value = { ...posCatalog.value, items }
  },
  onAgentControlChange: locked => agentControlsOrder.value = locked,
  // Match template precedence: checkout hides review, which hides the item dialog.
  screen: () => {
    if (checkout.value)
      return 'checkout'
    if (orderReviewOpen.value)
      return 'cart_review'
    return selectedItem.value ? 'item_configuration' : 'menu'
  },
  visibleItemId: () => selectedItem.value?.id,
  visibleItemIds: () => visibleMenuItems.value.map(item => item.id),
  fulfillmentModes: [],
  serviceContext: () => orderingContext.value,
  onSessionReset: async () => {
    if (orderingContext.value)
      orderingContext.value = await loadOrderingContext(import.meta.env.VITE_ORDER_MENU_SERVER_URL, orderingContext.value.id)
    receiptAccess.value = undefined
    completedOrderId.value = undefined
    completedOrder.value = undefined
    checkout.value = undefined
    orderReviewOpen.value = false
    resetPaymentAttempt()
  },
  checkout: {
    assertCanRestart,
    cancel: cancelCheckout,
    chooseInvoice,
    confirmInvoice: () => {
      if (!checkout.value)
        throw new Error('尚未進入發票確認。')
      checkout.value = confirmInvoiceDraft(checkout.value)
      return checkout.value
    },
    confirmTaxId: confirmTaxIdNumber,
    paymentMethods: testPaymentMethods,
    paymentStatus: () => paymentStatus.value === 'pending' || paymentStatus.value === 'uncertain' ? paymentStatus.value : undefined,
    revision: () => checkoutRevision,
    requestTaxId: openTaxId,
    restart: restartOrder,
    selectPayment,
    setTaxId: updateTaxId,
    skipMembership: skipCheckoutMembership,
    snapshot: () => checkout.value,
    start: startCheckout,
  },
  gateway: createPosBridgeGateway(import.meta.env.VITE_ORDER_MENU_SERVER_URL, () => undefined, { phone: () => undefined, onReceipt: access => receiptAccess.value = access, orderingContext: () => orderingContext.value }),
  menu: [],
  onAction: animateAction,
  onReviewRequested: async () => {
    // A cart read must not replace a live checkout/payment screen.
    if (checkout.value || completedOrderId.value)
      return
    selectedItemId.value = undefined
    orderReviewOpen.value = true
    await nextTick()
  },
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
  onMenuSelection: (itemId) => {
    if (itemId)
      orderReviewOpen.value = false
    selectedItemId.value = itemId
  },
  onMenuScroll: direction => selectedItemId.value || orderReviewOpen.value
    ? { status: 'UNAVAILABLE', position: document.scrollingElement?.scrollTop ?? 0 }
    : scrollViewport(document.scrollingElement, direction),
  onMenuRequested: returnToMenuForAdditionalItems,
  onFulfillmentChange: (mode) => {
    fulfillmentMode.value = mode
  },
  onSelectionChange: syncSelection,
  onOrderConfirmed: handleOrderConfirmed,
  onOrderSubmission: handleOrderSubmission,
  onRecommendationsChange: async (presentation) => {
    returnToMenuForAdditionalItems()
    recommendations.value = presentation
    selectedPresentationSubjectId.value = undefined
    activeCategory.value = recommendedCategoryId
    await nextTick()
  },
  onMenuPresentationActivity: async ({ state, toolName }) => {
    if (state === 'idle') {
      // The model may run two lookups in parallel. Remove only this completed
      // invocation so the visible loading state remains for the other one.
      const completedIndex = menuPresentationLoadingTools.value.lastIndexOf(toolName)
      if (completedIndex >= 0)
        menuPresentationLoadingTools.value = menuPresentationLoadingTools.value.filter((_, index) => index !== completedIndex)
      return
    }

    menuPresentationLoadingTools.value = [...menuPresentationLoadingTools.value, toolName]
    // Yield briefly for the skeleton without making the operation depend on
    // an animation frame: background/hidden documents can suspend those frames.
    await nextTick()
    await waitForAgentCursor(16)
  },
})

async function invoke(name: MenuToolName, args: Record<string, unknown> = {}, options: { animate?: boolean } = {}) {
  return await runtime.invokeManual(name, args, options.animate === false ? () => {} : undefined)
}

function syncSelection(selection: Selection) {
  quantities[selection.itemId] = selection.quantity
  selectedOptionsByItem[selection.itemId] = { ...selection.options }
}

function selectPresentationSubject(subjectId: string | undefined) {
  selectedPresentationSubjectId.value = subjectId
  activeCategory.value = recommendedCategoryId
}

function handleOrderConfirmed(order: SubmittedOrder) {
  if (completedOrderId.value === order.id)
    return

  completedOrderId.value = order.id
  completedOrder.value = order
  orderStatus.value = order.receipt.pickupNumber
    ? `${order.receipt.customerMessage} 取餐號碼：${order.receipt.pickupNumber}`
    : order.receipt.customerMessage
  checkout.value = undefined
  orderReviewOpen.value = true
  // Completion must reach the host immediately so its configured reward appears.
  // The host displays the carry-away QR alongside that reward until dismissal.
  notifyHost('completed', {
    ...(order.serviceMode === 'table-service' ? { serviceMode: order.serviceMode, table: order.table, lines: order.cart.lines.map(line => ({ name: line.name, quantity: line.quantity, total: line.unitPrice * line.quantity })) } : {}),
    environment: order.receipt.environment,
    fulfillmentMode: order.cart.fulfillmentMode!,
    id: order.id,
    itemCount: order.cart.itemCount,
    ...(order.receipt.pickupNumber ? { pickupNumber: order.receipt.pickupNumber } : {}),
    ...(order.receipt.posOrderId ? { posOrderId: order.receipt.posOrderId } : {}),
    status: 'accepted',
    total: order.cart.total,
  }, receiptUrl.value)
}

async function completeCustomerSession() {
  const order = completedOrder.value
  if (!order)
    return
  if (window.parent === window && orderingContext.value?.serviceMode === 'table-service') {
    try {
      await runtime.reset()
    }
    catch (error) { orderStatus.value = errorMessageFrom(error) ?? '目前無法開始新訂單。' }
    return
  }
  if (window.parent === window && orderingContext.value) {
    try {
      await loadOrderingContext(import.meta.env.VITE_ORDER_MENU_SERVER_URL, orderingContext.value.id)
    }
    catch (error) {
      orderStatus.value = errorMessageFrom(error) ?? '目前無法開始新訂單。'
      return
    }
  }
  if (window.parent === window)
    window.location.reload()
}

function handleOrderSubmission(order: SubmittedOrder) {
  submissionStatus.value = order.receipt.status
  orderStatus.value = order.receipt.customerMessage
}

function notifyHost(type: 'activity' | 'completed', orderResult?: InteractiveServiceOrderResult, orderContinuationUrl?: string) {
  if (window.parent === window)
    return

  // The host validates both the active iframe Window and this service origin.
  // Keep the transient carry-away capability outside the archivable order result.
  if (import.meta.env.DEV)
    console.info('[DEBUG-feedback-lifecycle] menu sent lifecycle event', { type })
  const message: InteractionLifecycleMessage = { source: 'airi-interaction-lifecycle', type, orderResult, orderContinuationUrl }
  window.parent.postMessage(message, { targetOrigin: expectedAiriOrigin ?? '*' })
}

function notifyActivity() {
  cursorTargetId.value = undefined
  showAgentCursor.value = false
  notifyHost('activity')
}

function handleMenuPointerDown() {
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

async function confirmVisibleOrder() {
  if (orderingContext.value?.serviceMode !== 'table-service')
    return startCheckout()
  if (tableSubmitting.value)
    return
  tableSubmitting.value = true
  try {
    await runtime.confirmTableOrder()
  }
  catch (error) { orderStatus.value = errorMessageFrom(error) ?? '訂單未送出。' }
  finally { tableSubmitting.value = false }
}

function startCheckout() {
  if (cart.value.lines.length === 0)
    throw new Error('Cart is empty.')
  if (!fulfillmentMode.value)
    throw new Error('Choose dine-in or self-pickup before starting checkout.')
  if (!posCatalog.value?.store.fulfillmentModes.some(mode => mode.id === fulfillmentMode.value))
    throw new Error('This fulfillment mode is not offered by the POS.')
  if (completedOrderId.value)
    throw new Error('This order has already been completed.')

  selectedItemId.value = undefined
  orderReviewOpen.value = false
  resetPaymentAttempt()
  checkout.value = beginCheckout('collected')
  return checkout.value
}

function skipCheckoutMembership() {
  if (!checkout.value)
    throw new Error('Checkout has not started.')

  checkout.value = skipMembership(checkout.value)
  return checkout.value
}

function chooseInvoice(method: 'carrier' | 'citizen' | 'donation') {
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

function backCheckout() {
  if (!checkout.value)
    return
  const previous = returnToPreviousStep(checkout.value, paymentStatus.value)
  resetPaymentAttempt()
  checkout.value = previous
  orderReviewOpen.value = !previous
}

async function returnToOrderReview() {
  assertCanRestart()
  resetPaymentAttempt()
  checkout.value = undefined
  orderReviewOpen.value = true
}

function assertCanRestart() {
  if (paymentStatus.value === 'pending' || paymentStatus.value === 'authorized' || paymentStatus.value === 'uncertain')
    throw new Error('Cannot restart while a payment is pending, authorized, or awaiting reconciliation.')
}

async function cancelCheckout() {
  if (!checkout.value)
    throw new Error('Checkout has not started.')
  assertCanRestart()
  await returnToOrderReview()
}

function restartOrder() {
  resetPaymentAttempt()
  checkout.value = undefined
  orderReviewOpen.value = false
  selectedItemId.value = undefined
}

/** Returns to browsing while preserving the current cart when the customer adds more items. */
function returnToMenuForAdditionalItems() {
  if (paymentStatus.value === 'pending' || paymentStatus.value === 'uncertain')
    return
  resetPaymentAttempt()
  checkout.value = undefined
  orderReviewOpen.value = false
  selectedItemId.value = undefined
  activeCategory.value = undefined
  selectedPresentationSubjectId.value = undefined
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
    // The terminal already authorized payment. A POS rejection is not proof
    // of a refund, so keep payment/table ownership locked for reconciliation.
    paymentStatus.value = 'uncertain'
    paymentError.value = `${order.receipt.customerMessage} 付款已授權，請洽門市人員確認，勿重複付款。`
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
  if (checkout.value?.stage !== 'payment' || !testPaymentMethods.includes(method))
    throw new Error('請在付款畫面選擇 LINE Pay 或街口支付。')
  assertCanRestart()
  paymentMethod.value = method
  paymentStatus.value = undefined
  paymentError.value = undefined
  return { customerMessage: orderingMessages['zh-Hant'].payment.ready.replace('{method}', paymentLabels[method]), status: 'selected' as const }
}

async function simulatePayment() {
  const method = paymentMethod.value
  if (!method)
    throw new Error('請先選擇付款方式。')
  if (checkout.value?.stage !== 'payment')
    throw new Error('A payment method can only be selected during payment.')
  if (paymentStatus.value === 'pending' || paymentStatus.value === 'uncertain')
    throw new Error('This payment attempt is already pending or awaiting reconciliation.')

  resetPaymentAttempt()
  const attempt = paymentAttempt
  let terminalAuthorized = false
  let terminalRequested = false
  paymentMethod.value = method
  paymentStatus.value = 'pending'
  try {
    terminalRequested = true
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
    if (!terminalRequested) {
      paymentMethod.value = undefined
      paymentStatus.value = undefined
      paymentError.value = errorMessageFrom(error) ?? '請返回訂單確認資料，再啟動付款。'
      return { customerMessage: paymentError.value, status: 'rejected' }
    }
    if (terminalAuthorized) {
      paymentStatus.value = 'uncertain'
      paymentError.value = '付款已授權，但訂單結果無法確認。為避免重複扣款，此筆交易已鎖定。'
      return { customerMessage: paymentError.value, status: 'uncertain' }
    }
    // The request could have reached the terminal before the response was
    // lost. Unknown initiation is never authority to retry or free seats.
    paymentStatus.value = 'uncertain'
    paymentError.value = errorMessageFrom(error) ?? '無法確認付款終端狀態，請洽門市人員。'
    return { customerMessage: paymentError.value, status: 'uncertain' }
  }
}

const paymentSelectionSeconds = usePaymentSelectionCountdown(
  () => checkout.value?.stage === 'payment' && !paymentMethod.value && !paymentStatus.value && !agentControlsOrder.value,
  () => { void returnToOrderReview() },
)

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
  catch (error) {
    if (!(error instanceof ItemSelectionError))
      throw error
    menuInteractionMessage.value = error.message
  }
  finally {
    addingItemId.value = undefined
  }
}

async function openItem(itemId: string) {
  try {
    menuInteractionMessage.value = undefined
    await invoke('menu_select_item', { itemId }, { animate: false })
  }
  catch (error) {
    if (!(error instanceof ItemSelectionError))
      throw error
    menuInteractionMessage.value = error.message
  }
}

async function addSelectedItem(itemId: string) {
  await addItem(itemId)
  selectedItemId.value = undefined
}

function optionLabel(line: CartSnapshot['lines'][number]) {
  const item = menuItems.value.find(candidate => candidate.id === line.itemId)
  return Object.entries(line.options)
    .map(([groupId, valueId]) => item?.optionGroups.find(group => group.id === groupId)?.values.find(value => value.id === valueId)?.label)
    .filter((label): label is string => !!label)
    .join('、')
}

async function loadCatalog() {
  try {
    if (!orderingContext.value)
      orderingContext.value = await loadOrderingContext(import.meta.env.VITE_ORDER_MENU_SERVER_URL)
  }
  catch (error) {
    catalogError.value = errorMessageFrom(error) ?? '無法取得服務模式。'
    catalogState.value = 'error'
    return
  }
  const catalog = await loadPosCatalog()
  if (!catalog || menuUnmounted)
    return

  runtime.setMenu(catalog.items, catalog.revision)
  runtime.setFulfillmentModes(catalog.store.fulfillmentModes)
  for (const item of catalog.items) {
    quantities[item.id] = 1
    expandedCustomizations[item.id] = false
    selectedOptionsByItem[item.id] = defaultOptionsFor(item)
  }
  disconnectService?.()
  if (expectedAiriOrigin)
    disconnectService = connectInteractiveService(runtime, expectedAiriOrigin)
}

onMounted(() => {
  void loadCatalog()
})

onUnmounted(() => {
  menuUnmounted = true
  disconnectService?.()
  disconnectService = undefined
  if (cartUpdateTimer)
    clearTimeout(cartUpdateTimer)
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
  <main v-else :inert="agentControlsOrder" class="menu-app" @pointerdown="handleMenuPointerDown">
    <p v-if="menuInteractionMessage" role="status" :class="['presentation-context']">
      {{ menuInteractionMessage }}
    </p>
    <CheckoutInvoice
      v-if="checkout?.stage === 'invoice'"
      :checkout="checkout"
      :locked="agentControlsOrder"
      :total="currency(cart.total)"
      @back="backCheckout"
      @choose="chooseInvoice"
      @draft="(method, code) => { if (checkout) checkout = setInvoiceDraft(checkout, method, code) }"
      @details="(method, code) => { if (checkout) checkout = confirmInvoiceDetails(checkout, method, code) }"
      @tax-id="openTaxId"
      @register-control="setControlElement"
    />
    <CheckoutTaxId
      v-else-if="checkout?.stage === 'tax-id'"
      :tax-id="checkout.taxId ?? ''"
      :locked="agentControlsOrder"
      @back="backCheckout"
      @confirm="confirmTaxIdNumber"
      @update-tax-id="updateTaxId"
      @register-control="setControlElement"
      @cancel="cancelCheckout"
      @donation="chooseInvoice('donation')"
    />
    <CheckoutPayment
      v-else-if="checkout?.stage === 'payment'"
      :error="paymentError"
      :method="paymentMethod"
      :status="paymentStatus"
      :selection-seconds="paymentSelectionSeconds"
      :total="currency(cart.total)"
      @back="backCheckout"
      @change-method="() => { assertCanRestart(); resetPaymentAttempt() }"
      @select="selectPayment"
      @simulate="simulatePayment"
      @register-control="setControlElement"
      @cancel="cancelCheckout"
    />
    <OrderReview
      v-else-if="orderReviewOpen"
      :completed="!!completedOrderId"
      :completed-label="completedOrderLabel"
      :fulfillment-mode="fulfillmentMode"
      :fulfillment-modes="orderingContext?.serviceMode === 'table-service' ? [] : posCatalog?.store.fulfillmentModes ?? []"
      :service-context="orderingContext"
      :submitting="tableSubmitting"
      :seating-ready="true"
      :lines="reviewLines"
      :order-status="orderStatus"
      :submission-status="submissionStatus"
      :total="currency(cart.total)"
      @back="orderReviewOpen = false"
      @checkout="confirmVisibleOrder"
      @remove="removeCartLine"
      @register-control="setControlElement"
      @set-fulfillment="setFulfillmentMode"
      @update-quantity="updateCartLineQuantity"
    >
      <template #continuation>
        <button type="button" @click="completeCustomerSession">
          完成，開始下一筆
        </button>
      </template>
    </OrderReview>

    <template v-else>
      <div class="menu-browser">
        <nav class="category-navigation" aria-label="餐點分類">
          <button :class="['category-button', { 'is-selected': activeCategory === recommendedCategoryId }]" type="button" :disabled="recommendedItems.length === 0" @click="selectPresentationSubject(undefined)">
            {{ presentationNavigationLabel }} <span>{{ presentationItemCount }}</span>
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
          <p v-if="presentationContext" class="presentation-context">
            <span class="i-solar:filter-bold-duotone" aria-hidden="true" />
            {{ presentationContext }}
          </p>
          <MenuPresentationSubjects
            v-if="!menuPresentationLoading && activeCategory === recommendedCategoryId && recommendations?.kind === 'query-results' && presentationSubjects.length > 1"
            :selected-id="selectedPresentationSubjectId"
            :subjects="presentationSubjects"
            @select="selectPresentationSubject"
          />
          <MenuRecommendationRail
            v-if="!menuPresentationLoading && activeCategory === recommendedCategoryId && recommendations?.kind === 'recommendation' && recommendedItems.length > 0"
            :presentation="recommendations"
          />
          <MenuPresentationSkeleton v-if="menuPresentationLoading" :label="menuPresentationLoadingLabel" />
          <p v-else-if="activeCategory === recommendedCategoryId && recommendations && visibleMenuItems.length === 0" :class="['presentation-context']">
            目前沒有符合條件的餐點。
          </p>
          <div v-else class="menu-grid">
            <div v-for="item in visibleMenuItems" :key="item.id" :ref="element => setCardElement(item.id, element)">
              <MenuItemCard
                :is-targeted="cursorTargetId === item.id"
                :item="item"
                @select="openItem"
              />
            </div>
          </div>
        </section>
      </div>

      <MenuItemDialog
        :item="selectedItem"
        :locked="agentControlsOrder"
        :quantity="selectedItem ? quantities[selectedItem.id] ?? 1 : 1"
        :selected-options="selectedItem ? selectedOptionsByItem[selectedItem.id] ?? {} : {}"
        @add="addSelectedItem"
        @close="selectedItemId = undefined"
        @register-control="setControlElement"
        @update-option="(groupId, valueId) => selectedItem && updateOption(selectedItem.id, groupId, valueId)"
        @update-quantity="quantity => selectedItem && updateQuantity(selectedItem.id, quantity)"
      />

      <div :ref="element => setCardElement('cart', element)" :class="['order-summary-container', { 'is-updated': cartUpdated, 'is-targeted': cursorTargetId === 'cart' }]">
        <OrderSummaryBar :item-count="cart.itemCount" :lines="cartSummaryLines" :total="currency(cart.total)" @open="orderReviewOpen = true" @register-control="setControlElement" />
      </div>
    </template>

    <div v-if="showAgentCursor" :class="['agent-cursor', `is-${cursorPhase}`]" :style="{ left: `${cursorPosition.x}px`, top: `${cursorPosition.y}px`, transitionDuration: `${cursorTravelMs}ms` }" aria-hidden="true">
      ✦
    </div>
  </main>
</template>
