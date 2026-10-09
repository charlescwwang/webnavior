import { describe, expect, it } from 'vitest'

import { createPosSimulator } from './simulator'

describe('pOS simulator', () => {
  it('publishes the current menu without customization options and with fixed serving prices', async () => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json()
    expect(catalog.items).toHaveLength(7)
    for (const item of catalog.items) {
      expect(item.optionGroups).toEqual([])
      expect(item.composition.removals).toEqual([])
    }
    expect(catalog.items.find((item: { id: string }) => item.id === 'beef-noodle-soup')).toMatchObject({ name: '紅燒牛肉麵', aliases: ['牛肉麵'], price: 150 })
    expect(catalog.items.find((item: { id: string }) => item.id === 'dumplings')).toMatchObject({ price: 80, description: '每份10顆，80元，現點現煮' })
  })
  it('exposes POS fulfillment capabilities and a revision-checked staff departure screen', async () => {
    const simulator = createPosSimulator()
    expect(await (await simulator.app.request('/v1/catalog')).json()).toMatchObject({ store: { fulfillmentModes: [{ id: 'dine-in', label: '內用' }, { id: 'takeout', label: '自取' }] } })
    const held = await simulator.app.request('/v1/seating/holds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: 0, partySize: 2, tableIds: ['T1'], splitApproved: false }) })
    const { hold } = await held.json() as { hold: { id: string } }
    const paymentResult = await simulator.app.request('/v1/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: 60, method: 'card', tableHoldId: hold.id }) })
    const { payment } = await paymentResult.json() as { payment: { id: string } }
    await simulator.app.request('/v1/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotencyKey: 'departure-test', cart: { fulfillmentMode: 'dine-in', tableHoldId: hold.id, paymentId: payment.id } }) })
    const page = await (await simulator.app.request('/__simulator/seating')).text()
    expect(page).toContain('模擬離席，釋放此桌')
    const depart = (revision: number) => simulator.app.request('/__simulator/seating/depart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tableId: 'T1', expectedRevision: revision }) })
    expect((await depart(0)).status).toBe(409)
    expect((await depart(3)).status).toBe(200)
    expect(await (await simulator.app.request('/v1/seating')).json()).toMatchObject({ seating: { revision: 4, tables: expect.arrayContaining([{ id: 'T1', label: '1 號桌', capacity: 4, status: 'free' }]) } })
  })
  it('exposes the project menu source as its detailed, available catalog', async () => {
    const simulator = createPosSimulator()

    const response = await simulator.app.request('/v1/catalog')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          aliases: ['招牌便當'],
          id: 'signature-shrimp-roll-bento',
          imageUrl: expect.stringContaining('images.unsplash.com'),
          name: '周氏蝦捲招牌便當',
          price: 145,
        }),
      ]),
      revision: expect.stringMatching(/^source-menu-v2-/),
      store: { name: '周氏蝦捲' },
    })
  })

  it('changes only new test orders when its mode is updated', async () => {
    const simulator = createPosSimulator()
    const submit = (idempotencyKey: string) => simulator.app.request('/v1/orders', {
      body: JSON.stringify({ idempotencyKey }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })

    await expect((await submit('customer-session-0001')).json()).resolves.toMatchObject({ receipt: { status: 'accepted', customerMessage: '訂單已接受。', environment: 'test' } })
    const mode = await simulator.app.request('/__simulator/mode', {
      body: JSON.stringify({ mode: 'uncertain' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })

    expect(mode.status).toBe(200)
    await expect((await submit('customer-session-0002')).json()).resolves.toMatchObject({ receipt: { status: 'uncertain', customerMessage: '訂單狀態尚未確認，請勿再次送單。', environment: 'test' } })
    await expect((await submit('customer-session-0001')).json()).resolves.toMatchObject({ receipt: { status: 'accepted' } })
  })

  it('keeps each payment result stable when the simulated terminal mode changes', async () => {
    const simulator = createPosSimulator()
    const createPayment = () => simulator.app.request('/v1/payments', {
      body: JSON.stringify({ amount: 95, method: 'card' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })

    const first = await (await createPayment()).json() as { payment: { id: string } }
    await simulator.app.request('/__simulator/payment-mode', {
      body: JSON.stringify({ mode: 'pending' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
    const second = await (await createPayment()).json() as { payment: { id: string } }

    await expect((await simulator.app.request(`/v1/payments/${first.payment.id}`)).json()).resolves.toMatchObject({ payment: { amount: 95, method: 'card', status: 'authorized' } })
    await expect((await simulator.app.request(`/v1/payments/${second.payment.id}`)).json()).resolves.toMatchObject({ payment: { status: 'pending' } })
  })
})
