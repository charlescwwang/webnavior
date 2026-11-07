import type { ServiceTool } from '@proj-airi/stage-shared/interactive-service'
import type { createInteractiveServiceClient } from '@proj-airi/stage-ui/services/interactiveServiceClient'

import type { BrowserEffect, BrowserPlan, EffectDecision } from '../../../server/src/services/domain/browser-ordering/contracts'
import type { createBrowserCartSession } from './browserCartSession'
import type { createBrowserDialogue } from './browserDialogue'
import type { AdditionProposal, QuestionSnapshot } from './browserQuestionWindow'

import { replyToConversation } from '@proj-airi/stage-shared/kiosk-conversation'
import { normalizeSlotNumbers } from '@proj-airi/stage-shared/ordering-slots'
import { productConfigurationSchema } from '@proj-airi/stage-ui/services/pbProduct'
import { array, boolean, looseObject, number, object, optional, parse, picklist, safeParse, strictObject, string } from 'valibot'

import { browserWriteToolNameSchema, cartLineLabelSchema } from '../../../server/src/services/domain/browser-ordering/contracts'

interface TaskQuestions {
  /** UI translation boundary for a requested fact the assistant cannot verify. */
  informationUnavailable?: () => string
  /** Host-only terminal evidence after a fully covered single edit is verified. */
  onRequestComplete?: () => void
  readOnly?: boolean
  /** Uncertain meaning may ask an explicit sealed question; factual inquiries may not. */
  clarifyOrder?: boolean
  dialogue?: ReturnType<typeof createBrowserDialogue>
  cartSession?: { gate: ReturnType<typeof createBrowserCartSession>, owner: () => string | undefined, serviceUrl: () => string | undefined, message: string }
}

interface VerifiedReceipt {
  /** Full-cart version after this effect; replay requires that exact cart. */
  version: string
  toolName: BrowserPlan['toolName']
  result: Record<string, unknown>
  addition?: NonNullable<BrowserEffect['completedAdditions']>[number]
}

let active: TaskQuestions & { cartOwner?: { owner: string, serviceUrl: string }, answerResolved?: boolean, previousProposal?: AdditionProposal, selected?: { productRef: string, request: string }, confirmed?: { proposal: AdditionProposal, binding: QuestionSnapshot }, text: string, transcript: string, decide: (proposal: BrowserEffect, plan: Pick<BrowserPlan, 'toolName' | 'arguments'>) => Promise<EffectDecision>, isCurrent: () => boolean, repairs: number, receipts: Map<string, VerifiedReceipt> } | undefined
const writes = new Set(['browser_cart_add', 'browser_cart_quantity', 'browser_cart_remove', 'browser_cart_replace'])

/** Owns one current utterance; only validated one-use question answers extend its target scope. */
export function beginBrowserCartTask(text: string, options: TaskQuestions & { decide: (proposal: BrowserEffect, plan: Pick<BrowserPlan, 'toolName' | 'arguments'>) => Promise<EffectDecision>, isCurrent: () => boolean }) {
  const task: NonNullable<typeof active> = { text: text.replaceAll(/\s/g, ''), transcript: text, ...options, repairs: 0, receipts: new Map<string, VerifiedReceipt>() }
  active = task
  return () => {
    if (active === task)
      active = undefined
  }
}

/** Keeps previous visitor details Host-only until this visitor owns the cart. */
function admitCart(task: NonNullable<typeof active>, raw: unknown, catalogOnly = false) {
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
    return { ok: false, source: 'browser', status: 'status' in raw && raw.status === 'unknown' ? 'unknown' : 'rejected', effect: 'none', ...('customerMessage' in raw && typeof raw.customerMessage === 'string' ? { customerMessage: raw.customerMessage } : {}) }
  }
  task.cartOwner ??= { owner, serviceUrl }
  if (session.gate.check(owner, serviceUrl, raw))
    return
  task.dialogue?.reset()
  if (catalogOnly) {
    const facts = parse(looseObject({ products: array(looseObject({ ref: string(), name: string() })) }), raw)
    return { ok: true, source: 'browser', dataOnly: true, products: facts.products, customerBoundary: 'review-required', explanation: '購物車屬於尚未完成交接的其他接待，未提供任何原車內容。可繼續以最新商品工具回答菜單問題，但不可宣稱原車為空、推測內容或修改。嘗試寫入會由 Host 阻擋，請如實告知需現場確認。' }
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
export async function executeBrowserCartTool(client: Pick<ReturnType<typeof createInteractiveServiceClient>, 'tools' | 'execute'>, tool: ServiceTool, input: Record<string, unknown>): Promise<unknown> {
  const task = active
  const context = client.tools.value.find(tool => tool.name === 'browser_cart_get')
  if (!writes.has(tool.name)) {
    if (tool.name === 'browser_cart_review') {
      if (!task || !task.isCurrent() || !context)
        return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
      // Check ownership before the native review opens the cart on screen.
      // Reading metadata here must not consume an outstanding product answer.
      const before = await client.execute(context, { includeCatalog: false })
      if (active !== task || !task.isCurrent())
        return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
      const denied = admitCart(task, before)
      if (denied)
        return denied
      // The selected capability is a fixed, read-only current-cart review.
      // There are no model-controlled arguments: never forward invented
      // planning/write fields (S13 emitted includeCatalog="false" repeatedly).
      // Native strict validation still receives exactly its advertised {}.
      const result = await client.execute(tool, {})
      if (active !== task || !task.isCurrent())
        return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
      // Navigation can outlive the first snapshot. The final fresh receipt must
      // still belong to this visitor before any contents reach Main or speech.
      return admitCart(task, result) ?? result
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
        return { ok: true, source: 'browser', dataOnly: true, requiredTool: 'browser_quote_selection', products: targets, explanation: '本句提到這項商品的現有規格／加購，基本價不足以回答整句。請依原句決定包含或排除哪些選項，以最新 selection 呼叫 browser_quote_selection；不要把基本價當成配置後合計。尚未加車。' }
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
      // Exact-name lookup and choose-product are different Main routes to the
      // same discovery problem. A miss cannot end an alias request with "not
      // found" when today's labels provide a related confirmation candidate.
      const facts = await client.execute(context, { includeCatalog: true })
      if (active !== task || !task.isCurrent())
        return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
      const denied = admitCart(task, facts, true)
      if (denied)
        return denied
      const names = safeParse(array(string()), input.names)
      const query = names.success && names.output.length === 1 ? names.output[0] : ''
      return task.dialogue.presentProducts(facts, query, task.transcript)
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
      const answer = await task.dialogue.answer(facts, task.transcript, observe, () => active === task && task.isCurrent())
      if (answer?.kind === 'receipt')
        return answer.result
      if (answer?.kind === 'product') {
        task.selected = { productRef: answer.product.productRef, request: answer.request }
        return { ...asBrowserFacts(facts), selectedProduct: answer.product, originalRequest: answer.request, explanation: '顧客只選定這項商品，尚未授權加入。依原需求提出完整數量、規格、備註及售價的 browser_cart_add；Host 只會建立確認問題，不會在這一步加車。' }
      }
      if (answer?.kind === 'new-request') {
        task.previousProposal = answer.previousProposal
        return { ...asBrowserFacts(facts), previousProposal: answer.previousProposal, explanation: '顧客有更正或新需求，舊確認已取消。若沿用該品項更正設定，必須重新呈現完整確認；尚未授權任何加購。明確其他品項則依整句重新處理。' }
      }
      if (answer?.kind === 'addition') {
        task.confirmed = answer
        return { ...asBrowserFacts(facts), confirmedAddition: answer.proposal, explanation: '顧客已確認這個完整設定。只能呼叫 browser_cart_add 執行這份完全相同的提案，不能重選參數；讀取工具本身沒有加車。' }
      }
      return facts
    }
    if (tool.name === 'browser_clarify_product' || (tool.name === 'browser_observe' && input.purpose === 'choose_product')) {
      const facts = await observe()
      if (active !== task || !task.isCurrent())
        return { ok: false, source: 'browser', status: 'rejected', effect: 'none' }
      const catalog = parse(looseObject({ products: array(looseObject({ ref: string(), name: string() })) }), facts)
      const named = catalog.products.filter(product => task.text.includes(product.name.replaceAll(/\s/g, '')))
      if (named.length === 1) {
        // A generic choose-product call cannot discard the exact current
        // subject and replace a price/options question with another menu list.
        return { ok: true, source: 'browser', dataOnly: true, products: named, explanation: '原句已唯一指明此商品，不需要再詢問品名。依完整原句及本商品最新規格處理；規格／加購查價用 browser_quote_selection，缺必要選項才詢問該選項。這次只是讀取，尚未加車。' }
      }
      const question = task.dialogue.presentProducts(facts, typeof input.query === 'string' ? input.query : '', task.transcript)
      const present = client.tools.value.find(tool => tool.name === 'browser_present')
      if (present && 'presentationRefs' in question && question.presentationRefs) {
        try {
          await client.execute(present, { productRefs: question.presentationRefs })
        }
        catch {
          // A missing visual cue cannot consume or invalidate the real question.
        }
      }
      return question
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
  const groupInput = safeParse(optional(array(string())), input.lineRefs)
  if (!groupInput.success)
    return { ok: true, source: 'browser', status: 'proposal_rejected', effect: 'none', dataOnly: true, explanation: 'lineRefs 必須是實際購物車行參照的陣列；尚未寫入。' }
  // A group still needs an explicit native anchor. Return the schema repair
  // rather than treating a missing anchor as a configuration ambiguity.
  if (groupInput.output && typeof input.lineRef !== 'string')
    return { ok: true, source: 'browser', status: 'proposal_rejected', effect: 'none', dataOnly: true, explanation: '缺少必填 lineRef。請保留本次 lineRefs、quantity、version，並另補 lineRef，值須為 lineRefs 內一個已觀察的行參照；不可改用 remove 或單列調整代替整組合計。尚未寫入。' }
  const refs = groupInput.output ?? (original ? [original.ref] : [])
  const originalGroup = facts.cart.lines.filter(line => refs.includes(line.ref))
  if (groupInput.output && (!['browser_cart_quantity', 'browser_cart_remove'].includes(tool.name) || !original || !refs.length || new Set(refs).size !== refs.length || originalGroup.length !== refs.length || !refs.includes(original.ref) || !original.productRef || original.configuration === undefined || original.unitPrice === undefined || originalGroup.some(line => line.productRef !== original.productRef || line.configuration !== original.configuration || line.unitPrice !== original.unitPrice)))
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
  if (task.confirmed && task.dialogue) {
    const { proposal, binding } = task.confirmed
    if (!task.dialogue.accepts(binding, rawFacts))
      return { ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: '確認後餐點或購物車已變更，請重新確認；尚未加車。' }
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
    const result = await client.execute(tool, expected)
    if (result && typeof result === 'object' && 'status' in result && result.status === 'verified' && 'cart' in result && result.cart && typeof result.cart === 'object' && 'version' in result.cart && typeof result.cart.version === 'string')
      task.receipts.set(key, { version: result.cart.version, toolName: 'browser_cart_add', result: { ...result }, ...(servingKey ? { addition: { servingKey, note: proposal.note, quantity: proposal.quantity } } : {}) })
    return result
  }
  if (task.previousProposal && task.dialogue && tool.name === 'browser_cart_add' && input.productRef === task.previousProposal.productRef && !task.text.includes(task.previousProposal.productName.replaceAll(/\s/g, '')))
    return task.dialogue.presentAddition(rawFacts, input)
  if (task.selected && task.dialogue) {
    if (tool.name !== 'browser_cart_add' || input.productRef !== task.selected.productRef)
      return { ok: true, source: 'browser', status: 'clarification', effect: 'none', customerMessage: '剛才只選定品項，請先確認完整餐點設定；購物車尚未變更。' }
    return task.dialogue.presentAddition(rawFacts, input)
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
        const selectionResult = safeParse(looseObject({ version: string(), variantRef: string(), choices: array(looseObject({ ref: string(), quantity: number() })) }), input.selection)
        if (!selectionResult.success)
          return { ok: true, source: 'browser', status: 'proposal_rejected', effect: 'none', dataOnly: true, availableConfigurations: product.configurations.map(configuration => ({ version: configuration.version, variantRef: configuration.variantRef })), selectionIssues: selectionResult.issues.map(issue => ({ path: issue.path?.map(part => part.key).join('.') ?? '', message: issue.message })), explanation: 'selection 缺漏或格式錯誤，尚未派送任何寫入。請一次補齊 selectionIssues 的所有欄位：version 複製該商品 configuration.version，variantRef 複製已觀察規格，choices 為每份已選加購陣列（沒有加購也必須明填 []）。頂層 version 仍使用 cart.version。不得猜值；修正欄位後還須核對顧客各組餐點及備註。' }
        const selection = selectionResult.output
        const configuration = product.configurations.find(configuration => configuration.variantRef === selection.variantRef)
        if (configuration) {
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
              selectedLabels.push(`${actual.name} 額外共 ${choice.quantity * Number(input.quantity)} 份`)
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
        const label = (row: typeof line) => ({ name: row.name, quantity: row.quantity, description: row.description ?? '', note: row.note ?? '' })
        cartTarget = { selected: { ...label(line), quantity: originalQuantity }, ...(originalGroup.length > 1 ? { groupSize: originalGroup.length } : {}), others: facts.cart.lines.filter(candidate => !refs.includes(candidate.ref) && candidate.productRef === line.productRef).map(candidate => ({ ...label(candidate), sameConfiguration: candidate.configuration === line.configuration })) }
      }
      ambiguous ||= sameName.length > 1 && !identified
    }
  }
  const expected = tool.name === 'browser_cart_replace' ? 2 : 1
  if (active !== task || !task.isCurrent() || names.length < expected)
    return { ok: false, source: 'browser', status: 'rejected', customerMessage: '目前需求或商品已變更，尚未操作購物車，請重新確認。' }
  const action = tool.name === 'browser_cart_add' ? 'add' : tool.name === 'browser_cart_replace' ? 'replace' : tool.name === 'browser_cart_quantity' ? 'quantity' : 'remove'
  const replacement = facts.products.find(product => product.ref === input.productRef)
  const retainQuantity = input.retainQuantity === undefined ? 0 : input.retainQuantity
  if (typeof retainQuantity !== 'number' || !Number.isInteger(retainQuantity) || retainQuantity < 0 || (action !== 'replace' && retainQuantity !== 0) || (action === 'replace' && original && retainQuantity >= original.quantity))
    return { ok: true, source: 'browser', status: 'proposal_rejected', effect: 'none', dataOnly: true, explanation: '保留份數必須是少於原行數量的非負整數，只能用於替換；尚未寫入。' }
  if (retainQuantity > 0 && !cartTarget)
    return { ok: true, source: 'browser', status: 'clarification', effect: 'none', customerMessage: '尚無法確認原餐配置，請先確認要調整的餐點；尚未變更購物車。' }
  const description = action === 'quantity'
    ? `保留「${original?.name}」商品與規格，將選定同配置行的合計由 ${originalQuantity} 改為 ${input.quantity} 份；其他餐點全部保留。`
    : action === 'remove'
      ? `移除選定同配置「${original?.name}」${originalQuantity} 份；不新增餐點，其他行全部保留。`
      : action === 'replace'
        ? `將既有「${original?.name}」${Number(original?.quantity) - retainQuantity} 份換成「${replacement?.name}」${input.quantity} 份，原配置保留 ${retainQuantity} 份；先加新餐核對，再調整原行。`
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
  const semanticDecision = await task.decide({ transcript: task.transcript, action, completedEffects, completedAdditions, servingKey, deltas, cartContext: { version: facts.cart.version, lines: facts.cart.lines.map(line => ({ name: line.name, quantity: line.quantity, description: line.description ?? '', note: line.note ?? '' })) }, cartTarget, serving, note: typeof input.note === 'string' ? input.note : '', storeFacts: [...selectedFacts, ...(original ? [`PB 現在指定的購物車行／同配置群組是「${original.name}」合計 ${originalQuantity} 份。整組移除代表移除目前這 ${originalQuantity} 份；這個原有數量不是顧客對新餐指定的份數。`] : [])].join(' '), description: `${description} 每份餐點的選項：${selectedLabels.join('、') || '沒有加購'}。單份售價 ${input.unitPrice ?? '沿用原行'}。備註：${input.note ?? ''}。` }, { toolName: parse(browserWriteToolNameSchema, tool.name), arguments: JSON.stringify(input) })
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
  if (ambiguous)
    return { ok: true, source: 'browser', status: 'clarification', effect: 'none', customerMessage: '目前有多筆同名商品，請先在畫面確認要操作的那一筆；尚未變更購物車。' }

  if (semanticDecision.choice === 'REVISE' && task.repairs++ < 1)
    return { ok: true, source: 'browser', status: 'proposal_rejected', effect: 'none', dataOnly: true, semanticDecision, requiredAction: action, explanation: `原句已清楚，但提案參數不符，尚未寫入。請依核對原因修正本輪原需求：${semanticDecision.checks?.at(-1)?.reason ?? ''}` }
  if (names.some(name => !task.text.includes(name.replaceAll(/\s/g, ''))) && tool.name === 'browser_cart_add' && task.dialogue) {
    // Semantic resolution may propose a current SKU for an unfamiliar spoken
    // name. It still cannot write: ask with the official name and complete
    // configuration, then require the existing one-use customer confirmation.
    if (semanticDecision.choice === 'ALLOW')
      return task.dialogue.presentAddition(rawFacts, input)
    return task.dialogue.presentProducts(rawFacts, '', task.transcript)
  }
  if (semanticDecision.choice !== 'ALLOW')
    return { ok: true, source: 'browser', status: 'clarification', effect: 'none', semanticDecision, customerMessage: '尚未確認您要進行這項購物車操作，請重新確認需求；目前尚未變更購物車。' }
  // The selected existing configuration may be referred to as "the one with
  // rice" when the verified replacement retains its SKU. A different SKU still
  // requires its formal target name; semantic allowance alone cannot invent it.
  const sameProductReplacement = action === 'replace' && !!original?.productRef && original.productRef === replacement?.ref
  if (names.some(name => !task.text.includes(name.replaceAll(/\s/g, '')) && (!cartTarget || semanticDecision.choice !== 'ALLOW' || name !== original?.name || (name === replacement?.name && !sameProductReplacement)))) {
    // A replacement's new SKU was independently checked above, but its spoken
    // name is still unconfirmed. Ask about that observed candidate only; the
    // existing meal and all write authority remain unchanged until a new turn.
    if (action === 'replace' && replacement && task.dialogue)
      return task.dialogue.presentProducts(rawFacts, replacement.name, task.transcript)
    const choices = needsProducts ? facts.products : facts.cart.lines
    return { ok: true, source: 'browser', status: 'clarification', effect: 'none', customerMessage: `請問您要${choices.map(product => product.name).join('、')}中的哪一項？目前尚未變更購物車。` }
  }
  const result = await client.execute(tool, input)
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

/** Keeps the read-only receipt intact while attaching Host question evidence. */
function asBrowserFacts(value: unknown) {
  return parse(looseObject({ source: string(), cart: looseObject({ version: string() }) }), value)
}

/** A generic acknowledgement cannot bypass a live purchase question or claim an effect. */
export async function executeBrowserReply(client: Pick<ReturnType<typeof createInteractiveServiceClient>, 'tools' | 'execute'>, kind: unknown) {
  const selected = parse(picklist(['greeting', 'acknowledgement', 'hearing-check', 'clarification', 'information-unavailable']), kind)
  const task = active
  if (!task || !task.isCurrent())
    return { ok: false, source: 'host', status: 'rejected', effect: 'none' }
  if (task.cartSession?.gate.blocked.value && ['clarification', 'acknowledgement'].includes(selected))
    return { ok: true, source: 'host', status: 'conversation', effect: 'none', customerMessage: task.cartSession.message }
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
