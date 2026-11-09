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
  await expect.element(screen.getByText('我要一碗牛肉面', { exact: true })).toBeVisible()
  await expect.element(screen.getByText('請確認這份訂單。', { exact: true })).toBeVisible()
  await expect.element(screen.getByText('暫時無法連線，請稍後再試。', { exact: true })).toBeVisible()
  await expect.element(screen.getByText('正在查詢菜單。', { exact: true })).toBeVisible()
  expect(messages[0]?.content).toBe('我要一碗牛肉面')
  expect(messages[1]?.content).toBe('请确认这份订单。')
  expect(streaming.content).toBe('正在查询菜单。')
  expect(streaming.slices[0]).toEqual({ type: 'text', text: '正在查询菜单。' })
})

it('preserves pending input while presenting progress text in Traditional Chinese', async () => {
  const screen = render(KioskConversation, {
    props: { ...props, voiceConversationOnly: true, pendingTranscript: '请帮我推荐', activityStatus: '正在查询菜单', activitySteps: [{ label: '确认订单', state: 'executing', toolName: 'menu_get' }] },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: {} } })] },
  })
  await expect.element(screen.getByText('请帮我推荐', { exact: true })).toBeVisible()
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

it('preserves diagnostic transcript display as recognized', async () => {
  const entry = { id: 1, status: 'recognized' as const, text: '请问牛肉面' }
  const screen = render(KioskVoiceDiagnostics, {
    props: { entries: [entry] },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: {} } })] },
  })
  await expect.element(screen.getByText('「请问牛肉面」', { exact: true })).toBeVisible()
  expect(entry.text).toBe('请问牛肉面')
})

it('normalizes inspector headings without changing model evidence', async () => {
  const entry = { id: 1, transcript: '我要水饺', source: 'asr' as const, route: 'ignored' as const, startedAt: Date.now(), modelContext: '原始语音：我要水饺' }
  const screen = render(KioskDecisionInspector, { props: { entries: [entry], pendingCount: 0 } })
  await screen.getByRole('button', { name: /決策流程/ }).click()
  await expect.element(screen.getByText('我要水饺', { exact: true })).toBeVisible()
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

// Report: this chat,Nov5 — source text stays intact while assistant display omits NT/$.
it('normalizes prices in final and streaming assistant content without changing original evidence', async () => {
  const messages: ChatHistoryItem[] = [
    { role: 'user', content: '預算NT$100' },
    { role: 'assistant', content: '便當 NT$80。', slices: [{ type: 'text', text: '便當 NT$80。' }], tool_results: [] },
  ]
  const screen = render(KioskConversation, {
    props: { ...props, messages, voiceConversationOnly: true },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: {} } })] },
  })
  await expect.element(screen.getByText('便當 80元。', { exact: true })).toBeVisible()
  await expect.element(screen.getByText('預算NT$100', { exact: true })).toBeVisible()
  expect(messages[0].content).toBe('預算NT$100')
  expect(messages[1].content).toBe('便當 NT$80。')
})

it.each([true, false])('shows ASR text inside chat before semantic processing, voiceOnly=%s', async (voiceConversationOnly) => {
  const messages: ChatHistoryItem[] = []
  const screen = render(KioskConversation, {
    props: { ...props, messages, voiceConversationOnly, recognizedTranscripts: [{ id: 11, text: '水餃兩份', waiting: true }] },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: {} } })] },
  })
  try {
    await expect.element(screen.getByText('水餃兩份', { exact: true })).toBeVisible()
    expect(screen.container.querySelector('.message-history')?.textContent).toContain('水餃兩份')
    await expect.element(screen.getByText('stage.kiosk.service-recovery.queued', { exact: true })).toBeVisible()
    await screen.rerender({ recognizedTranscripts: [], messages: [{ role: 'user', content: '水餃兩份' }] })
    await expect.element(screen.getByText('水餃兩份', { exact: true })).toBeVisible()
    expect(screen.container.textContent?.split('水餃兩份')).toHaveLength(2)
    expect(messages).toHaveLength(0)
  }
  finally { screen.unmount() }
})

// Report: this chat, Nov09 — user-authored input must be displayed as entered.
it('preserves the original user spelling and price notation in conversation', async () => {
  const messages: ChatHistoryItem[] = [{ role: 'user', content: '虱目魚 $130 单价' }]
  const screen = render(KioskConversation, { props: { ...props, messages }, global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: {} } })] } })
  await expect.element(screen.getByText('虱目魚 $130 单价', { exact: true })).toBeVisible()
  expect(messages[0]!.content).toBe('虱目魚 $130 单价')
})

// Report: this chat Nov09 — a successful ASR receipt must remain visible even if presence later closes admission.
it('keeps recognized text visible when later voice admission blocks processing', async () => {
  const screen = render(KioskConversation, { props: { ...props, voiceConversationOnly: true, recognizedTranscripts: [{ id: 12, text: '牛肉麵兩份', blocked: true }] }, global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: {} } })] } })
  await expect.element(screen.getByText('牛肉麵兩份', { exact: true })).toBeVisible()
  expect(screen.container.querySelector('.message-history')?.textContent).toContain('牛肉麵兩份')
  await expect.element(screen.getByText('stage.kiosk-agent.voice-presence-lost', { exact: true })).toBeVisible()
  screen.unmount()
})
