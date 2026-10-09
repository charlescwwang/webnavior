import { describe, expect, it } from 'vitest'

import { createSeating } from './seating'

describe('simulated current table holds', () => {
  it('allows staff departure only for occupied tables at the observed revision', () => {
    const seating = createSeating()
    const hold = seating.reserve({ expectedRevision: 0, partySize: 5, tableIds: ['T1', 'T2'], splitApproved: true })
    expect(() => seating.depart('T1', seating.snapshot().revision)).toThrow('occupied')
    seating.protect(hold.id)
    expect(() => seating.depart('T1', seating.snapshot().revision)).toThrow('occupied')
    seating.occupy(hold.id)
    const revision = seating.snapshot().revision
    expect(() => seating.depart('T1', revision - 1)).toThrow('revision')
    seating.depart('T1', revision)
    expect(seating.snapshot().tables[0]?.status).toBe('free')
    expect(seating.snapshot().tables[1]?.status).toBe('occupied')
  })
  it('claims four-person tables atomically and releases an unpaid hold after ten minutes', () => {
    let now = 1000
    const seating = createSeating(() => now)
    expect(seating.snapshot().tables).toHaveLength(5)
    const hold = seating.reserve({ expectedRevision: seating.snapshot().revision, partySize: 4, tableIds: ['T1'], splitApproved: false })
    expect(hold.expiresAt).toBe(601000)
    expect(() => seating.reserve({ expectedRevision: seating.snapshot().revision, partySize: 2, tableIds: ['T1'], splitApproved: false })).toThrow('available')
    now = 601000
    expect(seating.snapshot().tables[0]?.status).toBe('free')
    expect(() => seating.protect(hold.id)).toThrow('expired')
    expect(seating.reserve({ expectedRevision: seating.snapshot().revision, partySize: 2, tableIds: ['T1'], splitApproved: false }).status).toBe('held')
  })

  it('requires exact capacity and explicit approval before dividing a party', () => {
    const seating = createSeating()
    expect(() => seating.reserve({ expectedRevision: seating.snapshot().revision, partySize: 5, tableIds: ['T1'], splitApproved: true })).toThrow('required')
    expect(() => seating.reserve({ expectedRevision: seating.snapshot().revision, partySize: 5, tableIds: ['T1', 'T2'], splitApproved: false })).toThrow('approval')
    expect(() => seating.reserve({ expectedRevision: seating.snapshot().revision, partySize: 2, tableIds: ['T1', 'T2'], splitApproved: true })).toThrow('required')
    expect(() => seating.reserve({ expectedRevision: seating.snapshot().revision, partySize: 5, tableIds: ['T1', 'T1'], splitApproved: true })).toThrow('required')
    expect(seating.reserve({ expectedRevision: seating.snapshot().revision, partySize: 5, tableIds: ['T1', 'T2'], splitApproved: true }).tableIds).toEqual(['T1', 'T2'])
  })

  it('does not release unresolved payment or occupied tables at expiry', () => {
    let now = 0
    const seating = createSeating(() => now)
    const hold = seating.reserve({ expectedRevision: seating.snapshot().revision, partySize: 3, tableIds: ['T1'], splitApproved: false })
    seating.protect(hold.id)
    now = 600001
    expect(seating.snapshot().tables[0]?.status).toBe('held')
    expect(() => seating.release(hold.id)).toThrow('Payment')
    expect(() => seating.protect(hold.id)).toThrow('already')
    seating.occupy(hold.id)
    seating.occupy(hold.id)
    expect(seating.snapshot().tables[0]?.status).toBe('occupied')
    expect(() => seating.release(hold.id)).toThrow('occupancy')
  })

  it('returns rejected payment to the original deadline, never renews it', () => {
    let now = 0
    const seating = createSeating(() => now)
    const hold = seating.reserve({ expectedRevision: seating.snapshot().revision, partySize: 1, tableIds: ['T1'], splitApproved: false })
    seating.protect(hold.id)
    now = 600001
    seating.paymentRejected(hold.id)
    expect(seating.snapshot().tables[0]?.status).toBe('free')
  })

  it('releases an unpaid claim idempotently without freeing someone else’s table', () => {
    const seating = createSeating()
    const hold = seating.reserve({ expectedRevision: seating.snapshot().revision, partySize: 4, tableIds: ['T1'], splitApproved: false })
    seating.release(hold.id)
    const other = seating.reserve({ expectedRevision: seating.snapshot().revision, partySize: 1, tableIds: ['T1'], splitApproved: false })
    seating.release(hold.id)
    expect(seating.get(other.id).status).toBe('held')
  })
})
