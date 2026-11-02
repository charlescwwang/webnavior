import { describe, expect, it } from 'vitest'

import { buildConversationContext, buildDecisionMessages, conversationEntries, normalizeTranscript } from './context'

describe('system One conversation context', () => {
  it('retains failed decisions as diagnostics, not completed customer requests', () => {
    expect(conversationEntries([
      { kind: 'asr_transcript', content: '好', metadata: { decisionRoute: 'execution_failed', utteranceId: 1 } },
      { kind: 'asr_transcript', content: '嗯', metadata: { decisionRoute: 'unavailable', utteranceId: 2 } },
      { kind: 'service_event', content: '未完成' },
    ])).toEqual([])
  })
  it('cleans only formatting, retaining short answers, deictics, fillers and dish-name numerals', () => {
    expect(normalizeTranscript(' \u0000三杯雞\n這個\u200B ')).toEqual({ raw: ' \u0000三杯雞\n這個\u200B ', normalized: '三杯雞 這個' })
    for (const text of ['對', '嗯', '蛤？', '一品鍋', '不要那個'])
      expect(normalizeTranscript(text).normalized).toBe(text)
  })
  it('deduplicates an escalation by utterance ID, keeping separate repeated customer requests', () => {
    expect(conversationEntries([
      { kind: 'asr_transcript', content: '有賣什麼', metadata: { decisionRoute: 'fast_path', utteranceId: 1 } },
      { kind: 'tool_result', content: '查詢成功' },
      { kind: 'user_text', content: '有賣什麼', metadata: { utteranceId: 1 } },
      { kind: 'user_text', content: '有賣什麼', metadata: { utteranceId: 2 } },
    ])).toEqual([{ kind: 'user_text', content: '有賣什麼' }, { kind: 'user_text', content: '有賣什麼' }])
  })
  it('retains speakers and completed fast-path turns, excluding old model decisions and tools', () => {
    expect(buildConversationContext([
      { kind: 'asr_transcript', content: '水餃怎麼賣？', metadata: { decisionRoute: 'fast_path' } },
      { kind: 'assistant_text', content: '一份十顆，60 元。' },
      { kind: 'tool_result', content: '{"itemId":"private-id"}' },
      { kind: 'service_event', content: 'ADD_ITEM' },
    ])).toEqual({ messages: [
      { role: 'user', content: '水餃怎麼賣？' },
      { role: 'assistant', content: '一份十顆，60 元。' },
    ] })
  })

  it('bounds long conversations without erasing speaker identity', () => {
    const context = buildConversationContext(Array.from({ length: 100 }, (_, index) => ({ kind: index % 2 ? 'assistant_text' : 'user_text', content: String(index).repeat(200) })))
    expect(context.messages.length).toBeLessThanOrEqual(12)
    expect(context.messages.reduce((sum, message) => sum + message.content.length, 0)).toBeLessThanOrEqual(4_000)
    expect(context.messages.at(-1)).toMatchObject({ role: 'assistant', content: '99'.repeat(200) })
  })
})

// Report: live112 D09, current request was shadowed by preceding dialogue.
it('keeps history data before the exact current user message across Main stages', () => {
  const history = { messages: [{ role: 'user', content: '我還沒說清楚' }] }
  const messages = buildDecisionMessages('依技能釐清需求', history, '我現在要問付款方式')
  expect(messages.map(message => message.role)).toEqual(['system', 'user', 'user'])
  expect(JSON.parse(messages[1]!.content)).toEqual(history)
  expect(messages.at(-1)!.content).toBe('我現在要問付款方式')
})
