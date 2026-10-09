import type { HoldRequest, SeatingSnapshot, TableHold } from './seatingContracts'

import { randomUUID } from 'node:crypto'

/** Single-process simulated POS inventory. Restarting this simulator clears it. */
export function createSeating(now: () => number = () => Date.now()) {
  const tables = Array.from({ length: 5 }, (_, index) => ({ id: `T${index + 1}`, label: `${index + 1} 號桌`, capacity: 4 }))
  const holds = new Map<string, TableHold>()
  // Departure changes physical occupancy, not the immutable paid hold/order.
  const departedTables = new Map<string, Set<string>>()
  let revision = 0

  function expire() {
    for (const hold of holds.values()) {
      // A terminal result may be unknown. Never free its seats merely because
      // the original unpaid hold deadline elapsed while payment was running.
      if (hold.status === 'held' && hold.expiresAt <= now()) {
        hold.status = 'expired'
        revision++
      }
    }
  }

  function get(id: string) {
    expire()
    const hold = holds.get(id)
    if (!hold || hold.status === 'expired' || hold.status === 'released')
      throw new Error('The table hold has expired or been released.')
    return hold
  }

  function snapshot(): SeatingSnapshot {
    expire()
    return { revision, tables: tables.map((table) => {
      const claim = [...holds.values()].find(hold => ['held', 'locked', 'occupied'].includes(hold.status) && hold.tableIds.includes(table.id) && !departedTables.get(hold.id)?.has(table.id))
      return { ...table, status: claim?.status === 'occupied' ? 'occupied' : claim ? 'held' : 'free' }
    }) }
  }

  function reserve(request: HoldRequest): TableHold {
    const current = snapshot()
    if (request.expectedRevision !== current.revision)
      throw new Error('The seating revision has changed.')
    if (!Number.isInteger(request.partySize) || request.partySize < 1 || request.partySize > 20)
      throw new Error('Party size must be between 1 and 20.')
    const ids = new Set(request.tableIds)
    const count = Math.ceil(request.partySize / 4)
    if (ids.size !== count || ids.size !== request.tableIds.length)
      throw new Error('Choose exactly the required number of tables.')
    if (count > 1 && !request.splitApproved)
      throw new Error('Splitting the party requires explicit approval.')
    if (request.tableIds.some(id => !current.tables.some(table => table.id === id && table.status === 'free')))
      throw new Error('The selected tables are no longer available.')
    // No await between availability check and claim: concurrent HTTP calls
    // in this one simulator process cannot both acquire the same table.
    const hold: TableHold = { id: randomUUID(), partySize: request.partySize, tableIds: [...request.tableIds], expiresAt: now() + 600_000, status: 'held' }
    holds.set(hold.id, hold)
    revision++
    return { ...hold, tableIds: [...hold.tableIds] }
  }

  function release(id: string) {
    expire()
    const hold = holds.get(id)
    if (!hold || hold.status === 'released' || hold.status === 'expired')
      return
    if (hold.status !== 'held')
      throw new Error('Payment or occupancy prevents releasing this hold.')
    hold.status = 'released'
    revision++
  }

  function protect(id: string) {
    const hold = get(id)
    if (hold.status !== 'held')
      throw new Error('This hold already has a payment or order.')
    hold.status = 'locked'
    revision++
  }

  function paymentRejected(id: string) {
    const hold = get(id)
    if (hold.status !== 'locked')
      throw new Error('The table hold has no pending payment.')
    hold.status = 'held'
    revision++
    expire()
  }

  function occupy(id: string) {
    const hold = get(id)
    if (hold.status === 'occupied')
      return
    if (hold.status !== 'locked')
      throw new Error('The table hold is not protected by a payment.')
    hold.status = 'occupied'
    revision++
  }

  function find(id: string) {
    expire()
    const hold = holds.get(id)
    return hold && ['held', 'locked', 'occupied'].includes(hold.status) ? { ...hold, tableIds: [...hold.tableIds] } : undefined
  }
  function depart(tableId: string, expectedRevision: number) {
    const current = snapshot()
    if (current.revision !== expectedRevision)
      throw new Error('The seating revision has changed.')
    if (!current.tables.some(table => table.id === tableId && table.status === 'occupied'))
      throw new Error('Only an occupied table can depart.')
    const hold = [...holds.values()].find(hold => hold.status === 'occupied' && hold.tableIds.includes(tableId) && !departedTables.get(hold.id)?.has(tableId))!
    const departed = departedTables.get(hold.id) ?? new Set<string>()
    departed.add(tableId)
    departedTables.set(hold.id, departed)
    revision++
  }
  return { snapshot, reserve, release, protect, paymentRejected, occupy, find, depart, get: (id: string) => ({ ...get(id), tableIds: [...get(id).tableIds] }) }
}
