import { expect, it } from 'vitest'

import { createFixtureLedger } from './fixtureLedger.js'
import { sessionSchemaVersion } from './fixtureProtocol.js'
import { selection, submit } from './order.js'

function setup() {
  const ledger = createFixtureLedger()
  const state = { schemaVersion: sessionSchemaVersion, table: 'A1 桌', cart: [], orders: [], invoice: { type: 'none', code: '', phone: '', email: 'fixture@example.test' }, checkoutKey: 'checkout-one', note: '' }
  let current = null
  let revision = 0
  const write = (value, atRevision = revision) => {
    const result = ledger.write(JSON.stringify({ revision: atRevision, state: value }), current, revision)
    if (result.status === 200) {
      current = result.state
      revision = result.revision
    }
    return result
  }
  expect(write(state).status).toBe(200)
  state.cart = [{ ...selection('fish-soup', 1, 0, ''), lineId: 'line-one', vendorLineId: 1 }]
  expect(write(state).status).toBe(200)
  return { ledger, state, write, current: () => current, revision: () => revision }
}

it('records actual state writes separately from verified submission transitions', () => {
  const { ledger, state, write } = setup()
  state.note = '備註'
  expect(write(state).status).toBe(200)
  submit(state, { id: 'one', now: '2026-11-15T00:00:00Z' })
  expect(write(state).status).toBe(200)
  state.orders[0].updatedAt = '2026-11-15T00:00:01Z'
  expect(write(state).status).toBe(200)
  expect(JSON.stringify(ledger.snapshot())).not.toContain('fixture@example.test')
  expect(ledger.snapshot()).toMatchObject({ protocol: 'owned-fixture-state-put', rawWriteAttempts: 5, acceptedWrites: 5, submissionRequests: 1, createdOrders: 1, duplicateSubmissions: 0 })
})

it('counts an exact submission request replay but never creates a second order after a lost ACK', () => {
  const { ledger, state, write, revision, current } = setup()
  const submittedRevision = revision()
  submit(state, { id: 'one', now: '2026-11-15T00:00:00Z' })
  expect(ledger.armFault({ nextWriteAck: 'drop' }).status).toBe(200)
  expect(write(state)).toMatchObject({ status: 200, dropAck: true })
  expect(write(state, submittedRevision).status).toBe(409)
  expect(current().orders).toHaveLength(1)
  expect(ledger.snapshot()).toMatchObject({ rawWriteAttempts: 4, submissionRequests: 2, createdOrders: 1, duplicateSubmissions: 1, staleRejectedWrites: 1, lostAcks: 1 })
})

it('rejects fabricated or checkout-key-reused additions without counting them as accepted orders', () => {
  const { ledger, state, write } = setup()
  submit(state, { id: 'one', now: '2026-11-15T00:00:00Z' })
  const invalid = structuredClone(state)
  invalid.orders[0].total = 1
  expect(write(invalid).status).toBe(400)
  expect(write(state).status).toBe(200)
  const duplicate = structuredClone(state)
  duplicate.orders.unshift({ ...duplicate.orders[0], orderId: 'TEST-other' })
  expect(write(duplicate).status).toBe(409)
  expect(ledger.snapshot()).toMatchObject({ createdOrders: 1, rejectedTransitions: 2 })
})

it('does not claim restored historical orders as server-observed creations', () => {
  const { state } = setup()
  submit(state, { id: 'history', now: '2026-11-15T00:00:00Z' })
  const ledger = createFixtureLedger()
  expect(ledger.write(JSON.stringify({ revision: 0, state }), null, 0).status).toBe(200)
  expect(ledger.snapshot()).toMatchObject({ createdOrders: 0, baselineOrders: 1, submissionRequests: 0 })
})

it('injects a single malformed result response without modifying the stored order', () => {
  const { ledger, state, write } = setup()
  submit(state, { id: 'one', now: '2026-11-15T00:00:00Z' })
  expect(write(state).status).toBe(200)
  expect(ledger.armFault({ nextResultFormat: 'malformed-json' }).status).toBe(200)
  expect(ledger.resultFault('/order/store/1kgJeql/internal_use/menu')).toBeUndefined()
  expect(ledger.resultFault('/order/store/1kgJeql/internal_use/orders/TEST-one/choosePayment')).toBe('malformed-json')
  expect(ledger.resultFault('/order/store/1kgJeql/internal_use/orders/TEST-one/choosePayment')).toBeUndefined()
  expect(ledger.snapshot()).toMatchObject({ createdOrders: 1, resultFormatFaults: 1 })
})
