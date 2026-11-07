import { readFile } from 'node:fs/promises'

import { expect, it } from 'vitest'

import { recoverServiceRequest } from './serviceRecovery'

// Report: this chat, 2026-11-06. Uses the authorized replay response, with no network or order operations.
it('reproduces the invalid assistant/question combination from the provider response', async () => {
  const [exchange] = JSON.parse(await readFile('/tmp/kiosk-invalid-review-probe.json', 'utf8'))
  const result = await recoverServiceRequest({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION', recovery: { status: 'eligible' } }, { backgroundSpeechMode: 'off', transcript: '你有買一送一嗎？', state: { phase: 'ordering' }, complete: async () => Response.json(exchange.response) })
  expect(result.kind).toBe('UNAVAILABLE')
  expect(result.recovery?.failure).toBe('invalid')
})

it('accepts the same assistant disposition when the prohibited question is absent', async () => {
  const [exchange] = JSON.parse(await readFile('/tmp/kiosk-invalid-review-probe.json', 'utf8'))
  const call = exchange.response.choices[0].message.tool_calls[0].function
  const args = JSON.parse(call.arguments)
  delete args.question
  call.arguments = JSON.stringify(args)
  const result = await recoverServiceRequest({ kind: 'UNAVAILABLE', reason: 'UNCERTAIN_OPERATION', recovery: { status: 'eligible' } }, { backgroundSpeechMode: 'off', transcript: '你有買一送一嗎？', state: { phase: 'ordering' }, complete: async () => Response.json(exchange.response) })
  expect(result.kind).toBe('NEEDS_ASSISTANT')
  expect(result.recovery?.status).toBe('completed')
})
