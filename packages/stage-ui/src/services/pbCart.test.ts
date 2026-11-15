import type { CartGateway, CartSnapshot } from './pbCart'

import { describe, expect, it, vi } from 'vitest'

import { createCartOperations, readCartPage, verifyCartRowEdit } from './pbCart'

function setup() {
  let cart: CartSnapshot = { context: { orderRef: 'order', date: 'today', time: 'noon', manualRevision: 0 }, lines: [{ ref: 'old', productRef: 'p-old', name: '原餐', quantity: 1, unitPrice: 17, configuration: 'original' }], subtotal: 17 }
  const gateway: CartGateway = {
    canEdit: vi.fn(() => true),
    read: vi.fn(async () => structuredClone(cart)),
    clear: vi.fn(async (_before, onDispatch) => {
      onDispatch()
      cart = { ...cart, lines: [], subtotal: 0 }
    }),
    prepare: vi.fn(async ({ quantity }) => ({ productRef: 'p-new', name: '當日新品', unitPrice: 23, configuration: 'plain', commit: vi.fn(async (onDispatch: () => void) => {
      onDispatch()
      cart.lines.push({ ref: 'new', productRef: 'p-new', name: '當日新品', quantity, unitPrice: 23, configuration: 'plain' })
      cart.subtotal += quantity * 23
    }) })),
    setQuantity: vi.fn(async (ref, quantity, onDispatch) => {
      onDispatch()
      const line = cart.lines.find(line => line.ref === ref)!
      cart.subtotal += (quantity - line.quantity) * line.unitPrice
      line.quantity = quantity
    }),
    remove: vi.fn(async (ref, onDispatch) => {
      onDispatch()
      const line = cart.lines.find(line => line.ref === ref)!
      cart.subtotal -= line.quantity * line.unitPrice
      cart.lines = cart.lines.filter(line => line.ref !== ref)
    }),
  }
  return { gateway, operations: createCartOperations(gateway), change: (next: CartSnapshot) => cart = next }
}

describe('pb cart operations', () => {
  it('allows equivalent row identities only within the admitted group and verifies every field', async () => {
    const { gateway } = setup()
    const initial = await gateway.read()
    const before = { ...initial, subtotal: 34, lines: [...initial.lines, { ...initial.lines[0], ref: 'second' }] }
    const after = { ...before, subtotal: 17, lines: [before.lines[1]] }
    expect(verifyCartRowEdit(before, after, 'second', 0, ['old', 'second'])).toBe(true)
    expect(verifyCartRowEdit(before, after, 'second', 0)).toBe(false)
    expect(verifyCartRowEdit(before, { ...after, subtotal: 18 }, 'second', 0, ['old', 'second'])).toBe(false)
    expect(verifyCartRowEdit(before, { ...after, context: { ...after.context, manualRevision: 1 } }, 'second', 0, ['old', 'second'])).toBe(false)
  })

  it('continues a group edit when the native page removes another indistinguishable admitted row', async () => {
    const { operations, gateway, change } = setup()
    const before = await gateway.read()
    change({ ...before, subtotal: 34, lines: [...before.lines, { ...before.lines[0], ref: 'second' }] })
    const remove = gateway.remove
    gateway.remove = vi.fn(async (_ref, dispatch) => remove('old', dispatch))
    const cart = await operations.observe()
    expect(await operations.execute({ action: 'quantity', version: cart.version, lineRef: 'old', lineRefs: ['old', 'second'], quantity: 3, note: '' })).toMatchObject({ status: 'verified' })
    expect((await gateway.read()).lines.map(line => [line.ref, line.quantity])).toEqual([['second', 3]])
    expect((await gateway.read()).subtotal).toBe(51)
  })
  // Report: this chat, Nov14; PB repeated additions remain separate rows.
  it('replaces two servings across equivalent rows while retaining the other serving', async () => {
    const { operations, gateway, change } = setup()
    const before = await gateway.read()
    change({ ...before, lines: [{ ...before.lines[0], quantity: 1 }, { ...before.lines[0], ref: 'second', quantity: 2 }], subtotal: 51 })
    const cart = await operations.observe()
    const result = await operations.execute({ action: 'replace', version: cart.version, lineRef: 'old', lineRefs: ['old', 'second'], retainQuantity: 1, productRef: 'p-new', quantity: 2, unitPrice: 23, note: '', selection: { version: 'config', variantRef: '', choices: [] } })
    expect(result.status).toBe('verified')
    expect((await gateway.read()).lines.map(line => [line.ref, line.quantity])).toEqual([['old', 1], ['new', 2]])
    expect((await gateway.read()).subtotal).toBe(63)
  })

  it('does not group different per-serving extras for a replacement', async () => {
    const { operations, gateway, change } = setup()
    const before = await gateway.read()
    change({ ...before, lines: [...before.lines, { ...before.lines[0], ref: 'extra', configuration: 'extra-two' }], subtotal: 34 })
    const cart = await operations.observe()
    expect(await operations.execute({ action: 'replace', version: cart.version, lineRef: 'old', lineRefs: ['old', 'extra'], retainQuantity: 1, productRef: 'p-new', quantity: 1, unitPrice: 23, note: '', selection: { version: 'config', variantRef: '', choices: [] } })).toMatchObject({ status: 'rejected' })
    expect(gateway.prepare).not.toHaveBeenCalled()
  })
  // Report: this chat, Nov11; ending PB reception must clear unfinished cart items.
  it('clears the entire freshly read cart once and verifies it is empty', async () => {
    const { operations, gateway, change } = setup()
    const original = await gateway.read()
    change({ ...original, subtotal: 34, lines: [...original.lines, { ...original.lines[0], ref: 'same-looking-row' }] })
    expect(await operations.clear()).toMatchObject({ ok: true, status: 'verified', cart: { lines: [], subtotal: 0 } })
    expect(gateway.clear).toHaveBeenCalledOnce()
    expect(gateway.remove).not.toHaveBeenCalled()
    expect((await operations.observe()).lines).toEqual([])
  })

  it('does not click clear when the current cart is already empty', async () => {
    const { operations, gateway, change } = setup()
    change({ ...await gateway.read(), lines: [], subtotal: 0 })
    expect(await operations.clear()).toMatchObject({ ok: true, status: 'verified', cart: { lines: [], subtotal: 0 } })
    expect(gateway.clear).not.toHaveBeenCalled()
  })

  it.each(['rows-remain', 'subtotal-remains', 'read-fails'])('blocks further cart work when accepted clear cannot be verified (%s)', async (failure) => {
    const { operations, gateway, change } = setup()
    gateway.clear = vi.fn(async (_before, onDispatch) => {
      onDispatch()
      if (failure === 'subtotal-remains')
        change({ ...await gateway.read(), lines: [] })
      if (failure === 'read-fails')
        gateway.read = vi.fn(async () => { throw new Error('cart read unavailable') })
    })
    expect(await operations.clear()).toMatchObject({ ok: false, status: 'unknown' })
    expect(operations.canRecover()).toBe(false)
    expect(await operations.clear()).toMatchObject({ ok: false, status: 'unknown' })
    expect(gateway.clear).toHaveBeenCalledOnce()
  })

  it('keeps a rejected clear retryable when no merchant action was dispatched', async () => {
    const { operations, gateway } = setup()
    gateway.clear = vi.fn(async () => {
      throw new Error('button disabled')
    })
    expect(await operations.clear()).toMatchObject({ ok: false, status: 'rejected' })
    expect(operations.canRecover()).toBe(true)
    expect((await operations.observe()).lines).toHaveLength(1)
  })
  // Report: output/playwright/pb-electron/restored-S13-nov4-replacement-sequence.json.
  it.each([true, false])('keeps repeated same-serving additions editable when native identity is proven (%s)', async (editable) => {
    const { operations, gateway, change } = setup()
    gateway.canEdit = vi.fn(() => editable)
    let nextRef = 0
    const committed = vi.fn()
    gateway.prepare = vi.fn(async ({ quantity }) => ({ productRef: 'p-new', name: '當日新品', unitPrice: 23, configuration: 'plain', commit: async (onDispatch: () => void) => {
      onDispatch()
      committed()
      const before = await gateway.read()
      change({ ...before, subtotal: before.subtotal + quantity * 23, lines: [...before.lines, { ref: `additional-${++nextRef}`, productRef: 'p-new', name: '當日新品', quantity, unitPrice: 23, configuration: 'plain' }] })
    } }))
    for (let index = 0; index < 2; index++) {
      const before = await operations.observe()
      const result = await operations.execute({ action: 'add', version: before.version, productRef: 'p-new', quantity: 1, unitPrice: 23, note: '', selection: { version: 'config', variantRef: '', choices: [] } })
      expect(result).toMatchObject({ status: 'verified', effectMessage: '已加入當日新品 1 份。' })
    }
    const after = await operations.observe()
    expect(after.subtotal).toBe(63)
    expect(after.lines.filter(line => line.productRef === 'p-new').map(line => line.quantity)).toEqual(editable ? [2] : [1, 1])
    expect(after.lines[0]).toMatchObject({ ref: 'old', quantity: 1, unitPrice: 17 })
    expect(committed).toHaveBeenCalledTimes(editable ? 1 : 2)
    expect(gateway.setQuantity).toHaveBeenCalledTimes(editable ? 1 : 0)
  })

  it.each([
    { quantity: 99, unitPrice: 23, configuration: 'plain' },
    { quantity: 1, unitPrice: 24, configuration: 'plain' },
    { quantity: 1, unitPrice: 23, configuration: 'different-note-or-options' },
  ])('preserves ordinary additions across row capacity, price or configuration differences (%j)', async (existing) => {
    const { operations, gateway, change } = setup()
    const initial = await operations.observe()
    change({ ...initial, subtotal: existing.quantity * existing.unitPrice, lines: [{ ...initial.lines[0], ...existing, productRef: 'p-new', name: '當日新品' }] })
    const before = await operations.observe()
    expect(await operations.execute({ action: 'add', version: before.version, productRef: 'p-new', quantity: 1, unitPrice: 23, note: '', selection: { version: 'config', variantRef: '', choices: [] } })).toMatchObject({ status: 'verified' })
    const after = await operations.observe()
    expect(after.lines[0]).toEqual(before.lines[0])
    expect(after.lines[1]).toMatchObject({ productRef: 'p-new', quantity: 1, unitPrice: 23, configuration: 'plain' })
    expect(after.subtotal).toBe(existing.quantity * existing.unitPrice + 23)
    expect(gateway.setQuantity).not.toHaveBeenCalled()
  })

  it.each([{ action: 'quantity' as const, quantity: 5 }, { action: 'quantity' as const, quantity: 13 }, { action: 'remove' as const, quantity: 5 }])('adjusts equivalent split rows together while preserving unrelated meals (%j)', async ({ action, quantity }) => {
    const { operations, gateway, change } = setup()
    const state = await operations.observe()
    state.lines[0].quantity = 17
    state.lines.push({ ...state.lines[0], ref: 'second', quantity: 13 })
    state.lines.push({ ref: 'unrelated', productRef: 'p-other', name: '其他餐', quantity: 2, unitPrice: 23, configuration: 'other' })
    state.subtotal = 556
    change(state)
    const original = { ...state.lines[0] }
    const cart = await operations.observe()
    const result = await operations.execute({ action, version: cart.version, lineRef: 'old', lineRefs: ['old', 'second'], quantity, note: '' })
    expect(result).toMatchObject({ ok: true, status: 'verified', cart: { subtotal: action === 'quantity' ? quantity * 17 + 46 : 46 } })
    expect((await operations.observe()).lines).toEqual(action === 'quantity' ? [{ ...original, quantity }, { ref: 'unrelated', productRef: 'p-other', name: '其他餐', quantity: 2, unitPrice: 23, configuration: 'other' }] : [{ ref: 'unrelated', productRef: 'p-other', name: '其他餐', quantity: 2, unitPrice: 23, configuration: 'other' }])
    expect(gateway.remove).toHaveBeenCalledWith('second', expect.any(Function), ['old', 'second'])
    expect(gateway.remove).not.toHaveBeenCalledWith('unrelated', expect.anything())
    if (action === 'quantity') {
      // Setting 17 to 13 first would make two identical native rows; redundant
      // rows must disappear before the surviving row receives its final count.
      expect(vi.mocked(gateway.remove).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(gateway.setQuantity).mock.invocationCallOrder[0])
    }
  })

  it('stops a group adjustment if manual activity changes the cart generation during its first removal', async () => {
    const { operations, gateway, change } = setup()
    const state = await operations.observe()
    state.lines.push({ ...state.lines[0], ref: 'second', quantity: 13 })
    state.subtotal = 238
    change(state)
    const remove = gateway.remove
    gateway.remove = vi.fn(async (...args: Parameters<CartGateway['remove']>) => {
      await remove(...args)
      state.context.manualRevision++
    })
    const cart = await operations.observe()
    const input = { action: 'quantity' as const, version: cart.version, lineRef: 'old', lineRefs: ['old', 'second'], quantity: 5, note: '' }
    expect(await operations.execute(input)).toMatchObject({ status: 'unknown' })
    expect(gateway.setQuantity).not.toHaveBeenCalled()
    expect(await operations.execute(input)).toMatchObject({ status: 'unknown' })
    expect(gateway.remove).toHaveBeenCalledTimes(1)
  })

  it.each(['different-config', 'different-price', 'missing-row', 'duplicate-ref'] as const)('rejects an unverified row group before any dispatch (%s)', async (mode) => {
    const { operations, gateway, change } = setup()
    const state = await operations.observe()
    state.lines.push({ ...state.lines[0], ref: 'second', configuration: mode === 'different-config' ? 'rice' : 'original', unitPrice: mode === 'different-price' ? 18 : 17 })
    state.subtotal += state.lines[1].unitPrice
    change(state)
    const cart = await operations.observe()
    const lineRefs = mode === 'missing-row' ? ['old', 'missing'] : mode === 'duplicate-ref' ? ['old', 'old'] : ['old', 'second']
    expect(await operations.execute({ action: 'quantity', version: cart.version, lineRef: 'old', lineRefs, quantity: 5, note: '' })).toMatchObject({ status: 'rejected' })
    expect(gateway.setQuantity).not.toHaveBeenCalled()
    expect(gateway.remove).not.toHaveBeenCalled()
  })

  // Report: docs/plans/2026-10-28-windows-kiosk-electron.md, S04/S09 partial rice allocation.
  it('changes one serving to another configuration and preserves the two original servings', async () => {
    const { operations, gateway, change } = setup()
    const state = await operations.observe()
    state.lines[0].quantity = 3
    state.subtotal = 51
    change(state)
    gateway.prepare = vi.fn(async ({ quantity }) => ({ productRef: 'p-old', name: '原餐', unitPrice: 22, configuration: 'rice', description: '白飯 ×1', commit: async (onDispatch: () => void) => {
      onDispatch()
      state.lines.push({ ref: 'rice', productRef: 'p-old', name: '原餐', quantity, unitPrice: 22, configuration: 'rice', description: '白飯 ×1' })
      state.subtotal += quantity * 22
    } }))
    const observed = await operations.observe()
    const result = await operations.execute({ action: 'replace', version: observed.version, lineRef: 'old', productRef: 'p-old', quantity: 1, retainQuantity: 2, unitPrice: 22, note: '', selection: { version: 'config', variantRef: '', choices: [{ ref: 'rice-choice', quantity: 1 }] } })
    expect(result).toMatchObject({ ok: true, status: 'verified', cart: { subtotal: 56, lines: [{ ref: 'old', quantity: 2 }, { ref: 'rice', quantity: 1, description: '白飯 ×1' }] } })
    expect(gateway.setQuantity).toHaveBeenCalledWith('old', 2, expect.any(Function), ['old'])
    expect(gateway.remove).not.toHaveBeenCalled()
  })

  it('rejects retaining the whole source row before preparing a replacement', async () => {
    const { operations, gateway } = setup()
    const cart = await operations.observe()
    expect(await operations.execute({ action: 'replace', version: cart.version, lineRef: 'old', productRef: 'p-new', quantity: 1, retainQuantity: 1, unitPrice: 23, note: '', selection: { version: 'config', variantRef: '', choices: [] } })).toMatchObject({ status: 'rejected' })
    expect(gateway.prepare).not.toHaveBeenCalled()
  })

  // Report: output/playwright/pb-electron/restored-S04-final-rice-quantity.json.
  it.each([
    { original: 1, incoming: 1, retained: 0, final: 1 },
    { original: 1, incoming: 3, retained: 0, final: 3 },
    { original: 3, incoming: 2, retained: 2, final: 4 },
  ])('compiles an equivalent same-configuration replacement into one quantity edit (%j)', async ({ original, incoming, retained, final }) => {
    const { operations, gateway, change } = setup()
    const state = await operations.observe()
    state.lines[0].quantity = original
    state.subtotal = original * 17
    change(state)
    const commit = vi.fn(async () => {})
    gateway.prepare = vi.fn(async () => ({ productRef: 'p-old', name: '原餐', unitPrice: 17, configuration: 'original', commit }))
    const cart = await operations.observe()
    const result = await operations.execute({ action: 'replace', version: cart.version, lineRef: 'old', productRef: 'p-old', quantity: incoming, retainQuantity: retained, unitPrice: 17, note: '', selection: { version: 'config', variantRef: '', choices: [] } })
    expect(result).toMatchObject({ ok: true, status: 'verified', cart: { subtotal: final * 17, lines: [{ ref: 'old', quantity: final }] } })
    expect(result.customerMessage).toContain('已調整為')
    expect(result.customerMessage).not.toContain('尚未送出訂單')
    expect(commit).not.toHaveBeenCalled()
    expect(gateway.remove).not.toHaveBeenCalled()
    expect(gateway.setQuantity).toHaveBeenCalledOnce()
    expect(gateway.setQuantity).toHaveBeenCalledWith('old', final, expect.any(Function))
  })

  it.each(['another-row', 'price-change'])('does not infer same-configuration replacement totals across ambiguous rows or prices (%s)', async (mode) => {
    const { operations, gateway, change } = setup()
    const state = await operations.observe()
    if (mode === 'another-row') {
      state.lines.push({ ...state.lines[0], ref: 'other', quantity: 2 })
      state.subtotal += 34
    }
    change(state)
    const commit = vi.fn(async () => {})
    const price = mode === 'price-change' ? 18 : 17
    gateway.prepare = vi.fn(async () => ({ productRef: 'p-old', name: '原餐', unitPrice: price, configuration: 'original', commit }))
    const cart = await operations.observe()
    expect(await operations.execute({ action: 'replace', version: cart.version, lineRef: 'old', productRef: 'p-old', quantity: 3, unitPrice: price, note: '', selection: { version: 'config', variantRef: '', choices: [] } })).toMatchObject({ status: 'rejected' })
    expect(commit).not.toHaveBeenCalled()
    expect(gateway.setQuantity).not.toHaveBeenCalled()
    expect(gateway.remove).not.toHaveBeenCalled()
  })

  it('stops after a verified addition when reducing the original configuration fails, without replaying', async () => {
    const { operations, gateway, change } = setup()
    const state = await operations.observe()
    state.lines[0].quantity = 3
    state.subtotal = 51
    change(state)
    gateway.setQuantity = vi.fn(async () => {
      throw new Error('quantity response lost')
    })
    const cart = await operations.observe()
    const input = { action: 'replace' as const, version: cart.version, lineRef: 'old', productRef: 'p-new', quantity: 1, retainQuantity: 2, unitPrice: 23, note: '', selection: { version: 'config', variantRef: '', choices: [] } }
    const result = await operations.execute(input)
    expect(result).toMatchObject({ status: 'unknown', partial: true, verifiedAddition: { subtotal: 74 } })
    expect(result.customerMessage).toContain('新餐已確認加入')
    expect(operations.canRecover()).toBe(false)
    expect(await operations.execute(input)).toMatchObject({ status: 'unknown' })
    expect(gateway.prepare).toHaveBeenCalledTimes(1)
    expect(gateway.setQuantity).toHaveBeenCalledTimes(1)
    expect(gateway.remove).not.toHaveBeenCalled()
  })

  it('verifies a new daily product, quantity change and removal while preserving the original line', async () => {
    const { operations } = setup()
    let cart = await operations.observe()
    const add = await operations.execute({ action: 'add', selection: { version: 'config', variantRef: '', choices: [] }, version: cart.version, productRef: 'p-new', quantity: 2, note: '', unitPrice: 23 })
    expect(add).toMatchObject({ ok: true, status: 'verified', cart: { subtotal: 63 } })
    cart = await operations.observe()
    const update = await operations.execute({ action: 'quantity', version: cart.version, lineRef: 'new', quantity: 3, note: '' })
    expect(update).toMatchObject({ ok: true, cart: { subtotal: 86 } })
    cart = await operations.observe()
    const remove = await operations.execute({ action: 'remove', version: cart.version, lineRef: 'new', quantity: 1, note: '' })
    expect(remove).toMatchObject({ ok: true, cart: { subtotal: 17, lines: [{ ref: 'old', quantity: 1 }] } })
  })

  // Report: this chat, Nov15; a first pork add was mislabeled unknown before any UI step.
  it.each(['pickup', 'manual', 'table'] as const)('reports a stale %s context as no effect and allows a separately refreshed proposal', async (changeKind) => {
    const { operations, gateway, change } = setup()
    const observed = await operations.observe()
    const current = await gateway.read()
    if (changeKind === 'pickup')
      current.context.time = 'later'
    if (changeKind === 'manual')
      current.context.manualRevision++
    if (changeKind === 'table')
      current.context.tableName = 'B3 桌'
    change(current)
    const input = { action: 'add' as const, selection: { version: 'config', variantRef: '', choices: [] }, version: observed.version, productRef: 'p-new', quantity: 1, note: '', unitPrice: 23 }
    expect(await operations.execute(input)).toMatchObject({ ok: false, status: 'rejected', effect: 'none', reason: 'stale-cart' })
    expect(gateway.prepare).not.toHaveBeenCalled()
    expect(operations.canRecover()).toBe(true)
    const refreshed = await operations.observe()
    expect(await operations.execute({ ...input, version: refreshed.version })).toMatchObject({ ok: true, status: 'verified' })
    expect(gateway.prepare).toHaveBeenCalledExactlyOnceWith({ productRef: 'p-new', quantity: 1, note: '', selection: input.selection })
  })

  it('refuses a stale cart before dispatch', async () => {
    const { operations, gateway, change } = setup()
    const observed = await operations.observe()
    change({ context: { orderRef: 'order', date: 'today', time: 'noon', manualRevision: 0 }, lines: [], subtotal: 0 })
    expect(await operations.execute({ action: 'add', selection: { version: 'config', variantRef: '', choices: [] }, version: observed.version, productRef: 'p-new', quantity: 1, note: '' })).toMatchObject({ ok: false, status: 'rejected' })
    expect(gateway.prepare).not.toHaveBeenCalled()
  })

  it('does not commit after a daily price change', async () => {
    const { operations, gateway } = setup()
    const commit = vi.fn(async () => {})
    gateway.prepare = vi.fn(async () => ({ productRef: 'p-new', name: '當日新品', unitPrice: 24, configuration: 'plain', commit }))
    const cart = await operations.observe()
    expect(await operations.execute({ action: 'add', selection: { version: 'config', variantRef: '', choices: [] }, version: cart.version, productRef: 'p-new', quantity: 1, unitPrice: 23, note: '' })).toMatchObject({ status: 'rejected' })
    expect(commit).not.toHaveBeenCalled()
    expect(operations.canRecover()).toBe(true)
  })

  // Report: this chat, 2026-10-30; Main supplied a line total as a per-serving
  // price for two meals with paid options. This must be repairable before IO.
  it('reports a pre-dispatch unit-price mismatch without committing or blocking a corrected proposal', async () => {
    const { operations, gateway } = setup()
    const cart = await operations.observe()
    const input = { action: 'add' as const, selection: { version: 'config', variantRef: '', choices: [] }, version: cart.version, productRef: 'p-new', quantity: 2, unitPrice: 46, note: '' }
    expect(await operations.execute(input)).toMatchObject({ ok: false, status: 'rejected', effect: 'none', reason: 'unit-price-mismatch', expectedUnitPrice: 23 })
    const prepared = await vi.mocked(gateway.prepare).mock.results[0].value
    expect(prepared.commit).not.toHaveBeenCalled()
    expect(await operations.observe()).toEqual(cart)
    expect(operations.canRecover()).toBe(true)
    expect(await operations.execute({ ...input, unitPrice: 23 })).toMatchObject({ ok: true, status: 'verified', cart: { subtotal: 63 } })
  })

  it('compares decimal prices in currency minor units', async () => {
    let current: CartSnapshot = { context: { orderRef: 'decimal', date: 'today', time: 'noon', manualRevision: 0 }, lines: [{ ref: 'decimal', productRef: 'today', name: '每日商品', quantity: 2, unitPrice: 0.1, configuration: '' }], subtotal: 0.2 }
    const gateway: CartGateway = {
      canEdit: () => true,
      clear: async () => { throw new Error('unused') },
      read: async () => current,
      prepare: async () => { throw new Error('unused') },
      remove: async () => { throw new Error('unused') },
      setQuantity: async (_ref, _amount, onDispatch) => {
        onDispatch()
        current = { context: { orderRef: 'decimal', date: 'today', time: 'noon', manualRevision: 0 }, lines: [{ ...current.lines[0], quantity: 3 }], subtotal: 0.3 }
      },
    }
    const operations = createCartOperations(gateway)
    const cart = await operations.observe()
    expect(await operations.execute({ action: 'quantity', version: cart.version, lineRef: 'decimal', quantity: 3, note: '' })).toMatchObject({ ok: true, cart: { subtotal: 0.3 } })
  })

  it('does not remove a line that was not in the current cart', async () => {
    const { operations, gateway } = setup()
    const cart = await operations.observe()
    expect(await operations.execute({ action: 'remove', version: cart.version, lineRef: 'missing', quantity: 1, note: '' })).toMatchObject({ status: 'rejected' })
    expect(gateway.remove).not.toHaveBeenCalled()
  })

  it('verifies the replacement add before removing the original line', async () => {
    const { operations, gateway } = setup()
    const cart = await operations.observe()
    const result = await operations.execute({ action: 'replace', selection: { version: 'config', variantRef: '', choices: [] }, version: cart.version, lineRef: 'old', productRef: 'p-new', quantity: 1, unitPrice: 23, note: '' })
    expect(result).toMatchObject({ ok: true, cart: { subtotal: 23, lines: [{ ref: 'new', name: '當日新品' }] } })
    expect(gateway.remove).toHaveBeenCalledWith('old', expect.any(Function), ['old'])
  })

  it('preserves the original line when the replacement add cannot be verified', async () => {
    const { operations, gateway } = setup()
    gateway.prepare = async () => ({ productRef: 'p-new', name: '新品', unitPrice: 23, configuration: 'plain', commit: async onDispatch => onDispatch() })
    const cart = await operations.observe()
    expect(await operations.execute({ action: 'replace', selection: { version: 'config', variantRef: '', choices: [] }, version: cart.version, lineRef: 'old', productRef: 'p-new', quantity: 1, unitPrice: 23, note: '' })).toMatchObject({ status: 'unknown' })
    expect(gateway.remove).not.toHaveBeenCalled()
    expect((await operations.observe()).lines).toEqual(cart.lines)
  })

  it('reports verified partial replacement without claiming rollback or repeating writes', async () => {
    const { operations, gateway } = setup()
    gateway.remove = vi.fn(async () => {
      throw new Error('lost removal')
    })
    const cart = await operations.observe()
    const input = { action: 'replace' as const, selection: { version: 'config', variantRef: '', choices: [] }, version: cart.version, lineRef: 'old', productRef: 'p-new', quantity: 1, unitPrice: 23, note: '' }
    const result = await operations.execute(input)
    expect(result).toMatchObject({ ok: false, status: 'unknown', effect: 'unknown', partial: true, verifiedAddition: { subtotal: 40 } })
    expect(result.customerMessage).toContain('新餐已確認加入')
    expect((await operations.observe()).lines.map(line => line.ref)).toEqual(['old', 'new'])
    expect(await operations.execute(input)).toMatchObject({ status: 'unknown' })
    expect(gateway.remove).toHaveBeenCalledTimes(1)
  })

  it('invalidates the prepared write after a trusted manual interaction or pickup change', async () => {
    const { operations, gateway, change } = setup()
    const cart = await operations.observe()
    const commit = vi.fn(async () => {})
    gateway.prepare = async () => {
      change({ ...cart, context: { ...cart.context, manualRevision: 1 } })
      return { productRef: 'p-new', name: '新品', unitPrice: 23, configuration: 'plain', commit }
    }
    expect(await operations.execute({ action: 'add', selection: { version: 'config', variantRef: '', choices: [] }, version: cart.version, productRef: 'p-new', quantity: 1, unitPrice: 23, note: '' })).toMatchObject({ status: 'rejected' })
    expect(commit).not.toHaveBeenCalled()
  })

  it('does not retry a write whose response is lost even if the cart can be read', async () => {
    const { operations, gateway } = setup()
    gateway.remove = vi.fn(async (_ref, onDispatch) => {
      onDispatch()
      throw new Error('lost response')
    })
    const cart = await operations.observe()
    const input = { action: 'remove' as const, version: cart.version, lineRef: 'old', quantity: 1, note: '' }
    expect(await operations.execute(input)).toMatchObject({ status: 'unknown', ok: false })
    expect(await operations.execute(input)).toMatchObject({ status: 'unknown', ok: false })
    expect(gateway.remove).toHaveBeenCalledTimes(1)
    expect(operations.canRecover()).toBe(false)
  })

  it('blocks further writes when readback does not match the full requested effect', async () => {
    const { operations, gateway } = setup()
    gateway.setQuantity = vi.fn(async (_ref, _quantity, onDispatch) => onDispatch())
    const cart = await operations.observe()
    expect(await operations.execute({ action: 'quantity', version: cart.version, lineRef: 'old', quantity: 2, note: '' })).toMatchObject({ status: 'unknown' })
    expect(operations.canRecover()).toBe(false)
  })

  it('rejects a second concurrent operation before any second dispatch', async () => {
    const { operations, gateway } = setup()
    let release!: () => void
    const pending = new Promise<void>(resolve => release = resolve)
    const read = gateway.read
    gateway.read = async () => {
      await pending
      return read()
    }
    const first = operations.observe()
    release()
    const cart = await first
    let complete!: () => void
    gateway.remove = vi.fn(() => new Promise<void>(resolve => complete = resolve))
    const input = { action: 'remove' as const, version: cart.version, lineRef: 'old', quantity: 1, note: '' }
    const operation = operations.execute(input)
    await vi.waitFor(() => expect(gateway.remove).toHaveBeenCalledTimes(1))
    expect(await operations.execute(input)).toMatchObject({ status: 'rejected' })
    complete()
    await operation
    expect(gateway.remove).toHaveBeenCalledTimes(1)
  })
})

// Report: this chat, 2026-10-30; PB returns order:null before its first cart item.
describe('pb empty order lifecycle', () => {
  const pickup = { date: 'today', time: 'noon' }
  it('accepts an explicit null order only when no details and zero subtotal agree', () => {
    expect(readCartPage({ order: null, subtotal: 0 }, pickup, 3)).toEqual({ lines: [], subtotal: 0, context: { ...pickup, manualRevision: 3 } })
    expect(readCartPage({ order: null, details: null, subtotal: 0 }, pickup, 3).lines).toEqual([])
    expect(() => readCartPage({ order: null, subtotal: 10 }, pickup, 0)).toThrow()
    expect(() => readCartPage({ order: null, details: [{ id: 1 }], subtotal: 0 }, pickup, 0)).toThrow()
    expect(() => readCartPage({ subtotal: 0 }, pickup, 0)).toThrow()
  })
  it.each(['created-order', 'changed-pickup', 'changed-manual', 'changed-table'])('verifies first add while protecting context: %s', async (transition) => {
    let cart: CartSnapshot = { lines: [], subtotal: 0, context: { ...pickup, manualRevision: 0, tableName: 'A1 桌' } }
    const operations = createCartOperations({
      canEdit: () => true,
      clear: async () => { throw new Error('unused') },
      read: async () => structuredClone(cart),
      prepare: async () => ({ productRef: 'p-new', name: '新品', unitPrice: 10, configuration: '', commit: async (onDispatch: () => void) => {
        onDispatch()
        cart = { lines: [{ ref: 'new', productRef: 'p-new', name: '新品', unitPrice: 10, quantity: 1, configuration: '' }], subtotal: 10, context: { ...pickup, orderRef: 'created', tableName: transition === 'changed-table' ? 'B1 吧檯' : 'A1 桌', manualRevision: transition === 'changed-manual' ? 1 : 0, ...(transition === 'changed-pickup' ? { time: 'later' } : {}) } }
      } }),
      remove: async () => { throw new Error('unused') },
      setQuantity: async () => { throw new Error('unused') },
    })
    const before = await operations.observe()
    expect(await operations.execute({ action: 'add', version: before.version, productRef: 'p-new', quantity: 1, unitPrice: 10, note: '', selection: { version: 'config', variantRef: '', choices: [] } })).toMatchObject({ status: transition === 'created-order' ? 'verified' : 'unknown' })
  })
})

// Report: PB Create-DccDhWl4.js / DetailProductPrice-DpUTh351.js, Nov3 row binding.
it('retains structured option amounts and the separate note from vendor cart observations', () => {
  const cart = readCartPage({ subtotal: 30, order: { hash: 'observed', pick_up_date: 'today', pick_up_time: 'noon' }, details: [{ id: 1, amount: 1, unit_price: 30, item_type: 'product', item: { id: 7, name: '每日新品' }, note: '飯少', product_prices: [{ item_type: 'product', item_id: 7, parent_id: null, product_attrs: [{ attr_id: 9, attr: { name: '配菜' }, amount: 2, unit_price: 5 }] }] }] }, { date: 'today', time: 'noon' }, 0)
  expect(cart.lines[0].options).toEqual([{ name: '配菜', quantity: 2 }])
  expect(cart.lines[0].description).toBe('配菜 ×2')
  expect(cart.lines[0].note).toBe('飯少')
})
