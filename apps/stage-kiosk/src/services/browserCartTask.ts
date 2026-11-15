import type { BrowserConversation } from '@proj-airi/stage-shared/browser-conversation'
import type { ServiceTool } from '@proj-airi/stage-shared/interactive-service'
import type { OrderingSite } from '@proj-airi/stage-shared/ordering-sites'
import type { createInteractiveServiceClient } from '@proj-airi/stage-ui/services/interactiveServiceClient'

import type { BrowserEffect, BrowserPlan, EffectDecision } from '../../../server/src/services/domain/browser-ordering/contracts'
import type { createBrowserCartSession } from './browserCartSession'
import type { createBrowserDialogue, OrderEvidence } from './browserDialogue'
import type { createBrowserPresentation } from './browserPresentation'
import type { AdditionProposal, QuestionSnapshot } from './browserQuestionWindow'
import type { RecommendationCriteria } from './recommendationSession'

import { errorMessageFrom } from '@moeru/std'
import { browserConversationSchema, browserToolNames } from '@proj-airi/stage-shared/browser-conversation'
import { browserSignInRequiredSchema } from '@proj-airi/stage-shared/interactive-service'
import { replyToConversation } from '@proj-airi/stage-shared/kiosk-conversation'
import { labelCatalog } from '@proj-airi/stage-shared/ordering-sites'
import { explicitServingQuantities, normalizeSlotNumbers } from '@proj-airi/stage-shared/ordering-slots'
import { pbCheckoutSchema, pbInvoiceMethodSchema } from '@proj-airi/stage-shared/pb-checkout'
import { menuEntryReceiptSchema } from '@proj-airi/stage-shared/pb-journey'
import { describePbMeal, pbBasicServing, pbProductName } from '@proj-airi/stage-shared/pb-menu-presentation'
import { productConfigurationSchema } from '@proj-airi/stage-shared/product-configuration'
import { browserPresentationInputSchema, productPresentationSchema } from '@proj-airi/stage-shared/product-presentation'
import { resolveTableName } from '@proj-airi/stage-shared/table-names'
import { resolveSelection } from '@proj-airi/stage-ui/services/pbProduct'
import { array, boolean, literal, looseObject, minLength, number, object, optional, parse, picklist, pipe, safeParse, strictObject, string } from 'valibot'

import { orderingMessages } from '../../../../packages/i18n/src/orderingMessages'
import { browserWriteToolNameSchema, cartLineLabelSchema, cartSnapshotSchema } from '../../../server/src/services/domain/browser-ordering/contracts'

interface TaskQuestions {
  /** Set only by the Host after Jev selects a currently issued action. */
  intentSource?: 'jev'

  /** Local utterance correlation scopes answered-question evidence to this request. */
  utteranceId?: number
  /** UI translation boundary for a requested fact the assistant cannot verify. */
  informationUnavailable?: () => string
  /** Manual checkout guidance follows a fresh, visitor-owned native cart review. */
  checkoutGuidance?: (empty: boolean) => string
  /** Host-only terminal evidence after a fully covered single edit is verified. */
  onRequestComplete?: () => void
  readOnly?: boolean
  /** Uncertain meaning may ask an explicit sealed question; factual inquiries may not. */
  clarifyOrder?: boolean
  dialogue?: ReturnType<typeof createBrowserDialogue>
  presentation?: Pick<ReturnType<typeof createBrowserPresentation>, 'filterRecommendations'>
  catalogLabels?: () => OrderingSite['catalogLabels']
  cartSession?: { gate: ReturnType<typeof createBrowserCartSession>, owner: () => string | undefined, serviceUrl: () => string | undefined, message: string }
}

interface VerifiedReceipt {
  /** Full-cart version after this effect; replay requires that exact cart. */
  version: string
  toolName: BrowserPlan['toolName']
  result: Record<string, unknown>
  addition?: NonNullable<BrowserEffect['completedAdditions']>[number]
}

// Server admission compares transcript with this turn's stored customer text.
// Matching text and orderEvidence may include prior answers; transcript may not.
let active: TaskQuestions & { tableSelectionRequired?: boolean, cartOwner?: { owner: string, serviceUrl: string }, answerResolved?: boolean, previousProposal?: AdditionProposal, selected?: { productRef: string, request: string, requestTarget?: string, requestedQuantity?: number, orderSelection?: true }, confirmed?: { proposal: AdditionProposal, binding: QuestionSnapshot }, confirmedOrder?: { proposals: AdditionProposal[], binding: QuestionSnapshot, evidence?: OrderEvidence }, text: string, readonly transcript: string, decide: (proposal: BrowserEffect, plan: Pick<BrowserPlan, 'toolName' | 'arguments'>) => Promise<EffectDecision>, isCurrent: () => boolean, orderEvidence?: OrderEvidence, repairs: number, receipts: Map<string, VerifiedReceipt> } | undefined
const writes = new Set(['browser_cart_add', 'browser_cart_quantity', 'browser_cart_remove', 'browser_cart_replace'])
const orderingAnswerFactsSchema = looseObject({ products: array(looseObject({ ref: string(), name: string(), configurations: array(productConfigurationSchema) })) })
const tableEntrySchema = looseObject({ ok: literal(true), source: literal('browser'), page: literal('table'), code: literal('table-selection-required'), tableChoices: array(string()), selectedTable: optional(string()), customerMessage: string() })

// Dispatch is the uncertainty boundary: a thrown transport or missing receipt
// may follow an applied merchant effect. Preserve it for both Main and Jev;
// neither adapter may reinterpret it as a definite no-effect refusal.
async function dispatchCartWrite(client: Pick<ReturnType<typeof createInteractiveServiceClient>, 'execute'>, tool: ServiceTool, input: Record<string, unknown>): Promise<unknown> {
  let error: string | undefined
  try {
    const receipt = await client.execute(tool, input)
    if (receipt && typeof receipt === 'object' && 'status' in receipt
      && ['verified', 'preserved', 'rejected', 'proposal_rejected', 'clarification', 'unknown'].includes(String(receipt.status))) {
      return receipt
    }
  }
  catch (caught) {
    error = errorMessageFrom(caught)
  }
  return { ok: false, source: 'browser', status: 'unknown', effect: 'unknown', ...(error ? { error } : {}), customerMessage: orderingMessages['zh-Hant'].recovery.review }
}

function missingTableMessage(choices: readonly string[], transcript: string) {
  if (/外送|送到家|宅配/.test(transcript))
    return '這裡提供內用及櫃台自取的外帶，沒有外送服務。內用請先找到座位，再告訴我您的桌號；外帶可以說「櫃台自取」。'
  const compact = (value: string) => value.replaceAll(/\s/g, '').toUpperCase()
  const codes = [...new Set(normalizeSlotNumbers(transcript).toUpperCase().match(/[A-Z]+\s*\d+/g)?.map(compact) ?? [])]
  // Multiple codes can include a correction or negation. Only one explicit
  // code can prove absence without guessing which part of the turn is intended.
  if (codes.length === 1 && !resolveTableName(codes[0], choices))
    return `目前沒有「${codes[0]}」這個桌號，請確認桌號，或從畫面上的選項重新選擇。`
}

/** Owns one current utterance; only validated one-use question answers extend its target scope. */
export function beginBrowserCartTask(text: string, options: TaskQuestions & { decide: (proposal: BrowserEffect, plan: Pick<BrowserPlan, 'toolName' | 'arguments'>) => Promise<EffectDecision>, isCurrent: () => boolean }) {
  const task: NonNullable<typeof active> = { text: text.replaceAll(/\s/g, ''), transcript: text, ...options, repairs: 0, receipts: new Map<string, VerifiedReceipt>() }
  active = task
  return () => {
    if (active === task)
      active = undefined
  }
}

function mentionsProduct(task: NonNullable<typeof active>, name: string, products: readonly { ref: string, name: string }[]) {
  if (task.selected && products.some(product => product.ref === task.selected!.productRef && product.name === name))
    return true
  if (task.text.includes(name.replaceAll(/\s/g, '')))
    return true
  const displayName = pbProductName(name)
  if (displayName !== name && task.text.includes(displayName) && products.filter(product => pbProductName(product.name) === displayName).length === 1)
    return true
  const catalog = labelCatalog(products, task.catalogLabels?.())
  const product = catalog.find(product => product.name === name)
  return product?.aliases.some(alias => task.transcript.includes(alias) && catalog.filter(candidate => candidate.name === alias || candidate.aliases.includes(alias)).length === 1) === true
}

/** Keeps previous visitor details Host-only until this visitor owns the cart. */
function admitCart(task: NonNullable<typeof active>, raw: unknown, catalogOnly = false) {
  const tableEntry = safeParse(tableEntrySchema, raw)
  if (tableEntry.success)
    return { ok: true, source: 'browser', status: 'clarification', page: 'table', code: 'table-selection-required', tableChoices: tableEntry.output.tableChoices, selectedTable: tableEntry.output.selectedTable, customerMessage: missingTableMessage(tableEntry.output.tableChoices, task.transcript) ?? tableEntry.output.customerMessage, effect: 'none' }
  const session = task.cartSession
  if (!session)
    return
  const owner = session.owner()
  const serviceUrl = session.serviceUrl()
  if (!owner || !serviceUrl || (task.cartOwner && (owner !== task.cartOwner.owner || serviceUrl !== task.cartOwner.serviceUrl)))
    return { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: session.message }
  if (raw && typeof raw === 'object' && 'ok' in raw && raw.ok === false) {
    // A failed lookup is not a snapshot or proof of an empty order. Preserve
    // only its public failure; attached cart data still belongs behind the gate.
    const signIn = safeParse(browserSignInRequiredSchema, raw)
    if (signIn.success)
      return signIn.output
    return { ok: false, source: 'browser', status: 'status' in raw && raw.status === 'unknown' ? 'unknown' : 'rejected', effect: 'none', ...('customerMessage' in raw && typeof raw.customerMessage === 'string' ? { customerMessage: raw.customerMessage } : {}) }
  }
  task.cartOwner ??= { owner, serviceUrl }
  if (session.gate.check(owner, serviceUrl, raw))
    return
  task.dialogue?.reset()
  if (catalogOnly) {
    const facts = parse(looseObject({ products: array(looseObject({ ref: string(), name: string() })) }), raw)
    return { ok: true, source: 'browser', dataOnly: true, products: facts.products, customerBoundary: 'review-required', explanation: '購物車屬於尚未完成交接的其他接待，未提供任何原本的購物車內容。可繼續以最新商品工具回答菜單問題，但不可宣稱原本的購物車沒有餐點、推測內容或修改。嘗試寫入會由 Host 阻擋，請如實告知需現場確認。' }
  }
  return { ok: true, source: 'browser', status: 'clarification', effect: 'none', customerBoundary: 'review-required', customerMessage: session.message }
}

function ownsCurrentCart(task: NonNullable<typeof active>) {
  const session = task.cartSession
  if (!session)
    return true
  return !!task.cartOwner && session.owner() === task.cartOwner.owner && session.serviceUrl() === task.cartOwner.serviceUrl && session.gate.owns(task.cartOwner.owner, task.cartOwner.serviceUrl)
}

/**
 * New products require current formal names or a sealed confirmation. Existing
 * rows can be referred to by their verified configuration after semantic checks.
 * The cart coordinator still owns freshness and full-effect verification.
 * A consumed question can select a target or authorize one complete addition.
 */
export async function executeBrowserCartTool(client: Pick<ReturnType<typeof createInteractiveServiceClient>, 'tools' | 'execute'> & Partial<Pick<ReturnType<typeof createInteractiveServiceClient>, 'waitUntilReady'>>, tool: ServiceTool, input: Record<string, unknown>): Promise<unknown> {
  const task = active
  const context = client.tools.value.find(tool => tool.name === 'browser_cart_get')

  if (tool.name === 'browser_cart_get' && task?.dialogue?.hasPending() && !task.answerResolved && input.includeCatalog !== true)
    return executeBrowserCartTool(client, tool, { includeCatalog: true })

  // Main can choose a lookup or even propose an add before reading the pending
  // question. Resolve its one-use answer first; a yes to an alias only selects
  // that product and cannot authorize an invented serving or repeat the question.
  if (task?.dialogue?.hasPending() && !task.answerResolved && context
    && (writes.has(tool.name) || ['browser_clarify_product', 'browser_product_get'].includes(tool.name))) {
    const resolved = await executeBrowserCartTool(client, context, { includeCatalog: true })
    if (resolved && typeof resolved === 'object'
      && (('ok' in resolved && resolved.ok === false) || 'selectedProduct' in resolved || 'confirmedAddition' in resolved || 'pendingCustomerChoice' in resolved || 'customerMessage' in resolved)) {
      return resolved
    }
  }

  async function presentQuestion(facts: unknown, query: string) {
    if (!task?.dialogue || active !== task || !task.isCurrent())
      return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
    const question = task.dialogue.presentProducts(facts, query, task.transcript)
    if (!('presentationRefs' in question) || !question.presentationRefs)
      return question
    const present = client.tools.value.find(tool => tool.name === 'browser_present')
    let result: unknown
    try {
      if (present)
        result = await client.execute(present, { productRefs: question.presentationRefs, mode: 'information' })
    }
    catch { /* An unshown question must retire below, including transport failures. */ }
    if (active !== task || !task.isCurrent())
      return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
    const shown = safeParse(looseObject({ ok: literal(true), source: picklist(['browser']), presentation: productPresentationSchema }), result)
    const catalog = parse(looseObject({ products: array(looseObject({ ref: string(), name: string(), price: number() })) }), facts)
    const expected = catalog.products.filter(product => question.presentationRefs.includes(product.ref))
    // A spoken choice owns the same refs/names/prices as its verified native
    // batch. An optional cue failure cannot leave an invisible live question.
    if (!shown.success || shown.output.presentation.cue !== 'shown'
      || shown.output.presentation.products.length !== question.presentationRefs.length
      || expected.some(product => !shown.output.presentation.products.some(visible => visible.ref === product.ref && visible.name === product.name && visible.price === product.price))) {
      task.dialogue.reset()
      return { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '目前無法同步顯示要介紹的餐點，請確認畫面後再繼續；尚未變更購物車。' }
    }
    return question
  }

  if (!writes.has(tool.name)) {
    if (tool.name === 'browser_close_product')
      return cancelBrowserItemSelection(client)
    if (tool.name === 'browser_table_select' || tool.name === 'browser_start_ordering') {
      if (!task || !task.isCurrent() || !context)
        return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
      const entry = safeParse(tableEntrySchema, await client.execute(context, { includeCatalog: false }))
      if (active !== task || !task.isCurrent() || !entry.success)
        return { ok: false, source: 'host', status: 'rejected', effect: 'none', customerMessage: '目前選桌畫面已變更，請重新確認。' }
      const missing = missingTableMessage(entry.output.tableChoices, task.transcript)
      if (missing)
        return { ok: true, source: 'host', status: 'clarification', effect: 'none', customerMessage: missing }
      const name = typeof input.name === 'string' ? input.name : ''
      // A Start request may use the website's current selection, including its
      // default. A model cannot switch to another table without customer intent.
      const compact = (value: string) => value.replaceAll(/\s/g, '').toUpperCase()
      const spokenCodes = normalizeSlotNumbers(task.transcript).toUpperCase().match(/[A-Z]+\s*\d+/g)?.map(compact) ?? []
      const explicitlyNamed = resolveTableName(task.transcript.replaceAll(/[，,。！!]/g, ''), entry.output.tableChoices) === name || compact(task.transcript).includes(compact(name)) || spokenCodes.some(code => resolveTableName(code, entry.output.tableChoices) === name) || (name === '櫃台取餐' && task.transcript.includes('櫃台'))
      if (tool.name === 'browser_start_ordering' && task.intentSource !== 'jev' && !explicitlyNamed && entry.output.selectedTable && entry.output.selectedTable !== name)
        return { ok: true, source: 'host', status: 'proposal_rejected', effect: 'none', dataOnly: true, selectedTable: entry.output.selectedTable, tableChoices: entry.output.tableChoices, explanation: '這次提案使用的桌號與畫面目前選擇不同，尚未執行。顧客未要求換桌，請沿用這次回傳的 selectedTable；呼叫 start_ordering_at_table 時省略 tableName，即會使用畫面目前選擇。不必要求顧客重新選桌。' }
      if (!name || !entry.output.tableChoices.includes(name) || (!explicitlyNamed && task.intentSource !== 'jev' && (tool.name === 'browser_table_select' || entry.output.selectedTable !== name)))
        return { ok: true, source: 'host', status: 'clarification', effect: 'none', customerMessage: '內用請先找到座位，再告訴我您的桌號；外帶請選櫃台自取。' }
      let result = await client.execute(tool, { name })
      if (safeParse(menuEntryReceiptSchema, result).success && client.waitUntilReady) {
        await client.waitUntilReady()
        if (active !== task || !task.isCurrent())
          return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
        // Document discovery can finish before PB renders its first menu card.
        // Read through the replacement binding, never reuse the table document.
        const deadline = Date.now() + 5000
        while (true) {
          const reader = client.tools.value.find(tool => tool.name === 'browser_cart_get')
          const menu = safeParse(looseObject({ ok: literal(true), page: literal('menu'), menuReady: boolean(), cart: looseObject({ tableName: string() }) }), reader ? await client.execute(reader, { includeCatalog: false }) : undefined)
          if (active !== task || !task.isCurrent())
            return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
          if (!menu.success || menu.output.cart.tableName !== name || (!menu.output.menuReady && Date.now() >= deadline))
            return { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '菜單目前尚未載入完成，請稍候再試。' }
          if (menu.output.menuReady)
            break
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        result = { ...parse(menuEntryReceiptSchema, result), customerMessage: '菜單準備好了，想吃什麼？可以告訴我餐點和份數，或請我推薦。' }
      }
      // A standalone Start request is fully covered by its navigation receipt.
      // Do not launch a second Main round with the retired table tool set. A
      // sentence also requesting food remains a separate, uncovered demand.
      const entryReceipt = safeParse(menuEntryReceiptSchema, result)
      // Remove only the verified table, then require a complete entry/assent
      // phrase. Extra food requests must continue after the new menu is ready.
      const entryText = normalizeSlotNumbers(task.text).toUpperCase().replaceAll(/[,，。！!、\s]/g, '').replace(compact(name), '')
      if (active === task && task.isCurrent() && entryReceipt.success
        && /^(?:(?:好的?|對|沒錯|可以|確認)(?:那就)?)?(?:(?:請|幫我|我要)?開始(?:點餐)?吧?)?$/.test(entryText)) {
        task.onRequestComplete?.()
      }
      return result
    }
    if (tool.name === 'browser_present' && task) {
      const proposed = safeParse(browserPresentationInputSchema, input)
      let parameters = input
      if (proposed.success && proposed.output.mode !== 'information' && proposed.output.productRefs.length) {
        // A new search may legitimately contain dishes already introduced.
        // Exclusion requires the model's explicit request for other recommendations.
        const productRefs = proposed.output.mode === 'other-recommendations' && task.presentation
          ? task.presentation.filterRecommendations(proposed.output.productRefs)
          : proposed.output.productRefs
        if (!productRefs || active !== task || !task.isCurrent())
          return { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '目前頁面或接待已變更，請重新查詢。' }
        if (!productRefs.length)
          return { ok: true, source: 'browser', dataOnly: true, excludedProductRefs: proposed.output.productRefs, explanation: '這批品項剛剛已成功介紹過，尚未重複呈現。請依顧客需求從最新菜單選其他品項；若顧客指定餐點或餐類，改用 recommendation 呈現符合餐點供選擇；只要資訊時用 information。' }
        parameters = { ...proposed.output, productRefs, deferVisual: true }
      }
      const result = await client.execute(tool, parameters)
      if (active !== task || !task.isCurrent())
        return { ok: false, source: 'browser', status: 'rejected', effect: 'none' }
      const presented = safeParse(looseObject({ ok: literal(true), source: literal('browser'), presentation: productPresentationSchema, customerMessage: optional(string()) }), result)
      if (proposed.success && proposed.output.mode !== 'information' && presented.success && task.dialogue && presented.output.presentation.products.length === 1) {
        // A single recommendation offers a serving; it is not purchase consent.
        // Bind the offer to the actual receipt so later assent has a real target/count.
        const question = await askBrowserCustomerQuestion(client, { questionType: 'purchase-recommendation', name: presented.output.presentation.products[0].name, quantity: 1 })
        return { ...presented.output, ...question, customerMessage: `${presented.output.customerMessage ?? ''} ${question.customerMessage}`.trim() }
      }
      if (proposed.success && proposed.output.mode !== 'information' && presented.success && task.dialogue && presented.output.presentation.products.length > 1) {
        const facts = await readBrowserOrderingFacts(client)
        if (active !== task || !task.isCurrent())
          return { ok: false, source: 'browser', status: 'rejected', effect: 'none' }
        // Both Jev and Main finish recommendations here. Bind the next answer
        // to the dishes in this receipt, not the whole catalog or model prose.
        const question = task.dialogue.presentProducts(facts, '', task.transcript, presented.output.presentation.products.map(product => product.ref))
        return { ...presented.output, ...question, customerMessage: `${presented.output.customerMessage ?? ''} ${question.customerMessage}`.trim() }
      }
      return result
    }

    if (tool.name === 'browser_search' && task?.dialogue) {
      const query = typeof input.query === 'string' ? input.query.trim() : ''
      if (task.dialogue.hasPending() && context) {
        const raw = await client.execute(context, { includeCatalog: true })
        if (active !== task || !task.isCurrent())
          return { ok: false, source: 'browser', status: 'rejected', effect: 'none' }
        const current = task.dialogue.conversation(raw, task.utteranceId)
        const draftName = current.draft?.name ?? current.drafts?.[0]?.name
        if (draftName) {
          if (!query || !draftName.includes(query))
            return askBrowserCustomerQuestion(client, { questionType: 'cancel-and-search', query })
          return { ok: true, source: 'browser', dataOnly: true, pendingCustomerChoice: current.waitingFor, explanation: '目前選餐保持不變；需要內容或價格時使用get_menu_item_details。' }
        }
      }
      // A new search replaces the view and its old ordinal/yes-no choices,
      // including when the vendor later fails to finish rendering that view.
      task.dialogue.reset()
      const labels = task.catalogLabels?.()
      if (query && labels?.some(label => label.aliases.includes(query) || label.category === query) && context) {
        const raw = await client.execute(context, { includeCatalog: true })
        if (active !== task || !task.isCurrent())
          return { ok: false, source: 'browser', status: 'rejected', effect: 'none' }
        const denied = admitCart(task, raw, true)
        if (denied)
          return denied
        const facts = parse(looseObject({ products: array(looseObject({ ref: string(), name: string() })) }), raw)
        const matches = labelCatalog(facts.products, labels).filter(product => product.name.includes(query) || product.aliases.includes(query) || product.category === query)
        const present = client.tools.value.find(tool => tool.name === 'browser_present')
        if (matches.length > 10)
          return { ok: true, source: 'browser', dataOnly: true, products: matches, explanation: '這個類別超過十項，尚未呈現全部。請先詢問更明確條件，再用實際商品參照呈現；不可宣稱已顯示全部。' }
        if (matches.length && present) {
          // Native presentation clears any stale text search and verifies these
          // exact cards. Configured labels never become invented PB search text.
          return client.execute(present, { productRefs: matches.map(product => product.ref), mode: 'information' })
        }
      }
      return client.execute(tool, input)
    }
    if (tool.name === 'browser_cart_review' || tool.name === 'browser_return_menu') {
      if (!task || !task.isCurrent() || !context)
        return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
      const session = task.cartSession
      const owner = session?.owner()
      const serviceUrl = session?.serviceUrl()
      // Check ownership before the native review opens the cart on screen.
      // Reading metadata here must not consume an outstanding product answer.
      const before = await client.execute(context, { includeCatalog: false })
      if (active !== task || !task.isCurrent() || session?.owner() !== owner || session?.serviceUrl() !== serviceUrl)
        return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
      const denied = admitCart(task, before)
      if (denied)
        return denied
      if (tool.name === 'browser_return_menu') {
        task.dialogue?.reset()
        task.confirmed = undefined
        task.confirmedOrder = undefined
        task.selected = undefined
      }
      // The selected capability is a fixed, read-only current-cart review.
      // There are no model-controlled arguments: never forward invented
      // planning/write fields (S13 emitted includeCatalog="false" repeatedly).
      // Native strict validation still receives exactly its advertised {}.
      const result = await client.execute(tool, {})
      if (active !== task || !task.isCurrent())
        return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
      if (tool.name === 'browser_return_menu' && task.intentSource === 'jev')
        task.onRequestComplete?.()
      // Navigation can outlive the first snapshot. The final fresh receipt must
      // still belong to this visitor before any contents reach Main or speech.
      const rejected = admitCart(task, result)
      if (rejected)
        return rejected
      if (tool.name === 'browser_cart_review' && task.dialogue && typeof result === 'object' && result && 'checkout' in result) {
        const raw = await readBrowserOrderingFacts(client)
        if (active !== task || !task.isCurrent())
          return { ok: false, source: 'host', effect: 'none' }
        const fresh = parse(looseObject({ ...orderingAnswerFactsSchema.entries, cart: cartSnapshotSchema }), raw)
        if (fresh.cart.lines.length) {
          const old = task.dialogue.conversation(raw).waitingFor
          if (old)
            task.dialogue.releaseService(raw, old.questionId)
          const question = task.dialogue.presentService(raw, { purpose: 'cart-review', request: task.transcript, question: '餐點、份數和金額正確嗎？確認後繼續選擇發票方式。', choices: [{ id: 'yes', description: '確認目前購物車餐點、份數與金額，繼續選擇發票；不送單。' }, { id: 'no', description: '先不繼續結帳，保留購物車並提出修改。' }] })
          return { ...result, ...question, customerMessage: 'customerMessage' in result ? result.customerMessage : question.customerMessage }
        }
      }
      return result
    }
    if (task && tool.name === 'browser_observe' && input.purpose === 'information') {
      const result = await client.execute(tool, input)
      if (active !== task || !task.isCurrent())
        return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
      const catalog = safeParse(looseObject({ ok: boolean(), source: string(), products: array(looseObject({ name: string() })) }), result)
      if (!catalog.success || !catalog.output.ok || catalog.output.source !== 'browser')
        return result
      // A full catalog has not applied the customer's exclusions or established
      // missing facts. Only a subsequent explicit presentation is a menu answer.
      const { customerMessage: _message, ...facts } = catalog.output
      return { ...facts, dataOnly: true, explanation: '這是當前完整菜單資料，不代表已完成原句的篩選。依完整需求選出商品參照，再用 browser_present 呈現；資料不足以確認條件時用 browser_respond kind=information-unavailable，不把全部商品說成符合。' }
    }
    let cartRead: unknown
    if (tool.name === 'browser_quote' && task && context) {
      const fresh = parse(looseObject({ products: array(looseObject({ ref: string(), name: string(), kind: string(), priceType: number(), price: number(), configurations: array(productConfigurationSchema) })) }), await client.execute(context, { includeCatalog: true }))
      if (active !== task || !task.isCurrent())
        return { ok: false, source: 'browser', status: 'rejected', effect: 'none' }
      const targets = fresh.products.filter(product => product.name === input.name)
      const optionMention = targets.some(product => product.configurations.some(configuration => configuration.groups.some(group => group.choices.some(choice => task.text.includes(choice.name.replaceAll(/\s/g, ''))))))
      if (optionMention) {
        // Literal option presence means the base-only tool cannot cover this
        // query. Main still decides inclusion/refusal and uses fresh choice refs;
        // the Host must not turn a mention into either selection or consent.
        return { ok: true, source: 'browser', dataOnly: true, requiredTool: 'browser_quote_selection', products: targets, explanation: '本句提到這項商品的現有規格／加購，基本價不足以回答整句。請依原句決定包含或排除哪些選項，以最新 selection 呼叫 browser_quote_selection；不要把基本價當成配置後合計。尚未加入購物車。' }
      }
      const result = await client.execute(tool, input)
      const quoted = safeParse(looseObject({ ok: boolean(), source: string(), customerMessage: string() }), result)
      if (!quoted.success || !quoted.output.ok || quoted.output.source !== 'browser')
        return result
      // A quote may be just one step of a multi-name inquiry. Preserve current
      // base/presence facts for other literal targets; never infer their portion
      // counts, add-on selections, stock or availability from that one quote.
      const related = fresh.products.filter(product => product.name !== input.name && task.text.includes(product.name.replaceAll(/\s/g, '')))
      const names = [...new Set(related.map(product => product.name))]
      const facts = names.map((name) => {
        const matches = related.filter(product => product.name === name)
        const product = matches[0]
        return matches.length === 1 && product.kind === 'product' && product.priceType === 1 ? `${name}，單份 ${product.price} 元` : `${name}，規格與價格請在畫面確認`
      })
      return facts.length ? { ...quoted.output, relatedProducts: related, customerMessage: `${quoted.output.customerMessage} 另外，當前菜單列有：${facts.join('；')}。` } : result
    }
    if (task && context && tool.name === 'browser_product_get') {
      const result = await client.execute(tool, input)
      if (active !== task || !task.isCurrent())
        return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
      if (result && typeof result === 'object' && 'cart' in result)
        return admitCart(task, result, true) ?? result
      const unresolved = safeParse(looseObject({ ok: boolean(), source: picklist(['browser']), status: picklist(['clarification']), effect: picklist(['none']) }), result)
      if (!unresolved.success || !unresolved.output.ok || !task.dialogue)
        return result
      const names = safeParse(array(string()), input.names)
      if (!names.success || names.output.length !== 1) {
        // A multi-name lookup already identifies the missing subject. Do not
        // replace its absence receipt with candidates matching another name.
        task.dialogue.reset()
        return result
      }
      // Exact-name lookup and choose-product are different Main routes to the
      // same discovery problem. A miss cannot end an alias request with "not
      // found" when today's labels provide a related confirmation candidate.
      const facts = await client.execute(context, { includeCatalog: true })
      if (active !== task || !task.isCurrent())
        return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
      const denied = admitCart(task, facts, true)
      if (denied)
        return denied
      const query = names.output[0]
      return presentQuestion(facts, query)
    }
    if (task?.cartSession && context && ['browser_cart_get', 'browser_open_product', 'browser_set_note'].includes(tool.name)) {
      const raw = await client.execute(context, { includeCatalog: input.includeCatalog === true || tool.name !== 'browser_cart_get' })
      cartRead = raw
      const denied = admitCart(task, raw, tool.name === 'browser_cart_get' && input.includeCatalog === true)
      if (denied)
        return denied
      if (!task.dialogue || tool.name !== 'browser_cart_get')
        return tool.name === 'browser_cart_get' ? raw : client.execute(tool, input)
    }
    if (!task?.dialogue || !context)
      return client.execute(tool, input)
    const observe = () => client.execute(context, { includeCatalog: true })
    if (tool.name === 'browser_cart_get' && input.includeCatalog === true && !task.answerResolved) {
      task.answerResolved = true
      const facts = cartRead ?? await observe()
      const denied = admitCart(task, facts, true)
      if (denied)
        return denied
      const answer = await task.dialogue.answer(facts, task.transcript, observe, () => active === task && task.isCurrent(), task.utteranceId)
      if (answer?.kind === 'receipt' && 'completeOrder' in answer.result) {
        task.confirmed = undefined
        task.confirmedOrder = answer.result.completeOrder
        return executeBrowserConfirmedAddition(client)
      }
      if (answer?.kind === 'receipt')
        return answer.result
      if (answer?.kind === 'checkout') {
        if (answer.action === 'submit') {
          const submit = client.tools.value.find(tool => tool.name === 'browser_order_submit')
          if (!submit)
            throw new Error('目前網站尚未提供助手送出訂單。')
          // Only a consumed, current final-summary ticket reaches this branch.
          // Main has no public submission tool or model-controlled token.
          return client.execute(submit, { confirmationToken: answer.confirmationToken })
        }
        return executeBrowserCheckout(client, answer.action, 'method' in answer ? { method: parse(pbInvoiceMethodSchema, answer.method) } : {})
      }
      if (answer?.kind === 'review-cart') {
        const review = client.tools.value.find(tool => tool.name === 'browser_cart_review')
        if (review)
          return executeBrowserCartTool(client, review, {})
        return { ok: false, source: 'browser', status: 'rejected', effect: 'none' }
      }
      if (answer?.kind === 'product') {
        const quantities = explicitServingQuantities(answer.request, { productName: answer.product.name })
        const requestedQuantity = answer.requestedQuantity ?? (quantities.length === 1 ? quantities[0] : undefined)
        const requestTarget = 'requestTarget' in answer ? answer.requestTarget : undefined
        const orderSelection = 'orderSelection' in answer ? answer.orderSelection : undefined
        task.selected = { productRef: answer.product.productRef, request: answer.request, requestTarget, requestedQuantity, orderSelection }
        // The admission protocol binds transcript to this exact customer turn.
        // Earlier selection evidence may help matching, but cannot rewrite it.
        task.text = `${answer.request}\n${task.transcript}`.replaceAll(/\s/g, '')
        const product = parse(orderingAnswerFactsSchema, facts).products.find(product => product.ref === answer.product.productRef)
        const configuration = product?.configurations.length === 1 ? product.configurations[0] : undefined
        // A resolved product choice may have started with a category or shared
        // alias. Carry that exact question query across the quantity turn; the
        // original request and any notes/options remain untouched as evidence.
        const remainingRequest = answer.request.replace(requestTarget || answer.product.name, '').replaceAll(/[\s，,。！!？?]/g, '')
        // Selecting a dish from an issued recommendation question and then
        // supplying its count is a new purchase request, even though the saved
        // original utterance only asked for recommendations.
        if (('completePurchase' in answer && answer.completePurchase !== undefined) || (orderSelection && requestedQuantity !== undefined))
          task.readOnly = false
        // Optional extras do not make an accepted base serving incomplete.
        // Required groups become durable draft slots, so a later turn cannot
        // lose the already accepted product/count and ask them again.
        if (!task.readOnly && requestedQuantity !== undefined && configuration && (('completePurchase' in answer && answer.completePurchase !== undefined) || orderSelection || /^(?:我要|我想要|請給我|給我|要|來)?$/.test(remainingRequest))) {
          if (configuration.groups.some(group => group.required)) {
            return task.dialogue.collectOrder(facts, { lines: [{ productRef: product!.ref, evidence: answer.request, quantity: requestedQuantity, choices: [], askGroups: [], note: '' }] }, answer.request, { productRef: product!.ref, quantity: requestedQuantity, answer: task.transcript })
          }
          const selection = { version: configuration.version, variantRef: configuration.variantRef, choices: [] }
          const selected = resolveSelection(configuration, selection, '')
          task.confirmed = { binding: answer.binding, proposal: { productRef: product!.ref, productName: product!.name, quantity: requestedQuantity, unitPrice: selected.unitPrice, note: '', selection, optionSummary: '', options: [] } }
          return { ...asBrowserFacts(facts), confirmedAddition: task.confirmed!.proposal }
        }
        if (requestedQuantity === undefined && quantities.length === 0)
          return executeBrowserQuantityQuestion(client, { productRef: answer.product.productRef })
        return { ...asBrowserFacts(facts), selectedProduct: answer.product, originalRequest: answer.request, ...(requestedQuantity === undefined ? {} : { requestedQuantity }), explanation: '顧客已選定這項商品。requestedQuantity 是顧客已回答的份數，存在時原樣採用，未提供時不可預設一份。保留原需求與已收集欄位，使用 browser_order_draft 完成餐點設定；evidence 可引用 originalRequest 或這次已驗證的回答。必要資料齊全後直接加入購物車，不再詢問是否加入；缺少資料時只詢問缺少的欄位。' }
      }
      if (answer?.kind === 'switch-query') {
        const closed = await cancelBrowserItemSelection(client)
        const search = client.tools.value.find(tool => tool.name === 'browser_search')
        if (!search || !closed || typeof closed !== 'object' || !('ok' in closed) || closed.ok !== true)
          return closed
        return executeBrowserCartTool(client, search, { query: answer.query })
      }
      if (answer?.kind === 'new-request') {
        task.previousProposal = answer.previousProposal
        return { ...asBrowserFacts(facts), previousProposal: answer.previousProposal, explanation: '顧客有更正或新需求，舊確認已取消。若沿用該品項更正設定，必須重新呈現完整確認；尚未授權任何加購。明確其他品項則依整句重新處理。' }
      }
      if (answer?.kind === 'order') {
        task.confirmedOrder = answer
        return { ...asBrowserFacts(facts), confirmedAddition: { lines: answer.proposals }, explanation: '顧客已確認這整批完整設定。只呼叫 browser_confirm_add {}，由 Host 依序執行封存草稿；不得另組加入購物車或替換參數。' }
      }
      if (answer?.kind === 'addition') {
        task.confirmed = answer
        return { ...asBrowserFacts(facts), confirmedAddition: answer.proposal, explanation: '顧客已確認這個完整設定。呼叫 browser_confirm_add 並傳 {}，由 Host 執行封存提案，不重新產生品項、份數、選項或版本；讀取工具本身沒有加入購物車。' }
      }
      return facts
    }
    if (tool.name === 'browser_clarify_product' || (tool.name === 'browser_observe' && input.purpose === 'choose_product')) {
      const facts = await observe()
      if (active !== task || !task.isCurrent())
        return { ok: false, source: 'browser', status: 'rejected', effect: 'none' }
      // Table entry intentionally has no menu catalog. Preserve its question
      // before parsing product fields, including when Main asked about a dish.
      const denied = admitCart(task, facts)
      if (denied)
        return denied
      const catalog = parse(looseObject({ products: array(looseObject({ ref: string(), name: string() })) }), facts)
      const named = catalog.products.filter(product => task.text.includes(product.name.replaceAll(/\s/g, '')))
      if (named.length === 1) {
        // A generic choose-product call cannot discard the exact current
        // subject and replace a price/options question with another menu list.
        return { ok: true, source: 'browser', dataOnly: true, products: named, explanation: '原句已唯一指明此商品，不需要再詢問品名。依完整原句及本商品最新規格處理；規格／加購查價用 browser_quote_selection，缺必要選項才詢問該選項。這次只是讀取，尚未加入購物車。' }
      }
      return presentQuestion(facts, typeof input.query === 'string' ? input.query : '')
    }
    return tool.name === 'browser_cart_get' && cartRead !== undefined ? cartRead : client.execute(tool, input)
  }
  if (!task || !context)
    throw new Error('Current browser cart task is unavailable.')
  if (task.readOnly) {
    if (task.clarifyOrder && task.dialogue && tool.name === 'browser_cart_add') {
      const raw = await client.execute(context, { includeCatalog: true })
      const denied = admitCart(task, raw)
      if (denied)
        return denied
      if (active !== task || !task.isCurrent() || !ownsCurrentCart(task))
        return { ok: false, source: 'browser', status: 'rejected', effect: 'none' }
      const facts = parse(looseObject({ products: array(looseObject({ ref: string(), name: string() })) }), raw)
      const product = facts.products.find(product => product.ref === input.productRef)
      if (!product || !task.text.includes(product.name.replaceAll(/\s/g, '')) || facts.products.filter(candidate => candidate.name === product.name).length !== 1)
        return task.dialogue.presentProducts(raw, '', task.transcript)
      // This creates a complete, priced question only. A later explicit answer
      // must consume the existing session/document/cart-bound question protocol.
      return task.dialogue.presentAddition(raw, input)
    }
    return { ok: true, source: 'browser', status: 'rejected', effect: 'none', customerMessage: task.clarifyOrder ? '目前尚未確認完整操作，請重新說明要調整的餐點；尚未變更購物車。' : '本次僅查詢，未變更購物車。' }
  }
  const needsProducts = tool.name === 'browser_cart_add' || tool.name === 'browser_cart_replace'
  const rawFacts = await client.execute(context, { includeCatalog: needsProducts })
  const denied = admitCart(task, rawFacts)
  if (denied)
    return denied
  const facts = parse(looseObject({ cart: looseObject({ version: string(), lines: array(looseObject({ ...cartLineLabelSchema.entries, ref: string(), productRef: optional(string()), configuration: optional(string()), unitPrice: optional(number()) })) }), products: optional(array(looseObject({ ref: string(), name: string(), configurations: array(looseObject({ variantRef: string(), name: string(), groups: array(looseObject({ choices: array(looseObject({ ref: string(), name: string(), unitPrice: number() })) })) })) })), []) }), rawFacts)
  const original = facts.cart.lines.find(line => line.ref === input.lineRef)
  const copySource = tool.name === 'browser_cart_add' && typeof input.copySourceRef === 'string' ? facts.cart.lines.find(line => line.ref === input.copySourceRef && line.productRef === input.productRef && line.options !== undefined) : undefined
  if (input.copySourceRef !== undefined && !copySource)
    return { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '原餐配置已變更，尚未加入餐點。' }
  const groupInput = safeParse(optional(array(string())), input.lineRefs)
  if (!groupInput.success)
    return { ok: true, source: 'browser', status: 'proposal_rejected', effect: 'none', dataOnly: true, explanation: 'lineRefs 必須是實際購物車行參照的陣列；尚未寫入。' }
  // A group still needs an explicit native anchor. Return the schema repair
  // rather than treating a missing anchor as a configuration ambiguity.
  if (groupInput.output && typeof input.lineRef !== 'string')
    return { ok: true, source: 'browser', status: 'proposal_rejected', effect: 'none', dataOnly: true, explanation: '缺少必填 lineRef。請保留本次 lineRefs、quantity、version，並另補 lineRef，值須為 lineRefs 內一個已觀察的行參照；不可改用 remove 或單列調整代替整組合計。尚未寫入。' }
  const refs = groupInput.output ?? (original ? [original.ref] : [])
  const originalGroup = facts.cart.lines.filter(line => refs.includes(line.ref))
  if (groupInput.output && (!['browser_cart_quantity', 'browser_cart_remove', 'browser_cart_replace'].includes(tool.name) || !original || !refs.length || new Set(refs).size !== refs.length || originalGroup.length !== refs.length || !refs.includes(original.ref) || !original.productRef || original.configuration === undefined || original.unitPrice === undefined || originalGroup.some(line => line.productRef !== original.productRef || line.configuration !== original.configuration || line.unitPrice !== original.unitPrice)))
    return { ok: true, source: 'browser', status: 'proposal_rejected', effect: 'none', dataOnly: true, explanation: '合計調整只能指定已核對、商品與配置及單價相同的現有行，不合併不同加購／備註；尚未寫入。' }
  const originalQuantity = originalGroup.reduce((sum, line) => sum + line.quantity, 0)
  // A replacement can leave its source row with the retained quantity. Main
  // sometimes repeats that same step with the resulting cart version and an
  // omitted selection version. Those freshness fields do not make a new swap.
  // Reuse only this turn's verified receipt while its exact cart remains current;
  // any intervening manual or agent edit invalidates the receipt below.
  const selectionIdentity = safeParse(object({ variantRef: string(), choices: array(object({ ref: string(), quantity: number() })) }), input.selection)
  const selectedConfiguration = selectionIdentity.success ? { ...selectionIdentity.output, choices: [...selectionIdentity.output.choices].sort((left, right) => left.ref.localeCompare(right.ref)) } : input.selection
  // Choice order and freshness versions do not change a serving. Keep vendor
  // identities opaque to semantic IO; this key is scoped to this task/document,
  // and only a verified native addition can contribute completed quantities.
  const servingKey = selectionIdentity.success && typeof input.productRef === 'string' ? JSON.stringify([input.productRef, selectedConfiguration]) : undefined
  const key = JSON.stringify([tool.name, tool.name === 'browser_cart_replace' ? undefined : input.version, input.lineRef, input.lineRefs, input.productRef, input.quantity, input.retainQuantity, input.unitPrice, input.note, tool.name === 'browser_cart_replace' ? selectedConfiguration : input.selection])
  const previous = task.receipts.get(key)
  if (active === task && task.isCurrent() && previous?.version === facts.cart.version)
    return { ...previous.result, repeated: true }
  if (active !== task || !task.isCurrent() || !ownsCurrentCart(task))
    return { ok: false, source: 'browser', status: 'rejected', effect: 'none' }
  const action = tool.name === 'browser_cart_add' ? 'add' : tool.name === 'browser_cart_replace' ? 'replace' : tool.name === 'browser_cart_quantity' ? 'quantity' : 'remove'
  if (!task.confirmed && input.version !== facts.cart.version && [...task.receipts.values()].some(receipt => receipt.version === facts.cart.version)) {
    // A verified effect in THIS turn owns the new cart version. A later call
    // from the same model batch has not been dispatched or claimed yet: return
    // current evidence for a newly issued plan, never patch/replay its arguments.
    return { ...asBrowserFacts(rawFacts), status: 'proposal_rejected', effect: 'none', dataOnly: true, requiredAction: action, explanation: '這筆參數的購物車版本已不同，尚未派送本次操作。依最新 cart.version 與已核實結果重新規劃仍未完成的需求；不能重做已完成或 unknown 的操作。' }
  }
  if (task.confirmed && task.dialogue) {
    const { proposal, binding } = task.confirmed
    if (!task.dialogue.accepts(binding, rawFacts))
      return { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '確認後餐點或購物車已變更，請重新確認；尚未加入購物車。' }
    const expected = { version: binding.cartVersion, productRef: proposal.productRef, quantity: proposal.quantity, unitPrice: proposal.unitPrice, note: proposal.note, selection: proposal.selection }
    const selection = safeParse(strictObject({ version: string(), variantRef: string(), choices: array(strictObject({ ref: string(), quantity: number() })) }), input.selection)
    // Option/key order is transport formatting, not a different customer choice.
    // Compare only the sealed domain fields and always dispatch saved arguments.
    const sameChoices = selection.success && JSON.stringify(selection.output.choices.map(choice => [choice.ref, choice.quantity]).sort()) === JSON.stringify(proposal.selection.choices.map(choice => [choice.ref, choice.quantity]).sort())
    const same = tool.name === 'browser_cart_add' && selection.success && sameChoices && selection.output.version === proposal.selection.version && selection.output.variantRef === proposal.selection.variantRef
      && ['version', 'productRef', 'quantity', 'unitPrice', 'note'].every(name => input[name] === expected[name as keyof typeof expected]) && Object.keys(input).length === Object.keys(expected).length
    if (!same)
      return { ok: true, source: 'browser', status: 'proposal_rejected', effect: 'none', dataOnly: true, requiredAction: 'add', confirmedAddition: proposal, cart: { version: binding.cartVersion }, explanation: '只允許執行剛才確認的完整設定，請使用這份回執參數。尚未寫入。' }
    if (!ownsCurrentCart(task))
      return { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: task.cartSession?.message }
    const result = await dispatchCartWrite(client, tool, expected)
    if (result && typeof result === 'object' && 'status' in result && result.status === 'verified' && 'cart' in result && result.cart && typeof result.cart === 'object' && 'version' in result.cart && typeof result.cart.version === 'string') {
      task.receipts.set(key, { version: result.cart.version, toolName: 'browser_cart_add', result: { ...result }, ...(servingKey ? { addition: { servingKey, note: proposal.note, quantity: proposal.quantity } } : {}) })
      // This turn consumed one complete confirmation. Its successful effect
      // ends the answer; a new round would compare the old sealed cart binding
      // against the cart this very operation just changed.
      task.onRequestComplete?.()
    }
    return result
  }
  if (task.previousProposal && task.dialogue && tool.name === 'browser_cart_add' && input.productRef === task.previousProposal.productRef && !task.text.includes(task.previousProposal.productName.replaceAll(/\s/g, '')))
    return task.dialogue.presentAddition(rawFacts, input)
  if (task.selected && task.dialogue) {
    if (tool.name !== 'browser_cart_add' || input.productRef !== task.selected.productRef)
      return { ok: true, source: 'browser', status: 'clarification', effect: 'none', customerMessage: '剛才只選定品項，請先確認完整餐點設定；購物車尚未變更。' }
    if (task.selected.requestedQuantity !== undefined && input.quantity !== task.selected.requestedQuantity)
      return { ok: true, source: 'browser', status: 'proposal_rejected', effect: 'none', dataOnly: true, requestedQuantity: task.selected.requestedQuantity, explanation: '份數必須使用顧客剛回答的 requestedQuantity；請修正同一餐點的完整提案，尚未加入購物車。' }
    try {
      const selection = parse(strictObject({ version: string(), variantRef: string(), choices: array(strictObject({ ref: string(), quantity: number() })) }), input.selection)
      const product = parse(orderingAnswerFactsSchema, rawFacts).products.find(product => product.ref === task.selected!.productRef)
      const configuration = product?.configurations.find(configuration => configuration.variantRef === selection.variantRef)
      if (!configuration || input.version !== facts.cart.version || resolveSelection(configuration, selection, typeof input.note === 'string' ? input.note : '').unitPrice !== input.unitPrice)
        throw new Error('餐點設定或售價與目前資料不同。')
    }
    catch (error) {
      return { ok: true, source: 'browser', status: 'proposal_rejected', effect: 'none', dataOnly: true, error: errorMessageFrom(error), explanation: '請依最新餐點設定與售價修正同一需求，尚未加入購物車。' }
    }
    // Keep the selected target/count, then run normal semantic admission.
    // A completed answer is not a reason to ask the same purchase again.
  }
  const names: string[] = []
  const selectedLabels: string[] = []
  const selectedFacts: string[] = []
  const selectedDeltas: BrowserEffect['deltas'] = []
  let cartTarget: BrowserEffect['cartTarget']
  let serving: BrowserEffect['serving']
  let ambiguous = false
  if (tool.name === 'browser_cart_add' || tool.name === 'browser_cart_replace') {
    const product = facts.products.find(product => product.ref === input.productRef)
    if (product) {
      names.push(product.name)
      ambiguous ||= new Set(facts.products.filter(candidate => candidate.name === product.name).map(candidate => candidate.ref)).size > 1
      if (input.selection) {
        const selectionResult = safeParse(looseObject({ version: pipe(string(), minLength(1)), variantRef: string(), choices: array(looseObject({ ref: string(), quantity: number() })) }), input.selection)
        if (!selectionResult.success)
          return { ok: true, source: 'browser', status: 'proposal_rejected', effect: 'none', dataOnly: true, availableConfigurations: product.configurations.map(configuration => ({ version: configuration.version, variantRef: configuration.variantRef })), selectionIssues: selectionResult.issues.map(issue => ({ path: issue.path?.map(part => part.key).join('.') ?? '', message: issue.message })), explanation: 'selection 缺漏或格式錯誤，尚未派送任何寫入。請一次補齊 selectionIssues 的所有欄位：version 複製該商品 configuration.version，variantRef 複製已觀察規格，choices 為每份已選加購陣列（沒有加購也必須明填 []）。頂層 version 仍使用 cart.version。不得猜值；修正欄位後還須核對顧客各組餐點及備註。' }
        const selection = selectionResult.output
        const configuration = product.configurations.find(configuration => configuration.variantRef === selection.variantRef)
        if (configuration) {
          if (product.name === '周氏水餃(最低8顆)')
            selectedFacts.push('周氏水餃基本每份8顆，水餃加量選項是每份額外顆數；每份10顆代表加量2顆。')
          serving = { productName: product.name, variantName: configuration.variantRef ? configuration.name : '', options: [] }
          for (const choice of configuration.groups.flatMap(group => group.choices)) {
            if (task.text.includes(choice.name.replaceAll(/\s/g, '')) && !selection.choices.some(selected => selected.ref === choice.ref)) {
              // A mention may refuse an option. Zero is an explicit omission
              // constraint: semantic extraction must agree before the base meal
              // can be added; a positive request instead requires repair.
              selectedDeltas.push({ name: choice.name, kind: 'option', mode: 'increase', quantity: 0 })
              selectedFacts.push(`PB 將「${choice.name}」列為「${product.name}」的加購選項，每個另加 ${choice.unitPrice} 元。`)
            }
          }
          if (configuration.variantRef)
            names.push(configuration.name)
          for (const choice of selection.choices) {
            const actual = configuration.groups.flatMap(group => group.choices).find(candidate => candidate.ref === choice.ref)
            if (actual) {
              serving.options.push({ name: actual.name, quantity: choice.quantity })
              names.push(actual.name)
              selectedLabels.push(`${actual.name} 每份加量 ${choice.quantity} 個`)
              selectedDeltas.push({ name: actual.name, kind: 'option', mode: 'increase', quantity: choice.quantity * Number(input.quantity) })
              selectedFacts.push(`PB 明確將「${actual.name}」列為「${product.name}」的商品加購／規格選項，每個另加 ${actual.unitPrice} 元。使用這個選項是實際加購，不是免費備註。`)
            }
          }
        }
      }
    }
  }
  if (tool.name !== 'browser_cart_add') {
    const line = original
    if (line) {
      names.push(line.name)
      const sameName = facts.cart.lines.filter(candidate => candidate.name === line.name)
      // Missing product/configuration evidence cannot resolve a same-name row.
      // Different SKUs sharing a label remain ambiguous regardless of the model.
      const identified = !!line.productRef && line.configuration !== undefined && sameName.every(candidate => candidate.productRef === line.productRef) && facts.cart.lines.filter(candidate => candidate.productRef === line.productRef).every(candidate => candidate.configuration !== undefined)
      if (identified) {
        const label = (row: typeof line) => ({ name: row.name, quantity: row.quantity, description: row.description ?? '', configuration: row.description ?? '', note: row.note ?? '', options: row.options })
        cartTarget = { selected: { ...label(line), quantity: originalQuantity }, ...(originalGroup.length > 1 ? { groupSize: originalGroup.length } : {}), others: facts.cart.lines.filter(candidate => !refs.includes(candidate.ref) && candidate.productRef === line.productRef).map(candidate => ({ ...label(candidate), sameConfiguration: candidate.configuration === line.configuration })) }
      }
      ambiguous ||= sameName.length > 1 && !identified
    }
  }
  const expected = tool.name === 'browser_cart_replace' ? 2 : 1
  if (active !== task || !task.isCurrent() || names.length < expected)
    return { ok: false, source: 'browser', status: 'rejected', customerMessage: '目前需求或商品已變更，尚未操作購物車，請重新確認。' }
  const replacement = facts.products.find(product => product.ref === input.productRef)
  const retainQuantity = input.retainQuantity === undefined ? 0 : input.retainQuantity
  if (typeof retainQuantity !== 'number' || !Number.isInteger(retainQuantity) || retainQuantity < 0 || (action !== 'replace' && retainQuantity !== 0) || (action === 'replace' && original && retainQuantity >= originalQuantity))
    return { ok: true, source: 'browser', status: 'proposal_rejected', effect: 'none', dataOnly: true, explanation: '保留份數必須是少於原行數量的非負整數，只能用於替換；尚未寫入。' }
  if (retainQuantity > 0 && !cartTarget)
    return { ok: true, source: 'browser', status: 'clarification', effect: 'none', customerMessage: '尚無法確認原餐配置，請先確認要調整的餐點；尚未變更購物車。' }
  const description = action === 'quantity'
    ? `保留「${original?.name}」商品與規格，將選定同配置行的合計由 ${originalQuantity} 改為 ${input.quantity} 份；其他餐點全部保留。`
    : action === 'remove'
      ? `移除選定同配置「${original?.name}」${originalQuantity} 份；不新增餐點，其他行全部保留。`
      : action === 'replace'
        ? `將既有「${original?.name}」${originalQuantity - retainQuantity} 份換成「${replacement?.name}」${input.quantity} 份，原配置保留 ${retainQuantity} 份；先加新餐核對，再調整原行。`
        : `新增「${replacement?.name}」${input.quantity} 份；所有原餐點保留。`
  const deltas: BrowserEffect['deltas'] = [...selectedDeltas]
  if (replacement)
    deltas.push({ name: replacement.name, kind: 'product', mode: 'increase', quantity: Number(input.quantity) })
  if (original)
    deltas.push({ name: original.name, kind: 'cart_line', mode: action === 'quantity' ? 'set' : 'remove', quantity: action === 'quantity' ? Number(input.quantity) : originalQuantity - retainQuantity })
  const completedEffects = [...new Set([...task.receipts.values()].flatMap(receipt => typeof receipt.result.effectMessage === 'string' ? [receipt.result.effectMessage] : []))]
  const unknownAddition = [...task.receipts.values()].some(receipt => receipt.toolName === 'browser_cart_add' && !receipt.addition)
  if (action === 'add' && unknownAddition)
    return { ok: true, source: 'browser', status: 'clarification', effect: 'none', customerMessage: '本輪已有核實新增，但尚無法辨識完整配置；請先核對購物車，避免重複加餐。' }
  const completedAdditions = [...task.receipts.values()].flatMap(receipt => receipt.addition ? [receipt.addition] : [])
  const semanticDecision = await task.decide({ transcript: task.transcript, action, completedEffects, completedAdditions, servingKey, deltas, cartContext: { version: facts.cart.version, lines: facts.cart.lines.map(line => ({ name: line.name, quantity: line.quantity, description: line.description ?? '', note: line.note ?? '', options: line.options })) }, cartTarget, serving, copySource: copySource ? { name: copySource.name, quantity: copySource.quantity, configuration: copySource.description ?? '', note: copySource.note ?? '', options: copySource.options } : undefined, note: typeof input.note === 'string' ? input.note : '', storeFacts: [...selectedFacts, ...(task.orderEvidence ? [`原始點餐需求：${task.orderEvidence.request}。已確認的問題與顧客回答：${task.orderEvidence.answers.map(item => `問題「${item.question}」，顧客回答「${item.answer}」`).join('；')}。`] : []), ...(original ? [`PB 現在指定的購物車行／同配置群組是「${original.name}」合計 ${originalQuantity} 份。整組移除代表移除目前這 ${originalQuantity} 份；這個原有數量不是顧客對新餐指定的份數。`] : [])].join(' '), description: `${description} 每份餐點的選項：${selectedLabels.join('、') || '沒有加購'}。單份售價 ${input.unitPrice ?? '沿用原行'}。備註：${input.note ?? ''}。` }, { toolName: parse(browserWriteToolNameSchema, tool.name), arguments: JSON.stringify(input) })
  if (active !== task || !task.isCurrent() || !ownsCurrentCart(task))
    return { ok: false, source: 'browser', status: 'rejected', customerMessage: '這次需求已結束，尚未變更購物車。' }
  if (semanticDecision.choice === 'PRESERVE') {
    // Preservation describes the whole utterance, not the retained half of a change.
    // Refuse the model's proposed write and obtain a fresh owned readback instead.
    const review = client.tools.value.find(tool => tool.name === 'browser_cart_review')
    if (!review)
      return { ok: false, source: 'browser', status: 'rejected', effect: 'none' }
    const receipt = await executeBrowserCartTool(client, review, {})
    const current = safeParse(looseObject({ ok: boolean(), source: string(), cart: looseObject({ version: string() }), customerMessage: string() }), receipt)
    if (!current.success || !current.output.ok || current.output.source !== 'browser' || active !== task || !task.isCurrent() || !ownsCurrentCart(task))
      return receipt
    task.onRequestComplete?.()
    return { ...current.output, status: 'preserved', effect: 'none', semanticDecision, customerMessage: `餐點維持不變。${current.output.customerMessage}` }
  }
  if (semanticDecision.choice === 'READ_ONLY')
    return { ok: true, source: 'browser', status: 'clarification', effect: 'none', dataOnly: true, semanticDecision, products: facts.products, explanation: '原句是資訊詢問，不是購買授權。尚未變更購物車；依完整問題使用只讀工具取得並呈現相應資訊，不用整份菜單代替答案。' }
  if (semanticDecision.choice === 'DIFFERENT_OPERATION')
    return { ok: true, source: 'browser', status: 'proposal_rejected', effect: 'none', dataOnly: true, semanticDecision, requiredAction: semanticDecision.requiredAction, explanation: '本句要求另一種完整操作，尚未寫入。換餐只能使用 browser_cart_replace，不得拆成 remove/add。請依 requiredAction 與最新事實重新提出完整工具呼叫。' }
  // Slot presence is not semantic permission. Purpose/ownership were checked
  // above; this only prevents an invented default meal count from reaching PB.
  const selectedCount = task.selected?.productRef === replacement?.ref && task.selected?.requestedQuantity === input.quantity
  if (action === 'add' && task.dialogue && replacement && !selectedCount && explicitServingQuantities(task.transcript, { productName: replacement.name }).length === 0) {
    if (!mentionsProduct(task, replacement.name, facts.products))
      return presentQuestion(rawFacts, replacement.name)
    return task.dialogue.presentQuantity(rawFacts, replacement.ref, task.transcript)
  }
  if (ambiguous)
    return { ok: true, source: 'browser', status: 'clarification', effect: 'none', customerMessage: '目前有多筆同名商品，請先在畫面確認要操作的那一筆；尚未變更購物車。' }

  if (semanticDecision.choice === 'REVISE' && task.repairs++ < 1)
    return { ok: true, source: 'browser', status: 'proposal_rejected', effect: 'none', dataOnly: true, semanticDecision, requiredAction: action, explanation: `原句已清楚，但提案參數不符，尚未寫入。請依核對原因修正本輪原需求：${semanticDecision.checks?.at(-1)?.reason ?? ''}` }
  if (!copySource && names.some(name => !mentionsProduct(task, name, facts.products)) && tool.name === 'browser_cart_add' && task.dialogue) {
    // Semantic resolution may propose a current SKU for an unfamiliar spoken
    // name. It still cannot write: ask with the official name and complete
    // configuration, then require the existing one-use customer confirmation.
    if (semanticDecision.choice === 'ALLOW')
      return task.dialogue.presentAddition(rawFacts, input)
    return task.dialogue.presentProducts(rawFacts, replacement?.name ?? '', task.transcript)
  }
  if (semanticDecision.choice !== 'ALLOW')
    return { ok: true, source: 'browser', status: 'clarification', effect: 'none', semanticDecision, customerMessage: '尚未確認您要進行這項購物車操作，請重新確認需求；目前尚未變更購物車。' }
  // The selected existing configuration may be referred to as "the one with
  // rice" when the verified replacement retains its SKU. A different SKU still
  // requires its formal target name; semantic allowance alone cannot invent it.
  const sameProductReplacement = action === 'replace' && !!original?.productRef && original.productRef === replacement?.ref
  const preservedSource = copySource ?? (sameProductReplacement ? original : undefined)
  const preservedName = (name: string) => preservedSource && (name === preservedSource.name || preservedSource.options?.some(option => option.name === name && serving?.options.some(selected => selected.name === name && selected.quantity === option.quantity)))
  if (names.some(name => !mentionsProduct(task, name, facts.products) && !preservedName(name) && (!cartTarget || semanticDecision.choice !== 'ALLOW' || name !== original?.name || (name === replacement?.name && !sameProductReplacement)))) {
    // A replacement's new SKU was independently checked above, but its spoken
    // name is still unconfirmed. Ask about that observed candidate only; the
    // existing meal and all write authority remain unchanged until a new turn.
    if (action === 'replace' && replacement && task.dialogue)
      return task.dialogue.presentProducts(rawFacts, replacement.name, task.transcript)
    const choices = needsProducts ? facts.products : facts.cart.lines
    return { ok: true, source: 'browser', status: 'clarification', effect: 'none', customerMessage: `請問您要${choices.map(product => product.name).join('、')}中的哪一項？目前尚未變更購物車。` }
  }
  const result = await dispatchCartWrite(client, tool, input)
  if (result && typeof result === 'object' && 'ok' in result && result.ok === true && 'status' in result && result.status === 'verified' && 'cart' in result && result.cart && typeof result.cart === 'object' && 'version' in result.cart && typeof result.cart.version === 'string') {
    const receipt = { ...result, semanticDecision }
    task.receipts.set(key, { version: result.cart.version, toolName: parse(browserWriteToolNameSchema, tool.name), result: receipt, ...(action === 'add' && servingKey ? { addition: { servingKey, note: typeof input.note === 'string' ? input.note : '', quantity: Number(input.quantity) } } : {}) })
    // This is completion coverage, never operation authority: Main selected the
    // tool, the Server admitted its exact plan, and the browser verified it above.
    // Any trailing request, negation or compound utterance continues through Main.
    if (active === task && task.isCurrent() && original && (action === 'remove' || action === 'quantity')) {
      const parts = task.text.split(original.name.replaceAll(/\s/g, ''))
      if (parts.length === 2) {
        const [before, after] = parts
        const complete = action === 'remove'
          ? /^(?:請|請幫我|幫我)?(?:移除|刪除)$/.test(before) && /^(?:謝謝)?[。！!]*$/.test(after)
          : /^(?:請|幫我)?把$/.test(before) && /^改成(?:[1-9]|1\d|20)份(?:謝謝)?[。！!]*$/.test(normalizeSlotNumbers(after)) && Number(normalizeSlotNumbers(after).match(/\d+/)?.[0]) === input.quantity
        if (complete)
          task.onRequestComplete?.()
      }
    }
    return receipt
  }
  return result
}

/** Reads verified PB facts without consuming an answer or changing the page. */
export async function readBrowserOrderingFacts(client: Pick<ReturnType<typeof createInteractiveServiceClient>, 'tools' | 'execute'>): Promise<unknown> {
  const task = active
  const read = client.tools.value.find(tool => tool.name === 'browser_cart_get')
  if (!task || !read || !task.isCurrent())
    throw new Error('目前點餐需求已結束。')
  const raw = await client.execute(read, { includeCatalog: true })
  if (active !== task || !task.isCurrent())
    throw new Error('目前點餐需求已結束。')
  const denied = admitCart(task, raw, true)
  if (denied && 'page' in denied && denied.page === 'table')
    return denied
  if (denied)
    throw new Error('目前購物車尚未完成確認。')
  const facts = parse(orderingAnswerFactsSchema, raw)
  return { ...facts, products: labelCatalog(facts.products, task.catalogLabels?.()) }
}

/** Main may update recommendation criteria; every visual choice is checked against them again. */
export function browserRecommendationCriteria(patch: RecommendationCriteria | undefined, products: readonly { name: string }[]) {
  const task = active
  if (!task?.isCurrent() || !task.dialogue)
    throw new Error('目前接待已結束。')
  if (patch?.category && !labelCatalog(products, task.catalogLabels?.()).some(product => product.category === patch.category))
    throw new Error('目前沒有這個已設定的餐點類別，請依目前菜單使用關鍵字搜尋或指定餐名。')
  return patch ? task.dialogue.recommendations.update(patch) : task.dialogue.recommendations.snapshot()
}

export function filterBrowserRecommendations<T extends { name: string, configurations: { unitPrice: number }[] }>(products: T[]): T[] {
  const task = active
  if (!task?.isCurrent() || !task.dialogue)
    throw new Error('目前接待已結束。')
  return task.dialogue.recommendations.filter(labelCatalog(products, task.catalogLabels?.()))
}

/** Builds one finite follow-up from current website facts; no model-authored question text. */
export async function askBrowserCustomerQuestion(client: Pick<ReturnType<typeof createInteractiveServiceClient>, 'tools' | 'execute'>, input: { questionType: string, name?: string, quantity?: number, query?: string }) {
  const task = active
  const raw = await readBrowserOrderingFacts(client)
  if (!task?.dialogue || active !== task || !task.isCurrent())
    throw new Error('目前點餐需求已結束。')
  const facts = parse(orderingAnswerFactsSchema, raw)
  const named = facts.products.filter(product => product.name === input.name)
  let question: string
  let choices = [{ id: 'yes', description: '同意' }, { id: 'no', description: '不同意' }]
  if (input.questionType === 'purchase-recommendation') {
    if (named.length !== 1)
      throw new Error('請先確認推薦的是哪道餐點。')
    const serving = pbBasicServing(named[0].name, named[0].configurations[0]?.unitPrice)
    question = `${serving ? `${pbProductName(named[0].name)}${serving}。` : ''}${input.quantity === 1 ? `要來一份${pbProductName(named[0].name)}嗎？` : `您要點${pbProductName(named[0].name)}嗎？要幾份？`}`
    if (input.quantity === 1)
      choices = [{ id: 'yes', description: `購買${named[0].name}一份，必選設定完整才加入購物車；不送單。` }, { id: 'no', description: '不要這道推薦，尚未加入購物車。' }]
  }
  else if (input.questionType === 'cancel-and-search') {
    const selection = task.dialogue.conversation(raw)
    const name = selection.draft?.name ?? selection.drafts?.[0]?.name
    if (!name || input.query === undefined)
      throw new Error('目前沒有可確認取消的選餐或新的查詢內容。')
    question = `要先取消${name}，改看${input.query || '全部餐點'}嗎？`
  }
  else if (input.questionType === 'cart-target') {
    const cart = parse(looseObject({ cart: looseObject({ lines: array(cartLineLabelSchema) }) }), raw).cart
    if (!cart.lines.length)
      throw new Error('購物車目前沒有餐點可以修改。')
    question = '請問要修改購物車裡的哪道餐點？'
    // The spoken choice and Main's subsequent answer evidence must distinguish
    // same-name rows by readable options, never the native fingerprint.
    choices = cart.lines.map((line, index) => ({ id: `line:${index}`, description: [line.name, line.description, line.note].filter(Boolean).join('，') }))
  }
  else if (input.questionType === 'option') {
    const configuration = named.length === 1 && named[0].configurations.length === 1 ? named[0].configurations[0] : undefined
    const groups = configuration?.groups.filter(group => !input.query || group.name === input.query)
    if (!groups || groups.length !== 1)
      throw new Error('請先確認要詢問哪道餐點的哪組選項。')
    question = `${named[0].name}的${groups[0].name}要選哪一項？`
    choices = groups[0].choices.map(choice => ({ id: `option:${choice.ref}`, description: choice.name }))
  }
  else {
    const criteria = task.dialogue.recommendations.snapshot()
    if (criteria.maxUnitPrice === undefined || filterBrowserRecommendations(facts.products).length)
      throw new Error('目前無法確認這個價格範圍沒有餐點，請先核對查詢條件。')
    question = `這個範圍沒有符合的，要看其他價格的嗎？`
  }
  return task.dialogue.presentService(raw, { purpose: input.questionType, name: input.name, quantity: input.quantity, query: input.query, request: task.transcript, question, choices })
}

/** Cancels only the current unadded selection and closes its native window. */
export async function cancelBrowserItemSelection(client: Pick<ReturnType<typeof createInteractiveServiceClient>, 'tools' | 'execute'>) {
  const task = active
  const close = client.tools.value.find(tool => tool.name === 'browser_close_product')
  if (!task || !task.isCurrent() || !close)
    throw new Error('目前無法取消選餐。')
  let result = await client.execute(close, {})
  const search = client.tools.value.find(tool => tool.name === 'browser_search')
  if (result && typeof result === 'object' && 'ok' in result && result.ok === true && search)
    result = await client.execute(search, { query: '' })
  const receipt = parse(looseObject({ ok: boolean() }), result)
  if (active === task && task.isCurrent() && receipt.ok) {
    task.dialogue?.reset()
    task.selected = undefined
    task.confirmed = undefined
    task.confirmedOrder = undefined
  }
  return result
}

/** Refreshes one task's model context without consuming answers or changing the page. */
export async function readBrowserConversation(client: Pick<ReturnType<typeof createInteractiveServiceClient>, 'tools' | 'execute'>, taskId: string, toolNames: readonly string[]): Promise<BrowserConversation> {
  const task = active
  const read = client.tools.value.find(tool => tool.name === 'browser_cart_get')
  if (!task || !read || !task.isCurrent())
    throw new Error('Current browser conversation is unavailable.')
  // This is an internal read, like master's host-only conversation-context read.
  // Answer resolution must wait for the canonical customer turn to be recorded.
  const raw = await client.execute(read, { includeCatalog: true })
  if (active !== task || !task.isCurrent())
    throw new Error('Browser context belongs to a superseded task.')
  if (safeParse(browserSignInRequiredSchema, raw).success) {
    return parse(browserConversationSchema, { taskId, sourceUtterance: task.transcript, phase: 'sign_in_required', readOnly: true, catalog: { complete: false, products: [] }, allowedToolNames: browserToolNames({ phase: 'sign_in_required', readOnly: true }, toolNames) })
  }
  const tableEntry = safeParse(tableEntrySchema, raw)
  if (tableEntry.success) {
    task.tableSelectionRequired = true
    const state = { phase: 'selecting_table' as const, readOnly: true }
    return parse(browserConversationSchema, { taskId, sourceUtterance: task.transcript, ...state, page: 'table', tableChoices: tableEntry.output.tableChoices, selectedTable: tableEntry.output.selectedTable, catalog: { complete: false, products: [] }, allowedToolNames: browserToolNames(state, toolNames) })
  }
  const facts = parse(looseObject({ itemSelectionOpen: optional(boolean()), ok: literal(true), source: literal('browser'), page: optional(picklist(['table', 'menu', 'cart', 'checkout'])), cart: looseObject({ version: string(), lines: array(looseObject({ ref: string(), name: string(), quantity: number() })) }), products: array(object({ ref: string(), name: string(), price: optional(number()), configurations: array(productConfigurationSchema) })) }), raw)
  const denied = admitCart(task, raw, true)
  const reviewRequired = denied && 'customerBoundary' in denied && denied.customerBoundary === 'review-required'
  if (denied && !reviewRequired)
    throw new Error('Current cart ownership cannot be established.')
  if (!reviewRequired && !task.selected) {
    const accepted = task.dialogue?.selectionForTurn(raw, task.utteranceId)
    if (accepted) {
      task.selected = accepted.selection
      task.orderEvidence = accepted.evidence
      task.text = [accepted.evidence.request, ...accepted.evidence.answers.map(item => item.answer), task.transcript].join('\n').replaceAll(/\s/g, '')
      // The current customer supplied this count to a purchase question. Main
      // may finish its notes/options, but still needs independent plan admission.
      task.readOnly = false
    }
  }
  const selected = task.selected
  const mentioned = facts.products.filter((product) => {
    if (task.text.includes(product.name.replaceAll(/\s/g, '')))
      return true
    const spokenName = pbProductName(product.name)
    return spokenName !== product.name && task.text.includes(spokenName)
      && facts.products.filter(candidate => pbProductName(candidate.name) === spokenName).length === 1
  })
  // A consumed answer has priority over literal mentions. An unresolved or
  // ambiguous name is not a current target that Main may invent a quantity for.
  let target: (typeof facts.products)[number] | undefined
  if (selected)
    target = facts.products.find(product => product.ref === selected.productRef)
  else if (mentioned.length === 1)
    target = mentioned[0]
  const quantities = explicitServingQuantities(selected?.request ?? task.transcript, { productName: target?.name })
  const quantity = selected?.requestedQuantity ?? (quantities.length === 1 ? quantities[0] : undefined)
  const providedSlots = !reviewRequired && target ? { productRef: target.ref, name: target.name, quantity } : undefined
  let dialogue: Pick<BrowserConversation, 'phase' | 'draft' | 'drafts' | 'waitingFor'> = { phase: 'browsing' }
  if (reviewRequired) {
    dialogue = { phase: 'review_required' }
  }
  else if (task.confirmedOrder && task.dialogue) {
    if (!task.dialogue.accepts(task.confirmedOrder.binding, raw))
      throw new Error('Confirmed order no longer matches the current browser.')
    dialogue = { phase: 'ready_to_add', drafts: task.confirmedOrder.proposals.map((proposal, index) => ({ id: String(index), productRef: proposal.productRef, name: proposal.productName, quantity: proposal.quantity, choices: proposal.selection.choices, note: proposal.note, missing: [] })) }
  }
  else if (task.confirmed && task.dialogue) {
    if (!task.dialogue.accepts(task.confirmed.binding, raw))
      throw new Error('Confirmed addition no longer matches the current browser.')
    const proposal = task.confirmed.proposal
    dialogue = { phase: 'ready_to_add', draft: { productRef: proposal.productRef, name: proposal.productName, quantity: proposal.quantity, note: proposal.note, optionSummary: proposal.optionSummary, missing: [] } }
  }
  else {
    dialogue = task.dialogue?.conversation(raw, task.utteranceId) ?? dialogue
    if (!dialogue.waitingFor && selected) {
      const product = facts.products.find(product => product.ref === selected.productRef)
      if (product)
        dialogue = { phase: 'configuring', draft: { productRef: product.ref, name: product.name, quantity, missing: ['configuration', 'confirmation'] } }
    }
  }
  const readOnly = task.readOnly === true
  return parse(browserConversationSchema, {
    taskId,
    sourceUtterance: task.transcript,
    recommendationCriteria: task.dialogue?.recommendations.snapshot(),
    page: facts.page,
    ...dialogue,
    readOnly,
    providedSlots,
    itemSelectionOpen: facts.itemSelectionOpen,
    checkout: typeof raw === 'object' && raw && 'checkout' in raw ? safeParse(pbCheckoutSchema, raw.checkout).output : undefined,
    // Preserve native row/configuration identity and subtotal through the owning
    // shared projection, but never expose another visitor's cart to the model.
    cart: reviewRequired ? undefined : facts.cart,
    search: typeof raw === 'object' && raw && 'search' in raw && typeof raw.search === 'string' ? raw.search : '',
    catalog: { complete: true, products: labelCatalog(facts.products, task.catalogLabels?.()) },
    allowedToolNames: browserToolNames({ phase: dialogue.phase, readOnly, providedSlots }, toolNames),
  })
}

/**
 * Prepares an answer to the current private question without consuming it.
 * Before Main, only closed literal answers qualify; a Jev-selected answer uses
 * semantic resolution after the canonical turn is recorded.
 * Invoke only after recording this utterance. The returned operation rechecks the
 * task and native bindings; it cannot construct a purchase or replay a batch.
 */
export async function prepareBrowserQuestionAnswer(client: Pick<ReturnType<typeof createInteractiveServiceClient>, 'tools' | 'execute'>) {
  const task = active
  const read = client.tools.value.find(tool => tool.name === 'browser_cart_get')
  if (!task?.dialogue?.hasPending() || task.answerResolved || !task.isCurrent() || !read)
    return
  const facts = await client.execute(read, { includeCatalog: true })
  // A selected Jev answer may use any wording. The semantic resolver still
  // checks the full answer and freshness; only the pre-Main shortcut is literal.
  if (active !== task || !task.isCurrent() || admitCart(task, facts) || (task.intentSource !== 'jev' && !task.dialogue.canAnswerLocally(facts, task.transcript)))
    return
  let consumed = false
  return async () => {
    if (consumed || active !== task || !task.isCurrent())
      return { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '目前接待或問題已變更，請重新確認。' }
    consumed = true
    const result = await executeBrowserCartTool(client, read, { includeCatalog: true })
    if (active === task && task.isCurrent() && (task.confirmedOrder || task.confirmed))
      return executeBrowserConfirmedAddition(client)
    if (result && typeof result === 'object' && 'selectedProduct' in result)
      return { ...result, needsAssistant: true }
    return result
  }
}

/** Keeps the read-only receipt intact while attaching Host question evidence. */
function asBrowserFacts(value: unknown) {
  return parse(looseObject({ source: string(), cart: looseObject({ version: string() }) }), value)
}

/** Opens a bound missing-quantity question; the model cannot supply the customer's answer. */
export async function executeBrowserQuantityQuestion(client: Pick<ReturnType<typeof createInteractiveServiceClient>, 'tools' | 'execute'>, input: unknown) {
  const { productRef } = parse(strictObject({ productRef: string() }), input)
  const task = active
  const context = client.tools.value.find(tool => tool.name === 'browser_cart_get')
  if (!task?.dialogue || !context || !task.isCurrent())
    return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
  if (task.dialogue.hasPending() && !task.answerResolved)
    return executeBrowserCartTool(client, context, { includeCatalog: true })
  const facts = await client.execute(context, { includeCatalog: true })
  if (active !== task || !task.isCurrent())
    return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
  const denied = admitCart(task, facts)
  if (denied)
    return denied
  const catalog = parse(looseObject({ products: array(looseObject({ ref: string(), name: string() })) }), facts)
  const product = catalog.products.find(product => product.ref === productRef)
  if (product && task.selected?.productRef !== productRef && !mentionsProduct(task, product.name, catalog.products)) {
    return { ok: true, source: 'browser', status: 'proposal_rejected', effect: 'none', dataOnly: true, explanation: '顧客尚未選定這項商品，不可替自行挑選的餐點問份數。推薦需求使用 browser_present；片段餐名才用 browser_clarify_product，query 保留顧客原用語。' }
  }
  const present = client.tools.value.find(tool => tool.name === 'browser_present')
  if (product && present) {
    const shown = await client.execute(present, { productRefs: [productRef], mode: 'information' })
    if (active !== task || !task.isCurrent())
      return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
    if (shown && typeof shown === 'object' && 'ok' in shown && shown.ok === false)
      return shown
  }
  return task.dialogue.presentQuantity(facts, productRef, task.selected?.request ?? task.transcript, task.selected?.requestTarget, task.selected?.orderSelection)
}

/** Collects model-extracted fields without allowing any vendor write. */
export async function executeBrowserOrderDraft(client: Pick<ReturnType<typeof createInteractiveServiceClient>, 'tools' | 'execute'>, input: unknown) {
  const task = active
  const read = client.tools.value.find(tool => tool.name === 'browser_cart_get')
  if (!task?.dialogue || !read || !task.isCurrent())
    return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
  if (task.dialogue.hasPending() && !task.answerResolved)
    return executeBrowserCartTool(client, read, { includeCatalog: true })
  if (task.readOnly && !task.clarifyOrder)
    return { ok: true, source: 'browser', status: 'proposal_rejected', effect: 'none', dataOnly: true, explanation: '顧客目前只要求查詢，不能建立購買草稿。請依原始問題使用查詢工具取得資料並回答，尚未變更購物車。' }
  const facts = await client.execute(read, { includeCatalog: true })
  if (active !== task || !task.isCurrent())
    return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
  const denied = admitCart(task, facts)
  if (denied)
    return denied
  const result = task.dialogue.collectOrder(facts, input, task.selected?.request || task.transcript, task.selected ? { productRef: task.selected.productRef, quantity: task.selected.requestedQuantity, answer: task.transcript } : undefined)
  if ('completeOrder' in result) {
    task.confirmed = undefined
    task.confirmedOrder = result.completeOrder
    return executeBrowserConfirmedAddition(client)
  }
  return result
}

/** Executes a current, complete customer-evidenced order or consumed confirmation once. */
export async function executeBrowserConfirmedAddition(client: Pick<ReturnType<typeof createInteractiveServiceClient>, 'tools' | 'execute'>) {
  const task = active
  const tool = client.tools.value.find(tool => tool.name === 'browser_cart_add')
  if (task?.readOnly)
    return { ok: true, source: 'browser', status: 'proposal_rejected', effect: 'none', dataOnly: true, explanation: '顧客目前只要求查詢，不能確認購買。請依原始問題使用查詢工具取得資料並回答，尚未變更購物車。' }
  if (task?.confirmedOrder && tool && task.dialogue && task.isCurrent()) {
    const order = task.confirmedOrder
    if (order.evidence) {
      // Customer confirmation is no longer a substitute for independent model
      // admission. Preserve original speech and real slot answers for that check.
      task.orderEvidence = order.evidence
      task.text = [order.evidence.request, ...order.evidence.answers.map(item => item.answer)].join('\n').replaceAll(/\s/g, '')
    }
    task.confirmedOrder = undefined // Consume before IO; duplicate commands cannot replay this batch.
    const read = client.tools.value.find(tool => tool.name === 'browser_cart_get')!
    let binding = order.binding
    const completed: AdditionProposal[] = []
    let last: Record<string, unknown> | undefined
    let failure: Record<string, unknown> | undefined
    let awaitingWrite = false
    try {
      for (const proposal of order.proposals) {
        const fresh = await client.execute(read, { includeCatalog: true })
        if (fresh && typeof fresh === 'object' && 'ok' in fresh && fresh.ok === false) {
          failure = { ...fresh }
          break
        }
        if (active !== task || !task.isCurrent() || !ownsCurrentCart(task) || !task.dialogue.accepts(binding, fresh)) {
          failure = { status: 'rejected', customerMessage: '畫面、餐點或購物車已變更，剩餘餐點尚未加入，請重新核對。' }
          break
        }
        awaitingWrite = true
        const write = { version: binding.cartVersion, productRef: proposal.productRef, quantity: proposal.quantity, unitPrice: proposal.unitPrice, note: proposal.note, selection: proposal.selection }
        if (order.evidence)
          task.selected = { productRef: proposal.productRef, request: order.evidence.request, requestedQuantity: proposal.quantity }
        const result = order.evidence ? await executeBrowserCartTool(client, tool, write) : await dispatchCartWrite(client, tool, write)
        awaitingWrite = false
        const receipt = safeParse(looseObject({ ok: literal(true), source: literal('browser'), status: literal('verified'), cart: looseObject({ version: string() }) }), result)
        if (!receipt.success) {
          failure = result && typeof result === 'object' ? { ...result } : { status: 'unknown' }
          break
        }
        completed.push(proposal)
        last = receipt.output
        // Only our verified native receipt advances the batch's cart binding. A
        // manual edit, changed schema or unknown write never gets silently rebound.
        binding = { ...binding, cartVersion: receipt.output.cart.version }
      }
    }
    catch {
      // Native transport can fail after a write; never retry or erase earlier
      // verified effects. The coordinator retains unknown-effect blocking.
      failure = { status: awaitingWrite ? 'unknown' : 'rejected' }
    }
    task.onRequestComplete?.()
    const added = completed.length ? `已加入：${completed.map(line => describePbMeal({ ...line, name: line.productName })).join('、')}。` : ''
    if (failure && !completed.length) {
      if (failure.pendingCustomerChoice || failure.status === 'proposal_rejected' || failure.dataOnly)
        return failure
      const signIn = safeParse(browserSignInRequiredSchema, failure)
      if (signIn.success)
        return signIn.output
    }
    if (failure)
      return { ok: false, source: 'browser', status: failure.status === 'unknown' ? 'unknown' : 'rejected', effect: completed.length ? 'partial' : 'none', customerMessage: `${added}${failure.status === 'unknown' ? '後續加入購物車結果尚未確認，請核對購物車，暫停自動操作。' : '其餘餐點尚未完成加入，請核對購物車後再繼續。'}尚未送出訂單或付款。` }
    return { ...last, ok: true, source: 'browser', status: 'verified', effect: 'applied', effectMessage: added, customerMessage: added }
  }
  if (!task?.confirmed || !tool || !task.isCurrent())
    return { ok: false, source: 'host', status: 'rejected', effect: 'none', customerMessage: '請先確認完整餐點與份數，尚未加入。' }
  const { proposal, binding } = task.confirmed
  // This command has no model-controlled parameters. Only the consumed answer's
  // saved proposal supplies write arguments; native validation below still checks
  // every value and the visitor/document/cart binding before any effect.
  return executeBrowserCartTool(client, tool, { version: binding.cartVersion, productRef: proposal.productRef, quantity: proposal.quantity, unitPrice: proposal.unitPrice, note: proposal.note, selection: proposal.selection })
}

/** Checkout drafts and final questions remain bound to the current visitor and native cart. */
export async function executeBrowserCheckout(client: Pick<ReturnType<typeof createInteractiveServiceClient>, 'tools' | 'execute'>, action: 'continue' | 'invoice-options' | 'invoice' | 'phone', input: { method?: string, phone?: string } = {}) {
  const task = active
  if (!task?.dialogue || !task.isCurrent())
    return { ok: false, source: 'host', effect: 'none' }
  if (action === 'continue' && task.dialogue.hasPending() && !task.answerResolved) {
    const read = client.tools.value.find(tool => tool.name === 'browser_cart_get')
    if (!read)
      throw new Error('結帳需要目前問題與購物車資料。')
    // Main may receive an unfamiliar assent after a weak fast-path choice.
    // Resolve that real question first; continuing must not silently adopt
    // the website's default invoice method or skip final submission consent.
    return executeBrowserCartTool(client, read, { includeCatalog: true })
  }
  const raw = await readBrowserOrderingFacts(client)
  if (active !== task || !task.isCurrent())
    return { ok: false, source: 'host', effect: 'none' }
  const denied = admitCart(task, raw)
  if (denied)
    return denied
  const facts = parse(looseObject({ ...orderingAnswerFactsSchema.entries, cart: cartSnapshotSchema }), raw)
  if (!facts.cart.lines.length)
    return { ok: true, source: 'browser', effect: 'none', customerMessage: '購物車目前沒有餐點。想點哪一道？' }
  const name = action === 'invoice' ? 'browser_invoice_select' : action === 'phone' ? 'browser_notification_phone' : 'browser_checkout_prepare'
  const tool = client.tools.value.find(tool => tool.name === name)
  if (!tool)
    throw new Error('目前網站尚未提供這項結帳操作。')
  let parameters: Record<string, unknown> = {}
  if (action === 'invoice')
    parameters = { method: parse(pbInvoiceMethodSchema, input.method) }
  if (action === 'phone') {
    const digits = normalizeSlotNumbers(task.transcript).replaceAll(/\D/g, '')
    if (!input.phone || input.phone !== digits || !/^\d{10,15}$/.test(digits))
      return { ok: true, source: 'browser', effect: 'none', customerMessage: '請提供完整通知手機號碼，或直接在畫面填寫。' }
    parameters = { phone: digits }
  }
  const result = await client.execute(tool, parameters)
  if (active !== task || !task.isCurrent())
    return { ok: false, source: 'host', effect: 'none' }
  const parsed = safeParse(looseObject({ ok: literal(true), source: literal('browser'), checkout: pbCheckoutSchema, cart: looseObject({ version: string(), lines: array(looseObject({ ...cartLineLabelSchema.entries, unitPrice: number() })), subtotal: optional(number()), tableName: optional(string()) }) }), result)
  if (!parsed.success)
    return result
  const checkout = parsed.output.checkout
  const binding = { ...facts, cart: { ...facts.cart, ...parsed.output.cart } }
  const pending = task.dialogue.conversation(binding).waitingFor
  if (pending)
    task.dialogue.releaseService(binding, pending.questionId)
  if (action === 'invoice-options' || !checkout.methods.some(method => method.selected)) {
    const question = task.dialogue.presentService(binding, { purpose: 'invoice-method', request: task.transcript, question: `發票要用哪種方式？${checkout.methods.map(method => method.label).join('、')}。`, choices: checkout.methods.map(method => ({ id: method.method, description: `選擇${method.label}，只設定發票，不送出訂單。` })) })
    return { ...parsed.output, ...question, dataOnly: false }
  }
  if (!checkout.ready || !checkout.confirmationToken) {
    const selected = checkout.methods.find(method => method.selected)!
    const message = checkout.missing.length ? checkout.missing.join(' ') : '資料已填入，請核對畫面；填寫完成後告訴我「資料填好了」。'
    return { ...parsed.output, dataOnly: false, effect: 'none', customerMessage: `目前發票方式：${selected.label}。${message}${checkout.missing.length ? '填好後請告訴我「資料填好了」。' : ''}` }
  }
  const cart = parsed.output.cart
  const meals = cart.lines.map(line => describePbMeal(line)).join('、')
  const invoice = checkout.methods.find(method => method.selected)!.label
  const fields = checkout.fields.filter(field => field.value).map(field => `${field.label}${field.value}`).join('、')
  const question = task.dialogue.presentService(binding, { purpose: 'submit-order', query: checkout.confirmationToken, request: task.transcript, question: `本次餐點：${meals}，總金額${checkout.total}元${cart.tableName ? `，${cart.tableName}` : ''}；發票${invoice}${fields ? `，${fields}` : ''}${checkout.orderNote ? `，訂單備註${checkout.orderNote}` : ''}。以上內容確認送出訂單嗎？`, choices: [{ id: 'yes', description: '確認剛才完整訂單摘要，現在按下送出訂單；不選擇或操作付款。' }, { id: 'no', description: '先不送出，保留餐點與發票通知資料，可以提出修改。' }] })
  return { ...parsed.output, ...question, dataOnly: false }
}

/** A generic acknowledgement cannot bypass a live purchase question or claim an effect. */
export async function executeBrowserReply(client: Pick<ReturnType<typeof createInteractiveServiceClient>, 'tools' | 'execute'>, kind: unknown) {
  const selected = parse(picklist(['greeting', 'acknowledgement', 'hearing-check', 'clarification', 'information-unavailable', 'checkout-guidance']), kind)
  const task = active
  if (!task || !task.isCurrent())
    return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
  if (task.tableSelectionRequired) {
    const read = client.tools.value.find(tool => tool.name === 'browser_cart_get')
    if (!read)
      throw new Error('Table entry requires the current native page.')
    const fresh = await client.execute(read, { includeCatalog: false })
    if (active !== task || !task.isCurrent())
      return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
    const denied = admitCart(task, fresh)
    if (denied)
      return denied
    task.tableSelectionRequired = false
  }
  if (selected === 'checkout-guidance') {
    if (client.tools.value.some(tool => tool.name === 'browser_checkout_prepare')) {
      const read = client.tools.value.find(tool => tool.name === 'browser_cart_get')!
      const raw = await client.execute(read, { includeCatalog: false })
      const page = safeParse(looseObject({ page: string() }), raw)
      if (page.success && page.output.page === 'cart')
        return executeBrowserCheckout(client, 'continue')
      const review = client.tools.value.find(tool => tool.name === 'browser_cart_review')!
      return executeBrowserCartTool(client, review, {})
    }
    const review = client.tools.value.find(tool => tool.name === 'browser_cart_review')
    if (!review || !task.checkoutGuidance)
      throw new Error('Checkout guidance requires native cart review and the current Kiosk translation context.')
    // The review gate checks ownership before opening or exposing a prior cart.
    // This never submits an order, selects payment or grants new cart ownership.
    const result = await executeBrowserCartTool(client, review, {})
    if (active !== task || !task.isCurrent())
      return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
    const reviewed = safeParse(looseObject({ ok: literal(true), source: literal('browser'), cart: looseObject({ lines: array(looseObject({ name: string(), quantity: number() })) }) }), result)
    if (!reviewed.success)
      return result
    return { ...reviewed.output, status: 'checkout-guidance', effect: 'none', customerMessage: task.checkoutGuidance(reviewed.output.cart.lines.length === 0) }
  }
  if (task.cartSession && !['greeting', 'hearing-check'].includes(selected)) {
    const session = task.cartSession
    const owner = session.owner()
    const serviceUrl = session.serviceUrl()
    const read = client.tools.value.find(tool => tool.name === 'browser_cart_get')
    if (!read)
      throw new Error('Browser replies require a fresh cart boundary check.')
    // New chat clears the visible block, not the merchant cart or its persisted
    // owner. Check fresh facts even when Main chose a generic fallback directly;
    // this read must not consume an outstanding product/confirmation answer.
    const fresh = await client.execute(read, { includeCatalog: false })
    if (active !== task || !task.isCurrent() || session.owner() !== owner || session.serviceUrl() !== serviceUrl)
      return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
    const denied = admitCart(task, fresh)
    if (denied)
      return denied
  }
  if (task.dialogue?.hasPending()) {
    const read = client.tools.value.find(tool => tool.name === 'browser_cart_get')
    if (!read)
      throw new Error('Current question requires its bound browser context.')
    return executeBrowserCartTool(client, read, { includeCatalog: true })
  }
  if (selected === 'information-unavailable') {
    if (!task.informationUnavailable)
      throw new Error('Information replies require the current Kiosk translation context.')
    return { ok: true, source: 'host', status: 'conversation', effect: 'none', customerMessage: task.informationUnavailable() }
  }
  return { ok: true, source: 'host', status: 'conversation', effect: 'none', customerMessage: replyToConversation(selected)!.content }
}
