import type { KioskActionCandidate, KioskDecisionState } from '../../server/src/services/domain/kiosk-interaction-decision'
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
    { transcript: '信用卡', question: '請選擇信用卡或行動支付。', expected: 'intent:select-payment:card', paymentPhase: true },
  ]) {
    it(scenario.transcript, async () => {
      let checkout: CheckoutSnapshot | undefined
      let revision = 0
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
          selectPayment: async () => ({ customerMessage: '已選擇，尚未付款。', status: 'selected' }),
        },
      })
      await runtime.invoke('order_add_item', { itemId: 'chous-shrimp-roll' })
      await runtime.invoke('order_set_fulfillment', { mode: 'takeout' })
      if (scenario.paymentPhase) {
        await runtime.invoke('checkout_start', { confirmedByUser: true })
        await runtime.invoke('checkout_skip_membership', { confirmedByUser: true })
        await runtime.invoke('checkout_choose_invoice', { method: 'donation' })
      }
      const offered = await runtime.invokeForAgent('order_ask_question', { purpose: scenario.paymentPhase ? 'payment-method' : 'checkout-entry' }) as { pendingCustomerChoice: { questionId: string, question: string } }
      await runtime.invoke('kiosk_dialogue_presented', { content: offered.pendingCustomerChoice.question, questionId: offered.pendingCustomerChoice.questionId })
      const snapshot = await runtime.invoke('kiosk_fast_path_context', { transcript: scenario.transcript }) as KioskDecisionState & { candidates: KioskActionCandidate[] }
      expect(snapshot.candidates.length).toBeLessThan(15)
      const decision = await decideInteraction({ candidates: snapshot.candidates, decisionState: snapshot, conversation: { messages: [{ role: 'assistant', content: offered.pendingCustomerChoice.question }] }, transcript: scenario.transcript, invoke, includeTrace: true, policy: { decisionInstruction: '', storeInstruction: '' } })
      const execution = decision.kind === 'FAST_ACTION' ? await runtime.invoke('kiosk_fast_path_execute', { candidateId: decision.actionId }) : null
      console.info(JSON.stringify({ transcript: scenario.transcript, snapshot, decision, execution }))
      if (scenario.expected === 'IGNORE') {
        expect(decision.kind).toBe('IGNORE')
      }
      else {
        expect(decision).toMatchObject({ kind: 'FAST_ACTION', actionId: scenario.expected })
        if (scenario.paymentPhase)
          expect(execution).toMatchObject({ decisionTrace: { authorize: { kind: 'EXECUTE' }, operationPlan: { intent: 'SELECT_PAYMENT' } } })
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
