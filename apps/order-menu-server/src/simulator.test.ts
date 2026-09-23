import { describe, expect, it } from 'vitest'

import { createPosSimulator } from './simulator'

describe('pOS simulator', () => {
  it('exposes the project menu source as its detailed, available catalog', async () => {
    const simulator = createPosSimulator()

    const response = await simulator.app.request('/v1/catalog')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          id: 'dish-ai-1789630028994-0',
          imageUrl: expect.stringContaining('images.unsplash.com'),
          name: '炸蝦捲(每份二條)',
          price: 95,
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

    await expect((await submit('customer-session-0001')).json()).resolves.toMatchObject({ receipt: { status: 'accepted' } })
    const mode = await simulator.app.request('/__simulator/mode', {
      body: JSON.stringify({ mode: 'uncertain' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })

    expect(mode.status).toBe(200)
    await expect((await submit('customer-session-0002')).json()).resolves.toMatchObject({ receipt: { status: 'uncertain' } })
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
