import type { ToolDescriptor } from '@proj-airi/stage-shared/interactive-service'
import type { InferOutput } from 'valibot'

import type { RouteName } from './pbRoutes'

import { errorMessageFrom } from '@moeru/std'
import { discoveryRequestSchema, executionRequestSchema, inspectionRequestSchema } from '@proj-airi/stage-shared/interactive-service'
import { pbInvoiceMethodSchema, readPbOrderState } from '@proj-airi/stage-shared/pb-checkout'
import { isPbJourneyPage, isPbOrderResultUrl, readPbStateJourney } from '@proj-airi/stage-shared/pb-journey'
import { describePbMeal, pbProductName } from '@proj-airi/stage-shared/pb-menu-presentation'
import { browserPresentationInputSchema, browserRecommendationLimit } from '@proj-airi/stage-shared/product-presentation'
import { array, boolean, integer, isValiError, literal, looseObject, maxLength, maxValue, minLength, minValue, nullable, number, optional, parse, picklist, pipe, safeParse, strictObject, string, unknown } from 'valibot'

import { orderingMessages } from '../../../i18n/src/orderingMessages'
import { createCartOperations, describeCartLines, readCartPage, verifyCartRowEdit } from './pbCart'
import { readCatalog as collectCatalog } from './pbCatalog'
import { createCheckout } from './pbCheckout'
import { createControls } from './pbControls'
import { installInvoiceInput } from './pbInvoiceInput'
import { createOperation } from './pbOperation'
import { createPresentation } from './pbPresentation'
import { prepareAddition, resolveSelection } from './pbProduct'
import { resolveRoute } from './pbRoutes'
import { installTablePicker } from './pbTablePicker'

function describeProducts(products: readonly { name: string, price?: number }[]) {
  // An omitted price means the configuration still needs a separate lookup.
  return `目前查到：${products.map(product => `${pbProductName(product.name)}${product.price === undefined ? '' : `，單份 ${product.price} 元`}`).join('；')}。`
}

/** Owns PB's bounded operations and document journal independently of its transport. */
export function createPbService() {
  const approvedJourney = readPbStateJourney(location.href)
  if (!approvedJourney)
    throw new Error('PB service journey has not been approved.')
  const journey = approvedJourney
  const entry = new URL(journey.menuPath, journey.origin).href
  /** SPA navigation keeps this listener alive; every admission must recheck scope. */
  function assertScope() {
    if (!isPbJourneyPage(entry, location.href))
      throw new Error('目前已離開這家店的點餐菜單，請返回菜單後重新確認需求。')
  }

  if (!isPbJourneyPage(entry, location.href) && !isPbOrderResultUrl(entry, location.href))
    throw new Error('PB page is outside the approved reader scope.')
  if (document.documentElement.hasAttribute('data-webnavior-pb-bridge'))
    throw new Error('PB service is already attached to this document.')
  document.documentElement.setAttribute('data-webnavior-pb-bridge', 'ready')
  const documentId = crypto.randomUUID()
  const presentation = createPresentation()
  const invoiceInput = installInvoiceInput()
  const text = pipe(string(), maxLength(200))
  const quantity = pipe(number(), integer(), minValue(1), maxValue(99))
  const selectionSchema = strictObject({ version: text, variantRef: text, choices: array(strictObject({ ref: text, quantity })) })
  const selectionInputSchema = { type: 'object', properties: { version: { type: 'string', description: 'Copy the selected product configuration version exactly. This is separate from cart.version.' }, variantRef: { type: 'string' }, choices: { type: 'array', description: 'Options for ONE serving. Omit refused/unrequested options; use [] for none. Never multiply option quantities by the meal quantity.', items: { type: 'object', properties: { ref: { type: 'string' }, quantity: { type: 'integer', minimum: 1, maximum: 99, description: 'Count of this option PER SERVING, within the observed option/group maximum. Two meals each with one option: top-level quantity=2, this quantity=1, not 2.' } }, required: ['ref', 'quantity'], additionalProperties: false } } }, required: ['version', 'variantRef', 'choices'], additionalProperties: false }
  const baseUrl = new URL(journey.basePath, journey.origin)
  const tablePicker = journey.tablePath
    ? installTablePicker(journey.tablePath, async () => {
        assertScope()
        // The rendered SelectTable document already owns this list. Re-fetching
        // it for every context/selection blocks voice on an unrelated HTTP read.
        // Unlike menu/cart SPA snapshots, this metadata is usable only while its
        // exact component and document URL still match the visible table page.
        const pages = Array.from(document.querySelectorAll('[data-page]'))
        const serialized = pages.length === 1 ? pages[0].getAttribute('data-page') : undefined
        if (!serialized)
          throw new Error('桌號頁資料尚未就緒，請重新載入選桌頁。')
        const page = parse(looseObject({
          component: literal('Menu/SelectTable'),
          url: string(),
          props: looseObject({ auth: optional(looseObject({ user: optional(unknown()) })), buyer: optional(looseObject({ type: string() })), diningTables: array(looseObject({ name: text })) }),
        }), JSON.parse(serialized))
        if (location.pathname !== journey.tablePath || new URL(page.url, location.origin).href !== location.href)
          throw new Error('桌號資料與目前頁面不符，請重新載入選桌頁。')
        if (!page.props.auth?.user && page.props.buyer?.type !== 'cookie')
          throw new Error('PB requires manual sign-in.', { cause: 'sign-in-required' })
        return page.props.diningTables.map(table => table.name)
      })
    : undefined
  // Enhancement failure leaves PB's original dropdown available for manual use.
  void tablePicker?.choices().catch(() => console.info('PB table enhancement is unavailable.'))
  window.addEventListener('pagehide', () => {
    invoiceInput.dispose()
    tablePicker?.dispose()
  }, { once: true })
  const blockedKey = `webnavior:pb:cart-pending:${baseUrl.pathname}`
  let writeMarker: string | undefined
  let currentControls: ReturnType<typeof createControls> | undefined
  // FIFO owns the one document's controls. Optional speech cues may be dropped;
  // required reads/actions wait instead of failing behind a passive cue.
  let executionQueue: Promise<void> = Promise.resolve()
  let queuedCount = 0
  let executingName: string | undefined
  let manualRevision = 0
  const checkout = createCheckout(readCart, () => manualRevision, () => {
    writeMarker = `order:${crypto.randomUUID()}`
    localStorage.setItem(blockedKey, writeMarker)
  }, () => {
    if (writeMarker && localStorage.getItem(blockedKey) === writeMarker)
      localStorage.removeItem(blockedKey)
  }, journey.canSubmit)
  let controlRevision = 0
  const controlTools = new Set(['browser_table_select', 'browser_start_ordering', 'browser_cart_review', 'browser_search', 'browser_open_product', 'browser_close_product', 'browser_set_note', 'browser_clarify_product', 'browser_cart_add', 'browser_cart_quantity', 'browser_cart_remove', 'browser_cart_replace', 'browser_customer_reset', 'browser_return_menu', 'browser_checkout_prepare', 'browser_invoice_select', 'browser_notification_phone', 'browser_order_submit'])
  let activeVisual: AbortController | undefined
  for (const eventName of ['pointerdown', 'keydown', 'wheel']) {
    document.addEventListener(eventName, (event) => {
      if (event.isTrusted && !invoiceInput.owns(event)) {
        // Scrolling cancels the visual cue but changes no cart data. Checkout
        // field editing is likewise excluded above; form values are separately
        // fingerprinted before the final submission ticket can be consumed.
        if (eventName !== 'wheel')
          manualRevision++
        controlRevision++
        activeVisual?.abort()
      }
    }, { capture: true })
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      controlRevision++
      activeVisual?.abort()
    }
  })
  let active: { id: string, operations: Map<string, { name: string, fingerprint: string, result: Promise<unknown>, status: 'pending' | 'settled' | 'failed' }> } | undefined

  // Cart and selection versions are different observations; make their owners
  // explicit in the model schema so an otherwise valid plan cannot mix them.
  const cartVersion = { type: 'string', description: 'Copy cart.version exactly from the latest browser_cart_get result. Never use selection.version or a product configuration version here.' }
  const tools: ToolDescriptor[] = [
    { name: 'browser_reception_reset', description: 'Host-only explicit staff initialization. Retires local operation warnings and consent; never reads, clears, submits or cancels a PB order/cart/payment. Reload the configured entry afterwards.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'browser_checkout_prepare', description: 'Read actual invoice/notification fields and prepare one expiring confirmation. No submission.', inputSchema: { type: 'object', properties: { focus: { type: 'string', enum: ['invoice', 'next'] } }, required: [], additionalProperties: false } },
    { name: 'browser_invoice_select', description: 'Select one actually offered native invoice method. No order submission.', inputSchema: { type: 'object', properties: { method: { type: 'string', enum: ['none', 'carrier', 'citizen', 'tax', 'donation'] } }, required: ['method'], additionalProperties: false } },
    { name: 'browser_notification_phone', description: 'Fill only the notification phone draft. No invoice carrier, email, submission or payment.', inputSchema: { type: 'object', properties: { phone: { type: 'string', pattern: '^\\d{10,15}$' } }, required: ['phone'], additionalProperties: false } },
    { name: 'browser_order_submit', description: 'Host-only: consume a native confirmation token after the customer answers the matching final summary. Never a Main tool.', inputSchema: { type: 'object', properties: { confirmationToken: { type: 'string' } }, required: ['confirmationToken'], additionalProperties: false } },
    { name: 'browser_close_product', description: 'Close the current unadded product selection without changing the cart.', inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false } },
    ...(tablePicker
      ? [
          { name: 'browser_table_select', description: 'Select exactly one currently offered dining table by name. Selection only; use browser_start_ordering when the customer asks to enter the menu. Never infer a customer choice from the initial website default.', inputSchema: { type: 'object', properties: { name: { type: 'string', maxLength: 200 } }, required: ['name'], additionalProperties: false } },
          { name: 'browser_start_ordering', description: 'Select the customer-specified table and press the actual Start ordering button to enter its menu. name must be a current tableChoices name explicitly requested by the customer or the verified selectedTable. Ask which table if neither exists. forReset is only for explicit Host reception cleanup while the website stays visible. This does not add food, submit an order or pay. New navigation must read back the table/cart before ordering.', inputSchema: { type: 'object', properties: { name: { type: 'string', maxLength: 200 }, forReset: { type: 'boolean' } }, required: ['name'], additionalProperties: false } },
        ]
      : []),
    { name: 'browser_present', description: 'Present exact current catalog refs, never cart quantities or subtotal. Default mode=recommendation presents at most three in the supplied ranking order; use it for named selections and ordinary recommendations. other-recommendations requests a different batch and shares the three-item limit; only that mode permits Host exclusion of the last introduced batch. mode=information is only for explicit named comparisons/menu information and allows up to ten. The full requested ref list is validated first; limiting is not evidence of absent products. If the prior search hides any selected product, clears the native search and verifies ALL selected cards before speaking. [] cancels visuals only; browser_search query="" clears the search. Never changes cart. Explicit presentation may return to the menu; preservePage=true keeps both the page and search unchanged.', inputSchema: { type: 'object', properties: { preservePage: { type: 'boolean', description: 'Host speech cue only: keep the current page and search unchanged; skip framing if the cards are not already visible.' }, deferVisual: { type: 'boolean', description: 'Host reserves validated dishes for reply-time cues; no frame or scroll until speech or visible reply starts.' }, productRefs: { type: 'array', items: { type: 'string' }, maxItems: 100 }, mode: { type: 'string', enum: ['recommendation', 'other-recommendations', 'information'], description: 'Defaults to recommendation (three). other-recommendations is only for explicitly requesting a different recommendation batch. Information is only for explicit customer-requested comparisons or factual lists.' } }, required: ['productRefs'], additionalProperties: false }, annotations: { readOnlyHint: true } },
    { name: 'browser_state_get', description: 'Host-only fresh page, form and order state. Never a model tool; never navigates or grants write authority.', inputSchema: { type: 'object', properties: { includeCatalog: { type: 'boolean' } }, required: ['includeCatalog'], additionalProperties: false }, annotations: { readOnlyHint: true } },
    { name: 'browser_cart_get', description: 'Read planning data before a cart edit: current cart/version and optional product references. includeCatalog=true is internal planning data, not a customer cart-review receipt. forAdmission=true is Host-only reception preparation, including a fresh cart read on the table page. For 核對、我點了什麼、目前訂單、還不要送 use browser_cart_review instead. This does not submit an order.', inputSchema: { type: 'object', properties: { includeCatalog: { type: 'boolean' }, forAdmission: { type: 'boolean' } }, required: ['includeCatalog'], additionalProperties: false }, annotations: { readOnlyHint: true } },
    { name: 'browser_return_menu', description: 'Return to the full actual menu, clear website search and unfinished selection, and verify the cart is unchanged. Does not increase servings, clear cart items, submit or pay.', inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false }, annotations: { readOnlyHint: true } },
    { name: 'browser_cart_review', description: 'Open the actual cart for review and read back the CURRENT ORDER, quantities, options, notes and actual PB subtotal as a customer receipt. Use for 核對一下、我點了什麼、確認目前訂單、先不要送. This is read-only: it neither presents menu unit prices as an order nor changes or submits anything. No parameters.', inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false }, annotations: { readOnlyHint: true } },
    { name: 'browser_product_get', description: 'For an order naming exact products, call this FIRST with those names; no prior browser_observe or browser_present is needed. Reads complete fresh configurations for 1–10 exact product names in one batch, returns cart.version, without presenting cards or opening a product window. Use browser_present separately when a customer asks to see the items. Copy each configuration.version and option refs; never guess. Read-only.', inputSchema: { type: 'object', properties: { names: { type: 'array', items: { type: 'string', maxLength: 200 }, minItems: 1, maxItems: 10 } }, required: ['names'], additionalProperties: false }, annotations: { readOnlyHint: true } },
    { name: 'browser_cart_add', description: 'Add the exact observed PB product and quantity. Requires the current cart version and freshly observed unit price. Each call adds ONE configuration and ONE shared per-serving note. Split different notes into separate calls: two meals, one note A and one note B, means quantity=1/note=A then quantity=1/note=B; never quantity=2/note="one A, one B". Use only customer-requested notes without meal-count narration. selection must explicitly contain version, variantRef and choices (use [] for no options); copy the observed configuration version, not cart.version. selection.choices quantities and unitPrice are PER SERVING, including paid options; top-level quantity is the number of meals. Never multiply per-serving options or unitPrice by meal quantity. Never choose a mandatory option for the customer. Never use for price inquiries.', inputSchema: { type: 'object', properties: { version: cartVersion, copySourceRef: { type: 'string' }, productRef: { type: 'string' }, quantity: { type: 'integer', minimum: 1, maximum: 99 }, unitPrice: { type: 'number', minimum: 0 }, note: { type: 'string', maxLength: 200 }, selection: selectionInputSchema }, required: ['version', 'productRef', 'quantity', 'unitPrice', 'note', 'selection'], additionalProperties: false } },
    { name: 'browser_cart_quantity', description: 'Set one row quantity, or provide lineRefs (including lineRef) for equivalent split rows with identical product/configuration/unit price. With lineRefs, quantity is the GROUP FINAL TOTAL: native controls retain that total and remove redundant rows after verifying each step. Preserve all other configurations and notes. Requires current cart version and lineRef. Inspect all matching rows and their options. When lineRefs is omitted, for a requested product/configuration total subtract the quantities of matching rows retained by this call; quantity is then the selected row final count, not the entire product total. Native rendered rows must also be distinguishable by name/quantity/unit price; identical visual signatures stop without guessing. Identical product/configuration rows may be adjusted through one row while preserving the others. Different configurations require an unambiguous customer target; never choose the first.', inputSchema: { type: 'object', properties: { version: cartVersion, lineRef: { type: 'string' }, lineRefs: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2000, uniqueItems: true }, quantity: { type: 'integer', minimum: 1, maximum: 99 } }, required: ['version', 'lineRef', 'quantity'], additionalProperties: false } },
    { name: 'browser_cart_remove', description: 'Remove one exact observed PB cart line, or provide lineRefs including lineRef to remove an entire equivalent group (same product/configuration/unit price), with current version. Each native control effect is verified. Does not clear other lines or submit an order.', inputSchema: { type: 'object', properties: { version: cartVersion, lineRef: { type: 'string' }, lineRefs: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2000, uniqueItems: true } }, required: ['version', 'lineRef'], additionalProperties: false } },
    { name: 'browser_cart_replace', description: 'Replace all or part of an observed cart line or explicit equivalent lineRefs group with an explicitly selected product/configuration. A unique same-price identical configuration compiles to one quantity edit of retainQuantity + quantity, never add/remove; duplicate configuration rows require grouped browser_cart_quantity instead. retainQuantity is the number of original servings to KEEP (default 0; strictly less than the source group total). quantity is the number of NEW servings, not the final combined total. For changing one of three meals to rice use quantity=1, retainQuantity=2 and the rice selection. This tool verifies the new servings before reducing/removing the original row; do not simulate replacement with separate add/remove calls. Requires latest version, original lineRef and replacement productRef/price/quantity.', inputSchema: { type: 'object', properties: { version: cartVersion, lineRef: { type: 'string' }, lineRefs: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2000, uniqueItems: true }, retainQuantity: { type: 'integer', minimum: 0, maximum: 197999 }, productRef: { type: 'string' }, quantity: { type: 'integer', minimum: 1, maximum: 99 }, unitPrice: { type: 'number', minimum: 0 }, note: { type: 'string', maxLength: 200 }, selection: selectionInputSchema }, required: ['version', 'lineRef', 'productRef', 'quantity', 'unitPrice', 'note', 'selection'], additionalProperties: false } },
    { name: 'browser_customer_reset', description: 'Host-only customer lifecycle end. Clears unsubmitted cart rows through the native PB clear button and verifies empty before resetting drafts/search; preserves shared login. Not an Agent tool.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'browser_recovery_context', description: 'Host-only fresh browser recovery and retry state. Not an Agent tool.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
    { name: 'browser_observe', description: 'Read actual PB products and prices. purpose=information for menu inquiries; purpose=choose_product to ask which actual product the customer wants when they only say a broad term such as one bento. Set includeDescriptions for ingredients/comparisons. Owned Menu/POS tools are unavailable.', inputSchema: { type: 'object', properties: { includeDescriptions: { type: 'boolean' }, purpose: { type: 'string', enum: ['information', 'choose_product'] } }, required: ['includeDescriptions', 'purpose'], additionalProperties: false }, annotations: { readOnlyHint: true } },
    { name: 'browser_search', description: 'Type a product query into the real PB search field and read back results. This only filters the visible menu; it does not order anything.', inputSchema: { type: 'object', properties: { query: { type: 'string', maxLength: 200 } }, required: ['query'], additionalProperties: false } },
    { name: 'browser_quote_selection', description: 'Read-only price quote INCLUDING customer-requested add-ons or options. First read browser_product_get for fresh configuration/version/choice refs, then provide that exact selection. quantity is meals; selection.choices quantities are PER SERVING. Never adds to cart. For a meal with rice price inquiry, use this instead of browser_quote, which only quotes the base price. Do not choose mandatory options for the customer.', inputSchema: { type: 'object', properties: { productRef: { type: 'string' }, quantity: { type: 'integer', minimum: 1, maximum: 99 }, selection: selectionInputSchema }, required: ['productRef', 'quantity', 'selection'], additionalProperties: false }, annotations: { readOnlyHint: true } },
    { name: 'browser_quote', description: 'Calculate a requested quantity from the exact visible PB product price. Read-only: asking how much is not permission to add to cart. This quotes BASE PRICE ONLY. For any add-on/option price question use browser_product_get then browser_quote_selection; do not answer a configured-price question with this partial base quote. Search for the product first.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, quantity: { type: 'integer', minimum: 1, maximum: 99 } }, required: ['name', 'quantity'], additionalProperties: false }, annotations: { readOnlyHint: true } },
    { name: 'browser_clarify_product', description: 'Search a broad customer product term, then ask them to choose among the actual matching products. Does not add anything.', inputSchema: { type: 'object', properties: { query: { type: 'string', maxLength: 200 } }, required: ['query'], additionalProperties: false }, annotations: { readOnlyHint: true } },
    { name: 'browser_open_product', description: 'Open a PB product by its exact observed name to show its details. This does not add it to the cart.', inputSchema: { type: 'object', properties: { name: { type: 'string', maxLength: 200 } }, required: ['name'], additionalProperties: false } },
    { name: 'browser_set_note', description: 'Fill the currently open product note and read it back. This is only an unsubmitted draft, not a cart or order mutation.', inputSchema: { type: 'object', properties: { note: { type: 'string', maxLength: 200 } }, required: ['note'], additionalProperties: false } },
  ]

  function observe(includeDraft = false) {
    return {
      source: 'browser',
      url: location.href,
      // Card text is PB's rendered price/description evidence. Keep it with its
      // heading; a bare product name cannot support a price comparison.
      products: Array.from(document.querySelectorAll('main [role="button"] h4, main button h4')).filter(element => element.getClientRects().length > 0).map((element) => {
        const details = element.closest<HTMLElement>('button, [role="button"]')?.textContent?.trim() ?? ''
        // Only an unambiguous single displayed price is a fixed-price quote.
        // Ranges, discounts with two amounts, and missing prices need clarification.
        const prices = [...details.matchAll(/\$([\d,]+(?:\.\d+)?)/g)]
        return { name: element.textContent?.trim(), details, price: prices.length === 1 ? Number(prices[0][1].replaceAll(',', '')) : undefined }
      }),
      catalogScope: 'Currently rendered search results only; an absent item is not proof the store never sells it.',
      ...(includeDraft ? { search: document.querySelector<HTMLInputElement>('input[placeholder="搜尋品項，例如：拿鐵、雞腿、套餐"]')?.value ?? '' } : {}),
      productDialog: Array.from(document.querySelectorAll('[role="dialog"]')).filter(element => element.getClientRects().length > 0).map(element => ({ name: element.querySelector('h1')?.textContent?.trim(), ...(includeDraft ? { note: element.querySelector<HTMLInputElement>('input[placeholder="商品有特殊需求，請在此備註"]')?.value } : {}) })),
      page: location.pathname === journey.tablePath ? 'table' : location.pathname === journey.cartPath ? 'cart' : 'menu',
      checkoutAvailable: false,
    }
  }

  async function pageProps(suffix: string, signal?: AbortSignal) {
    const url = new URL(suffix, baseUrl)
    const menu = url.pathname === journey.menuPath
    const component = menu ? 'Menu/Show' : 'Order/Create'
    const fields = ['auth', 'buyer', 'storeHash', 'flowType', 'diningTable', ...(menu ? ['defaultPickUpDate', 'defaultPickUpTime'] : ['order', 'details', 'subtotal'])]
    const pages = Array.from(document.querySelectorAll('[data-page]'))
    if (pages.length !== 1)
      throw new Error('PB 頁面資料尚未就緒，請重新載入後再試。')
    const { version } = parse(looseObject({ version: nullable(string()) }), JSON.parse(pages[0].getAttribute('data-page')!))
    // PB already serves Inertia partial reads. Fetch only live facts, not the
    // large HTML/dev scripts; never merge missing fields with an old DOM/cart.
    // The document's asset version is a protocol token, not freshness evidence.
    // https://inertiajs.com/docs/v3/core-concepts/the-protocol
    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        'Accept': 'text/html, application/xhtml+xml',
        'X-Requested-With': 'XMLHttpRequest',
        'X-Inertia': 'true',
        ...(version === null ? {} : { 'X-Inertia-Version': version }),
        'X-Inertia-Partial-Component': component,
        'X-Inertia-Partial-Data': fields.join(','),
      },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
    })
    if (response.status === 409)
      throw new Error('PB 頁面已更新，請重新載入後再試。')
    if (!response.ok || response.url !== url.href)
      throw new Error('PB page is unavailable or requires sign-in.')
    if (response.headers.get('X-Inertia') !== 'true')
      throw new Error('PB 資料回應格式已變更，請重新載入後再試。')
    const raw: unknown = await response.json()
    const tableRequired = safeParse(looseObject({ component: literal('Error'), url: string(), props: looseObject({ code: literal(403), message: literal('請掃描桌上 QR Code 點餐') }) }), raw)
    // A fresh PB guest has no server-side dining table until Start. This exact
    // response defers admission; it provides no evidence that the cart is empty.
    if (!menu && location.pathname === journey.tablePath && tableRequired.success && new URL(tableRequired.output.url, location.origin).href === url.href)
      throw new Error('PB requires table entry before cart inspection.', { cause: 'pb-table-entry-required' })
    const page = parse(looseObject({ component: literal(component), url: string(), props: looseObject({ storeHash: literal(journey.store), flowType: literal(journey.flow), auth: optional(looseObject({ user: optional(unknown()) })), buyer: optional(looseObject({ type: string() })) }) }), raw)
    if (new URL(page.url, location.origin).href !== url.href)
      throw new Error('PB 資料與目前店家頁面不符，尚未操作。')
    assertScope()
    const { props } = page
    if (!props.auth?.user && (journey.buyer !== 'guest' || props.buyer?.type !== 'cookie'))
      throw new Error('PB requires manual sign-in.', { cause: 'sign-in-required' })
    return props
  }

  async function readCatalog(configurationRefs?: readonly string[], includeConfigurations = true, signal?: AbortSignal) {
    assertScope()
    const snapshot = await collectCatalog({
      menu: async () => {
        const props = await pageProps(`menu${location.search}`, signal)
        const pickup = parse(looseObject({ defaultPickUpDate: string(), defaultPickUpTime: string() }), props)
        const url = vendorRoute('shopping.menu.categories', [journey.store, journey.flow])
        url.search = new URLSearchParams({ pickUpDate: pickup.defaultPickUpDate, pickUpTime: pickup.defaultPickUpTime }).toString()
        const response = await fetch(url, { cache: 'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) })
        if (!response.ok)
          throw new Error('PB 當前取餐時段的分類讀取失敗。')
        const data = parse(looseObject({ categories: array(looseObject({ id: number(), name: string(), count: number() })) }), await response.json())
        return { menuCategories: data.categories, defaultPickUpDate: pickup.defaultPickUpDate, defaultPickUpTime: pickup.defaultPickUpTime }
      },
      category: async ({ categoryId, date, time }) => {
        const query = new URLSearchParams({ category_id: String(categoryId), pickUpDate: date, pickUpTime: time })
        const response = await fetch(new URL(`menu-category-items?${query}`, baseUrl), { cache: 'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) })
        if (!response.ok)
          throw new Error('PB 商品資料讀取失敗。')
        return response.json()
      },
      attributes: async (id) => {
        const response = await fetch(vendorRoute('shopping.getAttrByProduct', [journey.store, journey.flow, String(id)]), { cache: 'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) })
        if (!response.ok)
          throw new Error('PB 商品規格讀取失敗。')
        return response.json()
      },
    }, { scope: baseUrl.href, configurationRefs, includeConfigurations })
    if (!snapshot.complete)
      throw new Error('PB 分類商品尚未完整載入，重新查核後仍不完整；尚未操作購物車。')
    return snapshot.products
  }

  async function readCart() {
    const props = await pageProps('orders/create')
    const persistedPickup = safeParse(looseObject({ pick_up_date: string(), pick_up_time: string() }), props.order)
    const pickup = !persistedPickup.success
      ? parse(looseObject({ defaultPickUpDate: string(), defaultPickUpTime: string() }), await pageProps(`menu${location.search}`))
      : { defaultPickUpDate: '', defaultPickUpTime: '' }
    const cart = readCartPage(props, { date: pickup.defaultPickUpDate, time: pickup.defaultPickUpTime }, manualRevision)
    // Reception preparation reads the old cart before the next table is
    // selected. Ordering on menu/cart still requires PB's verified table.
    if (location.pathname !== journey.tablePath && journey.flow === 'internal_use' && !cart.context.tableName)
      throw new Error('目前尚未核實內用桌號，請先選桌再開始點餐。')
    return { ...cart, tableName: cart.context.tableName, pickup: { date: cart.context.date, time: cart.context.time } }
  }

  function vendorRoute(name: RouteName, parameters: string[]) {
    let suffix: string
    switch (name) {
      case 'shopping.menu.categories':
        suffix = 'menu-categories'
        break
      case 'shopping.getAttrByProduct':
        suffix = `getAttrByProduct/${encodeURIComponent(parameters[2])}`
        break
      case 'shopping.orders.details.store':
        suffix = 'orders/null/details/store'
        break
      case 'shopping.orders.details.destroy':
      case 'shopping.orders.details.update':
        suffix = `orders/${encodeURIComponent(parameters[2])}/details/${encodeURIComponent(parameters[3])}`
        break
      default: throw new Error('PB route is not an approved cart operation.')
    }
    return resolveRoute(name, parameters, new URL(suffix, baseUrl), Array.from(document.scripts).map(script => script.textContent ?? ''))
  }

  function beginWrite(kind: 'cart' | 'reset' = 'cart') {
  // This is the final synchronous boundary before a vendor request.
  // A customer can navigate during the preceding asynchronous preparation.
    assertScope()
    if (writeMarker && localStorage.getItem(blockedKey) === writeMarker) {
      // Clearing can complete after its response is lost. Once dispatched,
      // distinguish it from the old add/edit marker even after document reload,
      // so another Restart cannot clear a later customer's cart a second time.
      if (kind === 'reset' && !writeMarker.startsWith('reset:')) {
        writeMarker = `reset:${crypto.randomUUID()}`
        localStorage.setItem(blockedKey, writeMarker)
      }
      return
    }
    if (localStorage.getItem(blockedKey))
      throw new Error('先前購物車操作尚未確認。')
    writeMarker = kind === 'reset' ? `reset:${crypto.randomUUID()}` : crypto.randomUUID()
    // Persist before dispatch so reload/restart cannot erase an unknown write.
    // No customer data, cookie, or credential is stored here.
    localStorage.setItem(blockedKey, writeMarker)
  }

  async function editLine(ref: string, amount: number | undefined, onDispatch: () => void, equivalentRefs: readonly string[] = []) {
    const controls = currentControls
    const before = await readCart()
    const target = before.lines.find(line => line.ref === ref)
    if (!controls || !target || !controls.canEdit(before.lines, equivalentRefs.length ? equivalentRefs : [ref]))
      throw new Error('購物車行無法唯一對應畫面，尚未操作。')
    await controls.edit(before.lines, ref, amount, async () => {
      if (JSON.stringify(await readCart()) !== JSON.stringify(before))
        throw new Error('移動期間購物車已變更，尚未操作。')
    }, async () => {
      const current = await readCart()
      return verifyCartRowEdit(before, current, ref, amount ?? 0, equivalentRefs)
    }, () => {
      beginWrite()
      onDispatch()
    }, equivalentRefs)
  }

  const cartOperations = createCartOperations({
    read: readCart,
    clear: async (before, onDispatch) => {
      if (!currentControls)
        throw new Error('缺少目前購物車畫面，尚未清空。')
      await currentControls.clearCart(async () => {
        if (JSON.stringify(await readCart()) !== JSON.stringify(before))
          throw new Error('移動期間購物車已變更，尚未清空。')
      }, async () => {
        const after = await readCart()
        return !after.lines.length && after.subtotal === 0
      }, () => {
        beginWrite('reset')
        onDispatch()
      })
    },
    canEdit: (cart, ref) => Boolean(currentControls?.canEdit(cart.lines, [ref])),
    prepare: async ({ productRef, quantity: amount, note, selection }) => {
      const [products, cart] = await Promise.all([readCatalog([productRef]), readCart()])
      const product = products.find(product => product.ref === productRef)
      if (!product || product.kind !== 'product' || product.priceType !== 1)
        throw new Error('請重新確認實際商品及售價；此商品需要另外選擇規格。')
      const configuration = product.configurations.find(configuration => configuration.variantRef === selection.variantRef)
      if (!configuration)
        throw new Error('目前沒有可驗證的商品規格，請在畫面確認。')
      const selected = prepareAddition(configuration, selection, { productId: product.id, quantity: amount, note })
      if (cart.lines.length && JSON.stringify(cart.pickup) !== JSON.stringify(product.pickup))
        throw new Error('購物車取餐時段與畫面不同，請先確認取餐時間；尚未加入餐點。')
      const controls = currentControls
      if (!controls)
        throw new Error('缺少目前畫面操作。')
      await controls.prepare(product.name, productRef, configuration, selection, amount, note)
      const before = await readCart()
      const count = (lines: typeof before.lines) => lines.filter(line => line.productRef === productRef && line.configuration === selected.configuration && line.unitPrice === selected.unitPrice).reduce((sum, line) => sum + line.quantity, 0)
      // Native commit revalidates configuration and cart at the actual press,
      // after pointer travel. Repeating the same configuration fetch immediately
      // before that travel would add IO without strengthening the final gate.
      return { productRef, name: product.name, unitPrice: selected.unitPrice, configuration: selected.configuration, commit: onDispatch => controls.add(product.name, productRef, async () => {
        const [products, cart] = await Promise.all([readCatalog([productRef]), readCart()])
        const current = products.find(candidate => candidate.ref === productRef)?.configurations.find(candidate => candidate.variantRef === selection.variantRef)
        if (!current || current.version !== selection.version)
          throw new Error('派送前餐點規格或價格已變更，尚未加入。')
        if (JSON.stringify(cart) !== JSON.stringify(before))
          throw new Error('移動期間購物車已變更，尚未加入。')
      }, async () => count((await readCart()).lines) === count(before.lines) + amount, () => {
        beginWrite()
        onDispatch()
      }) }
    },
    setQuantity: (ref, amount, onDispatch, equivalentRefs) => editLine(ref, amount, onDispatch, equivalentRefs),
    remove: (ref, onDispatch, equivalentRefs) => editLine(ref, undefined, onDispatch, equivalentRefs),
  })

  /** Explicit reception reset may discard the editable draft after accepted calls settle; it never replays submission. */
  function canResetCart(operationId?: string) {
    const marker = localStorage.getItem(blockedKey)
    // These markers block ordinary ordering and automatic recovery. An
    // explicit Restart has different authority: clear only the current editable
    // draft, verify it empty, then retire the previous warning into the old
    // reception's audit event. Result/payment pages expose no reset tool.
    const knownMarker = marker !== null && /^(?:order:|reset:)?[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(marker)
    return (!marker || knownMarker) && cartOperations.canRecover()
      && ![...(active?.operations.entries() ?? [])].some(([id, operation]) => id !== operationId && operation.name !== 'browser_recovery_context' && operation.status === 'pending')
  }

  /** Reads live site state without navigation; account fields never leave this document. */
  async function recoveryContext() {
    const atTable = location.pathname === journey.tablePath
    let state: unknown
    if (atTable) {
      // PB can require Start before its cart endpoint exists. Table admission
      // may authorize that one non-commerce transition, but proves no empty
      // cart and grants no retry of the old demand.
      state = { manualRevision, table: tablePicker?.selection(), page: 'table' }
    }
    else {
      const [products, cart] = await Promise.all([readCatalog(), readCart()])
      // Re-read only: an earlier add/edit can have committed before its readback
      // failed. Clear this document's cart marker only after the coordinator
      // proves the entire expected result. Submission/reset markers never qualify.
      if (writeMarker && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(writeMarker)
        && localStorage.getItem(blockedKey) === writeMarker && cartOperations.verifyPending(cart)) {
        localStorage.removeItem(blockedKey)
        writeMarker = undefined
      }
      // Equality evidence covers options/prices and pickup as well as the cart.
      // It is a local observation digest, never a vendor revision or write receipt.
      state = { manualRevision, products, cart, visible: observe(true) }
    }
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(state)))
    const contextKey = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
    const canRetry = !atTable && !localStorage.getItem(blockedKey) && cartOperations.canRecover() && ![...(active?.operations.values() ?? [])].some(operation => operation.name !== 'browser_recovery_context' && operation.status === 'pending')
    const marker = localStorage.getItem(blockedKey)
    let blockedBy: 'order' | 'reset' | 'cart' | 'operation' | undefined
    if (marker?.startsWith('order:'))
      blockedBy = 'order'
    else if (marker?.startsWith('reset:'))
      blockedBy = 'reset'
    else if (marker || !cartOperations.canRecover())
      blockedBy = 'cart'
    else if (!canRetry && !atTable)
      blockedBy = 'operation'
    return { source: 'browser', documentId, contextKey, canRetry, canReset: canResetCart(), ...(blockedBy ? { blockedBy } : {}) }
  }

  /** Presents fresh facts only after every selected ref has a unique rendered card. */
  async function presentProducts(refs: readonly string[], press = false, limit = 10, deferVisual = false, preservePage = false) {
    if (activeVisual?.signal.aborted)
      return { products: [], cue: 'cancelled' as const }
    if (!refs.length) {
      presentation.cancel()
      return { products: [], cue: 'cleared' as const }
    }
    // Replies also mention dishes on cart/invoice pages. Their optional speech
    // cues must never navigate or clear a customer's search to find a card.
    if (preservePage && location.pathname !== journey.menuPath)
      return { products: [], cue: 'cancelled' as const }
    const revision = presentation.revision()
    const catalog = await readCatalog(undefined, false, activeVisual?.signal)
    if (revision !== presentation.revision())
      return { products: [], cue: 'cancelled' as const }
    const matched = catalog.filter(product => refs.includes(product.ref))
    if (matched.length !== new Set(refs).size) {
      presentation.cancel()
      // No partial presentation can prove the requested filter. Preserve the
      // fresh identity mapping so Main can repair names or stale refs instead
      // of interpreting an empty cue as no matching products.
      return { products: [], cue: 'cleared' as const, unresolvedProductRefs: refs.filter(ref => !catalog.some(product => product.ref === ref)), availableProducts: catalog.map(product => ({ ref: product.ref, name: product.name })) }
    }
    // Validate all requested identities before limiting a recommendation. Keep
    // Main's ranking order; catalog order must not silently choose the batch.
    const byRef = new Map(matched.map(product => [product.ref, product]))
    const products = [...new Set(refs)].slice(0, limit).map(ref => byRef.get(ref)!)
    const evidence = products.map(product => ({ ref: product.ref, name: product.name, ...(product.kind === 'product' && product.priceType === 1 ? { price: product.price } : {}) }))
    const cardFor = (name: string) => {
      if (catalog.filter(product => product.name === name).length !== 1)
        return undefined
      const headings = Array.from(document.querySelectorAll<HTMLElement>('main [role="button"] h4, main button h4')).filter(element => element.textContent?.trim() === name && element.getClientRects().length > 0)
      return headings.length === 1 ? headings[0].closest<HTMLElement>('button, [role="button"]') ?? undefined : undefined
    }
    if (location.pathname !== journey.menuPath || products.some(product => !cardFor(product.name))) {
      if (preservePage)
        return { products: [], cue: 'cancelled' as const }
      // Catalog reads do not change PB's old search. Reveal through its real
      // controls, then await every selected card, including later comparison
      // subjects. Showing just the first card cannot prove a synchronized batch.
      if (!currentControls)
        throw new Error('目前無法同步菜單畫面，請確認後再試。')
      await currentControls.search('', () => products.every(product => Boolean(cardFor(product.name))))
    }
    if (activeVisual?.signal.aborted)
      return { products: [], cue: 'cancelled' as const }
    if (deferVisual)
      return { products: evidence, cue: 'prepared' as const }
    // Each spoken dish owns its own label, scroll and frame. Passing all names
    // to the first card makes off-screen recommendations appear unpresented.
    return presentation.introduce(async () => {
      let durationMs = 0
      for (let index = 0; index < evidence.length; index++) {
        const shown = await presentation.show([evidence[index]], cardFor(products[index].name), press, [], undefined, evidence.length > 1 ? 1000 : 0)
        durationMs += shown.durationMs ?? 0
        if (shown.cue === 'target-unavailable')
          throw new Error('餐點資料已查到，但目前無法同步顯示要介紹的品項；請確認畫面後再繼續。')
        if (shown.cue !== 'shown' || activeVisual?.signal.aborted)
          return { products: [], cue: 'cancelled' as const }
      }
      return { products: evidence, cue: 'shown' as const, durationMs }
    })
  }

  async function execute(name: string, input: Record<string, unknown>, operationId: string, admittedControlRevision: number) {
    const controller = new AbortController()
    activeVisual = controller
    if (admittedControlRevision !== controlRevision)
      controller.abort()
    // Reception reset stays visible. It may also finish while explicit Host
    // settings own visibility; document binding, cancellation, target checks
    // and merchant readback remain mandatory.
    const operation = createOperation({ documentId, operationId, signal: controller.signal, allowHidden: name === 'browser_customer_reset', follow: async (target, label, dispatch, prepare) => {
      if (name === 'browser_customer_reset') {
        invoiceInput.reset()
        checkout.reset()
        // Reset stays visible and skips illustrative travel/dwell only;
        // dispatch still performs all ownership,
        // hit-target and fresh-cart checks, then verifies the actual effect.
        target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
        await dispatch()
        return true
      }
      if (activeVisual !== controller)
        activeVisual?.abort()
      activeVisual = controller
      const result = await presentation.show([], target, true, [], { label, dispatch, prepare })
      return result.cue === 'shown'
    } })

    try {
      const result = await executeAction()
      return { ...result, execution: operation.snapshot() }
    }
    catch (error) {
      const execution = operation.snapshot()
      // Superseding a passive cue is successful cancellation, not a failed
      // customer operation. It supplies no product facts or write evidence.
      if (name === 'browser_present' && controller.signal.aborted)
        return { ok: true, source: 'browser', presentation: { products: [], cue: 'cancelled' }, dataOnly: true, execution }
      // Passive card framing cannot change a cart. An unavailable target is
      // a known display failure, even when no control step was needed; do not
      // turn it into a transport failure or an unknown merchant operation.
      if (name === 'browser_present')
        return { ok: false, source: 'browser', status: 'rejected', effect: 'none', execution, error: errorMessageFrom(error), customerMessage: '餐點資料已查到，但暫時無法在畫面標示；可以繼續點餐。' }
      if (!execution.steps.length)
        throw error
      const uncertain = execution.steps.some(step => step.state === 'unknown')
      return { ok: false, source: 'browser', status: uncertain ? 'unknown' : 'rejected', effect: uncertain ? 'unknown' : 'none', execution, customerMessage: errorMessageFrom(error) ?? '畫面步驟未完成，請確認目前狀態。' }
    }
    finally {
      currentControls = undefined
      if (activeVisual === controller)
        activeVisual = undefined
    }
    async function executeAction() {
      if (name === 'browser_state_get') {
        parse(strictObject({ includeCatalog: boolean() }), input)
        if (isPbOrderResultUrl(entry, location.href)) {
          const url = location.href
          const response = await fetch(url, { cache: 'no-store', redirect: 'error', headers: { 'X-Inertia': 'true', 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'text/html, application/xhtml+xml' }, signal: AbortSignal.timeout(8000) })
          if (!response.ok || response.url !== url || response.headers.get('X-Inertia') !== 'true')
            throw new Error('訂單狀態暫時無法讀取，請先查看畫面，避免重複送單。')
          const order = readPbOrderState(entry, url, await response.json())
          if (location.href !== url)
            throw new Error('訂單狀態屬於已離開的頁面。')
          // A result page grants no editor controls. Its fresh lifecycle decision
          // permits only Host entry reload after a terminal payment state. Never
          // clear a journal marker or infer settlement from the page title.
          let restart = 'allowed'
          if (localStorage.getItem(blockedKey) || [...(active?.operations.values() ?? [])].some(operation => operation.name !== 'browser_state_get' && operation.status === 'pending'))
            restart = 'operation-pending'
          else if (order.paymentStatus === 'pending')
            restart = 'payment-pending'
          else if (order.paymentStatus === 'unknown')
            restart = 'payment-unknown'
          return { ok: true, source: 'browser', effect: 'none', dataOnly: true, page: url.endsWith('/choosePayment') ? 'payment' : 'order-result', observedAt: Date.now(), documentId, order, restart }
        }
        // Editor reads retain the same cart/catalog and DOM form verifier. This
        // internal variant cannot request admission actions or consume answers.
        name = 'browser_cart_get'
      }
      try {
        assertScope()
      }
      catch (error) { return { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: errorMessageFrom(error) ?? '請返回點餐菜單。' } }
      const controls = createControls(operation, controller.signal)
      currentControls = controls
      if (location.pathname === journey.tablePath && name !== 'browser_customer_reset') {
        if (name === 'browser_recovery_context')
          return recoveryContext()
        const tableChoices = await tablePicker!.choices()
        const tap = async (target: HTMLElement, label: string, press: () => void) => {
          // Restart keeps customer controls covered. Only this Host-only entry
          // skips the illustrative hand; the table picker still verifies the
          // actual current selection and presses PB's real Start button once.
          if (name === 'browser_start_ordering' && input.forReset === true) {
            controller.signal.throwIfAborted()
            press()
            return
          }
          let dispatched = false
          const result = await presentation.show([], target, true, [], { label, dispatch: async (onPress) => {
            controller.signal.throwIfAborted()
            onPress()
            press()
            dispatched = true
          } })
          // PB may navigate immediately after Start and retire its hand. The
          // menu-ready check owns completion after a real click was dispatched.
          if (!dispatched && result.cue !== 'shown')
            throw new Error('桌號選擇已中止，請再告訴我您的桌號或選擇櫃台自取。')
        }

        if (name === 'browser_start_ordering') {
          const selectedTable = await tablePicker!.start(parse(strictObject({ name: text, forReset: optional(boolean()) }), input).name, controller.signal, tap)
          return { ok: true, source: 'browser', code: 'table-entry-starting', effect: 'none', selectedTable, customerMessage: '正在準備菜單。' }
        }
        const selectedTable = name === 'browser_table_select' ? await tablePicker!.choose(parse(strictObject({ name: text }), input).name, controller.signal, tap) : tablePicker!.selection()
        // Only the Host's preparation/review/reset requests may inspect a
        // previous cart before admission. Ordinary table context stays free
        // of prior customer data; a table page alone never proves emptiness.
        let admission: Record<string, unknown> = {}
        if (name === 'browser_cart_get' && input.forAdmission === true) {
          try {
            admission = { cart: await cartOperations.observe() }
          }
          catch (error) {
            if (!(error instanceof Error) || error.cause !== 'pb-table-entry-required')
              throw error
            admission = { cartAdmission: 'after-table-entry' }
          }
        }
        return { ok: true, source: 'browser', observedAt: Date.now(), documentId, page: 'table', code: 'table-selection-required', effect: 'none', tableChoices, ...(selectedTable ? { selectedTable } : {}), ...admission, customerMessage: selectedTable ? `已選擇${selectedTable}，請說「開始點餐」，或點畫面的開始點餐按鈕。` : '內用請先找到座位，再回來告訴我您的桌號；外帶可以選櫃台自取。這裡沒有外送服務。' }
      }
      if (name === 'browser_table_select' || name === 'browser_start_ordering')
        return { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '目前不在選桌頁，尚未更換桌號。' }
      if (['browser_cart_add', 'browser_cart_quantity', 'browser_cart_remove', 'browser_cart_replace', 'browser_set_note', 'browser_return_menu'].includes(name))
        invoiceInput.leave()
      let customerMessage: string | undefined
      let includeDescriptions = true
      let purpose: 'information' | 'choose_product' = 'information'
      let productCue: Awaited<ReturnType<typeof presentProducts>> | undefined
      if (name === 'browser_present') {
        const { productRefs, mode, deferVisual, preservePage } = parse(browserPresentationInputSchema, input)
        const limit = mode === 'information' ? 10 : browserRecommendationLimit
        if (mode === 'information' && new Set(productRefs).size > limit)
          return { ok: true, source: 'browser', status: 'proposal_rejected', effect: 'none', dataOnly: true, explanation: '明確資訊查詢每次最多呈現 10 項。請保留顧客原本查詢範圍，分批查證與呈現，不把前 10 項當成完整答案。這次尚未呈現任何品項。' }
        const selected = await presentProducts(productRefs, false, limit, deferVisual, preservePage)
        if ('unresolvedProductRefs' in selected)
          return { ok: true, source: 'browser', status: 'proposal_rejected', effect: 'none', dataOnly: true, presentation: { products: [], cue: selected.cue }, unresolvedProductRefs: selected.unresolvedProductRefs, products: selected.availableProducts, explanation: 'productRefs 必須複製當前 products 的 ref 欄位，不能填商品名稱。這次尚未呈現任何餐點，也未變更購物車；不是查無商品。請保留顧客完整篩選條件，依這份新鮮對照使用 ref 重新呼叫 browser_present。' }
        return { ok: true, source: 'browser', presentation: selected, mode, presentationLimit: limit, selectionTruncated: selected.products.length < new Set(productRefs).size, ...(selected.products.length ? { customerMessage: describeProducts(selected.products) } : { dataOnly: true }) }
      }
      if (name === 'browser_close_product') {
        parse(strictObject({}), input)
        await controls.close()
        return { ok: true, source: 'browser', status: 'verified', effect: 'none', customerMessage: '已取消這次選餐，購物車內容保持不變。' }
      }
      if (name === 'browser_return_menu') {
        parse(strictObject({}), input)
        const before = await readCart()
        await controls.close()
        await controls.navigate(journey.menuPath)
        const catalog = await readCatalog(undefined, false)
        await controls.search('', () => catalog.every(product => observe().products.some(visible => visible.name === product.name)))
        presentation.cancel()
        const after = await readCart()
        if (JSON.stringify(before) !== JSON.stringify(after))
          return { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '已返回菜單，但購物車內容有變動，請先重新核對。' }
        return { ok: true, source: 'browser', status: 'verified', effect: 'none', page: 'menu', cart: await cartOperations.observe(), customerMessage: '已清除搜尋，回到完整菜單。想點哪道餐點？也可以請我推薦。' }
      }
      if (name === 'browser_cart_get' || name === 'browser_cart_review') {
        let includeCatalog = false
        if (name === 'browser_cart_get')
          includeCatalog = parse(strictObject({ includeCatalog: boolean(), forAdmission: optional(boolean()) }), input).includeCatalog
        else
          parse(strictObject({}), input)
        const [products, observed] = await Promise.all([includeCatalog ? readCatalog() : undefined, cartOperations.observe()])
        // The first Host admission after table entry owns this harmless view
        // transition. Do not leave a store announcement covering the new menu.
        if (name === 'browser_cart_get' && input.forAdmission === true && location.pathname === journey.menuPath)
          await controls.dismissAnnouncement()
        let cart = observed
        if (name === 'browser_cart_review' && cart.lines.length) {
          await controls.navigate(journey.cartPath)
          cart = await cartOperations.observe()
          await checkout.reveal(controls)
        }
        const productDialog = observe().productDialog.flatMap(dialog => dialog.name ? [{ name: dialog.name }] : [])
        const checkoutState = checkout.read()
        return { ok: true, source: 'browser', observedAt: Date.now(), documentId, menuReady: location.pathname === journey.menuPath && observe().products.length > 0, itemSelectionOpen: productDialog.length > 0, productDialog, search: document.querySelector<HTMLInputElement>('input[placeholder="搜尋品項，例如：拿鐵、雞腿、套餐"]')?.value ?? '', page: location.pathname === journey.cartPath ? 'cart' : 'menu', cart, ...(checkoutState ? { checkout: checkoutState } : {}), ...(products ? { products, dataOnly: true } : { customerMessage: cart.lines.length ? `目前購物車：${describeCartLines(cart.lines)}。小計 ${cart.subtotal} 元。` : '購物車目前沒有餐點。' }) }
      }
      else if (name === 'browser_checkout_prepare' || name === 'browser_invoice_select' || name === 'browser_notification_phone' || name === 'browser_order_submit') {
        if (localStorage.getItem(blockedKey))
          return { ok: false, source: 'browser', status: 'unknown', effect: 'none', customerMessage: '先前操作仍在確認，請先查看目前訂單畫面，避免重複送出。' }
        if (name === 'browser_order_submit') {
          const { confirmationToken } = parse(strictObject({ confirmationToken: text }), input)
          invoiceInput.leave()
          return checkout.submit(confirmationToken, controls)
        }
        await controls.navigate(journey.cartPath)
        await checkout.reveal(controls)
        let state
        if (name === 'browser_invoice_select') {
          state = await checkout.choose(parse(strictObject({ method: pbInvoiceMethodSchema }), input).method, controls)
          await checkout.focus('next', controls)
        }
        else if (name === 'browser_notification_phone') {
          await checkout.phone(parse(strictObject({ phone: text }), input).phone, controls)
          // Phone consent fills a draft only. Prepare a fresh final-summary
          // ticket after its native input events, never reuse the pre-fill form.
          state = await checkout.prepare()
        }
        else {
          const { focus } = parse(strictObject({ focus: optional(picklist(['invoice', 'next'])) }), input)
          await checkout.focus(focus ?? 'next', controls)
          state = await checkout.prepare()
        }
        if (state.ready)
          invoiceInput.leave()
        return { ok: true, source: 'browser', page: 'cart', dataOnly: true, cart: await cartOperations.observe(), checkout: state }
      }
      else if (name === 'browser_product_get') {
        const { names } = parse(strictObject({ names: pipe(array(text), minLength(1), maxLength(10)) }), input)
        const index = await readCatalog(undefined, false)
        const references: string[] = []
        for (const name of new Set(names)) {
          const matches = index.filter(product => product.name === name)
          if (matches.length !== 1)
            return { ok: true, source: 'browser', status: 'clarification', effect: 'none', customerMessage: matches.length ? `目前有同名的「${name}」，請先在畫面確認是哪一項。` : `目前完整分類資料沒有找到「${name}」，請確認名稱。` }
          references.push(matches[0].ref)
        }
        const fresh = await readCatalog(references)
        const products = fresh.filter(product => references.includes(product.ref))
        if (products.length !== references.length || products.some(product => !names.includes(product.name)))
          throw new Error('讀取期間菜單已變更，請重新確認商品。')
        return { ok: true, source: 'browser', dataOnly: true, products, cart: await cartOperations.observe() }
      }
      else if (['browser_cart_add', 'browser_cart_quantity', 'browser_cart_remove', 'browser_cart_replace'].includes(name)) {
        const previousMarker = localStorage.getItem(blockedKey)
        if (previousMarker) {
          let blockedBy: 'order' | 'reset' | 'cart' = 'cart'
          if (previousMarker.startsWith('order:'))
            blockedBy = 'order'
          else if (previousMarker.startsWith('reset:'))
            blockedBy = 'reset'
          // The earlier operation remains unconfirmed. This request has not
          // entered any vendor step, so its own effect is definitively none.
          // Do not erase the persisted marker or turn this refusal into a retry.
          return { ok: false, source: 'browser', status: 'rejected', effect: 'none', code: 'previous-operation-unconfirmed', blockedBy, customerMessage: orderingMessages['zh-Hant'].previousOperation[blockedBy] }
        }
        const fields = name === 'browser_cart_replace'
          ? parse(strictObject({ version: text, lineRef: text, lineRefs: optional(pipe(array(text), minLength(1), maxLength(2_000))), retainQuantity: optional(pipe(number(), integer(), minValue(0), maxValue(197999))), productRef: text, quantity, unitPrice: pipe(number(), minValue(0)), note: text, selection: selectionSchema }), input)
          : name === 'browser_cart_add'
            ? parse(strictObject({ version: text, copySourceRef: optional(text), productRef: text, quantity, unitPrice: pipe(number(), minValue(0)), note: text, selection: selectionSchema }), input)
            : name === 'browser_cart_quantity'
              ? parse(strictObject({ version: text, lineRef: text, lineRefs: optional(pipe(array(text), minLength(1), maxLength(2_000))), quantity }), input)
              : parse(strictObject({ version: text, lineRef: text, lineRefs: optional(pipe(array(text), minLength(1), maxLength(2_000))) }), input)
        const returnToCart = location.pathname === journey.cartPath
        const action = name === 'browser_cart_replace' ? 'replace' : name === 'browser_cart_add' ? 'add' : name === 'browser_cart_quantity' ? 'quantity' : 'remove'
        const beforeCart = 'lineRef' in fields ? await readCart() : undefined
        const priorLine = beforeCart?.lines.find(line => 'lineRef' in fields && line.ref === fields.lineRef)
        if (beforeCart && 'lineRefs' in fields && fields.lineRefs && (!currentControls || !currentControls.canEdit(beforeCart.lines, fields.lineRefs))) {
          return { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '這組餐點的畫面配置仍無法唯一對應；尚未變更購物車，請先確認。' }
        }
        const targetRef = 'productRef' in fields ? fields.productRef : priorLine?.productRef
        const result = await cartOperations.execute({ ...fields, action, quantity: 'quantity' in fields ? fields.quantity : 1, note: 'note' in fields ? fields.note : '' })
        if (result.status === 'rejected' && 'reason' in result && result.reason === 'unit-price-mismatch') {
          return { ok: true, source: 'browser', status: 'proposal_rejected', effect: 'none', dataOnly: true, expectedUnitPrice: result.expectedUnitPrice, explanation: `提案單價不符，尚未派送任何寫入。unitPrice 是每份含所選加購的單價 ${result.expectedUnitPrice}，不是整行總價；selection.choices[].quantity 也是每份數量。請依原句與最新規格修正參數，不改選商品。` }
        }
        if (result.ok && result.cart && writeMarker && localStorage.getItem(blockedKey) === writeMarker) {
        // Keep the marker while UI navigation is pending: if it unexpectedly
        // replaces this world, the new document must retain the recovery block.
          let displayUpdated = false
          try {
            // Editing on checkout must not detour through the menu: PB rebuilds
            // invoice/contact drafts when checkout is entered again. The cart
            // coordinator already verified the edited row and fresh server cart.
            await controls.navigate(returnToCart ? journey.cartPath : journey.menuPath)
            await controls.ready(() => {
              if (returnToCart)
                return Boolean(document.querySelector('.order-create'))
              const totals = Array.from(document.querySelectorAll('span.text-xl.font-bold.ms-2'))
              return Boolean(document.querySelector('input[placeholder="搜尋品項，例如：拿鐵、雞腿、套餐"]')) && (result.cart!.subtotal === 0 && !result.cart!.lines.length ? totals.length === 0 : totals.length === 1 && Number(totals[0].textContent?.replace(/[^\d.]/g, '')) === result.cart!.subtotal)
            }, true)
            displayUpdated = true
          }
          catch {
            // A verified merchant effect remains verified if only its return
            // navigation fails. Report display failure; never retry the write.
          }
          localStorage.removeItem(blockedKey)
          writeMarker = undefined
          // A stale display cannot undo a verified merchant effect. Preserve the
          // receipt and never report an unexecuted write that might be retried.
          // The verified cart owns the added/changed identity. A removed line's
          // fresh preflight identity is retained for its completion label only.
          // Neither case needs another whole-menu read for presentation.
          const target = result.cart.lines.find(line => line.productRef === targetRef) ?? priorLine
          return { ...result, source: 'browser', presentation: target ? { products: [{ ref: target.productRef, name: target.name }], cue: 'shown', stage: 'completed', durationMs: operation.snapshot().durationMs } : undefined, displayUpdated, customerMessage: displayUpdated ? result.customerMessage : `${result.customerMessage} 畫面小計尚未同步，請重新整理確認；不要重複加入。` }
        }
        return { ...result, source: 'browser' }
      }
      else if (name === 'browser_customer_reset') {
        presentation.cancel()
        parse(strictObject({}), input)
        if (!canResetCart(operationId))
          throw new Error('先前操作尚未確認，請先由工作人員查看購物車。')
        // Restart discards the current draft; it never repeats an old add or
        // submission. Keep its barrier until clear/readback succeeds. The Host
        // records the retired warning in the ending visitor's audit history.
        const priorWriteMarker = writeMarker
        const previousMarker = localStorage.getItem(blockedKey)
        writeMarker = previousMarker ?? undefined
        const cleared = await cartOperations.clear()
        if (!cleared.ok) {
          // A missing/disabled clear control dispatched nothing. Keep the old
          // marker, but do not turn its adoption into a new uncertain write.
          if (cleared.status !== 'unknown')
            writeMarker = priorWriteMarker
          return { ...cleared, source: 'browser' }
        }
        // Clear is verified independently from returning to the menu. If later
        // navigation fails, an empty-cart retry will not click clear a second time.
        // Only PB's product draft may be closed; generic confirmations and
        // order submission controls never belong to the customer-reset flow.
        // PB puts role=dialog on el-overlay-dialog, outside .menu-dialog.
        // Identify the product by its observed note field or inner product class.
        const drafts = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).filter(element => element.getClientRects().length > 0 && (element.querySelector('.menu-dialog') || element.querySelector('input[placeholder="商品有特殊需求，請在此備註"]')))
        const atTable = location.pathname === journey.tablePath
        if (!atTable) {
          await controls.navigate(journey.menuPath)
          await controls.close()
          await controls.search('')
        }
        const search = document.querySelector<HTMLInputElement>('input[placeholder="搜尋品項，例如：拿鐵、雞腿、套餐"]')
        const after = await readCart()
        if (drafts.some(dialog => dialog.getClientRects().length > 0) || (!atTable && search?.value !== '') || after.lines.length || after.subtotal !== 0)
          throw new Error('換客期間的商品視窗或購物車尚未確認，請工作人員查看。')
        // Keep the previous warning through the final verification so a failed
        // reset can still be audited when the operator retries Restart.
        const remainingMarker = localStorage.getItem(blockedKey)
        if (remainingMarker && remainingMarker !== writeMarker)
          throw new Error('其他點餐畫面的操作仍在確認，請由工作人員查看。')
        if (remainingMarker)
          localStorage.removeItem(blockedKey)
        writeMarker = undefined
        // Revoke prior cart versions/retry digests without replacing this PB document.
        // The Host then revokes its connection and visitor consent independently.
        manualRevision++
        let retiredOperation: 'order' | 'reset' | 'cart' | undefined
        if (previousMarker) {
          retiredOperation = 'cart'
          if (previousMarker.startsWith('order:'))
            retiredOperation = 'order'
          else if (previousMarker.startsWith('reset:'))
            retiredOperation = 'reset'
        }
        return { ok: true, source: 'browser', status: 'customer-reset', cartCleared: true, documentId, ...(retiredOperation ? { retiredOperation } : {}) }
      }
      else if (name === 'browser_recovery_context') {
        parse(strictObject({}), input)
        return recoveryContext()
      }
      else if (name === 'browser_observe') {
        const options = parse(strictObject({ includeDescriptions: boolean(), purpose: picklist(['information', 'choose_product']) }), input)
        includeDescriptions = options.includeDescriptions
        purpose = options.purpose
      }
      else if (name === 'browser_clarify_product') {
        const { query } = parse(strictObject({ query: text }), input)
        await controls.search(query)
        const names = observe().products.map(product => product.name).filter(Boolean)
        if (!names.length)
          throw new Error('No visible choices; clear the search first.')
        customerMessage = `請問您要${names.join('、')}，哪一項？`
      }
      else if (name === 'browser_search') {
        const { query } = parse(strictObject({ query: text }), input)
        presentation.cancel()
        if (query.trim()) {
          const previous = document.querySelector<HTMLInputElement>('input[placeholder="搜尋品項，例如：拿鐵、雞腿、套餐"]')?.value.trim()
          if (previous) {
            const catalog = await readCatalog(undefined, false)
            // Restore the complete current catalog before applying another
            // filter. An empty input alone precedes PB's asynchronous render.
            await controls.search('', () => {
              const visible = observe().products
              return catalog.every(product => visible.some(item => item.name === product.name))
            })
          }
          await controls.search(query)
        }
        else {
          // Clearing recommendations means the full current menu, not a stale
          // filtered render whose input happens to have been emptied already.
          const catalog = await readCatalog(undefined, false)
          await controls.search('', () => {
            const visible = observe().products.map(product => product.name)
            return catalog.every(product => visible.includes(product.name))
          })
        }
      }
      else if (name === 'browser_open_product') {
        const { name: productName } = parse(strictObject({ name: text }), input)
        const matches = (await readCatalog(undefined, false)).filter(product => product.name === productName)
        if (matches.length !== 1)
          throw new Error('同名或已下架商品需要重新確認，尚未點擊。')
        await controls.open(productName, matches[0].ref)
      }
      else if (name === 'browser_quote_selection') {
        const { productRef, quantity: amount, selection } = parse(strictObject({ productRef: text, quantity, selection: selectionSchema }), input)
        const product = (await readCatalog([productRef])).find(product => product.ref === productRef)
        const configuration = product?.configurations.find(configuration => configuration.variantRef === selection.variantRef)
        if (!product || !configuration)
          throw new Error('商品或所選規格已變更，請重新查詢目前規格。')
        const selected = resolveSelection(configuration, selection, '')
        const total = Math.round(selected.unitPrice * 100) * amount / 100
        const options = selected.choices.map((choice) => {
          const option = configuration.groups.flatMap(group => group.choices).find(option => option.ref === choice.ref)!
          return { name: option.name, quantity: choice.quantity, unitPrice: option.unitPrice }
        })
        // A configured quote must retain the base/add-on prices; otherwise a
        // correct combined total still cannot answer what the extra costs.
        const breakdown = options.length ? `基本單價 ${configuration.unitPrice} 元；加購：${options.map(option => `${option.name} 每個 ${option.unitPrice} 元、每份 ${option.quantity} 個`).join('；')}。` : ''
        return { ok: true, source: 'browser', effect: 'none', unitPrice: selected.unitPrice, total, presentation: await presentProducts([productRef]), customerMessage: `${pbProductName(product.name)} ${amount} 份。${breakdown}單份 ${selected.unitPrice} 元，合計 ${total} 元。本次僅查價，尚未加入購物車。` }
      }
      else if (name === 'browser_quote') {
        const { name: productName, quantity } = parse(strictObject({ name: text, quantity: pipe(number(), integer(), minValue(1), maxValue(99)) }), input)
        const matches = (await readCatalog()).filter(product => product.name === productName)
        const product = matches.length === 1 ? matches[0] : undefined
        if (!product || product.kind !== 'product' || product.priceType !== 1 || !Number.isFinite(product.price))
          throw new Error('No unambiguous visible price for this exact product; search or clarify first.')
        productCue = await presentProducts([product.ref])
        customerMessage = `${describePbMeal({ name: product.name, quantity, unitPrice: product.price, options: [] })}，單份 ${product.price} 元，合計 ${Math.round(product.price * 100) * quantity / 100} 元，未含另外加購。`
      }
      else if (name === 'browser_set_note') {
        const { note } = parse(strictObject({ note: text }), input)
        await controls.note(note)
      }
      else {
        throw new Error('This prototype does not expose that action.')
      }
      // Input actions already await their concrete readiness condition.
      const snapshot = observe(name === 'browser_set_note')
      if (name === 'browser_observe') {
        const products = await readCatalog()
        snapshot.products = products.map(product => ({ ref: product.ref, name: product.name, price: product.kind === 'product' && product.priceType === 1 ? product.price : undefined, details: snapshot.products.find(visible => visible.name === product.name)?.details ?? '' }))
        if (purpose === 'choose_product')
          productCue = await presentProducts(products.slice(0, browserRecommendationLimit).map(product => product.ref))
        snapshot.catalogScope = 'Fresh PB product lists for the current pickup time; product groups and required variants need separate configuration.'
        if (purpose === 'choose_product') {
          snapshot.products = snapshot.products.slice(0, browserRecommendationLimit)
          snapshot.catalogScope = 'A bounded spoken choice batch from the current pickup catalog; this is not a vendor website page or the entire menu.'
        }
      }
      if (!includeDescriptions)
        snapshot.products = snapshot.products.map(product => ({ ...product, details: '' }))
      if ((name === 'browser_observe' && purpose === 'choose_product') || name === 'browser_search') {
        customerMessage = snapshot.products.length
          ? describeProducts(snapshot.products)
          : '目前搜尋沒有找到這道餐點。可以換一道餐點，或說「回到菜單」看全部餐點。'
        if (purpose === 'choose_product' && snapshot.products.length)
          customerMessage = `請問您要${snapshot.products.map(product => pbProductName(product.name)).join('、')}，哪一項？`
        if (name === 'browser_search' && typeof input.query === 'string' && !input.query.trim())
          customerMessage = '已清除搜尋，回到目前完整菜單。您可以看看其他餐點，或告訴我想找什麼。'
      }
      if (name === 'browser_search' && snapshot.products.length === 0) {
        // Missing results are information, not an issued customer question.
        // Main must still check the other dishes in the same utterance.
        return { ok: true, ...snapshot, status: 'not-found', effect: 'none', search: input.query, customerMessage: `目前搜尋沒有找到「${input.query}」。`, explanation: '僅完成這個關鍵字的搜尋；請繼續查詢原句其他餐點，全部核對後一起回覆。' }
      }
      return { ok: true, ...snapshot, ...(name === 'browser_observe' && purpose === 'information' ? { dataOnly: true } : {}), ...(productCue ? { presentation: productCue } : {}), ...(name === 'browser_search' ? { search: input.query } : {}), ...(customerMessage ? { customerMessage } : {}) }
    }
  }

  function discover(raw: unknown) {
    console.info('Webnavior PB discovery received.')
    const request = parse(discoveryRequestSchema, raw)
    if (active?.id !== request.connectionId)
      active = { id: request.connectionId, operations: new Map() }
    const available = isPbOrderResultUrl(entry, location.href) ? tools.filter(tool => ['browser_state_get', 'browser_reception_reset'].includes(tool.name)) : tools
    return { ...request, documentId, toolsRevision: 1, tools: available }
  }
  function enqueue(request: InferOutput<typeof executionRequestSchema>, binding: NonNullable<typeof active>) {
    if (request.name === 'browser_reception_reset') {
      parse(strictObject({}), request.input)
      // This local lifecycle command bypasses the commerce FIFO. Retire queued
      // controls before clearing our marker; already-dispatched PB work is not
      // cancelled or classified as successful. The Host immediately renews entry.
      controlRevision++
      activeVisual?.abort()
      presentation.cancel()
      invoiceInput.leave()
      checkout.reset()
      manualRevision++
      const marker = localStorage.getItem(blockedKey)
      let retiredOperation: 'order' | 'reset' | 'cart' | undefined
      if (marker) {
        retiredOperation = 'cart'
        if (marker.startsWith('order:'))
          retiredOperation = 'order'
        else if (marker.startsWith('reset:'))
          retiredOperation = 'reset'
      }
      localStorage.removeItem(blockedKey)
      writeMarker = undefined
      return Promise.resolve({ ok: true, source: 'browser', status: 'reception-reset', documentId, merchantState: 'untouched', ...(retiredOperation ? { retiredOperation } : {}) })
    }
    const revision = presentation.revision()
    const admittedControlRevision = controlRevision
    if (request.name === 'browser_present') {
      const { productRefs } = parse(browserPresentationInputSchema, request.input)
      if (!productRefs.length) {
        // Explicit takeover/reset cancels the visual owner immediately. An
        // accepted cart dispatch still settles through its verification owner.
        controlRevision++
        activeVisual?.abort()
        presentation.cancel()
        return Promise.resolve({ ok: true, source: 'browser', presentation: { products: [], cue: 'cleared' } })
      }
      if (queuedCount)
        return Promise.resolve({ ok: true, source: 'browser', presentation: { products: [], cue: 'cancelled' } })
    }
    else if (executingName === 'browser_present') {
      // A new required operation supersedes passive speech presentation only,
      // never an accepted merchant action or its readback. Cancel its catalog
      // IO too: hiding the cue alone leaves the FIFO blocked until fetch timeout.
      activeVisual?.abort()
      presentation.cancel()
    }
    queuedCount++
    const result = executionQueue.then(async () => {
      let receipt: unknown
      try {
        if (active !== binding)
          throw new Error('The queued browser binding has changed; nothing was dispatched.')
        if (controlTools.has(request.name) && admittedControlRevision !== controlRevision)
          throw new Error('使用者已接手或畫面已隱藏，尚未派送這筆排隊操作。')
        if (request.name === 'browser_present' && revision !== presentation.revision()) {
          receipt = { ok: true, source: 'browser', presentation: { products: [], cue: 'cancelled' } }
          return receipt
        }
        executingName = request.name
        receipt = await execute(request.name, request.input, request.operationId, admittedControlRevision)
        return receipt
      }
      finally {
        // Publish settlement before the next FIFO entry can inspect the journal.
        // A downstream result.then runs too late: an immediately queued reset
        // could mistake the cancelled speech cue for unfinished merchant work.
        const tracked = binding.operations.get(request.operationId)
        if (tracked)
          tracked.status = receipt && typeof receipt === 'object' && 'status' in receipt && receipt.status === 'unknown' ? 'failed' : 'settled'
        executingName = undefined
        queuedCount--
      }
    })
    // Failures settle this queue position; they cannot poison future reads.
    // Cart unknown-state markers still independently prevent another write.
    executionQueue = result.then(() => {}, () => {})
    return result
  }

  async function executeRequest(raw: unknown) {
    const request = parse(executionRequestSchema, raw)
    if (!active || request.connectionId !== active.id || request.documentId !== documentId || request.toolsRevision !== 1)
      throw new Error('The browser binding has changed.')
    const fingerprint = JSON.stringify({ name: request.name, input: request.input })
    let operation = active.operations.get(request.operationId)
    if (operation && operation.fingerprint !== fingerprint)
      throw new Error('Operation ID was reused for different input.')
    if (!operation) {
      if (active.operations.size >= 256)
        throw new Error('Prototype operation limit reached; stop this experiment.')
      // Cart writes classify failures inside their coordinator after dispatch.
      // Exceptions here are argument/preparation failures before a control effect;
      // dispatched cart/order failures already carry execution/coordinator receipts.
      const result = enqueue(request, active).catch((error) => {
        // Only pageProps produces this cause after reading the current vendor
        // auth state. Do not infer login loss from arbitrary English error text
        // or reclassify a coordinator's unknown/partial cart-write receipt.
        if (error instanceof Error && error.cause === 'sign-in-required')
          return { ok: false, source: 'browser', status: 'rejected', effect: 'none', code: 'sign-in-required', error: error.message }
        if (['browser_cart_add', 'browser_cart_quantity', 'browser_cart_remove', 'browser_cart_replace'].includes(request.name) && isValiError(error))
          return { ok: true, source: 'browser', status: 'proposal_rejected', effect: 'none', dataOnly: true, error: errorMessageFrom(error) ?? 'PB arguments were rejected.', explanation: '工具參數未符合 schema，尚未派送購物車寫入。請修正參數：version 使用最新 cart.version，selection.version 使用所選 product.configurations 的 version；不得省略規格版本。只修正本輪原需求，不改選商品或規格。' }
        return { ok: false, source: 'browser', status: 'rejected', effect: 'none', error: errorMessageFrom(error) ?? 'PB operation was rejected.' }
      })
      operation = { name: request.name, fingerprint, result, status: 'pending' }
      active.operations.set(request.operationId, operation)
      const accepted = operation
      void result.then((receipt) => {
        accepted.status = receipt && typeof receipt === 'object' && 'status' in receipt && receipt.status === 'unknown' ? 'failed' : 'settled'
      }, () => accepted.status = 'failed')
    }
    const result = await operation.result
    return { connectionId: request.connectionId, documentId, operationId: request.operationId, result }
  }
  function inspect(raw: unknown) {
    const request = parse(inspectionRequestSchema, raw)
    if (!active || request.connectionId !== active.id || request.documentId !== documentId)
      throw new Error('The browser binding has changed.')
    return { connectionId: active.id, documentId, pendingCount: [...active.operations.values()].filter(operation => operation.status === 'pending').length, operations: request.operationIds.map(operationId => ({ operationId, status: active!.operations.get(operationId)?.status ?? ('missing' as const) })) }
  }
  window.addEventListener('pagehide', () => {
    active = undefined
  }, { once: true })
  return { discover, execute: executeRequest, inspect }
}
