import { expect, it } from 'vitest'

import { useKioskStreamingReply } from './useKioskStreamingReply'

// Report: this chat, 2026-11-16 — SSE arrived but Scene never displayed deltas.
it('shows each delta before completion, without creating a durable history entry', () => {
  const reply = useKioskStreamingReply()
  reply.begin(1, 'utterance:1:reply')
  expect(reply.message.value).toBeUndefined()
  reply.append(1, '您好，')
  expect(reply.message.value?.content).toBe('您好，')
  reply.append(1, '請問需要什麼協助？')
  expect(reply.message.value?.content).toBe('您好，請問需要什麼協助？')
  expect(reply.message.value?.id).toBe('utterance:1:reply')
  expect(reply.message.value?.role === 'assistant' && reply.message.value.slices).toEqual([{ type: 'text', text: '您好，請問需要什麼協助？' }])
})

it('clears a retired draft and ignores late deltas', () => {
  const reply = useKioskStreamingReply()
  reply.begin(1, 'first')
  reply.append(1, '您好')
  reply.clear()
  reply.append(1, '過期文字')
  expect(reply.message.value).toBeUndefined()
})

it('isolates a replacement turn and starts a continuation with an empty draft', () => {
  const reply = useKioskStreamingReply()
  reply.begin(1, 'first')
  reply.append(1, '舊回覆')
  reply.begin(2, 'second')
  reply.append(1, '過期文字')
  expect(reply.message.value).toBeUndefined()
  reply.append(2, '新回覆')
  reply.clear(1)
  expect(reply.message.value?.content).toBe('新回覆')
  reply.begin(2, 'second')
  expect(reply.message.value).toBeUndefined()
})
