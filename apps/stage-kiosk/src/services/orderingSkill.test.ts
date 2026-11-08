import type { CheckoutSnapshot } from '../../../order-menu/src/domain/checkout-flow'
import type { KioskRoutesOptions } from '../../../server/src/routes/kiosk'
import type { FastPathDecision } from './kiosk-fast-path'

import { conversationContextSchema } from '@proj-airi/stage-shared/kiosk-conversation'
import { parse } from 'valibot'
import { expect, it, vi } from 'vitest'

import { beginCheckout, chooseInvoiceMethod, confirmInvoiceDraft, confirmTaxId, requestTaxId, setTaxIdDraft, skipMembership } from '../../../order-menu/src/domain/checkout-flow'
import { menu } from '../../../order-menu/src/domain/order-machine'
import { orderingIncidents } from '../../../order-menu/src/evaluation/orderingIncidents'
import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'
import { mockDB } from '../../../server/src/libs/mock-db'
import { createKioskRoutes } from '../../../server/src/routes/kiosk'
import { createKioskService } from '../../../server/src/services/domain/kiosk'
import { orderingSkill } from '../../../server/src/services/domain/kiosk-conversation-skills'
import { runFastPath } from './kiosk-fast-path'
import { questionReceiptFrom } from './questionPresentation'

import * as schema from '../../../server/src/schemas'

// Report: docs/research/2026-10-26-kiosk-conversation-error-audit.md, Oct31 core-cart.
async function createHarness(choice: 'intent:add-item' | 'intent:search-menu' | 'intent:set-fulfillment:dine-in' | 'intent:set-fulfillment:takeout' | 'intent:start-checkout' | 'intent:defer-question' | 'confirm-meal', weakAnswer = false, route: 'jev' | 'main' | 'uncertain' = 'main') {
  let checkoutState: CheckoutSnapshot | undefined
  let checkoutRevision = 0
  const checkoutStart = vi.fn(() => {
    checkoutRevision++
    checkoutState = beginCheckout('collected')
    return checkoutState
  })
  const payment = vi.fn(async () => {
    throw new Error('Payment is outside checkout-entry tests.')
  })
  const update = (next: CheckoutSnapshot) => {
    checkoutRevision++
    checkoutState = next
    return next
  }
  const runtime = createMenuToolRuntime({ checkout: {
    snapshot: () => checkoutState,
    revision: () => checkoutRevision,
    paymentStatus: () => undefined,
    assertCanRestart: () => {},
    restart: () => {
      checkoutState = undefined
      checkoutRevision++
    },
    cancel: () => {
      checkoutState = undefined
      checkoutRevision++
    },
    start: checkoutStart,
    skipMembership: () => update(skipMembership(checkoutState!)),
    chooseInvoice: method => update(chooseInvoiceMethod(checkoutState!, method)),
    requestTaxId: () => update(requestTaxId(checkoutState!)),
    setTaxId: value => update(setTaxIdDraft(checkoutState!, value)),
    confirmInvoice: () => update(confirmInvoiceDraft(checkoutState!)),
    confirmTaxId: () => update(confirmTaxId(checkoutState!)),
    selectPayment: payment,
  }, menu: [{ ...menu[0]!, id: 'dumplings', name: '水餃', aliases: [], optionGroups: [], price: 80 }, { ...menu[0]!, id: 'fried-pork-chop-bento', name: '炸排骨便當', aliases: ['排骨便當'], optionGroups: [], price: 130 }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
  const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async ({ body }) => {
    const tools = body.tools as Array<{ function: { name: string, parameters: { properties: { choice?: { enum: string[] } } } } }>
    const functionName = tools[0]!.function.name
    const properties = tools[0]!.function.parameters.properties
    const choices = properties.choice?.enum
    // The background-filter-off contract omits recipient and rejects extra fields.
    const recipient = 'recipient' in properties ? { recipient: 'kiosk' } : {}
    if (functionName === 'resolve_service_request' && !choices) {
      const args = route === 'uncertain'
        ? { ...('recipient' in properties ? { recipient: 'uncertain' } : {}), admission: 'uncertain', disposition: 'abstain' }
        : { ...recipient, admission: 'service', disposition: 'assistant' }
      return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: functionName, arguments: JSON.stringify(args) } }] } }] })
    }
    if (!choices)
      throw new Error(`Unexpected fixture schema: ${functionName}`)
    if (tools[0]!.function.name === 'verify_ordering_answer')
      return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'verify_ordering_answer', arguments: '{"choice":"COMPLETE","answerAction":"NO_EXPLICIT_ACTION"}' } }] } }] })
    if (tools[0]!.function.name === 'resolve_service_scope')
      return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_scope', arguments: JSON.stringify({ ...recipient, choice: route === 'uncertain' ? 'UNCERTAIN' : 'ORDER_MUTATION' }) } }] } }] })
    const selected = route === 'uncertain' ? 'UNCERTAIN' : choice === 'confirm-meal' ? choices.find(id => id.endsWith(':yes')) : choices.find(id => id.includes(':quantity:2')) ?? choice
    return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_ordering_intent', arguments: JSON.stringify({ ...recipient, choice: selected }) } }] } }] })
  })
  const systemOne: NonNullable<KioskRoutesOptions['systemOne']> = {
    isEnabled: async () => true,
    maxActionCandidates: async () => 22,
    getPolicy: async () => ({ decisionInstruction: '', defaultDecisionInstruction: '', storeInstruction: '', updatedAt: null }),
    decide: vi.fn<NonNullable<KioskRoutesOptions['systemOne']>['decide']>(async (_state, questions) => ({ answers: Object.fromEntries(Object.keys(questions).map((key) => {
      const choices = Object.keys(questions[key]!.criteria ?? {})
      let selected: string | undefined
      if (key === 'admission')
        selected = 'SERVICE'
      else if (key === 'purpose')
        selected = ['兩份', '內用', '自取', '好', '先不要', '對，一份'].includes(JSON.parse(_state).customerUtterance) ? 'ANSWER' : 'SINGLE'
      else if (key === 'family')
        selected = route === 'jev' && choice === 'intent:add-item' ? 'ITEM' : 'MENU'
      else if (key === 'review')
        selected = 'SATISFIED'
      else if (key === 'operationRequest')
        selected = 'OPERATION'
      else if (key === 'operationCoverage')
        selected = 'SINGLE'
      else if (key === 'operation')
        selected = choices.find(id => id.includes('quantity')) ?? (choice === 'confirm-meal' ? choices.find(id => id.endsWith(':yes')) : choice)
      if (!selected || !choices.includes(selected))
        throw new Error(`Unexpected fixture question: ${key}`)
      return [key, { choice: selected, confidence: route === 'jev' ? 0.99 : key === 'family' ? 0.2025 : weakAnswer && key === 'purpose' && ['兩份', '內用', '自取', '好', '先不要', '對，一份'].includes(JSON.parse(_state).customerUtterance) ? 0.4515 : 0.99 }]
    })) })),
  }
  const app = createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(await mockDB(schema)), llmGateway: { complete }, runtimeModelPolicy: { modelFor: async () => 'synthetic-main' }, systemOne })
  const enrolled = await app.request('/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
  const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
  const decisions: FastPathDecision[] = []
  const sources: string[] = []
  const execute = async (transcript: string) => await runFastPath({ transcript, onTrace: (trace) => {
    if (trace.decisionSource)
      sources.push(trace.decisionSource)
  }, isEnabled: async () => true, decide: async (request) => {
    const response = await app.request('/interaction-decisions', { method: 'POST', headers, body: JSON.stringify(request) })
    expect(response.status).toBe(200)
    const decision = await response.json() as FastPathDecision
    decisions.push(decision)
    return decision
  }, webMcp: { tools: runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'https://menu.test' })), execute: (tool, input) => runtime.invoke(tool.name as Parameters<typeof runtime.invoke>[0], input) } })
  return { runtime, execute, complete, decisions, sources, checkoutStart, payment }
}

// Report: docs/research/2026-10-26-kiosk-conversation-error-audit.md, Oct31 core-cart.
it.each([false, true])('resumes the owned quantity question after Main skill handoff (weak answer=%s)', async (weakAnswer) => {
  const { runtime, execute, complete, decisions, sources } = await createHarness('intent:add-item', weakAnswer)
  const first = await execute('我要水餃')
  expect(first.kind).toBe('FAST_ACTION')
  if (first.kind !== 'FAST_ACTION')
    throw new Error('Expected the browser-owned missing-slot flow')
  const question = questionReceiptFrom(first.result)
  expect(question?.purpose).toBe('item-configuration')
  expect(question?.question).toContain('幾份')
  expect(await runtime.invoke('cart_get', { display: false })).toHaveProperty('cart.itemCount', 0)
  await runtime.invoke('kiosk_dialogue_presented', { questionId: question!.questionId, content: question!.question })
  const second = await execute('兩份')
  expect(second.kind).toBe('FAST_ACTION')
  const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  expect(context.cart.lines).toMatchObject([{ itemId: 'dumplings', quantity: 2 }])
  expect(context.cart.itemCount).toBe(2)
  // One Jev decision and one Main intent call; background admission is off.
  expect(decisions[0]).toMatchObject({ resolvedBy: 'main-skill', modelCalls: 2 })
  expect(decisions[0]).not.toHaveProperty('confidence')
  expect(sources).toContain('main-skill')
  expect(complete).toHaveBeenCalledTimes(weakAnswer ? 3 : 1)
  expect(JSON.stringify(complete.mock.calls[0]![0].body.messages)).toContain(`ordering@${orderingSkill.version}`)
  if (weakAnswer) {
    const messages = complete.mock.calls[1]![0].body.messages as Array<{ role: string, content: string }>
    const facts = JSON.parse(messages.find(message => message.role === 'user')!.content)
    expect(facts.retainedRequests).toMatchObject([{ itemId: 'dumplings', sourceUtterance: '我要水餃', options: [], missing: { quantity: true, optionGroupIds: [] } }])
    expect(facts.retainedRequests[0]).not.toHaveProperty('quantity')
  }
})

// Report: docs/research/2026-10-26-kiosk-conversation-error-audit.md, Oct31 core-cart.
it('uses the same skill handoff for an inquiry without creating a purchase or quantity question', async () => {
  const { runtime, execute, complete } = await createHarness('intent:search-menu')
  const result = await execute('有水餃嗎')
  expect(result.kind).toBe('FAST_ACTION')
  const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  expect(context.cart.itemCount).toBe(0)
  expect(context.waitingFor).toBeUndefined()
  expect(context.presentation?.itemIds).toEqual(['dumplings'])
  expect(complete).toHaveBeenCalledOnce()
})

// Report: user field report, Oct31: fulfillment answer was replaced by recommendations.
it.each(['dine-in', 'takeout'] as const)('sets fulfillment after weak answer without recommending or adding food: %s', async (mode) => {
  const { runtime, execute, complete, decisions } = await createHarness(`intent:set-fulfillment:${mode}`, true)
  const added = await runtime.invoke('order_add_item', { itemId: 'dumplings', quantity: 1 })
  const question = questionReceiptFrom(added)
  expect(question?.purpose).toBe('fulfillment')
  await runtime.invoke('kiosk_dialogue_presented', { content: question!.question, questionId: question!.questionId })
  const result = await execute(mode === 'dine-in' ? orderingIncidents.fulfillment.turns[1].customer : '自取')
  expect(result.kind).toBe('FAST_ACTION')
  expect(decisions[0]).toMatchObject({ actionId: `intent:set-fulfillment:${mode}`, answeredQuestionId: question!.questionId, resolvedBy: 'main-skill' })
  const cart = await runtime.invoke('cart_get')
  expect(cart).toMatchObject({ cart: { fulfillmentMode: mode, itemCount: 1, total: 80 } })
  expect(complete).toHaveBeenCalledTimes(2)
})

// Report: Oct31 checkout-entry invitation -> 好 incorrectly became acknowledgement.
it.each([{ text: orderingIncidents.checkoutAssent.turns[1].customer, choice: 'intent:start-checkout', starts: 1 }, { text: '先不要', choice: 'intent:defer-question', starts: 0 }] as const)('answers checkout invitation without selecting payment: $text', async ({ text, choice, starts }) => {
  const { runtime, execute, decisions, checkoutStart, payment } = await createHarness(choice, true)
  await runtime.invoke('order_add_item', { itemId: 'dumplings', quantity: 1 })
  const receipt = await runtime.invoke('order_set_fulfillment', { mode: 'dine-in' })
  const question = questionReceiptFrom(receipt)
  expect(question?.purpose).toBe('checkout-entry')
  await runtime.invoke('kiosk_dialogue_presented', { content: question!.question, questionId: question!.questionId })
  expect((await execute(text)).kind).toBe('FAST_ACTION')
  expect(decisions[0]).toMatchObject({ actionId: choice, answeredQuestionId: question!.questionId })
  expect(checkoutStart).toHaveBeenCalledTimes(starts)
  expect(payment).not.toHaveBeenCalled()
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 1, total: 80 } })
  expect(parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context')).phase).toBe(starts ? 'checkout_invoice' : 'ordering')
})

// Report: Oct31 field: single dish shown -> 那我要一份 -> recommendation instead of cart addition.
it('orders one portion of the single just-presented dish after an uncertain operation handoff', async () => {
  const { runtime, execute, complete } = await createHarness('intent:add-item')
  const incident = orderingIncidents.omittedName
  const shown = await runtime.invoke('menu_get', { query: '排骨便當' })
  await runtime.invoke('kiosk_dialogue_presented', { content: incident.turns[0].observedReply })
  expect(shown).toMatchObject({ presentation: { itemIds: [incident.expectedCart.itemId] } })
  const result = await execute(incident.turns[1].customer)
  expect(result.kind).toBe('FAST_ACTION')
  expect(complete).toHaveBeenCalledOnce()
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { lines: [{ itemId: incident.expectedCart.itemId, quantity: incident.expectedCart.quantity }], itemCount: 1, total: incident.expectedCart.total } })
})

// Report: docs/research/2026-10-26-kiosk-conversation-error-audit.md, Nov1 exact incident.
it('2026-11-01-meal-confirmation-quantity replays the retained name-confirmation incident through Host and Menu', async () => {
  const incident = orderingIncidents.mealConfirmation
  const { runtime, execute, complete } = await createHarness('confirm-meal', true)
  const lookup = await runtime.invoke('menu_get', { query: '排骨飯' }) as { customerMessage: string }
  // Keep the historical observed reply in the incident corpus; current UI copy
  // now asks a concrete question while preserving the same unconfirmed target.
  expect(lookup).toMatchObject({ matchKind: 'possible', items: [], customerMessage: expect.stringContaining('您想找的是炸排骨便當嗎？') })
  await runtime.invoke('kiosk_dialogue_presented', { content: lookup.customerMessage })
  const context = await runtime.invoke('kiosk_fast_path_context', { transcript: incident.turns[1].customer }) as { clarificationOffer: { id: string } }
  const offer = await runtime.invoke('kiosk_fast_path_clarify', { questionId: context.clarificationOffer.id })
  const question = questionReceiptFrom(offer)!
  expect(question.question).toBe(incident.turns[1].observedReply)
  await runtime.invoke('kiosk_dialogue_presented', { content: question.question, questionId: question.questionId })
  const result = await execute(incident.turns[2].customer)
  expect(result.kind).toBe('FAST_ACTION')
  expect(complete).toHaveBeenCalledTimes(2)
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { lines: [{ itemId: incident.expectedCart.itemId, quantity: incident.expectedCart.quantity }], itemCount: 1, total: incident.expectedCart.total } })
})

it.each(['jev', 'main', 'uncertain'] as const)('keeps the same quantity draft through direct Jev, Main recovery or abstention: %s', async (route) => {
  const { runtime, execute, complete } = await createHarness('intent:add-item', true, route)
  await runtime.invoke('kiosk_fast_path_context', { transcript: '我要水餃' })
  const started = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:add-item' })
  const question = questionReceiptFrom(started)!
  await runtime.invoke('kiosk_dialogue_presented', { questionId: question.questionId, content: question.question })
  const before = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  const result = await execute('兩份')
  const after = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  if (route === 'uncertain') {
    expect(result.kind).toBe('UNAVAILABLE')
    expect(after.cart.itemCount).toBe(0)
    expect(after.retainedRequests).toEqual(before.retainedRequests)
    expect(after.waitingFor?.requestId).toBe(before.retainedRequests[0]!.id)
  }
  else {
    expect(result.kind).toBe('FAST_ACTION')
    expect(after.cart.lines).toMatchObject([{ itemId: 'dumplings', quantity: 2 }])
    expect(after.retainedRequests).toEqual([])
  }
  expect(complete).toHaveBeenCalledTimes(route === 'jev' ? 0 : 2)
})
