import { basePath } from './catalog.js'
import { sessionSchemaVersion } from './fixtureProtocol.js'
import { selection, submit } from './order.js'

/**
 * Server-observed fixture state writes, not merchant POSTs or UI click counts.
 * One instance belongs to one cookie session and is discarded on server restart.
 * Restored history is a baseline, never evidence that this process submitted it.
 */
export function createFixtureLedger() {
  const counters = { rawWriteAttempts: 0, acceptedWrites: 0, rejectedWrites: 0, staleRejectedWrites: 0, submissionRequests: 0, createdOrders: 0, duplicateSubmissions: 0, rejectedTransitions: 0, baselineOrders: 0, lostAcks: 0, resultFormatFaults: 0, eventsDropped: 0 }
  const knownOrders = new Map()
  // Exact request bytes distinguish a lost-ACK retry from a later ordinary
  // state save that happens to retain the same submitted-order history.
  const submissionBodies = new Set()
  const events = []
  let nextWriteAck
  let nextResultFormat
  function event(kind, extra = {}) {
    events.push({ sequence: counters.rawWriteAttempts, kind, ...extra })
    if (events.length > 1000) {
      events.shift()
      counters.eventsDropped++
    }
  }
  return {
    snapshot() {
      return { protocol: 'owned-fixture-state-put', schemaVersion: 1, eventHistoryLimit: 1000, ...counters, events: structuredClone(events) }
    },
    rejectWrite(reason) {
      counters.rawWriteAttempts++
      counters.rejectedWrites++
      event('write-rejected', { reason })
    },
    armFault(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length || Object.keys(value).some(key => !['nextWriteAck', 'nextResultFormat'].includes(key)) || (value.nextWriteAck !== undefined && value.nextWriteAck !== 'drop') || (value.nextResultFormat !== undefined && !['malformed-json', 'missing-order'].includes(value.nextResultFormat)))
        return { status: 400, error: 'Unknown fixture fault.' }
      if (value.nextWriteAck)
        nextWriteAck = value.nextWriteAck
      if (value.nextResultFormat)
        nextResultFormat = value.nextResultFormat
      return { status: 200 }
    },
    resultFault(path) {
      const matched = path.startsWith(`${basePath}/orders/`) ? path.slice(`${basePath}/orders/`.length).match(/^([\w-]+)(?:\/choosePayment)?$/) : null
      if (!nextResultFormat || !matched || !knownOrders.has(matched[1]))
        return
      const fault = nextResultFormat
      nextResultFormat = undefined
      counters.resultFormatFaults++
      event('result-format-fault', { fault, orderId: matched[1] })
      return fault
    },
    write(body, before, currentRevision) {
      counters.rawWriteAttempts++
      let input
      try {
        input = JSON.parse(body)
      }
      catch {
        counters.rejectedWrites++
        event('invalid-json')
        return { status: 400, error: 'Invalid fixture session' }
      }
      const value = input?.state
      const existingIds = new Set(before?.orders.map(order => order.orderId) ?? [])
      const proposed = Array.isArray(value?.orders) ? value.orders.filter(order => !existingIds.has(order?.orderId)) : []
      const duplicate = submissionBodies.has(body)
      if (duplicate || (before && proposed.length)) {
        counters.submissionRequests++
        if (duplicate)
          counters.duplicateSubmissions++
      }
      if (input?.revision !== currentRevision) {
        counters.staleRejectedWrites++
        counters.rejectedWrites++
        event('stale-write-rejected', { revision: currentRevision, submission: duplicate || proposed.length > 0 })
        return { status: 409, error: '另一分頁已更新測試資料，請重新整理後核對。' }
      }
      try {
        if (value?.schemaVersion !== sessionSchemaVersion || !Array.isArray(value.cart) || !Array.isArray(value.orders) || typeof value.checkoutKey !== 'string' || !value.invoice || typeof value.table !== 'string')
          throw new Error('Invalid fixture session')
        value.cart = value.cart.map(line => ({ ...selection(line.productId, line.quantity, line.extra, line.note), lineId: line.lineId, vendorLineId: line.vendorLineId }))
        if (new Set(value.cart.map(line => line.vendorLineId)).size !== value.cart.length || value.cart.some(line => !Number.isSafeInteger(line.vendorLineId) || line.vendorLineId < 1))
          throw new Error('Invalid fixture line identity')
        if (before && proposed.length) {
          if (proposed.length !== 1 || proposed[0].checkoutKey !== before.checkoutKey || [...knownOrders.values()].some(order => order.checkoutKey === proposed[0].checkoutKey)) {
            counters.rejectedTransitions++
            counters.rejectedWrites++
            event('duplicate-or-unbound-checkout')
            return { status: 409, error: 'Checkout identity was already used or is not current.' }
          }
        }
        if (new Set(value.orders.map(order => order?.orderId)).size !== value.orders.length || new Set(value.orders.map(order => order?.checkoutKey)).size !== value.orders.length || value.orders.some(order => typeof order?.orderId !== 'string' || typeof order?.checkoutKey !== 'string'))
          throw new Error('Invalid order identities')
        if (before && proposed.length) {
          const order = proposed[0]
          if (!order.orderId.startsWith('TEST-') || !Number.isFinite(Date.parse(order.createdAt)))
            throw new Error('Invalid submitted order')
          const expectedState = structuredClone(before)
          const expectedOrder = submit(expectedState, { id: order.orderId.slice(5), now: order.createdAt })
          // Independently reconstruct the immutable checkout from the server's
          // preceding cart. A client-provided total alone proves no submission.
          if (JSON.stringify(order) !== JSON.stringify(expectedOrder) || value.cart.length || value.checkoutKey !== before.checkoutKey || value.table !== before.table || JSON.stringify(value.invoice) !== JSON.stringify(before.invoice))
            throw new Error('Submitted snapshot differs from the preceding checkout')
        }
        if (before && before.orders.some(order => !value.orders.some(next => next.orderId === order.orderId)))
          throw new Error('Submitted history cannot be removed by state writes')
      }
      catch {
        counters.rejectedWrites++
        if (before && proposed.length)
          counters.rejectedTransitions++
        event('invalid-state-rejected')
        return { status: 400, error: 'Invalid fixture session' }
      }
      if (!before) {
        counters.baselineOrders = value.orders.length
        for (const order of value.orders)
          knownOrders.set(order.orderId, { checkoutKey: order.checkoutKey })
      }
      else if (proposed.length) {
        counters.createdOrders++
        const order = proposed[0]
        knownOrders.set(order.orderId, { checkoutKey: order.checkoutKey })
        submissionBodies.add(body)
        event('order-created', { orderId: order.orderId, checkoutKey: order.checkoutKey })
      }
      counters.acceptedWrites++
      const dropAck = nextWriteAck === 'drop'
      nextWriteAck = undefined
      if (dropAck) {
        counters.lostAcks++
        event('write-ack-dropped')
      }
      return { status: 200, state: value, revision: currentRevision + 1, dropAck }
    },
  }
}
