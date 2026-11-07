import type { ChatHistoryItem } from '@proj-airi/stage-ui/types/chat'

import { afterEach, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, effectScope, h, shallowRef } from 'vue'

import { createKioskUtteranceQueue } from '../services/kioskUtteranceQueue'
import { useKioskServiceFault } from './useKioskServiceFault'

afterEach(() => sessionStorage.removeItem('kiosk/service-fault'))

// Report: this chat, 2026-11-06 — purple technical errors were visual-only and allowed continued use.
it('latches a technical error, retains the cart, survives remount and requires explicit recovery', async () => {
  sessionStorage.removeItem('kiosk/service-fault')
  const messages = shallowRef<ChatHistoryItem[]>([])
  const cart = shallowRef(['蝦捲'])
  let fault: ReturnType<typeof useKioskServiceFault> | undefined
  const Harness = defineComponent({ setup() {
    fault = useKioskServiceFault(messages)
    return () => h('div', [h('output', fault!.locked.value ? 'Locked' : 'Ready'), h('p', cart.value.join('、'))])
  } })
  const first = render(Harness)
  messages.value = [{ role: 'error', content: 'Unverified provider response' }]
  await expect.element(first.getByText('Locked')).toBeVisible()
  messages.value = [{ role: 'assistant', content: 'Normal reply', slices: [], tool_results: [] }]
  expect(fault!.locked.value).toBe(true)
  await expect.element(first.getByText('蝦捲')).toBeVisible()
  first.unmount()
  const second = render(Harness)
  try {
    await expect.element(second.getByText('Locked')).toBeVisible()
    fault!.clear()
    await expect.element(second.getByText('Ready')).toBeVisible()
    expect(cart.value).toEqual(['蝦捲'])
    messages.value = [...messages.value, { role: 'error', content: 'Another failure' }]
    await expect.element(second.getByText('Locked')).toBeVisible()
  }
  finally { second.unmount() }
})

// Report: this chat, 2026-11-06; failed review before admission discarded the recognized sentence.
it('retains failed pre-admission speech and latches the staff notification without duplicating admitted input', () => {
  const messages = shallowRef<ChatHistoryItem[]>([])
  const scope = effectScope()
  const fault = scope.run(() => useKioskServiceFault(messages))!
  const failure = { kind: 'UNAVAILABLE' as const, reason: 'UNCERTAIN_OPERATION' as const, recovery: { status: 'failed' as const, failure: 'invalid' as const } }
  expect(fault.failDecision(failure, { transcript: '你有買一送一嗎？', message: '處理異常', shownInput: false })).toBe(true)
  expect(messages.value[0]).toMatchObject({ role: 'user', content: '你有買一送一嗎？' })
  expect(messages.value[1]).toMatchObject({ role: 'error', content: '處理異常' })
  expect(fault.locked.value).toBe(true)
  fault.clear()
  expect(fault.failDecision({ kind: 'IGNORE' }, { transcript: '背景對話', message: '處理異常', shownInput: false })).toBe(false)
  expect(messages.value).toHaveLength(2)
  expect(fault.locked.value).toBe(false)
  expect(fault.failDecision(failure, { transcript: '你有買一送一嗎？', message: '處理異常', shownInput: true })).toBe(true)
  expect(messages.value.filter(message => message.role === 'user')).toHaveLength(1)
  expect(fault.locked.value).toBe(true)
  scope.stop()
})

// Report: this chat, 2026-11-07; processing can end without any visible reply.
it('makes a thrown utterance failure visible, retains speech and latches assistance', async () => {
  const messages = shallowRef<ChatHistoryItem[]>([])
  const scope = effectScope()
  const fault = scope.run(() => useKioskServiceFault(messages))!
  const Harness = defineComponent({ setup: () => () => h('div', messages.value.map(message => h('p', typeof message.content === 'string' ? message.content : ''))) })
  const view = render(Harness)
  try {
    const queue = createKioskUtteranceQueue({
      process: async () => {
        throw new Error('Controlled processing failure')
      },
      onError: utterance => fault.failUtterance({ transcript: utterance.text, shownInput: false, message: '處理中斷，請確認購物車後由服務人員協助。' }),
    })
    queue.submit({ source: 'asr', text: '我們想到用這個方法去處理' })
    await queue.idle()
    await expect.element(view.getByText('我們想到用這個方法去處理')).toBeVisible()
    await expect.element(view.getByText('處理中斷，請確認購物車後由服務人員協助。')).toBeVisible()
    expect(fault.locked.value).toBe(true)
    fault.clear()
    messages.value = [{ role: 'user', content: '你有賣什麼東西' }]
    fault.failUtterance({ transcript: '你有賣什麼東西', shownInput: true, message: '處理中斷' })
    expect(messages.value.filter(message => message.role === 'user')).toHaveLength(1)
    expect(fault.locked.value).toBe(true)
  }
  finally {
    view.unmount()
    scope.stop()
  }
})
