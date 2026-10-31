import type { KioskRoutesOptions } from '../../../server/src/routes/kiosk'

import { conversationContextSchema } from '@proj-airi/stage-shared/kiosk-conversation'
import { parse } from 'valibot'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { menu } from '../../../order-menu/src/domain/order-machine'
import { createMenuToolRuntime } from '../../../order-menu/src/webmcp'
import { mockDB } from '../../../server/src/libs/mock-db'
import { createKioskRoutes } from '../../../server/src/routes/kiosk'
import { createKioskService } from '../../../server/src/services/domain/kiosk'

import * as schema from '../../../server/src/schemas'

// Cross-runtime coverage belongs to the Host suite; Server's composite project
// must not import the renderer's Menu implementation or its asset dependencies.
describe('field Main quantity recovery through the real HTTP route and Menu', () => {
  let db: Awaited<ReturnType<typeof mockDB>>
  const runtimeModelPolicy = { modelFor: async () => 'test-model' }
  beforeEach(async () => {
    db = await mockDB(schema)
  })
  // Report: docs/research/2026-10-26-kiosk-conversation-error-audit.md, Oct30, seq200–227.
  it('diagnoses quantity tool exposure and transport on the deployed route contract', async () => {
    const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id: 'dumplings', name: '水餃', aliases: [], category: '點心', price: 80, optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('order_add_item', { itemId: 'dumplings', quantity: 3 })
    const initial = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'quantity-diagnosis', transcript: '水餃三份改成兩份', expectedMenuRevision: initial.revisions.menu, constraints: {} })
    const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
    const call = { id: 'invalid-quantity', type: 'function', function: { name: 'cart_update_item', arguments: JSON.stringify({ lineId: context.cart.lines[0]!.id }) } }
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => Response.json({ choices: [{ message: { tool_calls: [call] } }] }))
    const app = createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy })
    const enrolled = await app.request('/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    const started = await app.request('/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const tools = runtime.toolDefinitions.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } }))
    const response = await app.request(`/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: context.sourceUtterance, tools, decisionState: { phase: 'ordering', context } }) })
    expect(response.status).toBe(200)
    expect(context.readOnly).toBe(false)
    const body = complete.mock.calls[0]![0].body
    expect(body.tools).toContainEqual(expect.objectContaining({ function: expect.objectContaining({ name: 'cart_set_line_quantity', parameters: expect.objectContaining({ required: ['lineId', 'quantity'] }) }) }))
    expect(body.tools).not.toContainEqual(expect.objectContaining({ function: expect.objectContaining({ name: 'cart_update_item' }) }))
    expect(JSON.stringify(body.messages)).toContain('水餃三份改成兩份')
    expect(await response.json()).toMatchObject({ toolCalls: [call] })
    expect(complete).toHaveBeenCalledOnce()
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 3 } })
  })

  // Report: docs/research/2026-10-26-kiosk-conversation-error-audit.md, Oct30 quantity incident.
  it.each([{ scenario: 'addition', transport: 'json' }, { scenario: 'quantity', transport: 'json' }, { scenario: 'addition', transport: 'sse' }, { scenario: 'quantity', transport: 'sse' }] as const)('finishes the original $scenario through tools ($transport)', async ({ scenario, transport }) => {
    const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id: 'dumplings', name: '水餃', aliases: [], category: '點心', price: 80, optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    if (scenario === 'quantity')
      await runtime.invoke('order_add_item', { itemId: 'dumplings', quantity: 3 })
    if (scenario === 'addition')
      await runtime.invoke('menu_get', { query: '水餃' })
    const initial = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
    const content = scenario === 'addition' ? '那我要三份' : '改成兩份'
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'completion-recovery', transcript: content, expectedMenuRevision: initial.revisions.menu, constraints: {} })
    const lineId = initial.cart.lines[0]?.id
    const call = (id: string, name: string, args: Record<string, unknown>) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })
    const missingEffect = scenario === 'addition' ? '水餃每份80元，您點三份，總共240元。請問需要內用還是自取？' : '已將水餃改為2份。'
    const replies = scenario === 'addition'
      ? [{ tool_calls: [call('menu', 'menu_get', { query: '水餃' })] }, { tool_calls: [call('cart', 'cart_get', { display: false })] }, { content: missingEffect }, { tool_calls: [call('add', 'order_add_item', { itemId: 'dumplings', quantity: 3 })] }, { content: '已加入。' }]
      : [{ content: missingEffect }, { tool_calls: [call('quantity', 'cart_set_line_quantity', { lineId, quantity: 2 })] }, { content: '已修改。' }]
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>(async () => Response.json({ choices: [{ message: replies.shift() ?? { content: '未完成。' } }] }))
    const app = createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy })
    const enrolled = await app.request('/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    const started = await app.request('/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    for (const entry of [{ kind: 'user_text', content: '剛看到有水餃' }, { kind: 'assistant_text', content: '水餃目前可以點。' }])
      expect((await app.request(`/visitor-sessions/${session.id}/entries`, { method: 'POST', headers, body: JSON.stringify(entry) })).status).toBe(201)
    let toolResults: Array<{ name: string, toolCallId: string, content: string }> = []
    const executed: string[] = []
    for (let round = 0; round < 5; round++) {
      const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
      const tools = runtime.toolDefinitions.filter(tool => context.allowedToolNames.includes(tool.name)).map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } }))
      const response = await app.request(`/visitor-sessions/${session.id}/messages`, { method: 'POST', headers: { ...headers, ...(transport === 'sse' ? { Accept: 'text/event-stream' } : {}) }, body: JSON.stringify({ ...(round === 0 ? { content } : {}), tools, toolResults, decisionState: { phase: 'ordering', context } }) })
      expect(response.status).toBe(200)
      const answer: { toolCalls: Array<{ id: string, function: { name: string, arguments: string } }> } = transport === 'json'
        ? await response.json()
        : (await response.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6))).find(event => event.type === 'turn-finished')
      if (!answer.toolCalls.length)
        break
      toolResults = []
      for (const operation of answer.toolCalls) {
        const definition = runtime.toolDefinitions.find(tool => tool.name === operation.function.name)!
        const result = await runtime.invokeForAgent(definition.name, JSON.parse(operation.function.arguments))
        executed.push(definition.name)
        toolResults.push({ name: definition.name, toolCallId: operation.id, content: JSON.stringify(result) })
      }
    }
    expect(executed).toContain(scenario === 'addition' ? 'order_add_item' : 'cart_set_line_quantity')
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: scenario === 'addition' ? 3 : 2 } })
    expect(complete).toHaveBeenCalledTimes(scenario === 'addition' ? 5 : 3)
    const review = complete.mock.calls[scenario === 'addition' ? 3 : 1]![0].body
    expect(JSON.stringify(review.messages)).toContain(content)
    expect(JSON.stringify(review.messages)).toContain('水餃目前可以點')
    expect(JSON.stringify(review.messages)).not.toContain(missingEffect)
    expect(review.tool_choice).toBe('required')
  })

  it('reviews once across read continuations and clarifies if the original demand remains unexecuted', async () => {
    const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, id: 'dumplings', name: '水餃', aliases: [], optionGroups: [] }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const initial = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'bounded-completion', transcript: '水餃三份', expectedMenuRevision: initial.revisions.menu, constraints: {} })
    const context = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
    const complete = vi.fn<KioskRoutesOptions['llmGateway']['complete']>()
      .mockImplementationOnce(async () => Response.json({ choices: [{ message: { content: '已加入。' } }] }))
      .mockImplementationOnce(async () => Response.json({ choices: [{ message: { tool_calls: [{ id: 'read-before-add', type: 'function', function: { name: 'menu_get', arguments: '{"query":"水餃"}' } }] } }] }))
      .mockImplementationOnce(async () => Response.json({ choices: [{ message: { content: '水餃可以點。' } }] }))
    const app = createKioskRoutes({ developmentRegistrationEnabled: true, secureCookies: false, kioskService: createKioskService(db), llmGateway: { complete }, runtimeModelPolicy })
    const enrolled = await app.request('/development/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationCode: '483920' }) })
    const headers = { 'Cookie': enrolled.headers.get('Set-Cookie')!.split(';')[0]!, 'Content-Type': 'application/json' }
    const started = await app.request('/visitor-sessions', { method: 'POST', headers, body: JSON.stringify({ serviceId: 'development-ordering-service' }) })
    const { session } = await started.json() as { session: { id: string } }
    const tools = runtime.toolDefinitions.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } }))
    const first = await app.request(`/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: context.sourceUtterance, tools, decisionState: { phase: 'ordering', context } }) })
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ toolCalls: [{ id: 'read-before-add', function: { name: 'menu_get' } }] })
    const receipt = await runtime.invokeForAgent('menu_get', { query: '水餃' })
    const freshContext = parse(conversationContextSchema, await runtime.invoke('kiosk_conversation_context'))
    const second = await app.request(`/visitor-sessions/${session.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ tools, toolResults: [{ name: 'menu_get', toolCallId: 'read-before-add', content: JSON.stringify(receipt) }], decisionState: { phase: 'ordering', context: freshContext } }) })
    expect(second.status).toBe(200)
    expect(await second.json()).toMatchObject({ reply: { kind: 'clarification' }, toolCalls: [] })
    expect(complete).toHaveBeenCalledTimes(3)
    expect(complete.mock.calls.filter(([request]) => request.body.tool_choice === 'required')).toHaveLength(1)
    const entries = await db.query.kioskInteractionEntries.findMany()
    expect(entries.filter(entry => entry.metadata.source === 'main_completion_review')).toHaveLength(1)
    expect(await runtime.invoke('cart_get', { display: false })).toMatchObject({ cart: { itemCount: 0 } })
  })
})
