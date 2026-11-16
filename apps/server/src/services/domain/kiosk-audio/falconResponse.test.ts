import { expect, it, vi } from 'vitest'

import { readFalconTranscript } from './falconResponse'

function streamResponse(events: string) {
  const bytes = new TextEncoder().encode(events)
  let offset = 0
  return new Response(new ReadableStream({
    pull(controller) {
      if (offset === bytes.length) {
        controller.close()
        return
      }
      controller.enqueue(bytes.slice(offset, ++offset))
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } })
}

it('reads the deployed service transcription JSON only when explicitly configured', async () => {
  expect(await readFalconTranscript(Response.json({ text: '我要水餃', model: 'kitchen-asr-v0.4', sampleRate: 16000 }), { responseFormat: 'transcription-json' })).toBe('我要水餃')
  expect(await readFalconTranscript(Response.json({ text: '' }), { responseFormat: 'transcription-json' })).toBe('')
  await expect(readFalconTranscript(Response.json({ model: 'missing-text' }), { responseFormat: 'transcription-json' })).rejects.toThrow()
  await expect(readFalconTranscript(Response.json({ text: 'wrong-format' }))).rejects.toThrow()
})

it('reads one completed JSON transcription without accepting tool calls', async () => {
  expect(await readFalconTranscript(Response.json({ choices: [{ index: 0, message: { content: '我要水餃' }, finish_reason: 'stop' }] }))).toBe('我要水餃')
  await expect(readFalconTranscript(Response.json({ choices: [{ message: { content: '半句' }, finish_reason: 'length' }] }))).rejects.toThrow()
  await expect(readFalconTranscript(Response.json({ choices: [{ message: { content: '文字', tool_calls: [{}] }, finish_reason: 'stop' }] }))).rejects.toThrow()
})

it('decodes UTF-8 deltas across byte boundaries and requires stop plus DONE', async () => {
  const preview = vi.fn()
  const response = streamResponse(': keepalive\r\n\r\ndata: {"choices":[{"index":0,"delta":{"content":"我要"},"finish_reason":null}]}\r\n\r\ndata: {"choices":[{"index":0,"delta":{"content":"水餃"},"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]\r\n\r\n')
  expect(await readFalconTranscript(response, { onDelta: preview })).toBe('我要水餃')
  expect(preview.mock.calls).toEqual([['我要'], ['水餃']])
})

it('rejects interrupted, truncated and failed streams instead of returning a partial command', async () => {
  const partial = 'data: {"choices":[{"index":0,"delta":{"content":"取消訂單"},"finish_reason":null}]}\n\n'
  await expect(readFalconTranscript(streamResponse(partial))).rejects.toThrow()
  await expect(readFalconTranscript(streamResponse(`${partial}data: [DONE]\n\n`))).rejects.toThrow()
  await expect(readFalconTranscript(streamResponse(`${partial}data: {"error":{"message":"failed"}}\n\n`))).rejects.toThrow()
  await expect(readFalconTranscript(streamResponse('data: {"choices":[{"delta":{"content":"半句"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n'))).rejects.toThrow()
})

it('rejects audio, non-2xx responses, multiple choices and oversized text', async () => {
  await expect(readFalconTranscript(new Response('wav', { headers: { 'Content-Type': 'audio/wav' } }))).rejects.toThrow()
  await expect(readFalconTranscript(Response.json({ error: 'failed' }, { status: 503 }))).rejects.toThrow()
  await expect(readFalconTranscript(Response.json({ choices: [{ message: { content: 'A' }, finish_reason: 'stop' }, { message: { content: 'B' }, finish_reason: 'stop' }] }))).rejects.toThrow()
  await expect(readFalconTranscript(Response.json({ choices: [{ message: { content: 'x'.repeat(40000) }, finish_reason: 'stop' }] }))).rejects.toThrow()
})

it('cancels a waiting body on abort and never returns its partial text', async () => {
  const cancel = vi.fn()
  const controller = new AbortController()
  const response = new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'text/event-stream' } })
  const pending = readFalconTranscript(response, { signal: controller.signal })
  controller.abort()
  await expect(pending).rejects.toThrow()
  expect(cancel).toHaveBeenCalledOnce()
})
