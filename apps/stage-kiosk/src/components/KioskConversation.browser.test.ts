import type { ChatHistoryItem } from '@proj-airi/stage-ui/types/chat'

import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { defineComponent, h, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'

import zhHant from '../../../../packages/i18n/src/locales/zh-Hant/stage.yaml'
import KioskAssistantThoughtBubble from './KioskAssistantThoughtBubble.vue'
import KioskConversation from './KioskConversation.vue'
import KioskDecisionInspector from './KioskDecisionInspector.vue'
import KioskVoiceDiagnostics from './KioskVoiceDiagnostics.vue'

import { useKioskStreamingReply } from '../composables/useKioskStreamingReply'
import { interactiveServiceClient } from '../services/interactiveServiceClient'
import { scenarioRegistry } from '../services/scenario-registry'

const props = {
  assistantPresence: { mode: 'listening' as const, description: '請點餐', title: '歡迎' },
  fontSize: 20,
  messages: [],
  sending: false,
  voiceConversationOnly: false,
}

// Report: this chat Nov17 — received audio must be acknowledged before ASR or an earlier action finishes.
it('acknowledges speech only in the thought bubble and keeps the follow-up transcript in the conversation', async () => {
  const count = shallowRef(1)
  const messages = shallowRef<ChatHistoryItem[]>([])
  const screen = render(defineComponent({
    setup: () => () => h('div', [
      h(KioskAssistantThoughtBubble, { recognizing: count.value > 0 }),
      h(KioskConversation, { ...props, recognizingCount: count.value, messages: messages.value, sending: true, requestStatuses: { 2: 'queued' }, voiceConversationOnly: true }),
    ]),
  }), { global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: zhHant } } })] } })
  await expect.element(screen.getByText('已收到語音，正在辨識…', { exact: true })).toBeVisible()
  expect(screen.container.querySelector('.assistant-thought-bubble')?.textContent).toContain('正在辨識')
  expect(screen.container.textContent).not.toContain('請直接對麥克風說話')
  expect(screen.container.querySelector('.conversation-progress')).toBeNull()
  messages.value = [{ role: 'user', id: 'utterance:2:user', content: '再加一份水餃' }]
  count.value = 0
  await expect.element(screen.getByText('再加一份水餃', { exact: true })).toBeVisible()
  expect(screen.container.querySelector('.request-status')).toBeNull()
  await expect.element(screen.getByText('已收到語音，正在辨識…', { exact: true })).not.toBeInTheDocument()
})

it('shows a pending decision only in the avatar bubble during simulated ordering', async () => {
  const message = '正在確認您的意思…'
  const screen = render(defineComponent({
    setup: () => () => h('div', [
      h(KioskAssistantThoughtBubble, { progress: { phase: 'understanding', message } }),
      h(KioskConversation, { ...props, fastPathSimulationStatus: '已收到模擬語句' }),
    ]),
  }), { global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: zhHant } } })] } })
  await expect.element(screen.getByText(message, { exact: true })).toBeVisible()
  expect(document.querySelector('.assistant-activity')).toBeNull()
  expect(document.querySelector('.text-console')?.textContent).not.toContain(message)
})

it('keeps the active tool in the bubble while recognizing a follow-up', async () => {
  const progress = shallowRef<{ phase: 'finding-menu', message: string } | undefined>({ phase: 'finding-menu', message: '正在查菜單' })
  const screen = render(defineComponent({
    setup: () => () => h(KioskAssistantThoughtBubble, { progress: progress.value, recognizing: true }),
  }), { global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: zhHant } } })] } })
  await expect.element(screen.getByRole('status')).toHaveTextContent('正在查菜單')
  progress.value = undefined
  await expect.element(screen.getByRole('status')).toHaveTextContent('已收到語音，正在辨識')
})

// Report: this chat, Nov17 — an unverified cart readback was repeatedly shown as a disconnected menu.
it('distinguishes a connected service with an unconfirmed cart effect from an actual disconnection', async () => {
  const lifetime = new AbortController()
  interactiveServiceClient.activateTransport('https://app.esgpb.com/order/store/1kgJeql/internal_use/menu', () => ({
    signal: lifetime.signal,
    discover: async request => ({ ...request, documentId: 'connected-document', toolsRevision: 1, tools: [{ name: 'browser_cart_get', description: '', inputSchema: { type: 'object' } }] }),
    execute: async () => { throw new Error('No operation is expected') },
    inspect: async () => { throw new Error('No inspection is expected') },
    dispose: reason => lifetime.abort(reason),
  }))
  await interactiveServiceClient.waitUntilReady()
  const screen = render(KioskConversation, {
    props: { ...props, serviceRecoveryBlocked: true },
    global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: zhHant } } })] },
  })
  try {
    const status = screen.container.querySelector<HTMLElement>('.service-status')!
    await expect.element(status).toHaveTextContent('先前餐點操作的結果尚未核對完成')
    await expect.element(status).not.toHaveTextContent('菜單連線中斷')
    expect(screen.getByRole('button', { name: '恢復菜單連線' }).query()).toBeNull()
    interactiveServiceClient.activate()
    await expect.element(status).toHaveTextContent('正在自動重新連線')
  }
  finally {
    screen.unmount()
    interactiveServiceClient.activate()
  }
})

// Report: this chat, 2026-10-21 — Kiosk bypassed the shared chat OpenCC output hook.
it('presents conversation text in Taiwan Traditional without rewriting source messages', async () => {
  const messages: ChatHistoryItem[] = [
    { role: 'user', content: '我要一碗牛肉面' },
    { role: 'assistant', content: '请确认这份订单。', slices: [{ type: 'text', text: '请确认这份订单。' }], tool_results: [] },
    { role: 'error', content: '暂时无法连接，请稍后再试。' },
  ]
  const streaming: ChatHistoryItem = { role: 'assistant', content: '正在查询菜单。', slices: [{ type: 'text', text: '正在查询菜单。' }], tool_results: [] }
  const screen = render(KioskConversation, {
    props: { ...props, messages, streamingAssistantMessage: streaming, voiceConversationOnly: true },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: {} } })] },
  })
  await expect.element(screen.getByText('我要一碗牛肉麵', { exact: true })).toBeVisible()
  await expect.element(screen.getByText('請確認這份訂單。', { exact: true })).toBeVisible()
  await expect.element(screen.getByText('暫時無法連線，請稍後再試。', { exact: true })).toBeVisible()
  await expect.element(screen.getByText('正在查詢菜單。', { exact: true })).toBeVisible()
  expect(messages[0]?.content).toBe('我要一碗牛肉面')
  expect(messages[1]?.content).toBe('请确认这份订单。')
  expect(streaming.content).toBe('正在查询菜单。')
  expect(streaming.slices[0]).toEqual({ type: 'text', text: '正在查询菜单。' })
})

it.each([true, false])('keeps individual notices but omits inline progress in either mode (voice=%s)', async (voiceConversationOnly) => {
  const screen = render(KioskConversation, {
    props: { ...props, voiceConversationOnly, pendingTranscript: '请帮我推荐', recognizingCount: 1, assistantPresence: { mode: 'speaking', title: '我正在說明', description: '想換個選擇時，直接說出來就可以。' } },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: {} } })] },
  })
  await expect.element(screen.getByText('請幫我推薦', { exact: true })).toBeVisible()
  expect(screen.container.querySelector('.assistant-activity')).toBeNull()
  expect(screen.container.querySelector('.assistant-activity-steps')).toBeNull()
})

it('keeps only the simulated ASR input in text mode and forwards its transcript', async () => {
  const onSimulateAsr = vi.fn()
  const screen = render(KioskConversation, {
    props: { ...props, onSimulateAsr, fastPathSimulationStatus: '正在查询菜单' },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: { stage: { message: 'Message' } } } })] },
  })
  expect(document.querySelectorAll('textarea')).toHaveLength(1)
  expect(screen.container.querySelector('[aria-label="送出訊息"]')).toBeNull()
  expect(screen.getByText('正在查詢菜單', { exact: true }).query()).toBeNull()
  await screen.getByRole('textbox').fill('我想吃面，一碗')
  await screen.getByRole('button', { name: '模擬辨識並執行' }).click()
  expect(onSimulateAsr).toHaveBeenCalledOnce()
  expect(onSimulateAsr).toHaveBeenCalledWith('我想吃面，一碗')
})

it('keeps voice-only mode free of text inputs and normalizes its welcome text', async () => {
  const screen = render(KioskConversation, {
    props: { ...props, voiceConversationOnly: true, assistantPresence: { mode: 'listening', title: '欢迎点餐', description: '请确认订单' } },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: {} } })] },
  })
  expect(document.querySelectorAll('textarea')).toHaveLength(0)
  await expect.element(screen.getByText('歡迎點餐', { exact: true })).toBeVisible()
  await expect.element(screen.getByText('請確認訂單', { exact: true })).toBeVisible()
})

it('normalizes diagnostic transcript display while preserving the recognized text', async () => {
  const entry = { id: 1, status: 'recognized' as const, text: '请问牛肉面' }
  const screen = render(KioskVoiceDiagnostics, {
    props: { entries: [entry] },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: {} } })] },
  })
  await expect.element(screen.getByText('「請問牛肉麵」', { exact: true })).toBeVisible()
  expect(entry.text).toBe('请问牛肉面')
})

it('normalizes inspector headings without changing model evidence', async () => {
  const entry = { id: 1, transcript: '我要水饺', source: 'asr' as const, route: 'ignored' as const, startedAt: Date.now(), modelContext: '原始语音：我要水饺' }
  const screen = render(KioskDecisionInspector, { props: { entries: [entry], pendingCount: 0 } })
  await screen.getByRole('button', { name: /決策流程/ }).click()
  await expect.element(screen.getByText('我要水餃', { exact: true })).toBeVisible()
  expect(entry.transcript).toBe('我要水饺')
  expect(screen.container.querySelector('pre')?.textContent).toBe(entry.modelContext)
})

afterEach(() => {
  scenarioRegistry.setServices([])
  interactiveServiceClient.activate(undefined)
})

it('describes missing assistant control without presenting the service as broken', async () => {
  scenarioRegistry.setServices([{
    enabled: true,
    id: 'menu',
    title: 'Menu',
    description: 'Ordering',
    serviceUrl: 'https://menu.example',
  }])
  interactiveServiceClient.activate(new URL('/favicon.ico', location.origin).href, window)
  const screen = render(KioskConversation, {
    props,
    global: { plugins: [createI18n({
      legacy: false,
      locale: 'en',
      messages: { en: { stage: { 'kiosk-agent': {
        'service-connecting': 'Connecting assistant controls. Use the service screen directly.',
        'service-manual': 'Assistant controls unavailable. Use the service screen directly.',
        'service-browser-unsupported': 'This browser does not support assistant controls. Use the service screen directly.',
      } } } },
    })] },
  })
  // No tools are registered on this origin. The bounded
  // connection timeout must both leave direct interaction available.
  await expect.poll(() => interactiveServiceClient.availability.value, { timeout: 7_000 }).toBe('unavailable')
  const message = 'Assistant controls unavailable. Use the service screen directly.'
  await expect.element(screen.getByText(message)).toBeVisible()
  expect(screen.container.querySelector('.service-status')?.textContent).not.toContain('WebMCP')
})

// Report: Nov14 user request; a slow answer must stay below its own customer message.
it('omits request labels and groups a late reply before the interruption', async () => {
  const messages: ChatHistoryItem[] = [
    { role: 'user', id: 'utterance:1:user', content: '先看雞腿飯' },
    { role: 'user', id: 'utterance:2:user', content: '再看湯' },
    { role: 'assistant', id: 'utterance:2:reply:a', content: '目前有蛋花湯。', slices: [], tool_results: [] },
    { role: 'assistant', id: 'utterance:1:reply:a', content: '雞腿飯在這裡。', slices: [], tool_results: [] },
  ]
  const screen = render(KioskConversation, { props: { ...props, messages, voiceConversationOnly: false, requestStatuses: { 1: 'completed', 2: 'processing' } }, global: { plugins: [createI18n({ legacy: false, locale: 'zh-TW', messages: { 'zh-TW': { stage: { kiosk: { 'request-status': { completed: '已完成', processing: '處理中' } } } } } })] } })
  expect(screen.getByText('處理中', { exact: true }).query()).toBeNull()
  await screen.getByRole('button', { name: 'stage.kiosk-agent.previous-conversation' }).click()
  const rows = [...screen.container.querySelectorAll('[data-chat-message-key]')]
  expect(rows.map(row => row.getAttribute('data-chat-message-key'))).toEqual(['utterance:1:user', 'utterance:1:reply:a', 'utterance:2:user', 'utterance:2:reply:a'])
  expect(rows[0].textContent).not.toContain('已完成')
  expect(rows[2].textContent).not.toContain('處理中')
  expect(messages[1].content).toBe('再看湯')
})

it('distinguishes a running microphone from reception-blocked voice input in diagnostics', async () => {
  const labels = { 'mode-customer': '顧客語音點餐', 'microphone-on': '收音管線已啟動', 'reception-reset': '接待重置中，暫停收件', 'blocked': '本段未進入點餐' }
  const screen = render(KioskVoiceDiagnostics, { props: { entries: [{ id: 1, status: 'blocked', reason: 'reception-reset' }], microphone: true, capturing: true, probability: 0.8, blockedReason: 'reception-reset', mode: 'customer' }, global: { plugins: [createI18n({ legacy: false, locale: 'zh-TW', missingWarn: false, messages: { 'zh-TW': { stage: { kiosk: { 'voice-debug': labels } } } } })] } })
  expect(screen.container.textContent).toContain('收音管線已啟動')
  expect(screen.container.textContent).toContain('VAD ● 80%')
  expect(screen.container.textContent).toContain('接待重置中，暫停收件')
  await expect.element(screen.getByText('本段未進入點餐', { exact: true })).toBeVisible()
})

// Report: this chat, 2026-11-14 — correct 虱目魚 input was displayed as 蝨目魚.
it('preserves Taiwanese dish spelling in both customer and assistant bubbles', async () => {
  const screen = render(KioskConversation, { props: { ...props, voiceConversationOnly: true, messages: [
    { role: 'user', content: '我要虱目魚' },
    { role: 'assistant', content: '有虱目魚湯。', slices: [], tool_results: [] },
  ] }, global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: {} })] } })
  await expect.element(screen.getByText('我要虱目魚', { exact: true })).toBeVisible()
  await expect.element(screen.getByText('有虱目魚湯。', { exact: true })).toBeVisible()
})

// Report: this chat, 2026-11-14 — failed labels duplicated an unhelpful tool error.
it('does not add a technical failure badge below a customer request', () => {
  const screen = render(KioskConversation, { props: { ...props, messages: [{ role: 'user', id: 'utterance:1:user', content: '回菜單' }], requestStatuses: { 1: 'failed' } }, global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: {} })] } })
  expect(screen.container.querySelector('.request-status')).toBeNull()
})

// Report: this chat, 2026-11-16 — repaint SSE text before the completed reply.
it('paints incremental replies in history and console, then replaces the draft once', async () => {
  const reply = useKioskStreamingReply()
  const messages = shallowRef<ChatHistoryItem[]>([])
  const sending = shallowRef(true)
  const screen = render(defineComponent({ setup: () => () => h(KioskConversation, {
    ...props,
    sending: sending.value,
    messages: messages.value,
    streamingAssistantMessage: reply.message.value,
  }) }), { global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: {} } })] } })
  reply.begin(1, 'reply-1')
  reply.append(1, '您好，')
  await expect.element(screen.getByText('您好，', { exact: true })).toBeVisible()
  await expect.poll(() => document.querySelector('.console-reply')?.textContent).toBe('您好，')
  reply.append(1, '歡迎點餐。')
  await expect.poll(() => document.querySelector('.console-reply')?.textContent).toBe('您好，歡迎點餐。')
  expect(messages.value).toEqual([])
  messages.value = [{ role: 'assistant', id: 'reply-1', content: '您好，歡迎點餐。', slices: [], tool_results: [] }]
  reply.clear()
  sending.value = false
  await expect.poll(() => screen.container.textContent?.split('您好，歡迎點餐。').length).toBe(2)
  await expect.poll(() => document.querySelector('.console-reply')?.textContent).toBe('您好，歡迎點餐。')
  // A new request (including JSON mode) has progress, not the old reply.
  sending.value = true
  await expect.poll(() => document.querySelector('.console-reply')).toBeNull()
  reply.append(1, '過期文字')
  await expect.poll(() => screen.container.textContent?.includes('過期文字')).toBe(false)
  screen.unmount()
})

// Report: this chat, Nov17 — voice mode opened the text console on startup.
it('shows the text console only in text mode and removes it when returning to voice', async () => {
  const voice = shallowRef(true)
  const host = defineComponent({ setup: () => () => h(KioskConversation, { ...props, voiceConversationOnly: voice.value }) })
  const view = render(host, { global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: {} } })] } })
  try {
    expect(document.querySelector('.text-console')).toBeNull()
    voice.value = false
    await expect.poll(() => document.querySelector('.text-console')).not.toBeNull()
    voice.value = true
    await expect.poll(() => document.querySelector('.text-console')).toBeNull()
  }
  finally { view.unmount() }
})

// Report: this chat, Nov19 — long continuous history crowds a 28px conversation panel.
it('shows the current turn by default and allows earlier conversation to be expanded', async () => {
  const messages: ChatHistoryItem[] = [
    { role: 'user', content: '先看看菜單' },
    { role: 'assistant', content: '想吃什麼？', slices: [], tool_results: [] },
    { role: 'user', content: '我要水餃十顆兩份' },
    { role: 'assistant', content: '已加入十顆水餃兩份。', slices: [], tool_results: [] },
  ]
  const screen = render(KioskConversation, { props: { ...props, fontSize: 28, messages }, global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: zhHant } } })] } })
  await expect.element(screen.getByText('我要水餃十顆兩份', { exact: true })).toBeVisible()
  expect(screen.container.textContent).not.toContain('先看看菜單')
  await screen.getByRole('button', { name: '查看先前對話' }).click()
  await expect.element(screen.getByText('先看看菜單', { exact: true })).toBeVisible()
  await screen.getByRole('button', { name: '只看本次對話' }).click()
  expect(screen.container.textContent).not.toContain('先看看菜單')
  expect(messages).toHaveLength(4)
})

// Report: this chat, Nov19 — keep the previous answer above this question and reply, with full history intact.
it('keeps previous reply context above the current question and response at the configured font size', async () => {
  const messages: ChatHistoryItem[] = [
    { role: 'user', content: '有哪些套餐' },
    { role: 'assistant', content: '有A套餐和B套餐。', slices: [], tool_results: [] },
    { role: 'user', content: '那我要炸的' },
    { role: 'assistant', content: '有炸雞腿便當、炸排骨便當。', slices: [], tool_results: [] },
  ]
  const screen = render(KioskConversation, { props: { ...props, fontSize: 28, messages, voiceConversationOnly: true }, global: { plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': { stage: zhHant } } })] } })
  await page.viewport(1280, 480)
  const panel = screen.container.querySelector<HTMLElement>('.kiosk-conversation')!
  panel.style.width = '1100px'
  panel.style.height = '280px'
  panel.style.background = '#1a2922'
  await expect.element(screen.getByText('有A套餐和B套餐。', { exact: true })).toBeVisible()
  const previous = screen.container.querySelector<HTMLElement>('.previous-reply')!
  const history = screen.container.querySelector<HTMLElement>('[data-chat-message-role="user"]')!
  expect(previous.getBoundingClientRect().top).toBeLessThan(history.getBoundingClientRect().top)
  expect(getComputedStyle(previous.querySelector('p')!).fontSize).toBe('22.4px')
  expect(screen.container.textContent).not.toContain('有哪些套餐')
  const latest = screen.container.querySelector<HTMLElement>('[data-chat-message-role="assistant"] [data-chat-message-bubble]')!
  const viewport = screen.container.querySelector<HTMLElement>('.current-message-list')!
  await expect.poll(() => latest.querySelector('.markdown-content p') !== null).toBe(true)
  await expect.poll(() => latest.getBoundingClientRect().bottom <= viewport.getBoundingClientRect().bottom + 1).toBe(true)
  expect(viewport.getBoundingClientRect().bottom).toBeLessThanOrEqual(screen.container.querySelector<HTMLElement>('.message-history')!.getBoundingClientRect().bottom + 1)
  await page.screenshot({ path: '__screenshots__/kiosk-conversation-context.png' })
  await screen.getByRole('button', { name: '上一則回覆（展開／收合）' }).click()
  expect(previous.classList.contains('is-expanded')).toBe(true)
  expect(messages).toHaveLength(4)
})
