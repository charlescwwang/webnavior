import { expect, it, vi } from 'vitest'

import { resolvePhoneChoice } from './phoneResolution'

it.each(['SKIP_PHONE', 'KEEP_PHONE', 'UNCERTAIN'] as const)('validates Main phone choice %s without exposing browser operations', async (choice) => {
  const complete = vi.fn<(body: Record<string, unknown>) => Promise<Response>>(async () => Response.json({ choices: [{ message: { tool_calls: [{ function: { name: 'resolve_phone_choice', arguments: JSON.stringify({ choice }) } }] } }] }))
  const result = await resolvePhoneChoice('略過', complete)
  expect(result.choice).toBe(choice)
  expect(result.durationMs).toBeGreaterThanOrEqual(0)
  const body = complete.mock.calls[0]?.[0]
  expect(body).toMatchObject({ tool_choice: 'required', tools: [{ function: { name: 'resolve_phone_choice' } }], messages: expect.arrayContaining([{ role: 'user', content: JSON.stringify({ customerUtterance: '略過' }) }]) })
})

it.each([
  { name: 'customer_skip_phone', arguments: '{"choice":"SKIP_PHONE"}' },
  { name: 'resolve_phone_choice', arguments: 'invalid' },
  { name: 'resolve_phone_choice', arguments: '{"choice":"invented"}' },
])('does not authorize an invalid Main proposal: $name/$arguments', async (call) => {
  const result = await resolvePhoneChoice('略過', async () => Response.json({ choices: [{ message: { tool_calls: [{ function: call }] } }] }))
  expect(result.choice).toBe('UNCERTAIN')
})

it('keeps phone entry unchanged after provider failure', async () => {
  const result = await resolvePhoneChoice('略過', async () => {
    throw new Error('network')
  })
  expect(result.choice).toBe('UNCERTAIN')
})
