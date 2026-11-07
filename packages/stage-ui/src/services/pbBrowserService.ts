import type { ToolDescriptor } from '@proj-airi/stage-shared/interactive-service'
import type { InferOutput } from 'valibot'

import type { RouteName } from './pbRoutes'

import { errorMessageFrom } from '@moeru/std'
import { discoveryRequestSchema, executionRequestSchema, inspectionRequestSchema } from '@proj-airi/stage-shared/interactive-service'
import { array, boolean, integer, isValiError, looseObject, maxLength, maxValue, minLength, minValue, number, optional, parse, picklist, pipe, strictObject, string } from 'valibot'

import { createCartOperations, describeCartLines, readCartPage } from './pbCart'
import { readCatalog as collectCatalog } from './pbCatalog'
import { createControls } from './pbControls'
import { createOperation } from './pbOperation'
import { createPresentation } from './pbPresentation'
import { prepareAddition, resolveSelection } from './pbProduct'
import { resolveRoute } from './pbRoutes'

function describeProducts(products: readonly { name: string, price?: number }[]) {
  // An omitted price means the configuration still needs a separate lookup.
  return `目前查到：${products.map(product => `${product.name}${product.price === undefined ? '' : `，單份 ${product.price} 元`}`).join('；')}。`
}

/** Owns PB's bounded operations and document journal independently of its transport. */
export function createPbService() {
  /** SPA navigation keeps this listener alive; every admission must recheck scope. */
  function assertScope() {
    if (location.origin !== 'https://app.esgpb.com' || !['/order/store/1kgJeql/pick_up/menu', '/order/store/1kgJeql/pick_up/orders/create'].includes(location.pathname))
      throw new Error('目前已離開這家店的點餐菜單，請返回菜單後重新確認需求。')
  }

  assertScope()
  if (document.documentElement.hasAttribute('data-webnavior-pb-bridge'))
    throw new Error('PB service is already attached to this document.')
  document.documentElement.setAttribute('data-webnavior-pb-bridge', 'ready')
  const documentId = crypto.randomUUID()
  const presentation = createPresentation()
  const text = pipe(string(), maxLength(200))
  const quantity = pipe(number(), integer(), minValue(1), maxValue(99))
  const selectionSchema = strictObject({ version: text, variantRef: text, choices: array(strictObject({ ref: text, quantity })) })
  const selectionInputSchema = { type: 'object', properties: { version: { type: 'string', description: 'Copy the selected product configuration version exactly. This is separate from cart.version.' }, variantRef: { type: 'string' }, choices: { type: 'array', description: 'Options for ONE serving. Omit refused/unrequested options; use [] for none. Never multiply option quantities by the meal quantity.', items: { type: 'object', properties: { ref: { type: 'string' }, quantity: { type: 'integer', minimum: 1, maximum: 99, description: 'Count of this option PER SERVING, within the observed option/group maximum. Two meals each with one option: top-level quantity=2, this quantity=1, not 2.' } }, required: ['ref', 'quantity'], additionalProperties: false } } }, required: ['version', 'variantRef', 'choices'], additionalProperties: false }
  const baseUrl = new URL('/order/store/1kgJeql/pick_up/', location.origin)
  const blockedKey = `webnavior:pb:cart-pending:${baseUrl.pathname}`
  let writeMarker: string | undefined
  let currentControls: ReturnType<typeof createControls> | undefined
  // FIFO owns the one document's controls. Optional speech cues may be dropped;
  // required reads/actions wait instead of failing behind a passive cue.
  let executionQueue: Promise<void> = Promise.resolve()
  let queuedCount = 0
  let executingName: string | undefined
  let manualRevision = 0
  let controlRevision = 0
  const controlTools = new Set(['browser_cart_review', 'browser_search', 'browser_open_product', 'browser_set_note', 'browser_clarify_product', 'browser_cart_add', 'browser_cart_quantity', 'browser_cart_remove', 'browser_cart_replace', 'browser_customer_reset'])
  let activeVisual: AbortController | undefined
  for (const eventName of ['pointerdown', 'keydown', 'wheel']) {
    document.addEventListener(eventName, (event) => {
      if (event.isTrusted) {
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
    { name: 'browser_present', description: 'Menu information only, never a review of ordered quantities or cart subtotal (use browser_cart_review for that). Present explicitly selected current catalog refs after interpreting the whole menu request, including exclusions. Returns a customer receipt for only those products. [] cancels visuals and is not evidence of no matches. Never clicks or changes cart.', inputSchema: { type: 'object', properties: { productRefs: { type: 'array', items: { type: 'string' }, maxItems: 10 } }, required: ['productRefs'], additionalProperties: false }, annotations: { readOnlyHint: true } },
    { name: 'browser_cart_get', description: 'Read planning data before a cart edit: current cart/version and optional product references. includeCatalog=true is internal planning data, not a customer cart-review receipt. For 核對、我點了什麼、目前訂單、還不要送 use browser_cart_review instead. This does not submit an order.', inputSchema: { type: 'object', properties: { includeCatalog: { type: 'boolean' } }, required: ['includeCatalog'], additionalProperties: false }, annotations: { readOnlyHint: true } },
    { name: 'browser_cart_review', description: 'Open the actual cart for review and read back the CURRENT ORDER, quantities, options, notes and actual PB subtotal as a customer receipt. Use for 核對一下、我點了什麼、確認目前訂單、先不要送. This is read-only: it neither presents menu unit prices as an order nor changes or submits anything. No parameters.', inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false }, annotations: { readOnlyHint: true } },
    { name: 'browser_product_get', description: 'For an order naming exact products, call this FIRST with those names; no prior browser_observe or browser_present is needed. Reads complete fresh configurations for 1–10 exact product names in one batch, returns cart.version, and already presents the matched products. Do not repeat browser_present before adding them. Copy each configuration.version and option refs; never guess. Read-only.', inputSchema: { type: 'object', properties: { names: { type: 'array', items: { type: 'string', maxLength: 200 }, minItems: 1, maxItems: 10 } }, required: ['names'], additionalProperties: false }, annotations: { readOnlyHint: true } },
    { name: 'browser_cart_add', description: 'Add the exact observed PB product and quantity. Requires the current cart version and freshly observed unit price. Each call adds ONE configuration and ONE shared per-serving note. Split different notes into separate calls: two meals, one note A and one note B, means quantity=1/note=A then quantity=1/note=B; never quantity=2/note="one A, one B". Use only customer-requested notes without meal-count narration. selection must explicitly contain version, variantRef and choices (use [] for no options); copy the observed configuration version, not cart.version. selection.choices quantities and unitPrice are PER SERVING, including paid options; top-level quantity is the number of meals. Never multiply per-serving options or unitPrice by meal quantity. Never choose a mandatory option for the customer. Never use for price inquiries.', inputSchema: { type: 'object', properties: { version: cartVersion, productRef: { type: 'string' }, quantity: { type: 'integer', minimum: 1, maximum: 99 }, unitPrice: { type: 'number', minimum: 0 }, note: { type: 'string', maxLength: 200 }, selection: selectionInputSchema }, required: ['version', 'productRef', 'quantity', 'unitPrice', 'note', 'selection'], additionalProperties: false } },
    { name: 'browser_cart_quantity', description: 'Set one row quantity, or provide lineRefs (including lineRef) for equivalent split rows with identical product/configuration/unit price. With lineRefs, quantity is the GROUP FINAL TOTAL: native controls retain that total and remove redundant rows after verifying each step. Preserve all other configurations and notes. Requires current cart version and lineRef. Inspect all matching rows and their options. When lineRefs is omitted, for a requested product/configuration total subtract the quantities of matching rows retained by this call; quantity is then the selected row final count, not the entire product total. Native rendered rows must also be distinguishable by name/quantity/unit price; identical visual signatures stop without guessing. Identical product/configuration rows may be adjusted through one row while preserving the others. Different configurations require an unambiguous customer target; never choose the first.', inputSchema: { type: 'object', properties: { version: cartVersion, lineRef: { type: 'string' }, lineRefs: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2000, uniqueItems: true }, quantity: { type: 'integer', minimum: 1, maximum: 99 } }, required: ['version', 'lineRef', 'quantity'], additionalProperties: false } },
    { name: 'browser_cart_remove', description: 'Remove one exact observed PB cart line, or provide lineRefs including lineRef to remove an entire equivalent group (same product/configuration/unit price), with current version. Each native control effect is verified. Does not clear other lines or submit an order.', inputSchema: { type: 'object', properties: { version: cartVersion, lineRef: { type: 'string' }, lineRefs: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2000, uniqueItems: true } }, required: ['version', 'lineRef'], additionalProperties: false } },
    { name: 'browser_cart_replace', description: 'Replace all or part of an observed cart line with an explicitly selected product/configuration. A unique same-price identical configuration compiles to one quantity edit of retainQuantity + quantity, never add/remove; duplicate configuration rows require grouped browser_cart_quantity instead. retainQuantity is the number of original servings to KEEP (default 0; strictly less than original quantity). quantity is the number of NEW servings, not the final combined total. For changing one of three meals to rice use quantity=1, retainQuantity=2 and the rice selection. This tool verifies the new servings before reducing/removing the original row; do not simulate replacement with separate add/remove calls. Requires latest version, original lineRef and replacement productRef/price/quantity.', inputSchema: { type: 'object', properties: { version: cartVersion, lineRef: { type: 'string' }, retainQuantity: { type: 'integer', minimum: 0, maximum: 98 }, productRef: { type: 'string' }, quantity: { type: 'integer', minimum: 1, maximum: 99 }, unitPrice: { type: 'number', minimum: 0 }, note: { type: 'string', maxLength: 200 }, selection: selectionInputSchema }, required: ['version', 'lineRef', 'productRef', 'quantity', 'unitPrice', 'note', 'selection'], additionalProperties: false } },
    { name: 'browser_customer_reset', description: 'Host-only customer lifecycle reset. Discards unsubmitted product/search drafts, preserves merchant cart and login. Not an Agent tool.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
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
      products: [...document.querySelectorAll('main [role="button"] h4, main button h4')].filter(element => element.getClientRects().length > 0).map((element) => {
        const details = element.closest<HTMLElement>('button, [role="button"]')?.textContent?.trim() ?? ''
        // Only an unambiguous single displayed price is a fixed-price quote.
        // Ranges, discounts with two amounts, and missing prices need clarification.
        const prices = [...details.matchAll(/\$([\d,]+(?:\.\d+)?)/g)]
        return { name: element.textContent?.trim(), details, price: prices.length === 1 ? Number(prices[0][1].replaceAll(',', '')) : undefined }
      }),
      catalogScope: 'Currently rendered search results only; an absent item is not proof the store never sells it.',
      ...(includeDraft ? { search: document.querySelector<HTMLInputElement>('input[placeholder="搜尋品項，例如：拿鐵、雞腿、套餐"]')?.value ?? '' } : {}),
      productDialog: [...document.querySelectorAll('[role="dialog"]')].filter(element => element.getClientRects().length > 0).map(element => ({ name: element.querySelector('h1')?.textContent?.trim(), ...(includeDraft ? { note: element.querySelector<HTMLInputElement>('input[placeholder="商品有特殊需求，請在此備註"]')?.value } : {}) })),
      checkoutAvailable: false,
    }
  }

  async function pageProps(suffix: string, signal?: AbortSignal) {
    const url = new URL(suffix, baseUrl)
    const response = await fetch(url, { cache: 'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) })
    if (!response.ok || response.url !== url.href)
      throw new Error('PB page is unavailable or requires sign-in.')
    const html = new DOMParser().parseFromString(await response.text(), 'text/html')
    const serialized = html.querySelector('[data-page]')?.getAttribute('data-page')
    if (!serialized)
      throw new Error('PB page shape changed.')
    const { props } = JSON.parse(serialized)
    if (!props.auth?.user)
      throw new Error('PB requires manual sign-in.')
    return props
  }

  async function readCatalog(configurationRefs?: readonly string[], includeConfigurations = true, signal?: AbortSignal) {
    assertScope()
    const snapshot = await collectCatalog({
      menu: async () => {
        const props = await pageProps(`menu${location.search}`, signal)
        const pickup = parse(looseObject({ defaultPickUpDate: string(), defaultPickUpTime: string() }), props)
        const url = vendorRoute('shopping.menu.categories', ['1kgJeql', 'pick_up'])
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
        const response = await fetch(vendorRoute('shopping.getAttrByProduct', ['1kgJeql', 'pick_up', String(id)]), { cache: 'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) })
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
    const pickup = props.order === null
      ? parse(looseObject({ defaultPickUpDate: string(), defaultPickUpTime: string() }), await pageProps(`menu${location.search}`))
      : { defaultPickUpDate: '', defaultPickUpTime: '' }
    const cart = readCartPage(props, { date: pickup.defaultPickUpDate, time: pickup.defaultPickUpTime }, manualRevision)
    return { ...cart, pickup: { date: cart.context.date, time: cart.context.time } }
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
    return resolveRoute(name, parameters, new URL(suffix, baseUrl), [...document.scripts].map(script => script.textContent ?? ''))
  }

  function beginWrite() {
  // This is the final synchronous boundary before a vendor request.
  // A customer can navigate during the preceding asynchronous preparation.
    assertScope()
    if (writeMarker && localStorage.getItem(blockedKey) === writeMarker)
      return
    if (localStorage.getItem(blockedKey))
      throw new Error('先前購物車操作尚未確認。')
    writeMarker = crypto.randomUUID()
    // Persist before dispatch so reload/restart cannot erase an unknown write.
    // No customer data, cookie, or credential is stored here.
    localStorage.setItem(blockedKey, writeMarker)
  }

  async function editLine(ref: string, amount: number | undefined, onDispatch: () => void) {
    const controls = currentControls
    const before = await readCart()
    const target = before.lines.find(line => line.ref === ref)
    if (!controls || !target || !controls.canEdit(before.lines, [ref]))
      throw new Error('購物車行無法唯一對應畫面，尚未操作。')
    await controls.edit(before.lines, ref, amount, async () => {
      if (JSON.stringify(await readCart()) !== JSON.stringify(before))
        throw new Error('移動期間購物車已變更，尚未操作。')
    }, async () => {
      const current = await readCart()
      return amount === undefined ? !current.lines.some(line => line.ref === ref) : current.lines.find(line => line.ref === ref)?.quantity === amount
    }, () => {
      beginWrite()
      onDispatch()
    })
  }

  const cartOperations = createCartOperations({
    read: readCart,
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
    setQuantity: (ref, amount, onDispatch) => editLine(ref, amount, onDispatch),
    remove: (ref, onDispatch) => editLine(ref, undefined, onDispatch),
  })

  /** Reads live site state without navigation; account fields never leave this document. */
  async function recoveryContext() {
    const [products, cart] = await Promise.all([readCatalog(), readCart()])
    // Equality evidence covers options/prices and pickup as well as the cart.
    // It is a local observation digest, never a vendor revision or write receipt.
    const state = { manualRevision, products, cart, visible: observe(true) }
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(state)))
    const contextKey = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
    const canRetry = !localStorage.getItem(blockedKey) && cartOperations.canRecover() && ![...(active?.operations.values() ?? [])].some(operation => operation.name !== 'browser_recovery_context' && operation.status !== 'settled')
    return { source: 'browser', documentId, contextKey, canRetry }
  }

  /** A catalog ref may target a card only when both current identities are unique. */
  async function presentProducts(refs: readonly string[], press = false) {
    if (activeVisual?.signal.aborted)
      return { products: [], cue: 'cancelled' as const }
    if (!refs.length) {
      presentation.cancel()
      return { products: [], cue: 'cleared' as const }
    }
    const revision = presentation.revision()
    const catalog = await readCatalog(undefined, false, activeVisual?.signal)
    if (revision !== presentation.revision())
      return { products: [], cue: 'cancelled' as const }
    const products = catalog.filter(product => refs.includes(product.ref)).slice(0, 10)
    if (products.length !== new Set(refs).size) {
      presentation.cancel()
      // No partial presentation can prove the requested filter. Preserve the
      // fresh identity mapping so Main can repair names or stale refs instead
      // of interpreting an empty cue as no matching products.
      return { products: [], cue: 'cleared' as const, unresolvedProductRefs: refs.filter(ref => !catalog.some(product => product.ref === ref)), availableProducts: catalog.map(product => ({ ref: product.ref, name: product.name })) }
    }
    const evidence = products.map(product => ({ ref: product.ref, name: product.name, ...(product.kind === 'product' && product.priceType === 1 ? { price: product.price } : {}) }))
    const cardFor = (name: string) => {
      if (catalog.filter(product => product.name === name).length !== 1)
        return undefined
      const headings = [...document.querySelectorAll<HTMLElement>('main [role="button"] h4, main button h4')].filter(element => element.textContent?.trim() === name && element.getClientRects().length > 0)
      return headings.length === 1 ? headings[0].closest<HTMLElement>('button, [role="button"]') ?? undefined : undefined
    }
    const target = cardFor(products[0].name)
    const related = products.flatMap((product) => {
      const card = cardFor(product.name)
      return card ? [card] : []
    })
    return presentation.show(evidence, target, press, related)
  }

  async function execute(name: string, input: Record<string, unknown>, operationId: string, admittedControlRevision: number) {
    const controller = new AbortController()
    activeVisual = controller
    if (admittedControlRevision !== controlRevision)
      controller.abort()
    const operation = createOperation({ documentId, operationId, signal: controller.signal, follow: async (target, label, dispatch, prepare) => {
      if (activeVisual !== controller)
        activeVisual?.abort()
      activeVisual = controller
      const result = await presentation.show([], target, true, [], { label, dispatch, prepare })
      return result.cue === 'shown'
    } })
    const controls = createControls(operation, controller.signal)
    currentControls = controls

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
      try {
        assertScope()
      }
      catch (error) { return { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: errorMessageFrom(error) ?? '請返回點餐菜單。' } }
      let customerMessage: string | undefined
      let includeDescriptions = true
      let purpose: 'information' | 'choose_product' = 'information'
      let productCue: Awaited<ReturnType<typeof presentProducts>> | undefined
      if (name === 'browser_present') {
        const { productRefs } = parse(strictObject({ productRefs: pipe(array(text), maxLength(10)) }), input)
        const selected = await presentProducts(productRefs)
        if ('unresolvedProductRefs' in selected)
          return { ok: true, source: 'browser', status: 'proposal_rejected', effect: 'none', dataOnly: true, presentation: { products: [], cue: selected.cue }, unresolvedProductRefs: selected.unresolvedProductRefs, products: selected.availableProducts, explanation: 'productRefs 必須複製當前 products 的 ref 欄位，不能填商品名稱。這次尚未呈現任何餐點，也未變更購物車；不是查無商品。請保留顧客完整篩選條件，依這份新鮮對照使用 ref 重新呼叫 browser_present。' }
        return { ok: true, source: 'browser', presentation: selected, ...(selected.products.length ? { customerMessage: describeProducts(selected.products) } : { dataOnly: true }) }
      }
      if (name === 'browser_cart_get' || name === 'browser_cart_review') {
        let includeCatalog = false
        if (name === 'browser_cart_get')
          includeCatalog = parse(strictObject({ includeCatalog: boolean() }), input).includeCatalog
        else
          parse(strictObject({}), input)
        const [products, observed] = await Promise.all([includeCatalog ? readCatalog() : undefined, cartOperations.observe()])
        let cart = observed
        if (name === 'browser_cart_review' && cart.lines.length) {
          await controls.navigate('/order/store/1kgJeql/pick_up/orders/create')
          cart = await cartOperations.observe()
        }
        return { ok: true, source: 'browser', cart, ...(products ? { products, dataOnly: true } : { customerMessage: cart.lines.length ? `目前購物車：${describeCartLines(cart.lines)}。小計 ${cart.subtotal} 元，尚未送出訂單。` : '購物車目前沒有餐點。' }) }
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
        return { ok: true, source: 'browser', dataOnly: true, products, cart: await cartOperations.observe(), presentation: await presentProducts(references) }
      }
      else if (['browser_cart_add', 'browser_cart_quantity', 'browser_cart_remove', 'browser_cart_replace'].includes(name)) {
        if (localStorage.getItem(blockedKey))
          return { ok: false, source: 'browser', status: 'unknown', customerMessage: '先前購物車操作的結果尚未確認，請先確認購物車；已暫停新的代操作。' }
        const fields = name === 'browser_cart_replace'
          ? parse(strictObject({ version: text, lineRef: text, retainQuantity: optional(pipe(number(), integer(), minValue(0), maxValue(98))), productRef: text, quantity, unitPrice: pipe(number(), minValue(0)), note: text, selection: selectionSchema }), input)
          : name === 'browser_cart_add'
            ? parse(strictObject({ version: text, productRef: text, quantity, unitPrice: pipe(number(), minValue(0)), note: text, selection: selectionSchema }), input)
            : name === 'browser_cart_quantity'
              ? parse(strictObject({ version: text, lineRef: text, lineRefs: optional(pipe(array(text), minLength(1), maxLength(2_000))), quantity }), input)
              : parse(strictObject({ version: text, lineRef: text, lineRefs: optional(pipe(array(text), minLength(1), maxLength(2_000))) }), input)
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
            await controls.navigate('/order/store/1kgJeql/pick_up/menu')
            await controls.ready(() => {
              const totals = [...document.querySelectorAll('span.text-xl.font-bold.ms-2')]
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
        if (localStorage.getItem(blockedKey) || !cartOperations.canRecover() || [...(active?.operations.entries() ?? [])].some(([id, operation]) => id !== operationId && operation.status !== 'settled'))
          throw new Error('先前操作尚未確認，請先由工作人員查看購物車。')
        const before = await readCart()
        // Only PB's product draft may be closed. Never click a generic confirmation
        // or navigate/reload: that could change the active shared-account order.
        // PB puts role=dialog on el-overlay-dialog, outside .menu-dialog.
        // Identify the product by its observed note field or inner product class.
        const drafts = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].filter(element => element.getClientRects().length > 0 && (element.querySelector('.menu-dialog') || element.querySelector('input[placeholder="商品有特殊需求，請在此備註"]')))
        await controls.navigate('/order/store/1kgJeql/pick_up/menu')
        await controls.close()
        await controls.search('')
        const search = document.querySelector<HTMLInputElement>('input[placeholder="搜尋品項，例如：拿鐵、雞腿、套餐"]')!
        if (drafts.some(dialog => dialog.getClientRects().length > 0) || search.value !== '' || JSON.stringify(await readCart()) !== JSON.stringify(before))
          throw new Error('換客期間的商品視窗或購物車尚未確認，請工作人員查看。')
        // Revoke prior cart versions/retry digests without replacing this PB document.
        // The Host then revokes its connection and visitor consent independently.
        manualRevision++
        return { ok: true, source: 'browser', status: 'customer-reset', cartPreserved: true, documentId }
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
        await controls.navigate('/order/store/1kgJeql/pick_up/menu')
        await controls.search(query)
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
          return `${option.name} 每個 ${choice.unitPrice} 元、每份 ${choice.quantity} 個`
        }).join('、')
        return { ok: true, source: 'browser', effect: 'none', unitPrice: selected.unitPrice, total, presentation: await presentProducts([productRef]), customerMessage: `${product.name}${options ? `（基本單價 ${configuration.unitPrice} 元；${options}）` : ''}，單份 ${selected.unitPrice} 元，${amount} 份合計 ${total} 元。本次僅查價，尚未加入購物車。` }
      }
      else if (name === 'browser_quote') {
        const { name: productName, quantity } = parse(strictObject({ name: text, quantity: pipe(number(), integer(), minValue(1), maxValue(99)) }), input)
        const matches = (await readCatalog()).filter(product => product.name === productName)
        const product = matches.length === 1 ? matches[0] : undefined
        if (!product || product.kind !== 'product' || product.priceType !== 1 || !Number.isFinite(product.price))
          throw new Error('No unambiguous visible price for this exact product; search or clarify first.')
        productCue = await presentProducts([product.ref])
        customerMessage = `${product.name}單份 ${product.price} 元，${quantity} 份合計 ${Math.round(product.price * 100) * quantity / 100} 元，未含另外加購。`
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
          productCue = await presentProducts(products.slice(0, 10).map(product => product.ref))
        snapshot.catalogScope = 'Fresh PB product lists for the current pickup time; product groups and required variants need separate configuration.'
      }
      if (!includeDescriptions)
        snapshot.products = snapshot.products.map(product => ({ ...product, details: '' }))
      if ((name === 'browser_observe' && purpose === 'choose_product') || name === 'browser_search') {
        customerMessage = snapshot.products.length
          ? describeProducts(snapshot.products)
          : '目前搜尋結果沒有符合的餐點，請問您指的是哪一道？'
        if (purpose === 'choose_product' && snapshot.products.length)
          customerMessage = `請問您要${snapshot.products.map(product => product.name).join('、')}，哪一項？`
      }
      return { ok: true, ...snapshot, ...(name === 'browser_observe' && purpose === 'information' ? { dataOnly: true } : {}), ...(productCue ? { presentation: productCue } : {}), ...(name === 'browser_search' ? { search: input.query } : {}), ...(customerMessage ? { customerMessage } : {}) }
    }
  }

  function discover(raw: unknown) {
    console.info('Webnavior PB discovery received.')
    const request = parse(discoveryRequestSchema, raw)
    if (active?.id !== request.connectionId)
      active = { id: request.connectionId, operations: new Map() }
    return { ...request, documentId, toolsRevision: 1, tools }
  }
  function enqueue(request: InferOutput<typeof executionRequestSchema>, binding: NonNullable<typeof active>) {
    const revision = presentation.revision()
    const admittedControlRevision = controlRevision
    if (request.name === 'browser_present') {
      const { productRefs } = parse(strictObject({ productRefs: pipe(array(text), maxLength(10)) }), request.input)
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
      // Exceptions here are argument/preparation failures before any cart write.
      const result = enqueue(request, active).catch(error => ['browser_cart_add', 'browser_cart_quantity', 'browser_cart_remove', 'browser_cart_replace'].includes(request.name) && isValiError(error)
        ? { ok: true, source: 'browser', status: 'proposal_rejected', effect: 'none', dataOnly: true, error: errorMessageFrom(error) ?? 'PB arguments were rejected.', explanation: '工具參數未符合 schema，尚未派送購物車寫入。請修正參數：version 使用最新 cart.version，selection.version 使用所選 product.configurations 的 version；不得省略規格版本。只修正本輪原需求，不改選商品或規格。' }
        : { ok: false, source: 'browser', error: errorMessageFrom(error) ?? 'PB operation was rejected.' })
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
