import type { CheckoutSnapshot } from '../../../order-menu/src/domain/checkout-flow'
import type { CartSnapshot, MenuItem } from '../../../order-menu/src/domain/order-machine'
import type { SeatingContext } from '../../../order-menu/src/domain/seating'
import type { MenuToolName } from '../../../order-menu/src/webmcp'
import type { KioskActionCandidate, KioskDecisionState } from '../../src/services/domain/kiosk-interaction-decision'
import type { Proposal } from './generativeRequirements'

import { errorMessageFrom } from '@moeru/std'

import { beginCheckout } from '../../../order-menu/src/domain/checkout-flow'
import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'

/** Synthetic catalog; prices, aliases and unknown composition are not store facts. */
export const menu: MenuItem[] = [
  { id: 'noodle', name: '紅燒牛肉麵', aliases: ['牛肉麵'], category: '麵食', price: 101 },
  { id: 'bento', name: '炸排骨便當', aliases: ['排骨便當'], category: '便當', price: 91 },
  { id: 'chicken', name: '椒麻雞便當', category: '便當', price: 96 },
  { id: 'dumplings', name: '水餃', category: '點心', price: 61 },
  { id: 'tea', name: '紅茶', category: '飲料', price: 21 },
].map(item => ({ ...item, description: '人工合成，成分未知', imageUrl: '', recommendationTags: [], optionGroups: [] }))

/** Evaluator expectations stay local; only text/history/question reach models. */
export const cases = [
  { id: 'a01', family: 'category', text: '我想吃麵', setup: 'empty', cart: {}, read: true },
  { id: 'a02', family: 'category-quantity', text: '我想吃麵，一碗', setup: 'empty', cart: { noodle: 1 } },
  { id: 'a03', family: 'query', text: '有牛肉麵嗎？', setup: 'empty', cart: {}, read: true },
  { id: 'a04', family: 'explicit-add', text: '排骨便當來一份', setup: 'empty', cart: { bento: 1 } },
  { id: 'a05', family: 'recommend-next', text: '還有沒有其他推薦？', setup: 'recommended', cart: {}, read: true, nextBatch: true },
  { id: 'a06', family: 'delayed-party', text: '一位', setup: 'party-intervening', cart: { bento: 1 }, party: 1 },
  { id: 'a07', family: 'context-modify', text: '改兩份', setup: 'cart', cart: { bento: 2 } },
  { id: 'a08', family: 'change-fulfillment', text: '還是內用好了', setup: 'pickup', cart: { bento: 1 }, mode: 'dine-in' },
  { id: 'a09', family: 'compound', text: '牛肉麵一碗，還要一個排骨便當', setup: 'empty', cart: { noodle: 1, bento: 1 } },
  { id: 'a10', family: 'mixed-unsupported', text: '我要炒鱔魚意麵，小辣不要香菜，還要一碗牛肉麵小辣，還要一個排骨便當，總共3樣', setup: 'empty', cart: {}, safeOnly: true },
  { id: 'a11', family: 'replace', text: '排骨便當不要了，換成牛肉麵一碗', setup: 'cart', cart: { noodle: 1 } },
  { id: 'a12', family: 'repair', text: '你沒有點到我的牛肉麵', setup: 'repair', cart: { bento: 1, noodle: 1 } },
  { id: 'a13', family: 'background', text: '為什麼你會選用這個分數，然後這個軟體', setup: 'cart', cart: { bento: 1 }, ignored: true },
  { id: 'a14', family: 'unfinished', text: '我要一……呃不是', setup: 'empty', cart: {}, ignored: true },
  { id: 'a15', family: 'reference', text: '那第二個一份', setup: 'recommended', cart: { bento: 1 } },
  { id: 'a16', family: 'diet-unknown', text: '有沒有素食？', setup: 'empty', cart: {}, safeOnly: true },
] as const
export type Case = typeof cases[number]

/** Inspect untyped tool envelopes without treating them as authorized plans. */
export function envelope(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** Fresh application runtime per arm/case; no POS, payment, browser or real session. */
export async function prepare(testCase: Case, recordReceipt?: (receipt: { name: string, input: Record<string, unknown>, result: unknown }) => void) {
  let seating: SeatingContext = { revision: 0, ready: false, choices: [] }
  let checkout: CheckoutSnapshot | undefined
  let checkoutRevision = 0
  let paymentAttempts = 0
  const history: Array<{ role: 'user' | 'assistant', content: string }> = []
  const receipts: Array<{ name: string, input: Record<string, unknown>, result: unknown }> = []
  const runtime = createMenuToolRuntime({
    menu,
    onAction: () => {},
    onCartChange: () => {},
    onMenuSelection: () => {},
    onMenuRequested: () => {},
    seating: {
      context: () => seating,
      refresh: async () => {},
      release: async () => {},
      reset: async () => {},
      reserve: async () => { throw new Error('Synthetic test cannot reserve tables') },
      setPartySize: async (partySize) => { seating = { ...seating, partySize, revision: seating.revision + 1 } },
    },
    checkout: {
      snapshot: () => checkout,
      revision: () => checkoutRevision,
      paymentStatus: () => undefined,
      assertCanRestart: () => {},
      restart: () => {
        checkout = undefined
        checkoutRevision++
      },
      start: () => {
        checkout = beginCheckout()
        checkoutRevision++
        return checkout
      },
      skipMembership: () => { throw new Error('Synthetic test stops before membership') },
      chooseInvoice: () => { throw new Error('Synthetic test cannot choose invoice') },
      requestTaxId: () => { throw new Error('Synthetic test cannot handle tax ID') },
      setTaxId: () => { throw new Error('Synthetic test cannot handle tax ID') },
      confirmTaxId: () => { throw new Error('Synthetic test cannot handle tax ID') },
      cancel: () => {
        checkout = undefined
        checkoutRevision++
      },
      selectPayment: async () => {
        paymentAttempts++
        throw new Error('Synthetic test cannot initiate payment')
      },
    },
  })
  const present = async (raw: unknown) => {
    const result = envelope(raw)
    if (typeof result.customerMessage !== 'string')
      return
    const question = envelope(result.pendingCustomerChoice)
    await runtime.invoke('kiosk_dialogue_presented', { content: result.customerMessage, ...(typeof question.questionId === 'string' ? { questionId: question.questionId } : {}) })
    history.push({ role: 'assistant', content: result.customerMessage })
  }
  if (['cart', 'pickup', 'repair', 'party-intervening'].includes(testCase.setup)) {
    history.push({ role: 'user', content: testCase.setup === 'repair' ? '我要牛肉麵一碗，還要排骨便當一份' : '先訂排骨便當一份' })
    await present(await runtime.invoke('order_add_item', { itemId: 'bento', quantity: 1 }))
    if (testCase.setup === 'pickup' || testCase.setup === 'party-intervening') {
      history.push({ role: 'user', content: testCase.setup === 'pickup' ? '自取' : '內用' })
      await present(await runtime.invoke('order_set_fulfillment', { mode: testCase.setup === 'pickup' ? 'takeout' : 'dine-in' }))
    }
    if (testCase.setup === 'party-intervening') {
      history.push({ role: 'user', content: '這裡吃' })
      history.push({ role: 'assistant', content: '好的，已保留內用設定。' })
      // An informational aside never clears or replaces the actual party question.
    }
  }
  let firstBatch: string[] = []
  if (testCase.setup === 'recommended') {
    history.push({ role: 'user', content: '推薦幾樣給我' })
    const result = await runtime.invoke('menu_recommend')
    await present(result)
    firstBatch = (envelope(result).items as Array<{ id: string }>).map(item => item.id)
  }
  const state = async () => await runtime.invoke('kiosk_interaction_state') as KioskDecisionState
  const cart = async () => (await runtime.invoke('cart_get', { display: false }) as { cart: CartSnapshot }).cart
  const initial = await state()
  await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: testCase.id, expectedMenuRevision: initial.menuRevision, constraints: initial.constraints ?? { exclude: [] } })
  const call = async (name: MenuToolName, input: Record<string, unknown> = {}) => {
    let result: unknown
    try {
      result = await runtime.invokeForAgent(name, input)
    }
    catch (error) {
      result = { error: errorMessageFrom(error) ?? 'Tool failed' }
    }
    receipts.push({ name, input, result })
    // A recording failure must not relabel an already applied mutation as a
    // domain failure, or manufacture a second attempted execution receipt.
    recordReceipt?.({ name, input, result })
    return result
  }
  return { runtime, history, receipts, present, state, cart, call, firstBatch, seating: () => seating, paymentAttempts: () => paymentAttempts }
}
export type Fixture = Awaited<ReturnType<typeof prepare>>

/**
 * Experimental binder, not a production resolver. Only exact name/alias IDs from
 * real menu_get and unique cart lines may bind; context goes through real issued
 * candidates. Unsupported atoms block all proposed writes before execution.
 * This cannot prove that the model retained every semantic demand: the frozen
 * evaluator must separately audit omissions and invented operations.
 */
export async function applyProposal(fixture: Fixture, proposal: Proposal) {
  const blocked: string[] = [...proposal.unresolved]
  const plan: Array<{ name: MenuToolName, input: Record<string, unknown> }> = []
  if (proposal.summaryCount !== null && proposal.summaryCount !== proposal.requirements.filter(atom => atom.effect === 'ADD' || atom.effect === 'REPLACE').length)
    blocked.push('Summary count cannot be reconciled without guessing units')
  if (blocked.length)
    return { blocked, plan, executed: false }
  const data = envelope(await fixture.call('menu_get', { display: false }))
  // Agent projections intentionally omit aliases. Bind against the same fixture
  // catalog facts, but only IDs proved present by the real data-only tool read.
  const ids = new Set((data.items as Array<{ id: string }>).map(item => item.id))
  const catalog = menu.filter(item => ids.has(item.id))
  const cart = await fixture.cart()
  const exact = (text: string | null) => catalog.filter(item => text && [item.name, ...(item.aliases ?? [])].includes(text))
  for (const atom of proposal.requirements) {
    if (atom.conditions.length || atom.effect === 'MODIFY_OPTION') {
      blocked.push(`Unsupported conditions: ${atom.source}`)
      continue
    }
    const matches = exact(atom.targetRaw)
    const item = matches.length === 1 ? matches[0] : undefined
    const line = item ? cart.lines.filter(line => line.itemId === item.id) : []
    const context = await fixture.runtime.invoke('kiosk_fast_path_context', { transcript: atom.source }) as KioskDecisionState & { candidates: KioskActionCandidate[] }
    const category = context.catalogEvidence?.categories.length === 1 ? context.catalogEvidence.categories[0]!.label : undefined
    if (atom.effect === 'CHAT' || atom.effect === 'UNFINISHED')
      continue
    if (atom.effect === 'QUERY' || atom.effect === 'VIEW') {
      if (atom.queryTopics.includes('DIET') || atom.queryTopics.includes('COMPOSITION')) {
        blocked.push(`Unknown composition: ${atom.source}`)
        continue
      }
      plan.push({ name: 'menu_get', input: category ? { category } : { query: atom.targetRaw ?? atom.source } })
      continue
    }
    if (atom.effect === 'RECOMMEND' || atom.effect === 'RECOMMEND_NEXT') {
      plan.push({ name: 'menu_recommend', input: { ...(atom.effect === 'RECOMMEND_NEXT' ? { more: true } : {}), ...(category ? { category } : {}) } })
      continue
    }
    if (atom.effect === 'ADD' && item && atom.quantity) {
      plan.push({ name: 'order_add_item', input: { itemId: item.id, quantity: atom.quantity } })
      continue
    }
    if (atom.effect === 'FULFILLMENT' && atom.value) {
      plan.push({ name: 'order_set_fulfillment', input: { mode: atom.value } })
      continue
    }
    if (atom.effect === 'PARTY_SIZE' && atom.quantity) {
      plan.push({ name: 'order_set_party_size', input: { partySize: atom.quantity } })
      continue
    }
    if (atom.effect === 'REMOVE' && line.length === 1) {
      plan.push({ name: 'cart_remove_item', input: { lineId: line[0]!.id } })
      continue
    }
    if (atom.effect === 'MODIFY_QUANTITY' && line.length === 1 && atom.quantity) {
      plan.push({ name: 'cart_set_line_quantity', input: { lineId: line[0]!.id, quantity: atom.quantity } })
      continue
    }
    if (atom.effect === 'REPLACE' && line.length === 1 && atom.quantity && exact(atom.replacementRaw).length === 1) {
      // Prebind both sides before removing; still non-atomic existing tools.
      // Failure between steps is recorded, not called successful replacement.
      plan.push({ name: 'cart_remove_item', input: { lineId: line[0]!.id } }, { name: 'order_add_item', input: { itemId: exact(atom.replacementRaw)[0]!.id, quantity: atom.quantity } })
      continue
    }
    // Reuse application target/quantity/reference policy rather than interpreting
    // historical product names or ordinals here. Never fabricate a candidate.
    const candidates = context.candidates
    const intent = ({ ADD: 'intent:add-item', MODIFY_QUANTITY: 'intent:set-quantity', REMOVE: 'intent:remove-item' } as Record<string, string>)[atom.effect]
    if (proposal.requirements.length === 1 && intent && candidates.some(candidate => candidate.id === intent)) {
      const result = await fixture.runtime.invoke('kiosk_fast_path_execute', { candidateId: intent })
      fixture.receipts.push({ name: 'kiosk_fast_path_execute', input: { candidateId: intent }, result })
      await fixture.present(result)
      return { blocked, plan, contextual: true }
    }
    blocked.push(`No safe binding: ${atom.source}`)
  }
  if (blocked.length)
    return { blocked, plan, executed: false }
  for (const operation of plan) {
    const result = await fixture.call(operation.name, operation.input)
    if (envelope(result).error || envelope(result).needsAssistant || envelope(result).pendingClarification)
      return { blocked: ['Execution did not complete'], plan, executed: false }
    await fixture.present(result)
  }
  return { blocked, plan, executed: true }
}
