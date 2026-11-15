import type { ChatHistoryItem } from '@proj-airi/stage-ui/types/chat'

import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import KioskConversation from './KioskConversation.vue'
import KioskDecisionInspector from './KioskDecisionInspector.vue'
import KioskVoiceDiagnostics from './KioskVoiceDiagnostics.vue'

import { interactiveServiceClient } from '../services/interactiveServiceClient'
import { scenarioRegistry } from '../services/scenario-registry'

const props = {
  assistantPresence: { mode: 'listening' as const, description: '請點餐', title: '歡迎' },
  fontSize: 20,
  messages: [],
  sending: false,
  voiceConversationOnly: false,
}

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

it('presents pending recognition and processing text in Traditional Chinese', async () => {
  const screen = render(KioskConversation, {
    props: { ...props, voiceConversationOnly: true, pendingTranscript: '请帮我推荐', activityStatus: '正在查询菜单', activitySteps: [{ label: '确认订单', state: 'executing', toolName: 'menu_get' }] },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: {} } })] },
  })
  await expect.element(screen.getByText('請幫我推薦', { exact: true })).toBeVisible()
  await expect.element(screen.getByText('正在查詢菜單', { exact: true })).toBeVisible()
  await expect.element(screen.getByText('確認訂單', { exact: true })).toBeVisible()
})

it('keeps only the simulated ASR input in text mode and forwards its transcript', async () => {
  const onSimulateAsr = vi.fn()
  const screen = render(KioskConversation, {
    props: { ...props, onSimulateAsr, fastPathSimulationStatus: '正在查询菜单' },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: { stage: { message: 'Message' } } } })] },
  })
  expect(document.querySelectorAll('textarea')).toHaveLength(1)
  expect(screen.container.querySelector('[aria-label="送出訊息"]')).toBeNull()
  await expect.element(screen.getByText('正在查詢菜單', { exact: true })).toBeVisible()
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
it('shows request status in the conversation and groups a late reply before the interruption', async () => {
  const messages: ChatHistoryItem[] = [
    { role: 'user', id: 'utterance:1:user', content: '先看雞腿飯' },
    { role: 'user', id: 'utterance:2:user', content: '再看湯' },
    { role: 'assistant', id: 'utterance:2:reply:a', content: '目前有蛋花湯。', slices: [], tool_results: [] },
    { role: 'assistant', id: 'utterance:1:reply:a', content: '雞腿飯在這裡。', slices: [], tool_results: [] },
  ]
  const screen = render(KioskConversation, { props: { ...props, messages, voiceConversationOnly: true, requestStatuses: { 1: 'completed', 2: 'processing' } }, global: { plugins: [createI18n({ legacy: false, locale: 'zh-TW', messages: { 'zh-TW': { stage: { kiosk: { 'request-status': { completed: '已完成', processing: '處理中' } } } } } })] } })
  await expect.element(screen.getByText('處理中', { exact: true })).toBeVisible()
  const rows = [...screen.container.querySelectorAll('[data-chat-message-key]')]
  expect(rows.map(row => row.getAttribute('data-chat-message-key'))).toEqual(['utterance:1:user', 'utterance:1:reply:a', 'utterance:2:user', 'utterance:2:reply:a'])
  expect(rows[0].textContent).toContain('已完成')
  expect(rows[2].textContent).toContain('處理中')
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
