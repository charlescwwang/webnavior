import type { BrowserConversation } from '@proj-airi/stage-shared/browser-conversation'
import type { ServiceTool } from '@proj-airi/stage-shared/interactive-service'
import type { OrderingSite } from '@proj-airi/stage-shared/ordering-sites'
import type { ServicePolicyReply } from '@proj-airi/stage-shared/ordering-tools'
import type { createInteractiveServiceClient } from '@proj-airi/stage-ui/services/interactiveServiceClient'
import type { InferOutput } from 'valibot'

import type { BrowserEffect, BrowserPlan, EffectDecision } from '../../../server/src/services/domain/browser-ordering/contracts'
import type { createBrowserDialogue, OrderEvidence, SelectedBrowserAnswer } from './browserDialogue'
import type { createBrowserPresentation } from './browserPresentation'
import type { AdditionProposal, QuestionSnapshot } from './browserQuestionWindow'
import type { chooseGateway } from './paymentChoice'
import type { RecommendationCriteria } from './recommendationSession'

import { errorMessageFrom } from '@moeru/std'
import { browserConversationSchema, browserToolNames } from '@proj-airi/stage-shared/browser-conversation'
import { browserRecoveryContextSchema, browserSignInRequiredSchema } from '@proj-airi/stage-shared/interactive-service'
import { contextReplySchema, replyToConversation } from '@proj-airi/stage-shared/kiosk-conversation'
import { labelCatalog } from '@proj-airi/stage-shared/ordering-sites'
import { explicitServingQuantities, normalizeSlotNumbers } from '@proj-airi/stage-shared/ordering-slots'
import { customerReplySchema, servicePolicyReplySchema } from '@proj-airi/stage-shared/ordering-tools'
import { pbBrowserStateSchema, pbCartStateSchema, pbCatalogStateSchema, pbEditorStateSchema, pbTableStateSchema } from '@proj-airi/stage-shared/pb-browser-state'
import { pbCheckoutSchema, pbGatewayReceiptSchema, pbInvoiceMethodSchema, pbOrderStateSchema, pbSubmissionResultSchema } from '@proj-airi/stage-shared/pb-checkout'
import { menuEntryReceiptSchema } from '@proj-airi/stage-shared/pb-journey'
import { describePbMeal, pbBasicServing, pbProductName } from '@proj-airi/stage-shared/pb-menu-presentation'
import { productConfigurationSchema } from '@proj-airi/stage-shared/product-configuration'
import { productMentions } from '@proj-airi/stage-shared/product-discovery'
import { browserPresentationInputSchema, productPresentationSchema } from '@proj-airi/stage-shared/product-presentation'
import { serviceOperationSchema } from '@proj-airi/stage-shared/service-operation'
import { resolveTableName } from '@proj-airi/stage-shared/table-names'
import { resolveSelection } from '@proj-airi/stage-ui/services/pbProduct'
import { array, boolean, literal, looseObject, minLength, number, object, optional, parse, picklist, pipe, safeParse, strictObject, string } from 'valibot'

import { orderingMessages } from '../../../../packages/i18n/src/orderingMessages'
import { browserWriteToolNameSchema, cartLineLabelSchema, cartSnapshotSchema } from '../../../server/src/services/domain/browser-ordering/contracts'
import { presentCheckoutInvitation } from './checkoutInvitation'
import { paymentChoiceFromSpeech, paymentOptionsReply } from './paymentChoice'

interface TaskQuestions {
  /** Bound by the fresh result-page context; never reused as payment authority. */
  orderPaymentMethods?: string[]
  orderReference?: string
  selectGateway?: typeof chooseGateway
  /** Set only by the Host after Jev selects a currently issued action. */
  intentSource?: 'jev'

  /** Local utterance correlation scopes answered-question evidence to this request. */
  utteranceId?: number
  /** UI translation boundary for a requested fact the assistant cannot verify. */
  informationUnavailable?: () => string
  /** Localized service limits; selecting a topic performs no external action. */
  servicePolicyReply?: (kind: ServicePolicyReply) => string
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
}

interface VerifiedReceipt {
  /** Full-cart version after this effect; replay requires that exact cart. */
  version: string
  toolName: BrowserPlan['toolName']
  result: Record<string, unknown>
  addition?: NonNullable<BrowserEffect['completedAdditions']>[number]
}

type BrowserClient = Pick<ReturnType<typeof createInteractiveServiceClient>, 'tools' | 'execute'>

interface TaskObservation {
  /** Tools are replaced on document discovery/reconnection; never cross that boundary. */
  tools: readonly ServiceTool[]
  execute: BrowserClient['execute']
  raw: InferOutput<typeof pbEditorStateSchema>
  catalog: boolean
}

interface TaskReads {
  snapshot?: TaskObservation
  pending?: { tools: readonly ServiceTool[], execute: BrowserClient['execute'], catalog: boolean, result: Promise<unknown> }
}

// Server admission compares transcript with this turn's stored customer text.
// Matching text and orderEvidence may include prior answers; transcript may not.
let active: TaskQuestions & { tableSelectionRequired?: boolean, answerResolved?: boolean, selectedAnswer?: SelectedBrowserAnswer, selected?: { productRef: string, request: string, requestTarget?: string, requestedQuantity?: number, orderSelection?: true }, confirmed?: { proposal: AdditionProposal, binding: QuestionSnapshot }, confirmedOrder?: { proposals: AdditionProposal[], binding: QuestionSnapshot, evidence?: OrderEvidence }, text: string, readonly transcript: string, decide: (proposal: BrowserEffect, plan: Pick<BrowserPlan, 'toolName' | 'arguments'>) => Promise<EffectDecision>, isCurrent: () => boolean, orderEvidence?: OrderEvidence, receipts: Map<string, VerifiedReceipt>, reads: TaskReads } | undefined
const writes = new Set(['browser_cart_add', 'browser_cart_quantity', 'browser_cart_remove', 'browser_cart_replace'])
const orderingAnswerFactsSchema = looseObject({ products: array(looseObject({ ref: string(), name: string(), configurations: array(productConfigurationSchema) })) })
const tableEntrySchema = looseObject({ ...pbTableStateSchema.entries, code: literal('table-selection-required'), customerMessage: string() })

/** Owns task-local PB observations; this phase assumes no concurrent customer edits. */
async function executeBrowserTool(client: BrowserClient, tool: ServiceTool, input: Record<string, unknown>): Promise<unknown> {
  const task = active
  const reads = task?.reads
  const tools = client.tools.value
  const contextRead = ['browser_state_get', 'browser_cart_get'].includes(tool.name) && input.forAdmission !== true
  const catalog = input.includeCatalog === true
  if (contextRead && task?.isCurrent() && reads) {
    const snapshot = reads.snapshot
    // Full data can answer a smaller read, but a cart-only read cannot provide
    // an absent catalog. This is valid only within this unchanged agent task.
    if (snapshot?.tools === tools && snapshot.execute === client.execute && (!catalog || snapshot.catalog))
      return structuredClone(snapshot.raw)
    const pending = reads.pending
    if (pending?.tools === tools && pending.execute === client.execute && (!catalog || pending.catalog))
      return structuredClone(await pending.result)
  }
  const previous = reads?.snapshot
  if (task) {
    // Invalidate before dispatch: an effect may already have changed the site,
    // or a larger/new-document read may fail. Late reads cannot repopulate it.
    task.reads = {}
  }
  const currentReads = task?.reads
  const execute = async () => {
    const result = await client.execute(tool, input)
    if (contextRead && task && active === task && task.isCurrent() && (client.tools.value !== tools || task.reads !== currentReads))
      throw new Error('Browser observation belongs to a retired task or document.')
    const stateRead = ['browser_state_get', 'browser_cart_get', 'browser_cart_review', 'browser_return_menu'].includes(tool.name)
    if (stateRead && (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== false)) {
      const state = parse(pbBrowserStateSchema, result)
      if (catalog && ['menu', 'cart', 'checkout'].includes(state.page))
        parse(pbCatalogStateSchema, result)
    }
    if (task && active === task && task.isCurrent() && task.reads === currentReads && client.tools.value === tools) {
      const editor = safeParse(pbEditorStateSchema, result)
      // Table/payment state is intentionally live: navigation and external
      // payment settlement must not be inferred from an earlier observation.
      const checkoutReceipt = ['browser_checkout_prepare', 'browser_invoice_select', 'browser_notification_phone', 'browser_invoice_donation', 'browser_invoice_tax'].includes(tool.name)
        && result && typeof result === 'object' && 'checkout' in result && safeParse(pbCheckoutSchema, result.checkout).success
      if ((stateRead || checkoutReceipt) && editor.success && input.forAdmission !== true) {
        const raw = editor.output
        // Same-store navigation/form receipts refresh page/cart/checkout facts.
        // The catalog is unchanged by these operations in the agent-only flow.
        if (!('products' in raw) && previous?.catalog && previous.tools === tools && previous.execute === client.execute)
          raw.products = previous.raw.products
        task.reads.snapshot = { tools, execute: client.execute, raw: structuredClone(raw), catalog: safeParse(pbCatalogStateSchema, raw).success }
      }
      else if (writes.has(tool.name) && previous?.tools === tools && previous.execute === client.execute && !('checkout' in previous.raw) && previous.raw.itemSelectionOpen !== true) {
        const receipt = safeParse(looseObject({ ok: literal(true), status: literal('verified'), cart: looseObject({ ...pbCartStateSchema.entries, subtotal: number() }) }), result)
        if (receipt.success) {
          // Native cart writes return their verified full-cart readback. Keep
          // the catalog, replace the entire cart; never calculate a local delta.
          task.reads.snapshot = { ...previous, raw: { ...previous.raw, cart: receipt.output.cart } }
        }
      }
    }
    return result
  }
  const result = execute()
  if (contextRead && currentReads)
    currentReads.pending = { tools, execute: client.execute, catalog, result }
  try {
    return await result
  }
  finally {
    if (currentReads?.pending?.result === result)
      currentReads.pending = undefined
  }
}

// Dispatch is the uncertainty boundary: a thrown transport or missing receipt
// may follow an applied merchant effect. Preserve it for both Main and Jev;
// neither adapter may reinterpret it as a definite no-effect refusal.
async function dispatchCartWrite(client: BrowserClient, tool: ServiceTool, input: Record<string, unknown>): Promise<unknown> {
  let error: string | undefined
  try {
    const receipt = await executeBrowserTool(client, tool, input)
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
  const codes = [...new Set(normalizeSlotNumbers(transcript).toUpperCase().match(/[A-Z]+\s*\d+(?:\s*[-‐‑–—－之]\s*\d+)*/g)?.map(compact) ?? [])]
  // Multiple codes can include a correction or negation. Only one explicit
  // code can prove absence without guessing which part of the turn is intended.
  if (codes.length === 1 && !resolveTableName(codes[0], choices))
    return `目前沒有「${codes[0]}」這個桌號，請再說一次桌號。`
}

/** Owns one current utterance; only validated one-use question answers extend its target scope. */
export function beginBrowserCartTask(text: string, options: TaskQuestions & { decide: (proposal: BrowserEffect, plan: Pick<BrowserPlan, 'toolName' | 'arguments'>) => Promise<EffectDecision>, isCurrent: () => boolean }) {
  const task: NonNullable<typeof active> = { text: text.replaceAll(/\s/g, ''), transcript: text, ...options, receipts: new Map<string, VerifiedReceipt>(), reads: {} }
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

// Model fallback may still propose a question after the fast path recognized a
// serving. A correction is tool-only and never grants permission to add.
function rejectKnownServingQuestion(task: NonNullable<typeof active>, product: { ref: string, name: string }, products: readonly { ref: string, name: string }[]) {
  const targets = products.filter(candidate => mentionsProduct(task, candidate.name, products))
  if (targets.length !== 1 || targets[0].ref !== product.ref)
    return
  const [quantity, ...others] = explicitServingQuantities(task.transcript, { productName: product.name })
  if (quantity === undefined || others.length)
    return
  return { ok: true, source: 'browser', status: 'proposal_rejected', effect: 'none', dataOnly: true, explanation: `顧客已說明「${pbProductName(product.name)}」要 ${quantity} 份，不再詢問份數或是否要點。明確點餐且必選規格完整時使用 add_items_to_cart；有缺漏只問缺漏欄位。查詢不加餐。` }
}

/** Handles table entry and failed vendor reads without inferring who owns a cart. */
function checkBrowserState(task: NonNullable<typeof active>, raw: unknown) {
  const tableEntry = safeParse(tableEntrySchema, raw)
  if (tableEntry.success) {
    const question = task.dialogue?.tables.offer(raw, task.transcript) ?? task.dialogue?.tables.pending(raw)
    return { ok: true, source: 'browser', status: 'clarification', page: 'table', code: 'table-selection-required', tableChoices: tableEntry.output.tableChoices, selectedTable: tableEntry.output.selectedTable, ...(question ? { pendingCustomerChoice: question } : {}), customerMessage: question?.question ?? missingTableMessage(tableEntry.output.tableChoices, task.transcript) ?? orderingMessages['zh-Hant'].recovery.table, effect: 'none' }
  }
  if (raw && typeof raw === 'object' && 'ok' in raw && raw.ok === false) {
    const signIn = safeParse(browserSignInRequiredSchema, raw)
    if (signIn.success)
      return signIn.output
    // A failed read cannot provide usable cart facts, even if its response
    // accidentally carries an older snapshot. Preserve the vendor's refusal.
    return { ok: false, source: 'browser', status: 'status' in raw && raw.status === 'unknown' ? 'unknown' : 'rejected', effect: 'none', ...('customerMessage' in raw && typeof raw.customerMessage === 'string' ? { customerMessage: raw.customerMessage } : {}) }
  }
}

/**
 * New products require current formal names or a sealed confirmation. Existing
 * rows can be referred to by their verified configuration after exact issued-plan admission.
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
    && (writes.has(tool.name) || ['browser_clarify_product', 'browser_product_get', 'browser_cart_review'].includes(tool.name))) {
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
        result = await executeBrowserTool(client, present, { productRefs: question.presentationRefs, mode: 'information' })
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
    if (tool.name === 'browser_return_table') {
      if (!task || !task.isCurrent())
        return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
      parse(strictObject({}), input)
      const result = await executeBrowserTool(client, tool, {})
      if (safeParse(looseObject({ ok: literal(true), code: literal('table-selection-starting') }), result).success) {
        // Questions/drafts belong to the previous page; no merchant cart write
        // is implied by abandoning those local conversation owners.
        task.dialogue?.reset()
        task.onRequestComplete?.()
      }
      return result
    }
    if (tool.name === 'browser_close_product')
      return cancelBrowserItemSelection(client)
    if (tool.name === 'browser_table_select' || tool.name === 'browser_start_ordering') {
      if (!task || !task.isCurrent() || !context)
        return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
      const entry = safeParse(tableEntrySchema, await executeBrowserTool(client, context, { includeCatalog: false }))
      if (active !== task || !task.isCurrent() || !entry.success)
        return { ok: false, source: 'host', status: 'rejected', effect: 'none', customerMessage: '目前選桌畫面已變更，請重新確認。' }
      if (task.dialogue?.tables.offer(entry.output, task.transcript))
        return checkBrowserState(task, entry.output)
      const pending = task.dialogue?.tables.pending(entry.output)
      const confirmed = pending ? task.dialogue?.tables.answer(entry.output, task.transcript, task.selectedAnswer) : undefined
      if (confirmed) {
        task.answerResolved = true
        if ('declined' in confirmed)
          return { ok: true, source: 'browser', status: 'verified', effect: 'none', customerMessage: orderingMessages['zh-Hant'].tableConfirmation.cancelled }
      }
      const confirmedName = confirmed && 'name' in confirmed ? confirmed.name : undefined
      const missing = confirmedName ? undefined : missingTableMessage(entry.output.tableChoices, task.transcript)
      if (missing)
        return { ok: true, source: 'host', status: 'clarification', effect: 'none', customerMessage: missing }
      const name = confirmedName ?? (typeof input.name === 'string' ? input.name : '')
      // A Start request may use the website's current selection, including its
      // default. A model cannot switch to another table without customer intent.
      const compact = (value: string) => value.replaceAll(/\s/g, '').toUpperCase()
      const spokenCodes = normalizeSlotNumbers(task.transcript).toUpperCase().match(/[A-Z]+\s*\d+(?:\s*[-‐‑–—－之]\s*\d+)*/g)?.map(compact) ?? []
      const explicitlyNamed = Boolean(confirmedName) || resolveTableName(task.transcript.replaceAll(/[，,。！!]/g, ''), entry.output.tableChoices) === name || compact(task.transcript).includes(compact(name)) || spokenCodes.some(code => resolveTableName(code, entry.output.tableChoices) === name) || (name === '櫃台取餐' && task.transcript.includes('櫃台'))
      if (pending && !confirmedName) {
        if (!explicitlyNamed || task.selectedAnswer)
          return checkBrowserState(task, entry.output)
        task.dialogue?.tables.reset()
      }
      if (tool.name === 'browser_start_ordering' && task.intentSource !== 'jev' && !explicitlyNamed && entry.output.selectedTable && entry.output.selectedTable !== name)
        return { ok: true, source: 'host', status: 'proposal_rejected', effect: 'none', dataOnly: true, selectedTable: entry.output.selectedTable, tableChoices: entry.output.tableChoices, explanation: '這次提案使用的桌號與畫面目前選擇不同，尚未執行。顧客未要求換桌，請沿用這次回傳的 selectedTable；呼叫 start_ordering_at_table 時省略 tableName，即會使用畫面目前選擇。不必要求顧客重新選桌。' }
      if (!name || !entry.output.tableChoices.includes(name) || (!explicitlyNamed && task.intentSource !== 'jev' && (tool.name === 'browser_table_select' || entry.output.selectedTable !== name)))
        return { ok: true, source: 'host', status: 'clarification', effect: 'none', customerMessage: '內用請先找到座位，再告訴我您的桌號；外帶請選櫃台自取。' }
      // Choosing a valid table now includes menu entry. Use PB's combined
      // select-and-Start operation once; do not dispatch a separate select or
      // replay Start after navigation retires this document.
      const start = tool.name === 'browser_start_ordering' ? tool : client.tools.value.find(tool => tool.name === 'browser_start_ordering')
      if (!start)
        return { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: orderingMessages['zh-Hant'].tableConfirmation.stale }
      let result = await executeBrowserTool(client, start, { name })
      if (safeParse(menuEntryReceiptSchema, result).success && client.waitUntilReady) {
        const startedAt = performance.now()
        let reads = 0
        const recordFailure = (reason: string) => {
          console.info('[webnavior-performance]', JSON.stringify({ kind: 'menu-entry', reason, reads, durationMs: Math.round(performance.now() - startedAt) }))
        }
        try {
          await client.waitUntilReady()
        }
        catch (error) {
          recordFailure('service-readiness-failed')
          throw error
        }
        if (active !== task || !task.isCurrent())
          return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
        // Document discovery can finish before PB renders its first menu card.
        // Read through the replacement binding, never reuse the table document.
        const deadline = Date.now() + 5000
        while (true) {
          const reader = client.tools.value.find(tool => tool.name === 'browser_cart_get')
          let state: unknown
          if (reader) {
            reads++
            try {
              state = await executeBrowserTool(client, reader, { includeCatalog: false, forAdmission: true })
            }
            catch (error) {
              recordFailure('read-failed')
              throw error
            }
          }
          const menu = safeParse(looseObject({ ok: literal(true), page: literal('menu'), menuReady: boolean(), cart: looseObject({ tableName: string() }) }), state)
          if (active !== task || !task.isCurrent())
            return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
          if (!menu.success || menu.output.cart.tableName !== name || (!menu.output.menuReady && Date.now() >= deadline)) {
            if (!reader)
              recordFailure('reader-missing')
            else if (!menu.success)
              recordFailure('menu-state-unavailable')
            else if (menu.output.cart.tableName !== name)
              recordFailure('table-mismatch')
            else
              recordFailure('menu-render-timeout')
            return { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '菜單目前尚未載入完成，請稍候再試。' }
          }
          if (menu.output.menuReady)
            break
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        result = { ...parse(menuEntryReceiptSchema, result), customerMessage: `已進入${name}的菜單，想吃什麼？桌號不對可以說「重選桌號」。` }
      }
      // A standalone table/Start request is covered by its navigation receipt.
      // Do not launch a second Main round with the retired table tool set. A
      // sentence also requesting food remains a separate, uncovered demand.
      const entryReceipt = safeParse(menuEntryReceiptSchema, result)
      // Remove only the verified table, then require a complete entry/assent
      // phrase. Extra food requests must continue after the new menu is ready.
      const entryText = normalizeSlotNumbers(task.text).toUpperCase().replaceAll(/[,，。！!、\s]/g, '').replace(compact(name), '')
      const tableOnly = resolveTableName(normalizeSlotNumbers(task.text).replaceAll(/[，,。！!\s]/g, '').replace(/^(?:請幫我|幫我|我要坐|我要|我想要|我的桌號是|桌號是|我在|我們在|請選|選擇|選)/, '').replace(/(?:請|幫我|我要)?開始(?:點餐)?吧?$/, ''), entry.output.tableChoices) === name
      if (active === task && task.isCurrent() && entryReceipt.success
        && (tableOnly || /^(?:(?:好的?|對|沒錯|可以|確認)(?:那就)?)?(?:(?:請|幫我|我要)?開始(?:點餐)?吧?)?$/.test(entryText))) {
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
      let result = await executeBrowserTool(client, tool, parameters)
      // Interrupting the previous spoken batch can cancel its visual while the
      // next batch is being prepared. Retry only this current, read-only request.
      const cancelledBatch = looseObject({ ok: literal(true), source: literal('browser'), dataOnly: literal(true), presentation: looseObject({ cue: literal('cancelled') }) })
      if (proposed.success && proposed.output.productRefs.length && proposed.output.mode !== 'information' && safeParse(cancelledBatch, result).success && active === task && task.isCurrent()) {
        result = await executeBrowserTool(client, tool, parameters)
        const retried = safeParse(cancelledBatch, result)
        if (active === task && task.isCurrent() && retried.success)
          return { ...retried.output, needsAssistant: true, explanation: '這次推薦呈現已取消，尚未介紹餐點。沿用原本價格及其他條件，重新取得符合的其他餐點。' }
      }
      if (active !== task || !task.isCurrent())
        return { ok: false, source: 'browser', status: 'rejected', effect: 'none' }
      const presented = safeParse(looseObject({ ok: literal(true), source: literal('browser'), presentation: productPresentationSchema, customerMessage: optional(string()) }), result)
      if (proposed.success && proposed.output.mode !== 'information' && presented.success && task.dialogue && presented.output.presentation.products.length === 1) {
        // A single recommendation offers a serving; it is not purchase consent.
        // Bind the offer to the actual receipt so later assent has a real target/count.
        const question = await askBrowserCustomerQuestion(client, { questionType: 'purchase-recommendation', name: presented.output.presentation.products[0].name, quantity: 1 })
        if (!('customerMessage' in question))
          return question
        return { ...presented.output, ...question }
      }
      if (proposed.success && proposed.output.mode !== 'information' && presented.success && task.dialogue && presented.output.presentation.products.length > 1) {
        const facts = await readBrowserOrderingFacts(client)
        if (active !== task || !task.isCurrent())
          return { ok: false, source: 'browser', status: 'rejected', effect: 'none' }
        // Both Jev and Main finish recommendations here. Bind the next answer
        // to the dishes in this receipt, not the whole catalog or model prose.
        const question = task.dialogue.presentProducts(facts, '', task.transcript, presented.output.presentation.products.map(product => product.ref))
        if (!question.ok)
          return question
        const names = presented.output.presentation.products.map(product => pbProductName(product.name))
        return { ...presented.output, ...question, customerMessage: `推薦${names.join('、')}。${question.customerMessage}` }
      }
      return result
    }

    if (tool.name === 'browser_search') {
      if (!task?.dialogue || !task.isCurrent())
        return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
      const query = typeof input.query === 'string' ? input.query.trim() : ''
      if (task.dialogue.hasPending() && context) {
        const raw = await executeBrowserTool(client, context, { includeCatalog: true })
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
      if (query) {
        if (!context)
          return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
        const raw = await executeBrowserTool(client, context, { includeCatalog: true })
        if (active !== task || !task.isCurrent())
          return { ok: false, source: 'browser', status: 'rejected', effect: 'none' }
        const denied = checkBrowserState(task, raw)
        if (denied)
          return denied
        const facts = parse(looseObject({ page: optional(string()), search: optional(string()), products: array(looseObject({ ref: string(), name: string(), price: optional(number()), configurations: array(productConfigurationSchema) })) }), raw)
        const catalog = labelCatalog(facts.products, labels)
        const normalized = query.toLocaleLowerCase()
        const knownCategory = catalog.some(product => product.category.toLocaleLowerCase() === normalized)
        const matches = knownCategory
          ? catalog.filter(product => product.category.toLocaleLowerCase() === normalized)
          : catalog.filter(product => [product.name, ...product.aliases, product.category].some(label => label.toLocaleLowerCase().includes(normalized)))
        const present = client.tools.value.find(tool => tool.name === 'browser_present')
        const exact = matches.length === 1 && [matches[0].name, ...matches[0].aliases].some(label => label.toLocaleLowerCase() === normalized)
        if ((exact || knownCategory) && matches.length <= 10 && present)
          return executeBrowserTool(client, present, { productRefs: matches.map(product => product.ref), mode: 'information' })
        if (matches.length) {
          // A substring is retrieval evidence, not a verified category: 湯 also
          // matches 湯餃 and meal sets. Main must select actual dishes before cues.
          return { ok: true, source: 'browser', dataOnly: true, search: query, catalogScope: 'full-current-catalog', products: matches.map(({ ref, name, price, aliases, category }) => ({ ref, name, price, aliases, category })), explanation: '這些僅是字面相符的候選，尚未框選。依顧客本輪語意與已知品名／分類／內容挑出真正符合的餐點，再用 point_to_menu_items purpose=information 介紹並框選。問單點湯品時不要把湯餃或含湯套餐列為湯品；資料不足才查 get_menu_item_details。不可把關鍵字命中當成分類或食材證據。完整菜單保持可瀏覽，不改購物車。' }
        }
        // Inquiries consult the full current catalog instead of blanking PB's
        // view. Restore an older/manual filter and retire old visual choices.
        if (facts.search && facts.page === 'menu') {
          const restored = await executeBrowserTool(client, tool, { query: '' })
          if (!safeParse(looseObject({ ok: literal(true) }), restored).success)
            return restored
        }
        if (present)
          await executeBrowserTool(client, present, { productRefs: [] })
        return { ok: true, source: 'browser', status: 'not-found', effect: 'none', search: query, catalogScope: 'full-current-catalog', products: [], alternatives: filterBrowserRecommendations(catalog).map(({ ref, name, price, category }) => ({ ref, name, price, category })), customerMessage: `目前菜單沒有「${query}」。`, originalRequest: task.transcript, explanation: '這是本輪完整菜單查詢，畫面保留完整菜單。只處理originalRequest這次的問題，不重查前一題。可依目前菜單推薦相近品項；沒有相關品項時詢問是否看其他推薦，不把替代品當成原品項。' }
      }
      // Only an empty query clears a previous/manual native search. Customer
      // category requests also use full-catalog highlighting above.
      return executeBrowserTool(client, tool, { query })
    }
    if (tool.name === 'browser_cart_review' || tool.name === 'browser_return_menu') {
      if (!task || !task.isCurrent() || !context)
        return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
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
      const result = await executeBrowserTool(client, tool, {})
      if (active !== task || !task.isCurrent())
        return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
      if (tool.name === 'browser_return_menu' && task.intentSource === 'jev')
        task.onRequestComplete?.()
      // A completed navigation still needs a readable vendor receipt before
      // any cart contents can reach Main or speech.
      const rejected = checkBrowserState(task, result)
      if (rejected || tool.name === 'browser_return_menu')
        return rejected ?? result
      if (task.dialogue && typeof result === 'object' && result && 'ok' in result && result.ok === true && 'cart' in result) {
        const raw = await executeBrowserTool(client, context, { includeCatalog: false })
        if (active !== task || !task.isCurrent())
          return { ok: false, source: 'host', effect: 'none' }
        const denied = checkBrowserState(task, raw)
        if (denied)
          return denied
        const fresh = parse(looseObject({ cart: cartSnapshotSchema }), raw)
        // Cart consent is bound to the active task/document/cart, not menu products.
        // Do not delay its read-back on unrelated full-catalog retrieval.
        const questionFacts = { ...fresh, products: [] }
        const receipt = parse(looseObject({ cart: cartSnapshotSchema, customerMessage: string() }), result)
        if (receipt.cart.version !== fresh.cart.version)
          return { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '購物車內容已變更，請重新核對目前餐點。' }
        if (fresh.cart.lines.length) {
          const old = task.dialogue.conversation(questionFacts).waitingFor
          if (old)
            task.dialogue.releaseService(questionFacts, old.questionId)
          const question = task.dialogue.presentService(questionFacts, { purpose: 'cart-review', request: task.transcript, question: orderingMessages['zh-Hant'].checkout.cartReview, choices: [{ id: 'yes', description: '確認目前購物車餐點、份數與金額，繼續選擇發票；不送單。' }, { id: 'no', description: '先不繼續結帳，保留購物車並提出修改。' }] })
          // Invoice controls can render after the cart. The observed receipt and
          // its explicit question must both reach speech before asking for consent.
          return { ...result, ...question, customerMessage: `${receipt.customerMessage}${question.customerMessage}` }
        }
      }
      const cartReview = safeParse(looseObject({ ok: literal(true), cart: cartSnapshotSchema }), result)
      if (cartReview.success && !cartReview.output.cart.lines.length)
        return { ...cartReview.output, customerMessage: await emptyCartMessage(client) }
      return result
    }
    if (task && tool.name === 'browser_observe' && input.purpose === 'information') {
      const result = await executeBrowserTool(client, tool, input)
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
    if (tool.name === 'browser_quote' && task && context) {
      const fresh = parse(looseObject({ products: array(looseObject({ ref: string(), name: string(), kind: string(), priceType: number(), price: number(), configurations: array(productConfigurationSchema) })) }), await executeBrowserTool(client, context, { includeCatalog: true }))
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
      const result = await executeBrowserTool(client, tool, input)
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
      const result = await executeBrowserTool(client, tool, input)
      if (active !== task || !task.isCurrent())
        return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
      if (result && typeof result === 'object' && 'cart' in result)
        return checkBrowserState(task, result) ?? result
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
      const facts = await executeBrowserTool(client, context, { includeCatalog: true })
      if (active !== task || !task.isCurrent())
        return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
      const denied = checkBrowserState(task, facts)
      if (denied)
        return denied
      const query = names.output[0]
      return presentQuestion(facts, query)
    }
    if (!task?.dialogue || !context)
      return executeBrowserTool(client, tool, input)
    const observe = () => executeBrowserTool(client, context, { includeCatalog: true })
    if (tool.name === 'browser_cart_get' && input.includeCatalog === true && !task.answerResolved) {
      task.answerResolved = true
      const facts = await observe()
      const denied = checkBrowserState(task, facts)
      if (denied)
        return denied
      const answer = await task.dialogue.answer(facts, task.transcript, observe, () => active === task && task.isCurrent(), task.utteranceId, { selectedAnswer: task.selectedAnswer })
      if (answer?.kind === 'receipt' && 'completeOrder' in answer.result) {
        task.confirmed = undefined
        task.confirmedOrder = answer.result.completeOrder
        return executeBrowserConfirmedAddition(client)
      }
      if (answer?.kind === 'receipt') {
        if ('code' in answer.result && answer.result.code === 'QUESTION_RETRY_LIMIT')
          task.onRequestComplete?.()
        return answer.result
      }
      if (answer?.kind === 'cancel-selection') {
        const cancelled = await cancelBrowserItemSelection(client, { excludedRefs: answer.excludedRefs })
        if (safeParse(looseObject({ ok: literal(true), status: literal('verified') }), cancelled).success)
          task.onRequestComplete?.()
        return cancelled
      }
      if (answer?.kind === 'continue-browsing') {
        return await offerBrowserAlternative(client, facts)
          ?? { ok: true, source: 'browser', effect: 'none', customerMessage: orderingMessages['zh-Hant'].nextStep.emptyCart }
      }
      if (answer?.kind === 'checkout') {
        if (answer.action === 'submit') {
          const submit = client.tools.value.find(tool => tool.name === 'browser_order_submit')
          if (!submit)
            throw new Error('目前網站尚未提供助手送出訂單。')
          // Only a consumed, current final-summary ticket reaches this branch.
          // Main has no public submission tool or model-controlled token.
          const result = await executeBrowserTool(client, submit, { confirmationToken: answer.confirmationToken })
          if (active !== task || !task.isCurrent())
            return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
          if (safeParse(pbSubmissionResultSchema, result).success) {
            task.onRequestComplete?.()
            return result
          }
          const rejection = safeParse(looseObject({ ok: literal(false), source: literal('browser'), status: literal('rejected'), effect: literal('none') }), result)
          const execution = result && typeof result === 'object' && 'execution' in result ? safeParse(serviceOperationSchema, result.execution) : undefined
          const dispatched = execution?.success && execution.output.steps.some(step => step.effect === 'order' && (step.dispatchMs !== undefined || ['executing', 'verifying', 'completed', 'unknown'].includes(step.state)))
          // Only a verified pre-dispatch refusal may rebuild a draft summary.
          // This reads/prepares, never presses Submit again in the same turn.
          if (rejection.success && (!execution || execution.success) && !dispatched)
            return executeBrowserCheckout(client, 'continue', { afterRejectedSubmit: true })
          return result
        }
        return executeBrowserCheckout(client, answer.action, 'method' in answer ? { method: parse(pbInvoiceMethodSchema, answer.method) } : 'phone' in answer ? { phone: answer.phone } : 'code' in answer ? { code: answer.code } : {})
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
        const closed = await cancelBrowserItemSelection(client, { followUp: false })
        const search = client.tools.value.find(tool => tool.name === 'browser_search')
        if (!answer.query.trim() || !search || !closed || typeof closed !== 'object' || !('ok' in closed) || closed.ok !== true)
          return closed
        return executeBrowserCartTool(client, search, { query: answer.query })
      }
      if (answer?.kind === 'new-request') {
        return { ...asBrowserFacts(facts), previousProposal: answer.previousProposal, explanation: '顧客有更正或新需求，舊確認已取消。請依完整原句與最新餐點設定重新選擇操作；舊問題不代表新的購買授權。' }
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
      const denied = checkBrowserState(task, facts)
      if (denied)
        return denied
      const catalog = parse(looseObject({ products: array(looseObject({ ref: string(), name: string() })) }), facts)
      const query = typeof input.query === 'string' ? input.query.trim() : ''
      const candidates = query
        ? labelCatalog(catalog.products, task.catalogLabels?.()).filter(product => product.name.includes(query) || product.aliases.includes(query))
        : catalog.products
      const named = candidates.filter(product => task.text.includes(product.name.replaceAll(/\s/g, '')))
      // A broad question can be redundant. For a targeted question, another
      // exact dish in the same order cannot resolve the requested alias.
      if (named.length === 1 && (!query || candidates.length === 1)) {
        return { ok: true, source: 'browser', effect: 'none', dataOnly: true, products: named, explanation: '原句已唯一指明此商品，不需要再詢問品名。依完整原句及本商品最新規格處理；規格／加購查價用 browser_quote_selection，缺必要選項才詢問該選項。這次只是讀取，尚未加入購物車。' }
      }
      return presentQuestion(facts, query)
    }
    return executeBrowserTool(client, tool, input)
  }
  if (!task || !context)
    throw new Error('Current browser cart task is unavailable.')
  if (task.readOnly) {
    if (task.clarifyOrder && task.dialogue && tool.name === 'browser_cart_add') {
      const raw = await executeBrowserTool(client, context, { includeCatalog: true })
      const denied = checkBrowserState(task, raw)
      if (denied)
        return denied
      if (active !== task || !task.isCurrent())
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
  const rawFacts = await executeBrowserTool(client, context, { includeCatalog: needsProducts })
  const denied = checkBrowserState(task, rawFacts)
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
  if (active !== task || !task.isCurrent())
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
  if (active !== task || !task.isCurrent())
    return { ok: false, source: 'browser', status: 'rejected', customerMessage: '這次需求已結束，尚未變更購物車。' }
  const issuedPlan = semanticDecision.choice === 'ALLOW' && semanticDecision.admission === 'issued-plan'
  if (!issuedPlan)
    return { ok: true, source: 'browser', status: 'clarification', effect: 'none', semanticDecision, customerMessage: '請再說明要調整的餐點與份數；目前尚未變更購物車。' }
  if (action === 'add' || action === 'replace') {
    let reason: string | undefined
    const selection = safeParse(strictObject({ version: string(), variantRef: string(), choices: array(strictObject({ ref: string(), quantity: number() })) }), input.selection)
    if (!selection.success) {
      reason = 'invalid-selection'
    }
    else {
      const observed = safeParse(orderingAnswerFactsSchema, rawFacts)
      const product = observed.success ? observed.output.products.find(product => product.ref === replacement?.ref) : undefined
      const configuration = product?.configurations.find(configuration => configuration.variantRef === selection.output.variantRef)
      if (!configuration) {
        reason = 'configuration-unavailable'
      }
      else if (input.version !== facts.cart.version) {
        reason = 'cart-version-mismatch'
      }
      else if (selection.output.version !== configuration.version) {
        reason = 'configuration-version-mismatch'
      }
      else {
        try {
          if (resolveSelection(configuration, selection.output, typeof input.note === 'string' ? input.note : '').unitPrice !== input.unitPrice)
            reason = 'unit-price-mismatch'
        }
        catch {
          reason = 'invalid-selection'
        }
      }
    }
    if (reason)
      return { ok: true, source: 'browser', status: 'proposal_rejected', effect: 'none', dataOnly: true, requiredAction: action, reason, explanation: '餐點設定、售價或購物車版本已不同；請依最新商品資料修正同一需求，尚未變更購物車。' }
  }
  if (ambiguous)
    return { ok: true, source: 'browser', status: 'clarification', effect: 'none', customerMessage: '目前有多筆同名商品，請先在畫面確認要操作的那一筆；尚未變更購物車。' }
  const result = await dispatchCartWrite(client, tool, input)
  const unexecuted = safeParse(looseObject({ ok: literal(false), source: literal('browser'), status: literal('rejected'), effect: literal('none'), reason: literal('stale-cart'), execution: looseObject({ steps: array(object({})) }) }), result)
  if (unexecuted.success && unexecuted.output.execution.steps.length === 0 && active === task && task.isCurrent() && !task.receipts.size) {
    // Native validation proved no dispatch. Keep the exact request for Main's
    // normal fresh-read/issued-plan admission flow; never replace only its version
    // or retry it here after a pickup, manual cart or configuration change.
    return { ...unexecuted.output, ok: true, status: 'proposal_rejected', dataOnly: true, needsAssistant: true, originalRequest: task.transcript, requiredAction: action, ...(replacement ? { selectedProduct: { productRef: replacement.ref, name: replacement.name } } : {}), requestedQuantity: input.quantity, explanation: '購物車資料已更新，這次操作尚未派送。保留原需求、餐點、份數及設定，重新讀取完整最新資料並核對後再提出操作；不要只替換版本，不重做任何已完成或結果不明的操作。' }
  }
  if (result && typeof result === 'object' && 'ok' in result && result.ok === true && 'status' in result && result.status === 'verified' && 'cart' in result && result.cart && typeof result.cart === 'object' && 'version' in result.cart && typeof result.cart.version === 'string') {
    const receipt = { ...result, planAdmission: semanticDecision, completionScope: 'tool-call', originalRequest: task.orderEvidence?.request ?? task.transcript, completedEffects: [...completedEffects, ...('effectMessage' in result && typeof result.effectMessage === 'string' ? [result.effectMessage] : [])] }
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
  const raw = await executeBrowserTool(client, read, { includeCatalog: true })
  if (active !== task || !task.isCurrent())
    throw new Error('目前點餐需求已結束。')
  const denied = checkBrowserState(task, raw)
  if (denied && 'page' in denied && denied.page === 'table')
    return denied
  if (denied)
    throw new Error('目前購物車資料讀取未完成。')
  parse(pbEditorStateSchema, raw)
  const facts = parse(orderingAnswerFactsSchema, raw)
  return { ...facts, products: labelCatalog(facts.products, task.catalogLabels?.()) }
}

/** Main may update recommendation criteria; every visual choice is checked against them again. */
/** Validates published categories before changing reception-owned recommendation state. */
export function browserRecommendationCriteria(patch: RecommendationCriteria | undefined, products: readonly { name: string }[]) {
  const task = active
  if (!task?.isCurrent() || !task.dialogue)
    throw new Error('目前接待已結束。')
  const categories = [...new Set(labelCatalog(products, task.catalogLabels?.()).flatMap(product => product.category ? [product.category] : []))]
  // A natural query such as 湯 is not necessarily a published category. Leave
  // all existing restrictions untouched so Main can retry a read-only keyword lookup.
  if (patch?.category && !categories.includes(patch.category))
    return { ok: false as const, reason: 'category' as const, categories }
  // This is a necessary evidence check, not a complete intent classifier.
  // Main still owns semantic restrictions, but a positive-only request cannot
  // create persistent exclusions (the reported 我要炸的 → 排除炸 inversion).
  if (patch?.excludedTerms?.some(Boolean) && !/不要|不吃|不想|不喜歡|別推薦|避開|排除|忌口|過敏|不能吃/.test(task.transcript))
    return { ok: false as const, reason: 'exclusion' as const, categories }
  return { ok: true as const, criteria: patch ? task.dialogue.recommendations.update(patch) : task.dialogue.recommendations.snapshot() }
}

export function filterBrowserRecommendations<T extends { name: string, configurations: { unitPrice: number }[] }>(products: T[]): T[] {
  const task = active
  if (!task?.isCurrent() || !task.dialogue)
    throw new Error('目前接待已結束。')
  return task.dialogue.recommendations.filter(labelCatalog(products, task.catalogLabels?.()))
}

function suggestedMenuProduct(products: InferOutput<typeof orderingAnswerFactsSchema>['products'], excludedRefs: readonly string[] = []) {
  const dismissed = active?.dialogue?.recommendations.dismissedProducts() ?? []
  const excluded = new Set([...excludedRefs, ...dismissed])
  const candidates = filterBrowserRecommendations(products).filter(product => !excluded.has(product.ref))
  const refs = active?.presentation?.filterRecommendations(candidates.map(product => product.ref))
  return candidates.find(product => product.configurations.length === 1 && (refs === undefined || refs.includes(product.ref))
    && products.filter(candidate => pbProductName(candidate.name) === pbProductName(product.name)).length === 1)
}

async function offerBrowserAlternative(client: BrowserClient, observed?: unknown) {
  const task = active
  const present = client.tools.value.find(tool => tool.name === 'browser_present')
  if (!task?.dialogue || !task.isCurrent() || !present || task.dialogue.hasPending())
    return
  try {
    const raw = observed ?? await readBrowserOrderingFacts(client)
    const facts = safeParse(looseObject({ ...orderingAnswerFactsSchema.entries, page: literal('menu'), cart: pbCartStateSchema }), raw)
    if (active !== task || !task.isCurrent() || !facts.success)
      return
    const cartRefs = facts.output.cart.lines.flatMap(line => line.productRef ? [line.productRef] : [])
    const product = suggestedMenuProduct(facts.output.products, cartRefs)
    if (!product)
      return
    const result = await executeBrowserCartTool(client, present, { productRefs: [product.ref], mode: 'recommendation' })
    const offered = safeParse(looseObject({ ok: literal(true), customerMessage: string(), pendingCustomerChoice: looseObject({ question: string() }) }), result)
    if (active === task && task.isCurrent() && offered.success)
      return offered.output
  }
  catch {
    // A follow-up recommendation is optional once the original operation has settled.
  }
}

async function emptyCartMessage(client: BrowserClient, observed?: unknown) {
  const task = active
  const copy = orderingMessages['zh-Hant'].nextStep
  if (!task?.dialogue || task.dialogue.hasPending())
    return copy.cartIsEmpty
  // This optional suggestion is based on the current catalog. A read failure
  // must not replace the verified empty-cart reply or create a purchase question.
  const raw = observed ?? await readBrowserOrderingFacts(client).catch(() => undefined)
  if (active !== task || !task.isCurrent())
    return copy.cartIsEmpty
  const facts = safeParse(looseObject({ ...orderingAnswerFactsSchema.entries, cart: cartSnapshotSchema }), raw)
  if (!facts.success || facts.output.cart.lines.length)
    return copy.cartIsEmpty
  const product = suggestedMenuProduct(facts.output.products)
  return product ? `${copy.cartIsEmpty}${copy.suggestDish.replace('{dish}', pbProductName(product.name))}` : copy.cartIsEmpty
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
    const redundant = rejectKnownServingQuestion(task, named[0], facts.products)
    if (redundant)
      return redundant
    const serving = pbBasicServing(named[0].name, named[0].configurations[0]?.unitPrice)
    const name = pbProductName(named[0].name)
    question = input.quantity === 1 ? `要來一份${name}嗎？` : `您要點${name}嗎？要幾份？`
    if (serving)
      question = `${name}${serving}。${input.quantity === 1 ? '要來一份嗎？' : '您要幾份？'}`
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

/** Returns an unfinished selection to the full menu with a verified cart receipt. */
export async function cancelBrowserItemSelection(client: BrowserClient, options: { followUp?: false, excludedRefs?: readonly string[] } = {}) {
  const task = active
  const menu = client.tools.value.find(tool => tool.name === 'browser_return_menu')
  if (!task || !task.isCurrent() || !menu)
    throw new Error('目前無法取消選餐。')
  let excludedRefs = options.excludedRefs
  if (options.followUp !== false && excludedRefs === undefined && task.dialogue && client.tools.value.some(tool => tool.name === 'browser_present')) {
    // Capture the old selection before the native menu return closes it.
    try {
      const observed = await readBrowserOrderingFacts(client)
      const facts = parse(looseObject({ ...orderingAnswerFactsSchema.entries, productDialog: optional(array(looseObject({ name: string() }))) }), observed)
      const names = new Set(facts.productDialog?.map(dialog => dialog.name))
      excludedRefs = [...task.dialogue.selectionRefs(observed), ...facts.products.filter(product => names.has(product.name)).map(product => product.ref)]
    }
    catch {
      // Missing evidence only suppresses the optional alternative.
    }
  }
  if (active !== task || !task.isCurrent())
    return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
  const result = await executeBrowserTool(client, menu, {})
  if (active !== task || !task.isCurrent())
    return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
  const receipt = safeParse(looseObject({ ok: literal(true), page: literal('menu'), cart: cartSnapshotSchema }), result)
  if (!receipt.success)
    return result
  task.dialogue?.reset()
  task.selected = undefined
  task.confirmed = undefined
  task.confirmedOrder = undefined
  const copy = orderingMessages['zh-Hant'].nextStep
  const cancelled = { ...receipt.output, customerMessage: copy.selectionCancelled }
  if (options.followUp === false || !task.dialogue)
    return cancelled
  task.dialogue.recommendations.dismissProducts(excludedRefs ?? [])
  if (receipt.output.cart.lines.length && client.tools.value.some(tool => tool.name === 'browser_cart_review')) {
    try {
      const invitation = presentCheckoutInvitation(task.dialogue, receipt.output)
      return { ...cancelled, pendingCustomerChoice: invitation.pendingCustomerChoice, customerMessage: `${copy.selectionCancelled}${invitation.customerMessage}` }
    }
    catch {
      return cancelled
    }
  }
  if (!receipt.output.cart.lines.length && excludedRefs?.length) {
    const offered = await offerBrowserAlternative(client)
    if (offered)
      return { ...offered, ...cancelled, pendingCustomerChoice: offered.pendingCustomerChoice, customerMessage: `${copy.selectionCancelled}${offered.customerMessage}` }
  }
  return cancelled
}

/** Refreshes one task's model context without consuming answers or changing the page. */
export async function readBrowserConversation(client: Pick<ReturnType<typeof createInteractiveServiceClient>, 'tools' | 'execute'>, taskId: string, toolNames: readonly string[], captureRetry?: (key: string | undefined) => void): Promise<BrowserConversation> {
  const task = active
  const read = client.tools.value.find(tool => tool.name === 'browser_state_get')
  if (!task || !read || !task.isCurrent())
    throw new Error('Current browser conversation is unavailable.')
  // This is an internal read, like master's host-only conversation-context read.
  // Answer resolution must wait for the canonical customer turn to be recorded.
  const raw = await executeBrowserTool(client, read, { includeCatalog: true })
  if (active !== task || !task.isCurrent())
    throw new Error('Browser context belongs to a superseded task.')
  const recovery = safeParse(looseObject({ documentId: string(), recovery: browserRecoveryContextSchema }), raw)
  const state = recovery.success ? recovery.output.recovery : undefined
  captureRetry?.(state?.canRetry && recovery.success && state.documentId === recovery.output.documentId ? JSON.stringify(['browser', state.documentId, state.contextKey]) : undefined)
  if (safeParse(browserSignInRequiredSchema, raw).success) {
    return parse(browserConversationSchema, { taskId, sourceUtterance: task.transcript, phase: 'sign_in_required', readOnly: true, catalog: { complete: false, products: [] }, allowedToolNames: browserToolNames({ phase: 'sign_in_required', readOnly: true }, toolNames) })
  }
  const order = safeParse(looseObject({ ok: literal(true), source: literal('browser'), page: picklist(['payment', 'order-result']), observedAt: number(), order: pbOrderStateSchema }), raw)
  if (order.success) {
    if (task.orderReference && task.orderReference !== order.output.order.reference)
      throw new Error('Order context belongs to a different order.')
    task.orderPaymentMethods = order.output.order.paymentMethods
    task.orderReference = order.output.order.reference
    const state = { phase: 'viewing_order' as const, readOnly: true }
    return parse(browserConversationSchema, { taskId, sourceUtterance: task.transcript, ...state, page: order.output.page, order: order.output.order, observedAt: order.output.observedAt, catalog: { complete: false, products: [] }, allowedToolNames: browserToolNames(state, toolNames) })
  }
  if (!client.tools.value.some(tool => tool.name === 'browser_cart_get'))
    throw new Error('訂單結果頁尚未就緒，請先查看畫面，避免重複送單。')
  const tableEntry = safeParse(tableEntrySchema, raw)
  if (tableEntry.success) {
    task.tableSelectionRequired = true
    const state = { phase: 'selecting_table' as const, readOnly: true }
    return parse(browserConversationSchema, { taskId, sourceUtterance: task.transcript, ...state, page: 'table', tableChoices: tableEntry.output.tableChoices, selectedTable: tableEntry.output.selectedTable, waitingFor: task.dialogue?.tables.pending(raw), catalog: { complete: false, products: [] }, allowedToolNames: browserToolNames(state, toolNames) })
  }
  const facts = parse(looseObject({ ...pbEditorStateSchema.entries, itemSelectionOpen: optional(boolean()), products: array(object({ ref: string(), name: string(), price: optional(number()), configurations: array(productConfigurationSchema) })) }), raw)
  const denied = checkBrowserState(task, raw)
  if (denied)
    throw new Error('Current browser state cannot be read.')
  if (!task.selected) {
    const accepted = task.dialogue?.selectionForTurn(raw, task.utteranceId)
    if (accepted) {
      task.selected = accepted.selection
      task.orderEvidence = accepted.evidence
      task.text = [accepted.evidence.request, ...accepted.evidence.answers.map(item => item.answer), task.transcript].join('\n').replaceAll(/\s/g, '')
      // The current customer supplied this count to a purchase question. Main
      // may finish its notes/options, but still needs its exact issued plan admitted.
      task.readOnly = false
    }
  }
  const selected = task.selected
  const catalog = labelCatalog(facts.products, task.catalogLabels?.())
  // FastPath and Main must agree on published aliases. Keep the PB reference
  // and original name in the model context even when the customer uses an alias.
  const compact = (label: string) => label.replaceAll(/\s/g, '')
  const mentioned = productMentions(catalog.map(product => ({
    ref: product.ref,
    name: compact(product.name),
    aliases: [...product.aliases, pbProductName(product.name)].map(compact),
  })), task.text)
  const mention = mentioned.length === 1 ? mentioned[0] : undefined
  // A consumed answer takes priority, and colliding names remain unresolved.
  const targetRef = selected?.productRef ?? mention?.product.ref
  const target = catalog.find(product => product.ref === targetRef)
  const servingText = !selected && mention ? compact(task.transcript).replaceAll(mention.label, '') : selected?.request ?? task.transcript
  const quantities = explicitServingQuantities(servingText, { productName: target?.name })
  const quantity = selected?.requestedQuantity ?? (quantities.length === 1 ? quantities[0] : undefined)
  const providedSlots = target ? { productRef: target.ref, name: target.name, quantity } : undefined
  let dialogue: Pick<BrowserConversation, 'phase' | 'draft' | 'drafts' | 'waitingFor'> = { phase: 'browsing' }
  if (task.confirmedOrder && task.dialogue) {
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
    observedAt: typeof raw === 'object' && raw && 'observedAt' in raw ? raw.observedAt : undefined,
    ...dialogue,
    readOnly,
    providedSlots,
    itemSelectionOpen: facts.itemSelectionOpen,
    checkoutStep: task.dialogue?.checkoutStep(raw),
    checkout: typeof raw === 'object' && raw && 'checkout' in raw ? safeParse(pbCheckoutSchema, raw.checkout).output : undefined,
    // Preserve the visible cart's row/configuration identity and subtotal
    // through the shared projection; local reception IDs do not identify its operator.
    cart: facts.cart,
    search: typeof raw === 'object' && raw && 'search' in raw && typeof raw.search === 'string' ? raw.search : '',
    catalog: { complete: true, products: catalog },
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
export async function prepareBrowserQuestionAnswer(client: Pick<ReturnType<typeof createInteractiveServiceClient>, 'tools' | 'execute'>, input?: Record<string, unknown>) {
  const task = active
  const payment = client.tools.value.find(tool => tool.name === 'browser_payment_open')
  if (task?.isCurrent() && client.tools.value.some(tool => tool.name === 'browser_state_get')) {
    const guidance = paymentOptionsReply(task.transcript, task.orderPaymentMethods, Boolean(task.orderReference))
    if (guidance)
      return async () => ({ ok: true, source: 'host', effect: 'none', customerMessage: guidance })
  }
  if (payment && task?.orderReference && task.isCurrent()) {
    // Match the whole customer turn. A list of alternatives, a negation or a
    // question about support must never select a gateway.
    const choice = paymentChoiceFromSpeech(task.transcript)
    if (choice) {
      const method = choice === 'line' ? 'LinePay' : 'Credit'
      const reference = task.orderReference
      return async () => {
        if (active !== task || !task.isCurrent() || task.answerResolved)
          return { ok: false, effect: 'none', customerMessage: '請確認目前的付款畫面。' }
        task.answerResolved = true
        const result = await executeBrowserTool(client, payment, { reference, method })
        if (choice !== 'credit' && choice !== 'line'
          && task.selectGateway) {
          const opened = safeParse(pbGatewayReceiptSchema, result)
          if (opened.success && opened.output.reference === reference && opened.output.method === method)
            return task.selectGateway(choice, reference, () => active === task && task.isCurrent())
        }
        return result
      }
    }
  }
  const read = client.tools.value.find(tool => tool.name === 'browser_cart_get')
  if (!task?.dialogue?.hasPending() || task.answerResolved || !task.isCurrent() || !read)
    return
  const facts = await executeBrowserTool(client, read, { includeCatalog: true })
  if (active !== task || !task.isCurrent())
    return
  const tableQuestion = task.dialogue.tables.pending(facts)
  if (tableQuestion) {
    if (task.intentSource === 'jev' && input && Object.keys(input).length) {
      const selected = safeParse(strictObject({ questionId: string(), choiceId: string() }), input)
      if (!selected.success || selected.output.questionId !== tableQuestion.questionId || !tableQuestion.choices.some(choice => choice.id === selected.output.choiceId))
        return
      task.selectedAnswer = selected.output
    }
    else if (!task.dialogue.tables.canAnswer(facts, task.transcript)) {
      return
    }
    const select = client.tools.value.find(tool => tool.name === 'browser_table_select')
    if (!select)
      return
    let consumed = false
    return async () => {
      if (consumed || active !== task || !task.isCurrent())
        return { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: orderingMessages['zh-Hant'].tableConfirmation.stale }
      consumed = true
      // The normal Host table executor re-reads the selector and consumes the
      // answer only while visitor, document, offered list and selection match.
      return executeBrowserCartTool(client, select, {})
    }
  }
  // Keep the exact already-selected Jev answer. Question consumption still
  // checks visitor, document, cart and expiry; another model gets no vote.
  if (active !== task || !task.isCurrent() || checkBrowserState(task, facts) || (task.intentSource !== 'jev' && !task.dialogue.canAnswerLocally(facts, task.transcript)))
    return
  if (task.intentSource === 'jev' && input && Object.keys(input).length) {
    const selected = safeParse(strictObject({ questionId: string(), choiceId: string() }), input)
    if (!selected.success)
      return
    task.selectedAnswer = selected.output
  }
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
  const facts = await executeBrowserTool(client, context, { includeCatalog: true })
  if (active !== task || !task.isCurrent())
    return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
  const denied = checkBrowserState(task, facts)
  if (denied)
    return denied
  const catalog = parse(looseObject({ products: array(looseObject({ ref: string(), name: string() })) }), facts)
  const product = catalog.products.find(product => product.ref === productRef)
  if (task.dialogue.hasPending() && !task.answerResolved) {
    if (product && mentionsProduct(task, product.name, catalog.products) && task.dialogue.checkoutStep(facts)) {
      // The customer explicitly named a meal while checkout was waiting. The
      // model has already requested that meal's quantity question; do not ask
      // an old checkout-answer resolver to reinterpret it as invoice/contact.
      // Suspend only local checkout dialogue; merchant fields and cart persist.
      task.dialogue.pauseCheckout(facts)
    }
    else {
      return executeBrowserCartTool(client, context, { includeCatalog: true })
    }
  }
  if (product && task.selected?.productRef !== productRef && !mentionsProduct(task, product.name, catalog.products)) {
    return { ok: true, source: 'browser', status: 'proposal_rejected', effect: 'none', dataOnly: true, explanation: '顧客尚未選定這項商品，不可替自行挑選的餐點問份數。推薦需求使用 browser_present；片段餐名才用 browser_clarify_product，query 保留顧客原用語。' }
  }
  if (product) {
    const redundant = rejectKnownServingQuestion(task, product, catalog.products)
    if (redundant)
      return redundant
  }
  const present = client.tools.value.find(tool => tool.name === 'browser_present')
  if (product && present) {
    const shown = await executeBrowserTool(client, present, { productRefs: [productRef], mode: 'information' })
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
  const facts = await executeBrowserTool(client, read, { includeCatalog: true })
  if (active !== task || !task.isCurrent())
    return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
  const denied = checkBrowserState(task, facts)
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
      // Preserve the original request and real slot answers as context for the
      // issued plan; customer confirmation does not replace current-data checks.
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
        const fresh = await executeBrowserTool(client, read, { includeCatalog: true })
        if (fresh && typeof fresh === 'object' && 'ok' in fresh && fresh.ok === false) {
          failure = { ...fresh }
          break
        }
        if (active !== task || !task.isCurrent() || !task.dialogue.accepts(binding, fresh)) {
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
export async function executeBrowserCheckout(client: Pick<ReturnType<typeof createInteractiveServiceClient>, 'tools' | 'execute'>, action: 'continue' | 'invoice-options' | 'invoice' | 'phone' | 'phone-confirmed' | 'donation-confirmed' | 'tax-confirmed', input: { method?: string, phone?: string, code?: string, afterRejectedSubmit?: true } = {}) {
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
  const denied = checkBrowserState(task, raw)
  if (denied)
    return denied
  const facts = parse(looseObject({ ...orderingAnswerFactsSchema.entries, cart: cartSnapshotSchema }), raw)
  if (!facts.cart.lines.length)
    return { ok: true, source: 'browser', effect: 'none', customerMessage: await emptyCartMessage(client, facts) }
  const pendingStep = task.dialogue.checkoutStep(raw)
  // A checked native radio only describes the website's form default. Until
  // this visitor enters a later checkout step, continuing must ask the actual
  // invoice choice rather than infer consent from that default.
  const needsInvoiceChoice = action === 'invoice-options' || (action === 'continue' && (!pendingStep || ['cart-review', 'review-checkout', 'invoice-method'].includes(pendingStep)))
  if (!task.answerResolved && ((action === 'invoice' && ['cart-review', 'review-checkout'].includes(pendingStep ?? ''))
    // A literal invoice-entry answer belongs to its issued slot even when Main
    // misroutes a short donation code into the notification-phone tool.
    || (pendingStep === 'invoice-details' && task.dialogue.canAnswerLocally(raw, task.transcript))
    || (action === 'phone' && ['notification-details', 'notification-phone', 'notification-phone-confirm'].includes(pendingStep ?? '')))) {
    const read = client.tools.value.find(tool => tool.name === 'browser_cart_get')!
    return executeBrowserCartTool(client, read, { includeCatalog: true })
  }
  // Generic completion belongs to the current workflow question. It never
  // supplies an unspoken invoice method, even if Main picked the wrong tool.
  if (action === 'invoice' && /^(?:正確|沒錯|對|是的|確認|確認無誤|好|好的|好了|ok)[。！!，,\s]*$/i.test(task.transcript.trim())) {
    if (pendingStep && pendingStep !== 'invoice-method')
      return executeBrowserCheckout(client, 'continue')
    return executeBrowserCheckout(client, 'invoice-options')
  }
  if (action === 'phone' && pendingStep === 'notification-phone-confirm')
    return { ok: true, source: 'browser', effect: 'none', customerMessage: orderingMessages['zh-Hant'].checkout.notificationPhone.confirmationRequired }
  let name = 'browser_checkout_prepare'
  if (action === 'invoice')
    name = 'browser_invoice_select'
  else if (action === 'phone' || action === 'phone-confirmed')
    name = 'browser_notification_phone'
  else if (action === 'donation-confirmed')
    name = 'browser_invoice_donation'
  else if (action === 'tax-confirmed')
    name = 'browser_invoice_tax'
  const tool = client.tools.value.find(tool => tool.name === name)
  if (!tool)
    throw new Error('目前網站尚未提供這項結帳操作。')
  let parameters: Record<string, unknown> = { focus: needsInvoiceChoice ? 'invoice' : 'next' }
  if (action === 'invoice')
    parameters = { method: parse(pbInvoiceMethodSchema, input.method) }
  if (action === 'phone' || action === 'phone-confirmed') {
    const digits = normalizeSlotNumbers(task.transcript).replaceAll(/\D/g, '')
    if (!input.phone || !/^\d{10,15}$/.test(input.phone) || (action === 'phone' && input.phone !== digits))
      return { ok: true, source: 'browser', effect: 'none', customerMessage: '請說完整通知手機號碼，可以分段說。' }
    parameters = { phone: input.phone }
  }
  if (action === 'tax-confirmed') {
    const form = safeParse(looseObject({ checkout: pbCheckoutSchema }), raw)
    if (!input.code || !/^\d{8}$/.test(input.code) || !form.success || !form.output.checkout.methods.some(method => method.method === 'tax' && method.selected))
      return { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: orderingMessages['zh-Hant'].checkout.taxId.invalid }
    parameters = { code: input.code }
  }
  if (action === 'donation-confirmed') {
    const form = safeParse(looseObject({ checkout: pbCheckoutSchema }), raw)
    if (!input.code || !/^\d{3,7}$/.test(input.code) || !form.success || !form.output.checkout.methods.some(method => method.method === 'donation' && method.selected))
      return { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: orderingMessages['zh-Hant'].checkout.donationCode.invalid }
    parameters = { code: input.code }
  }
  const result = await executeBrowserTool(client, tool, parameters)
  if (active !== task || !task.isCurrent())
    return { ok: false, source: 'host', effect: 'none' }
  const parsed = safeParse(looseObject({ ok: literal(true), source: literal('browser'), checkout: pbCheckoutSchema, cart: looseObject({ version: string(), lines: array(looseObject({ ...cartLineLabelSchema.entries, unitPrice: number() })), subtotal: optional(number()), tableName: optional(string()) }) }), result)
  if (!parsed.success) {
    // Unknown/pending effects are not a recoverable draft failure. In particular,
    // never manufacture progress or retry a write when its receipt is uncertain.
    const failed = safeParse(looseObject({ ok: literal(false), source: literal('browser'), effect: literal('none') }), result)
    if (failed.success) {
      const fresh = await readBrowserOrderingFacts(client)
      if (active !== task || !task.isCurrent())
        return result
      const denied = checkBrowserState(task, fresh)
      if (denied)
        return denied
      const recovery = task.dialogue.observeCheckout(fresh, `${name}:${action === 'invoice' ? input.method : pendingStep ?? 'invoice-method'}`, true, task.utteranceId ?? task)
      const form = safeParse(looseObject({ checkout: pbCheckoutSchema }), fresh)
      if (recovery && form.success && form.output.checkout.methods.length) {
        const question = task.dialogue.presentService(fresh, { purpose: 'invoice-method', request: task.transcript, question: `${orderingMessages['zh-Hant'].checkout.recovery.operationFailed}${orderingMessages['zh-Hant'].checkout.invoiceOptions.replace('{methods}', form.output.checkout.methods.map(method => method.label).join('、'))}`, choices: form.output.checkout.methods.map(method => ({ id: method.method, description: `選擇${method.label}，只設定發票，不送出訂單。` })) })
        task.onRequestComplete?.()
        return { ...question, code: 'CHECKOUT_RECOVERY', recovery, dataOnly: false }
      }
    }
    return result
  }
  const checkout = parsed.output.checkout
  const binding = { ...facts, checkout, cart: { ...facts.cart, ...parsed.output.cart } }
  const pending = task.dialogue.conversation(binding).waitingFor
  if (pending)
    task.dialogue.releaseService(binding, pending.questionId)
  if (needsInvoiceChoice || !checkout.methods.some(method => method.selected)) {
    const preselected = checkout.methods.find(method => method.selected)
    const selectionMessage = preselected ? orderingMessages['zh-Hant'].checkout.invoicePreselected.replace('{method}', preselected.label) : ''
    const question = task.dialogue.presentService(binding, { purpose: 'invoice-method', request: task.transcript, question: `${selectionMessage}${orderingMessages['zh-Hant'].checkout.invoiceOptions.replace('{methods}', checkout.methods.map(method => method.label).join('、'))}`, choices: checkout.methods.map(method => ({ id: method.method, description: `選擇${method.label}${method.selected ? '（目前預選；明確說沿用預選即選此方式）' : ''}，只設定發票，不送出訂單。` })) })
    return { ...parsed.output, ...question, dataOnly: false }
  }
  const selected = checkout.methods.find(method => method.selected)!
  const invoiceField = checkout.fields.find(field => field.kind === selected.method)
  const contacts = checkout.fields.filter(field => field.kind === 'phone' || field.kind === 'email')
  let entryQuestion: { purpose: string, question: string } | undefined
  // Invoice completion is its own bound question. A spoken "OK" re-reads the
  // real form before moving to contact details; it never fills a field or submits.
  if (selected.method !== 'none' && (!invoiceField || !invoiceField.valid)) {
    const copy = orderingMessages['zh-Hant'].checkout
    let question: string
    if (selected.method === 'donation') {
      question = invoiceField?.value ? copy.donationCode.invalid : copy.donationCode.introduction
    }
    else if (selected.method === 'tax') {
      question = invoiceField?.value ? copy.taxId.invalid : copy.taxId.introduction
    }
    else if (selected.method === 'carrier' || selected.method === 'citizen') {
      question = `${copy.scanInvoice.replace('{method}', selected.label)}，掃好後告訴我「好了」。`
    }
    else {
      question = invoiceField?.value ? copy.invalidInvoice.replace('{label}', selected.label).replace('{entry}', '填寫') : `目前此欄尚無法語音代填，請輸入${selected.label}，完成後告訴我「好了」。`
    }
    entryQuestion = { purpose: 'invoice-details', question }
  }
  else if (contacts.some(field => field.value && !field.valid)) {
    const invalid = contacts.find(field => field.value && !field.valid)!
    entryQuestion = { purpose: 'notification-details', question: `請在畫面確認${invalid.label}格式，完成後告訴我「好了」。` }
  }
  else if (contacts.length && !contacts.some(field => field.value && field.valid)) {
    entryQuestion = { purpose: 'notification-details', question: orderingMessages['zh-Hant'].checkout.notificationPhone.introduction }
  }
  if (entryQuestion) {
    const recovery = task.dialogue.observeCheckout(binding, entryQuestion.purpose, false, task.utteranceId ?? task)
    if (recovery) {
      // Rebuild from the freshly observed form, not the old question. The user
      // can retain/change invoice method or supply contact details naturally;
      // no default is adopted and no merchant data is cleared.
      const invoice = entryQuestion.purpose === 'invoice-details'
      const question = task.dialogue.presentService(binding, invoice
        ? { purpose: 'invoice-method', request: task.transcript, question: `${orderingMessages['zh-Hant'].checkout.recovery.invoice.replace('{method}', selected.label)}${orderingMessages['zh-Hant'].checkout.invoiceOptions.replace('{methods}', checkout.methods.map(method => method.label).join('、'))}`, choices: checkout.methods.map(method => ({ id: method.method, description: `選擇${method.label}，只設定發票，不送出訂單。` })) }
        : { purpose: 'notification-details', request: task.transcript, question: orderingMessages['zh-Hant'].checkout.recovery.contact, choices: [] })
      task.onRequestComplete?.()
      return { ...parsed.output, ...question, code: 'CHECKOUT_RECOVERY', recovery, dataOnly: false, effect: 'none' }
    }
    const question = task.dialogue.presentService(binding, { ...entryQuestion, request: task.transcript, choices: [{ id: 'yes', description: '目前這一步已填好，重新檢查畫面後繼續下一步；不送出訂單。' }, { id: 'no', description: '還沒填好，保留目前畫面及資料。' }] })
    return { ...parsed.output, ...question, dataOnly: false, effect: 'none' }
  }
  if (!checkout.ready || !checkout.confirmationToken) {
    const recovery = task.dialogue.observeCheckout(binding, 'checkout-details', false, task.utteranceId ?? task)
    const message = checkout.missing[0] ?? '資料已填入，請核對畫面。'
    if (recovery) {
      task.dialogue.pauseCheckout(binding)
      task.onRequestComplete?.()
      return { ok: true, source: 'browser', code: 'CHECKOUT_RECOVERY', recovery, effect: 'none', customerMessage: orderingMessages['zh-Hant'].checkout.recovery.details.replace('{missing}', message) }
    }
    const question = task.dialogue.presentService(binding, { purpose: 'checkout-details', request: task.transcript, question: `${message}完成後告訴我「好了」。`, choices: [{ id: 'yes', description: '資料已填好，重新讀取並核對目前訂單；不送出訂單。' }, { id: 'no', description: '先不繼續，保留目前畫面及資料。' }] })
    return { ...parsed.output, ...question, dataOnly: false, effect: 'none' }
  }
  const cart = parsed.output.cart
  const meals = cart.lines.map(line => describePbMeal(line)).join('、')
  const invoice = checkout.methods.find(method => method.selected)!.label
  const fields = checkout.fields.filter(field => field.value).map(field => `${field.label}${field.value}`).join('、')
  const question = task.dialogue.presentService(binding, { purpose: 'submit-order', query: checkout.confirmationToken, request: task.transcript, question: `${input.afterRejectedSubmit ? orderingMessages['zh-Hant'].checkout.notSubmitted : ''}本次餐點：${meals}，總金額${checkout.total}元${cart.tableName ? `，${cart.tableName}` : ''}；發票${invoice}${fields ? `，${fields}` : ''}${checkout.orderNote ? `，訂單備註${checkout.orderNote}` : ''}。以上內容確認送出訂單嗎？`, choices: [{ id: 'yes', description: '確認剛才完整訂單摘要，現在按下送出訂單；不選擇或操作付款。' }, { id: 'no', description: '先不送出，保留餐點與發票通知資料，可以提出修改。' }] })
  return { ...parsed.output, ...question, dataOnly: false }
}

/** A generic acknowledgement cannot bypass a live purchase question or claim an effect. */
export async function executeBrowserReply(client: Pick<ReturnType<typeof createInteractiveServiceClient>, 'tools' | 'execute'>, kind: unknown) {
  const selected = parse(customerReplySchema, kind)
  const task = active
  if (!task || !task.isCurrent())
    return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
  const stateReader = client.tools.value.find(tool => tool.name === 'browser_state_get')
  if (stateReader && (task.orderReference || !client.tools.value.some(tool => tool.name === 'browser_cart_get'))) {
    const fresh = await executeBrowserTool(client, stateReader, { includeCatalog: false })
    if (active !== task || !task.isCurrent())
      return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
    const state = parse(looseObject({ ok: literal(true), order: pbOrderStateSchema }), fresh).order
    if (task.orderReference && task.orderReference !== state.reference)
      throw new Error('Order reply belongs to a different order.')
    const messages = orderingMessages['zh-Hant'].orderState
    let customerMessage: string = messages[state.paymentStatus]
    if (state.paymentStatus === 'pending') {
      const paymentMethods = state.paymentMethods.filter(method => /^(?:line\s*pay|信用卡|credit(?:\s*card)?)$/i.test(method.trim()))
      customerMessage = `訂單已建立，尚未付款。${paymentMethods.length ? `請選擇${paymentMethods.join('或')}，再自行完成付款授權。` : orderingMessages['zh-Hant'].checkout.paymentUnavailable}`
    }
    return { ok: true, source: 'host', status: 'conversation', effect: 'none', order: state, customerMessage }
  }
  const policy = safeParse(servicePolicyReplySchema, selected)
  if (policy.success) {
    if (!task.servicePolicyReply)
      throw new Error('Service policy replies require the current Kiosk translation context.')
    // A service boundary cannot consume a meal question or imply a staff,
    // transport, discount, cart or payment operation has been dispatched.
    return { ok: true, source: 'host', status: 'conversation', effect: 'none', customerMessage: task.servicePolicyReply(policy.output) }
  }
  if (task.tableSelectionRequired) {
    const read = client.tools.value.find(tool => tool.name === 'browser_cart_get')
    if (!read)
      throw new Error('Table entry requires the current native page.')
    const fresh = await executeBrowserTool(client, read, { includeCatalog: false })
    if (active !== task || !task.isCurrent())
      return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
    const denied = checkBrowserState(task, fresh)
    if (denied)
      return denied
    task.tableSelectionRequired = false
  }
  if (selected === 'checkout-guidance') {
    if (client.tools.value.some(tool => tool.name === 'browser_checkout_prepare')) {
      const read = client.tools.value.find(tool => tool.name === 'browser_cart_get')!
      const raw = await executeBrowserTool(client, read, { includeCatalog: false })
      const page = safeParse(looseObject({ page: string() }), raw)
      if (page.success && page.output.page === 'cart')
        return executeBrowserCheckout(client, 'continue')
      const review = client.tools.value.find(tool => tool.name === 'browser_cart_review')!
      return executeBrowserCartTool(client, review, {})
    }
    const review = client.tools.value.find(tool => tool.name === 'browser_cart_review')
    if (!review || !task.checkoutGuidance)
      throw new Error('Checkout guidance requires native cart review and the current Kiosk translation context.')
    // Review the currently visible cart without inferring its operator.
    // This never submits an order or selects payment.
    const result = await executeBrowserCartTool(client, review, {})
    if (active !== task || !task.isCurrent())
      return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
    const reviewed = safeParse(looseObject({ ok: literal(true), source: literal('browser'), cart: looseObject({ lines: array(looseObject({ name: string(), quantity: number() })) }) }), result)
    if (!reviewed.success)
      return result
    return { ...reviewed.output, status: 'checkout-guidance', effect: 'none', customerMessage: task.checkoutGuidance(reviewed.output.cart.lines.length === 0) }
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
  return { ok: true, source: 'host', status: 'conversation', effect: 'none', customerMessage: replyToConversation(parse(contextReplySchema, { kind: selected }).kind)!.content }
}
