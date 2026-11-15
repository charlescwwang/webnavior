import type { ServiceTool } from '@proj-airi/stage-shared/interactive-service'

import { expect, it, vi } from 'vitest'
import { readonly, shallowRef } from 'vue'

import { beginBrowserCartTask, executeBrowserCartTool, executeBrowserConfirmedAddition, prepareBrowserQuestionAnswer } from './browserCartTask'
import { createBrowserDialogue } from './browserDialogue'

function setup(fail?: 'unknown' | 'throw' | 'manual' | 'login' | 'read-failure', readOnly = false) {
  const dialogue = createBrowserDialogue({ owner: () => 'visitor', documentId: () => 'page', answer: async () => ({ kind: 'UNCERTAIN', provider: 'main' }) })
  const facts = { ok: true, source: 'browser', cart: { version: 'v0', lines: [] }, products: ['甲餐', '乙餐'].map((name, i) => ({ ref: `p-${i}`, name, price: 100, configurations: [{ version: `cfg-${i}`, variantRef: '', name, unitPrice: 100, groups: [] }] })) }
  dialogue.collectOrder(facts, { lines: facts.products.map(p => ({ productRef: p.ref, quantity: 1, evidence: `${p.name}一份`, choices: [], askGroups: [], note: '' })) }, '甲餐一份、乙餐一份')
  const read: ServiceTool = { name: 'browser_cart_get', description: '', inputSchema: { type: 'object' }, origin: 'https://app.esgpb.com' }
  const add = { ...read, name: 'browser_cart_add' }
  let additions = 0
  let reads = 0
  const execute = vi.fn(async (tool: ServiceTool, _input: Record<string, unknown>): Promise<unknown> => {
    if (tool.name === read.name) {
      reads++
      if (reads === 3 && fail === 'login')
        return { ok: false, source: 'browser', status: 'rejected', effect: 'none', code: 'sign-in-required', error: 'PB requires manual sign-in.' }
      if (reads >= 4 && fail === 'read-failure')
        throw new Error('Read unavailable')
      if (reads >= 4 && fail === 'manual')
        facts.cart.version = 'manual'
      return facts
    }
    additions++
    if (additions === 2 && fail === 'throw')
      throw new Error('Transport disconnected')
    if (additions === 2 && fail === 'unknown')
      return { ok: false, source: 'browser', status: 'unknown' }
    facts.cart.version = `v${additions}`
    return { ok: true, source: 'browser', status: 'verified', cart: { version: facts.cart.version } }
  })
  const client = { tools: readonly(shallowRef([read, add])), execute }
  const complete = vi.fn()
  const release = beginBrowserCartTask('對', { dialogue, readOnly, isCurrent: () => true, onRequestComplete: complete, decide: async () => ({ choice: 'ALLOW', provider: 'main' }) })
  return { client, read, add, release, complete }
}

it('commits sealed dishes in order with fresh versions and consumes confirmation once', async () => {
  const { client, read, add, release, complete } = setup()
  try {
    await executeBrowserCartTool(client, read, { includeCatalog: true })
    expect(await executeBrowserConfirmedAddition(client)).toMatchObject({ ok: true, status: 'verified', customerMessage: expect.stringContaining('甲餐 1 份、乙餐 1 份') })
    const calls = client.execute.mock.calls.filter(([tool]) => tool.name === add.name)
    expect(calls).toHaveLength(2)
    expect(calls[0][1]).toMatchObject({ version: 'v0', productRef: 'p-0', quantity: 1 })
    expect(calls[1][1]).toMatchObject({ version: 'v1', productRef: 'p-1', quantity: 1 })
    expect(await executeBrowserConfirmedAddition(client)).toMatchObject({ ok: false, effect: 'none' })
    expect(client.execute.mock.calls.filter(([tool]) => tool.name === add.name)).toHaveLength(2)
    expect(complete).toHaveBeenCalledOnce()
  }
  finally { release() }
})

it('prepares a closed confirmation without effect, then executes its sealed batch once without a planner', async () => {
  const { client, add, release } = setup()
  try {
    const answer = await prepareBrowserQuestionAnswer(client)
    expect(answer).toBeTypeOf('function')
    expect(client.execute.mock.calls.filter(([tool]) => tool.name === add.name)).toHaveLength(0)
    expect(await answer!()).toMatchObject({ ok: true, status: 'verified' })
    expect(client.execute.mock.calls.filter(([tool]) => tool.name === add.name)).toHaveLength(2)
    expect(await answer!()).toMatchObject({ ok: false, effect: 'none' })
    expect(client.execute.mock.calls.filter(([tool]) => tool.name === add.name)).toHaveLength(2)
  }
  finally { release() }
})

it('does not dispatch a prepared answer after its task is retired', async () => {
  const { client, add, release } = setup()
  const answer = await prepareBrowserQuestionAnswer(client)
  release()
  expect(await answer!()).toMatchObject({ ok: false, effect: 'none' })
  expect(client.execute.mock.calls.filter(([tool]) => tool.name === add.name)).toHaveLength(0)
})

it.each(['unknown', 'throw', 'manual'] as const)('preserves verified effects and stops without replay on %s', async (failure) => {
  const { client, read, add, release } = setup(failure)
  try {
    await executeBrowserCartTool(client, read, { includeCatalog: true })
    const result = await executeBrowserConfirmedAddition(client)
    expect(result).toMatchObject({ ok: false, effect: 'partial', customerMessage: expect.stringContaining('已加入：甲餐 1 份') })
    expect(result).not.toHaveProperty('cart')
    expect(JSON.stringify(result)).not.toContain('目前尚未變更購物車')
    expect(client.execute.mock.calls.filter(([tool]) => tool.name === add.name)).toHaveLength(failure === 'manual' ? 1 : 2)
    expect(await executeBrowserConfirmedAddition(client)).toMatchObject({ ok: false, effect: 'none' })
  }
  finally { release() }
})

it('preserves the immutable read-only boundary even for a locally consumed batch confirmation', async () => {
  const { client, read, add, release } = setup(undefined, true)
  try {
    await executeBrowserCartTool(client, read, { includeCatalog: true })
    expect(await executeBrowserConfirmedAddition(client)).toMatchObject({ effect: 'none' })
    expect(client.execute.mock.calls.filter(([tool]) => tool.name === add.name)).toHaveLength(0)
  }
  finally { release() }
})

it('preserves a typed sign-in requirement discovered before the first write', async () => {
  const { client, read, add, release } = setup('login')
  try {
    await executeBrowserCartTool(client, read, { includeCatalog: true })
    expect(await executeBrowserConfirmedAddition(client)).toMatchObject({ code: 'sign-in-required', effect: 'none', status: 'rejected' })
    expect(client.execute.mock.calls.filter(([tool]) => tool.name === add.name)).toHaveLength(0)
  }
  finally { release() }
})

it('does not call a later read failure an unknown new write', async () => {
  const { client, read, add, release } = setup('read-failure')
  try {
    await executeBrowserCartTool(client, read, { includeCatalog: true })
    expect(await executeBrowserConfirmedAddition(client)).toMatchObject({ status: 'rejected', effect: 'partial', customerMessage: expect.stringContaining('甲餐') })
    expect(client.execute.mock.calls.filter(([tool]) => tool.name === add.name)).toHaveLength(1)
  }
  finally { release() }
})
