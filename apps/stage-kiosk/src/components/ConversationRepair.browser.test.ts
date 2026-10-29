import type { ChatHistoryItem } from '@proj-airi/stage-ui/types/chat'

import type { ConversationRetry } from '../services/kioskConversationRetry'

import { conversationContextSchema, serviceContextKey } from '@proj-airi/stage-shared/kiosk-conversation'
import { parse } from 'valibot'
import { expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'

import stageMessages from '../../../../packages/i18n/src/locales/zh-Hant/stage.yaml'
import KioskConversation from './KioskConversation.vue'

import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'
import { decideInteraction } from '../../../server/src/services/domain/kiosk-interaction-decision'
import { recoverServiceRequest } from '../../../server/src/services/domain/kiosk-interaction-decision/serviceRecovery'
import { createChoiceRequest, readChoice } from '../../../server/src/services/domain/kiosk-system-one/slm'
import { conversationDecisionStateFrom, runFastPath, shouldShowDecisionRetry } from '../services/kiosk-fast-path'
import { resumeConversationRetry } from '../services/kioskConversationRetry'
import { createKioskUtteranceQueue } from '../services/kioskUtteranceQueue'
import { createMenuReplyWindow, operationReplyFrom, replyFromConversation } from '../services/questionPresentation'

it('executes a strict SLM label through staged routing and the real Menu cart without a retry', async () => {
  const cartCount = shallowRef(0)
  const runtime = createMenuToolRuntime({ menu: [{ id: 'dumplings', name: '水餃', category: '點心', description: '', imageUrl: '', price: 80, recommendationTags: [], optionGroups: [] }], onAction: () => {}, onMenuSelection: () => {}, onCartChange: cart => cartCount.value = cart.itemCount })
  const script: Record<string, string> = { admission: 'SERVICE', purpose: 'SINGLE', family: 'ITEM', operation: 'intent:add-item', operationRequest: 'OPERATION', operationCoverage: 'SINGLE' }
  const results: unknown[] = []
  const result = await runFastPath({
    transcript: '水餃一份',
    isEnabled: async () => true,
    decide: async request => decideInteraction({ ...request, routing: 'staged', policy: { decisionInstruction: '', storeInstruction: '' }, invoke: async (state, questions) => {
      const key = Object.keys(questions)[0]!
      const request = createChoiceRequest('test-local', state, questions[key]!)
      const letter = request.labels[request.ids.indexOf(script[key]!)]!
      const choice = readChoice({ choices: [{ finish_reason: 'length', message: { content: letter } }] }, request)
      return { selectionMode: 'unscored', answers: { [key]: { choice } } }
    } }),
    webMcp: {
      tools: runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'https://menu.test' })),
      execute: async (tool, input) => {
        const issued = runtime.toolDefinitions.find(candidate => candidate.name === tool.name)
        if (!issued)
          throw new Error('The requested Menu tool was not issued by this runtime.')
        return runtime.invoke(issued.name, input)
      },
    },
    onExecuted: async (result) => { results.push(result) },
  })
  expect(result.kind).toBe('FAST_ACTION')
  expect(cartCount.value).toBe(1)
  expect(results).toHaveLength(1)
  expect(shouldShowDecisionRetry(result)).toBe(false)
  const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  expect(context.cart?.lines[0]?.name).toBe('水餃')
})

// Report: docs/research/2026-10-26-kiosk-conversation-error-audit.md, Oct29 unverified reply.
it('shows an owned character clarification without a retry button after unsupported no-tool prose', async () => {
  const runtime = createMenuToolRuntime({ menu: [{ id: 'bento', name: '招牌便當', category: '便當', description: '', imageUrl: '', price: 100, recommendationTags: [], optionGroups: [] }], onAction: () => {}, onMenuSelection: () => {}, onCartChange: () => {} })
  await runtime.invoke('order_add_item', { itemId: 'bento', quantity: 1 })
  const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
  const presented = replyFromConversation({ status: 'completed', agentMode: 'active', requestedTools: [], answer: '已經把便當移除了。' }, { context, menu: createMenuReplyWindow(), handoff: { intent: 'REMOVE_ITEM' }, failureMessage: '再試一次。' })
  const messages: ChatHistoryItem[] = presented.role === 'assistant' ? [{ role: 'assistant', content: presented.content, slices: [], tool_results: [] }] : [{ role: 'error', content: presented.content }]
  const screen = render(KioskConversation, { props: { assistantPresence: { mode: 'listening', title: '點餐', description: '請點餐' }, fontSize: 20, messages, sending: false, voiceConversationOnly: false, retryAvailable: presented.role === 'error' }, global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: stageMessages } } })] } })
  await expect.element(screen.getByText('剛才沒有理解清楚，請再說一次您想詢問或調整的內容。')).toBeVisible()
  await expect.element(screen.getByRole('button', { name: '再試一次' })).not.toBeInTheDocument()
  await expect.element(screen.getByText('已經把便當移除了。')).not.toBeInTheDocument()
  expect(parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context')).cart).toEqual(context.cart)
})

// Report: docs/research/2026-10-26-kiosk-conversation-error-audit.md, Oct28 retry -> fruit.
it('clicks retry through production admission and clarification, then accepts the next clear order', async () => {
  const cartCount = shallowRef(0)
  const runtime = createMenuToolRuntime({ menu: [{ id: 'dumplings', name: '水餃', category: '點心', description: '', imageUrl: '', price: 80, recommendationTags: [], optionGroups: [] }], onMenuScroll: () => {
    throw new Error('Unclear speech must not scroll.')
  }, onAction: () => {}, onMenuSelection: () => {}, onCartChange: cart => cartCount.value = cart.itemCount })
  await runtime.invokeForAgent('menu_get', { query: '水果', display: true })
  const snapshot = conversationDecisionStateFrom(await runtime.invoke('kiosk_interaction_state'))!
  const retry: ConversationRetry = { state: 'available', text: '是 是 帶刀刀', sessionId: 'visitor', iframeRevision: 1, requestId: 1, originalUtteranceId: 1, contextKey: serviceContextKey(snapshot) }
  const messages = shallowRef<ChatHistoryItem[]>([])
  const available = shallowRef(true)
  const tools = runtime.toolDefinitions.map(tool => ({ ...tool, origin: 'https://menu.test' }))
  const requested: string[] = []
  const observed: string[] = []
  const failures: unknown[] = []
  const queue = createKioskUtteranceQueue({ onError: (_utterance, error) => failures.push(error), process: async (utterance) => {
    observed.push(utterance.text)
    const ambiguous = utterance.text === retry.text
    const result = await runFastPath({ transcript: utterance.text, isEnabled: async () => true, webMcp: { tools, execute: (tool, input) => {
      requested.push(tool.name)
      return runtime.invoke(runtime.toolDefinitions.find(definition => definition.name === tool.name)!.name, input)
    } }, decide: async (request) => {
      const decision = await decideInteraction({ ...request, policy: { decisionInstruction: '', storeInstruction: '' }, invoke: async (_state, questions) => ({ answers: ambiguous
        ? { ...(questions.route ? { route: { choice: 'intent:scroll-menu:up', confidence: 0.5777 } } : {}), ...(questions.destination ? { destination: { choice: 'OTHER', confidence: 0.2081 } } : {}), ...(questions.serviceRequest ? { serviceRequest: { choice: 'REQUEST', confidence: 0.3556 } } : {}) }
        : { ...(questions.route ? { route: { choice: 'intent:add-item', confidence: 0.99 } } : {}), ...(questions.requestPurpose ? { requestPurpose: { choice: 'OPERATION', confidence: 0.99 } } : {}), ...(questions.cartRequest ? { cartRequest: { choice: 'SINGLE', confidence: 0.99 } } : {}) } }) })
      if (!ambiguous)
        return decision
      return await recoverServiceRequest(decision, { transcript: utterance.text, state: request.decisionState, complete: async (body) => {
        const review = JSON.stringify(body).includes('前一輪有限選項仍不確定')
        return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_service_request', arguments: JSON.stringify(review ? { admission: 'service', disposition: 'clarify', question: '剛才沒有理解清楚，請再說一次您的需求。' } : { choice: 'REQUEST' }) } }] } }] })
      } })
    } })
    if (ambiguous) {
      expect(result.kind).toBe('SERVICE_CLARIFICATION')
      if (result.kind === 'SERVICE_CLARIFICATION')
        messages.value = [{ role: 'assistant', content: result.question.question, slices: [], tool_results: [] }]
    }
    else {
      expect(result.kind).toBe('FAST_ACTION')
      messages.value = [...messages.value, { role: 'assistant', content: result.kind === 'FAST_ACTION' ? operationReplyFrom(result.result)! : '', slices: [], tool_results: [] }]
    }
  } })
  const screen = render(defineComponent({ setup: () => () => h('section', [h('output', { 'aria-label': '購物車份數' }, String(cartCount.value)), h(KioskConversation, {
    assistantPresence: { mode: 'listening', title: '點餐', description: '請點餐' },
    fontSize: 20,
    messages: messages.value,
    sending: false,
    voiceConversationOnly: false,
    retryAvailable: available.value,
    onRetryMessage: async () => {
      available.value = false
      await resumeConversationRetry(retry, { current: async () => ({ sessionId: 'visitor', iframeRevision: 1, contextKey: serviceContextKey(conversationDecisionStateFrom(await runtime.invoke('kiosk_interaction_state'))!) }), enqueue: text => queue.submit({ source: 'simulation', text }), record: async () => {} })
    },
  })]) }), { global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: stageMessages } } })] } })
  await screen.getByRole('button', { name: '再試一次' }).click()
  await expect.poll(() => messages.value.length + failures.length).toBe(1)
  expect(failures).toEqual([])
  await expect.element(screen.getByText('剛才沒有理解清楚，請再說一次您的需求。')).toBeVisible()
  expect(observed).toEqual(['是 是 帶刀刀'])
  expect(requested).not.toContain('menu_recommend')
  expect(requested).not.toContain('menu_get')
  expect(messages.value[0]!.content).not.toContain('符合條件')
  expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  queue.submit({ source: 'simulation', text: '我要水餃一份' })
  await expect.poll(async () => (await runtime.invoke('cart_get', { display: false }) as { cart: { itemCount: number } }).cart.itemCount).toBe(1)
  await expect.element(screen.getByLabelText('購物車份數')).toHaveTextContent('1')
  await expect.element(screen.getByText(/已將水餃加入購物車/)).toBeVisible()
  queue.reset()
})
