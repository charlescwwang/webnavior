/** Supplier-owned current table inventory; no customer identity is exposed. */
export interface SeatingSnapshot {
  revision: number
  tables: Array<{ id: string, label: string, capacity: number, status: 'free' | 'held' | 'occupied' }>
}

/** The hold ID is a private bearer capability, never a Jev domain reference. */
export interface TableHold {
  id: string
  partySize: number
  tableIds: string[]
  expiresAt: number
  status: 'held' | 'locked' | 'occupied' | 'released' | 'expired'
}

export interface HoldRequest {
  expectedRevision: number
  partySize: number
  tableIds: string[]
  splitApproved: boolean
}

/** Reservation and post-order scan binding are separate supported seating policies. */
export type TableAssignment = 'reservation' | 'after-order'
