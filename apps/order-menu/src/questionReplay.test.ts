import type { KioskActionCandidate, KioskDecisionState, KioskDecisionTrace } from '../../server/src/services/domain/kiosk-interaction-decision'
import type { SystemOneQuestion } from '../../server/src/services/domain/kiosk-system-one'
import type { CheckoutSnapshot } from './domain/checkout-flow'

import { describe, expect, it } from 'vitest'

import { decideInteraction } from '../../server/src/services/domain/kiosk-interaction-decision'
import { createRecommendationInvitation } from '../../server/src/services/domain/kiosk-interaction-decision/contracts'
import { beginCheckout, chooseInvoiceMethod, confirmTaxId, requestTaxId, setTaxIdDraft, skipMembership } from './domain/checkout-flow'
import { createMenuToolRuntime } from './webmcp'

const replayUrl = process.env.KIOSK_SYSTEM_ONE_REPLAY_URL

async function invoke(state: string, questions: Record<string, SystemOneQuestion>) {
  const response = await fetch(new URL('v1/systemone', `${replayUrl!.replace(/\/+$/, '')}/`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, questions }), signal: AbortSignal.timeout(30_000) })
  if (!response.ok)
    throw new Error(`Jev HTTP ${response.status}`)
  return await response.json() as { answers?: Record<string, unknown> }
}

describe.skipIf(!replayUrl)('live action-bound Jev replay with actual runtime candidates', () => {
  for (const scenario of [
    { transcript: '對', question: '準備進入結帳流程了嗎？', expected: 'intent:start-checkout' },
    { transcript: '好，結帳', question: '現在要開始結帳嗎？', expected: 'intent:start-checkout' },
    { transcript: '先不要', question: '要進入結帳流程嗎？', expected: 'intent:defer-question' },
    { transcript: '走走走 去那邊', question: '要進入結帳流程嗎？', expected: 'IGNORE' },
    { transcript: '周氏蝦捲再兩份', question: '要進入結帳流程嗎？', expected: 'intent:add-item' },
    // Report: this chat, 2026-10-19; retained session zloUV_0YpdMnMhQlGEFvp entries 7/9.
    { transcript: '略過', questionPresented: false, question: '發票畫面尚未呈現語音問題', expected: 'intent:choose-invoice:donation', invoicePhase: true },
    { transcript: '略過', question: '請選擇發票方式。', expected: 'intent:choose-invoice:donation', invoicePhase: true },
    { transcript: '跳過', questionPresented: false, question: '請選擇發票方式。', expected: 'intent:choose-invoice:donation', invoicePhase: true },
    { transcript: '捐贈發票', questionPresented: false, question: '請選擇發票方式。', expected: 'intent:choose-invoice:donation', invoicePhase: true },
    { transcript: '不要略過，我要手機載具', questionPresented: false, question: '請選擇發票方式。', expected: 'intent:choose-invoice:carrier', invoicePhase: true },
    { transcript: '小陳，這一頁先跳過，我們等下再討論。', questionPresented: false, question: '請選擇發票方式。', expected: 'SILENT', invoicePhase: true },
    { transcript: '可以略過嗎？', questionPresented: false, question: '請選擇發票方式。', expected: 'NO_ACTION', invoicePhase: true },
    { transcript: '手機載具', questionPresented: false, question: '請選擇發票方式。', expected: 'intent:choose-invoice:carrier', invoicePhase: true },
    { transcript: '信用卡', question: '請選擇信用卡或行動支付。', expected: 'intent:select-payment:card', paymentPhase: true },
  ]) {
    it(`${scenario.transcript}${scenario.invoicePhase ? ' invoice' : ''}${scenario.questionPresented === false ? ' without a presented question' : ''}`, async () => {
      let checkout: CheckoutSnapshot | undefined
      let revision = 0
      let paymentSelections = 0
      const update = (next: CheckoutSnapshot) => {
        checkout = next
        revision++
        return next
      }
      const runtime = createMenuToolRuntime({
        onAction: () => {},
        onCartChange: () => {},
        onMenuSelection: () => {},
        checkout: {
          snapshot: () => checkout,
          revision: () => revision,
          paymentStatus: () => undefined,
          assertCanRestart: () => {},
          restart: () => {
            checkout = undefined
            revision++
          },
          start: () => update(beginCheckout()),
          skipMembership: () => update(skipMembership(checkout!)),
          chooseInvoice: method => update(chooseInvoiceMethod(checkout!, method)),
          requestTaxId: () => update(requestTaxId(checkout!)),
          setTaxId: taxId => update(setTaxIdDraft(checkout!, taxId)),
          confirmTaxId: () => update(confirmTaxId(checkout!)),
          cancel: () => {
            checkout = undefined
            revision++
          },
          selectPayment: async () => {
            paymentSelections++
            return { customerMessage: '已選擇，尚未付款。', status: 'selected' }
          },
        },
      })
      await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
      await runtime.invoke('order_set_fulfillment', { mode: 'takeout' })
      if (scenario.paymentPhase || scenario.invoicePhase) {
        await runtime.invoke('checkout_start', { confirmedByUser: true })
        await runtime.invoke('checkout_skip_membership', { confirmedByUser: true })
        if (scenario.paymentPhase)
          await runtime.invoke('checkout_choose_invoice', { method: 'donation' })
      }
      const offered = scenario.questionPresented === false ? undefined : await runtime.invokeForAgent('order_ask_question', { purpose: scenario.paymentPhase ? 'payment-method' : scenario.invoicePhase ? 'invoice' : 'checkout-entry' }) as { pendingCustomerChoice: { questionId: string, question: string } } | undefined
      if (offered)
        await runtime.invoke('kiosk_dialogue_presented', { content: offered.pendingCustomerChoice.question, questionId: offered.pendingCustomerChoice.questionId })
      const snapshot = await runtime.invoke('kiosk_fast_path_context', { transcript: scenario.transcript }) as KioskDecisionState & { candidates: KioskActionCandidate[] }
      expect(snapshot.candidates.length).toBeLessThan(15)
      const decision = await decideInteraction({ candidates: snapshot.candidates, decisionState: snapshot, conversation: { messages: offered ? [{ role: 'assistant', content: offered.pendingCustomerChoice.question }] : [] }, transcript: scenario.transcript, invoke, includeTrace: true, policy: { decisionInstruction: '', storeInstruction: '' } })
      const execution = decision.kind === 'FAST_ACTION' ? await runtime.invoke('kiosk_fast_path_execute', { candidateId: decision.actionId }) : null
      console.info(JSON.stringify({ transcript: scenario.transcript, snapshot, decision, execution }))
      if (scenario.expected === 'IGNORE' || scenario.expected === 'SILENT' || scenario.expected === 'NO_ACTION') {
        if (scenario.expected === 'NO_ACTION')
          expect(['NEEDS_ASSISTANT', 'UNAVAILABLE']).toContain(decision.kind)
        else if (scenario.expected === 'SILENT')
          expect(['IGNORE', 'UNAVAILABLE']).toContain(decision.kind)
        else
          expect(decision.kind).toBe(scenario.expected)
        if (scenario.invoicePhase) {
          expect(checkout?.stage).toBe('invoice')
          expect(checkout?.invoiceMethod).toBeUndefined()
          expect(paymentSelections).toBe(0)
        }
      }
      else {
        expect(decision).toMatchObject({ kind: 'FAST_ACTION', actionId: scenario.expected })
        if (scenario.paymentPhase)
          expect(execution).toMatchObject({ decisionTrace: { authorize: { kind: 'EXECUTE' }, operationPlan: { intent: 'SELECT_PAYMENT' } } })
        if (scenario.invoicePhase) {
          expect(checkout?.stage).toBe(scenario.expected === 'intent:choose-invoice:donation' ? 'payment' : 'invoice')
          expect(checkout?.invoiceMethod).toBe(scenario.expected === 'intent:choose-invoice:donation' ? 'donation' : 'carrier')
          expect(checkout?.donationCode).toBeUndefined()
          expect(paymentSelections).toBe(0)
        }
        if (scenario.expected === 'intent:start-checkout')
          expect(checkout?.stage).toBe('membership')
      }
    }, 70_000)
  }
})

// These opt-in cases send only synthetic dialogue and the demo runtime catalog.
describe.skipIf(!replayUrl)('live finite invitation answers with the actual menu runtime', () => {
  it.each([
    { transcript: '好啊', kind: 'FAST_ACTION', actionId: 'intent:recommend', answered: true, superseded: false, cartCount: 0 },
    { transcript: '不用', kind: 'IGNORE', actionId: undefined, answered: true, superseded: false, cartCount: 0 },
    { transcript: '不用，我要水餃一份', kind: 'FAST_ACTION', actionId: 'intent:add-item', answered: false, superseded: true, cartCount: 1 },
    { transcript: '小明，好啊，等一下去找你', kind: 'IGNORE', actionId: undefined, answered: false, superseded: false, cartCount: 0 },
  ])('$transcript', async ({ transcript, kind, actionId, answered, superseded, cartCount }) => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const snapshot = await runtime.invoke('kiosk_fast_path_context', { transcript }) as KioskDecisionState & { candidates: KioskActionCandidate[] }
    const waitingFor = createRecommendationInvitation('SYNTHETIC_INVITATION', Date.now())
    const decision = await decideInteraction({ transcript, candidates: snapshot.candidates, decisionState: { ...snapshot, waitingFor }, conversation: { messages: [{ role: 'assistant', content: waitingFor.question }] }, policy: { decisionInstruction: '', storeInstruction: '' }, invoke, includeTrace: true })
    expect(decision.kind).toBe(kind)
    expect(decision.answeredQuestionId).toBe(answered ? 'SYNTHETIC_INVITATION' : undefined)
    expect(decision.supersededQuestionId).toBe(superseded ? 'SYNTHETIC_INVITATION' : undefined)
    if (decision.kind === 'FAST_ACTION') {
      expect(decision.actionId).toBe(actionId)
      await runtime.invoke('kiosk_fast_path_execute', { candidateId: decision.actionId, ...(decision.ingredientFilters ? { ingredientFilters: decision.ingredientFilters } : {}) })
    }
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: cartCount } })
  }, 70_000)
})

// Report: this chat, 2026-10-19; session NOSb3gdRfHaSE-uu_s7wB.
describe.skipIf(!replayUrl)('live menu content destination with actual candidates', () => {
  it.each([
    { transcript: '往下一點', direction: 'DOWN' },
    { transcript: '往上一點', direction: 'UP' },
    { transcript: '菜單往下看', direction: 'DOWN' },
    { transcript: '菜單往上看', direction: 'UP' },
    { transcript: '顯示更接近菜單結尾的內容', direction: 'DOWN' },
    { transcript: '顯示更接近菜單開頭的內容', direction: 'UP' },
    { transcript: '手指往上滑，讓下面的菜單出現', direction: 'DOWN', mayAbstain: true },
    { transcript: '手指往下滑，讓上面的菜單出現', direction: 'UP', mayAbstain: true },
  ])('resolves content or abstains from an unclear composite gesture: $transcript', async ({ transcript, direction, mayAbstain }) => {
    const directions: string[] = []
    const runtime = createMenuToolRuntime({
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
      onMenuRequested: () => {},
      onMenuScroll: (selected) => {
        directions.push(selected)
        return { status: 'MOVED', position: selected === 'UP' ? 0 : 720 }
      },
    })
    const snapshot = await runtime.invoke('kiosk_fast_path_context', { transcript }) as KioskDecisionState & { candidates: KioskActionCandidate[] }
    const result = await decideInteraction({ transcript, candidates: snapshot.candidates, decisionState: snapshot, invoke, policy: { decisionInstruction: '', storeInstruction: '' }, includeTrace: true })
    const trace = result.trace as KioskDecisionTrace | undefined
    console.info(JSON.stringify({ transcript, kind: result.kind, actionId: result.kind === 'FAST_ACTION' ? result.actionId : undefined, initial: trace?.rawAnswer, check: trace?.semanticCheck, modelCalls: result.modelCalls }))
    // Composite gestures may remain unresolved by the provider; abstention is
    // safe, but successful completion must never use the opposite destination.
    if (mayAbstain && result.kind === 'UNAVAILABLE') {
      expect(result).not.toHaveProperty('actionId')
      expect(directions).toEqual([])
      return
    }
    expect(result, JSON.stringify(result)).toMatchObject({ kind: 'FAST_ACTION', actionId: direction === 'UP' ? 'intent:scroll-menu:up' : 'intent:scroll-menu:down' })
    if (result.kind !== 'FAST_ACTION')
      throw new Error('Expected a verified scroll action.')
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: result.actionId })).toMatchObject({ status: 'MOVED' })
    expect(directions).toEqual([direction])
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  }, 40_000)
})

describe.skipIf(!replayUrl)('live open preference handoff with actual candidates', () => {
  it.each([
    { transcript: '還有什麼？我不要便當' },
    { transcript: '便當先不用，有其他選擇嗎？' },
    { transcript: '不要麵，要素食' },
    { transcript: '素食的有什麼，麵先不要' },
    { transcript: '不想吃飯', mayClarify: true },
    { transcript: '不是不要便當，是今天不想吃炸的' },
  ])('preserves the whole request for Agent: $transcript', async ({ transcript, mayClarify }) => {
    const runtime = createMenuToolRuntime({ onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const snapshot = await runtime.invoke('kiosk_fast_path_context', { transcript }) as KioskDecisionState & { candidates: KioskActionCandidate[] }
    const result = await decideInteraction({ transcript, candidates: snapshot.candidates, decisionState: snapshot, invoke, policy: { decisionInstruction: '', storeInstruction: '' }, includeTrace: true })
    const trace = result.trace as KioskDecisionTrace | undefined
    console.info(JSON.stringify({ transcript, kind: result.kind, reason: result.kind === 'NEEDS_ASSISTANT' ? result.reason : undefined, route: trace?.rawAnswer, checks: trace?.exchanges?.map(exchange => Object.keys(exchange.questions)), modelCalls: result.modelCalls }))
    expect(result, JSON.stringify(result)).toMatchObject({ kind: 'NEEDS_ASSISTANT' })
    if (!mayClarify)
      expect(result).toMatchObject({ reason: 'MENU_QUERY' })
    expect(result).not.toHaveProperty('actionId')
    expect(result).not.toHaveProperty('ingredientFilters')
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  }, 40_000)
})
