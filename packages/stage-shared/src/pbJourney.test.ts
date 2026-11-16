import { expect, it } from 'vitest'

import { isPbJourneyPage, isPbOrderResultUrl, isPbTableEntryUrl, readPbJourney } from './pbJourney'

const entry = 'https://app-205-rd.esgpb.com/order/store/1kAMNok/internal_use/menu/select-table'
// Report: this chat, 2026-11-16 — the merchant checkout incorrectly required manual submission.
it('enables confirmed submission only for the authorized dining deployment and owned simulator', () => {
  expect(readPbJourney('https://app.esgpb.com/order/store/1kgJeql/internal_use/orders/create')?.canSubmit).toBe(true)
  expect(readPbJourney('http://127.0.0.1:5188/order/store/1kgJeql/internal_use/orders/create')?.canSubmit).toBe(true)
  expect(readPbJourney('https://app.esgpb.com/order/store/1kgJeql/pick_up/orders/create')?.canSubmit).toBe(false)
  expect(readPbJourney(entry)?.canSubmit).toBe(false)
  expect(readPbJourney('https://other.example/order/store/1kgJeql/internal_use/orders/create')).toBeUndefined()
})
it('admits only the fixed local PB simulator without extending the merchant journey', () => {
  const local = 'http://127.0.0.1:5188/order/store/1kgJeql/internal_use/menu/select-table'
  expect(readPbJourney(local)?.buyer).toBe('guest')
  expect(isPbJourneyPage(local, local.replace('/menu/select-table', '/orders/create'))).toBe(true)
  expect(isPbJourneyPage(entry, local)).toBe(false)
  expect(readPbJourney(local.replace(':5188', ':5189'))).toBeUndefined()
  expect(readPbJourney(local.replace('127.0.0.1', 'localhost'))).toBeUndefined()
  expect(readPbJourney(local.replace('1kgJeql', 'other'))).toBeUndefined()
  expect(readPbJourney(local.replace('internal_use', 'pick_up'))).toBeUndefined()
  expect(readPbJourney(local.replace('/menu/select-table', '/orders/TEST-1/payment'))).toBeUndefined()
})
it('keeps table, menu and cart in one guest journey without admitting other stores or old member services', () => {
  expect(readPbJourney(entry)).toMatchObject({ buyer: 'guest', store: '1kAMNok', flow: 'internal_use' })
  expect(isPbJourneyPage(entry, entry.replace('/menu/select-table', '/orders/create'))).toBe(true)
  expect(isPbJourneyPage(entry, entry.replace('/menu/select-table', '/menu?query=飯'))).toBe(true)
  expect(isPbJourneyPage(entry, 'https://app.esgpb.com/order/store/1kgJeql/pick_up/menu')).toBe(false)
  expect(readPbJourney(entry.replace('1kAMNok', 'other-store'))).toBeUndefined()
  expect(readPbJourney(entry.replace('internal_use', 'pick_up'))).toBeUndefined()
  expect(readPbJourney(entry.replace('/menu/select-table', '/orders/submit'))).toBeUndefined()
  expect(readPbJourney(entry.replace('https://', 'https://user:secret@'))).toBeUndefined()
  expect(readPbJourney('https://app.esgpb.com/order/store/1kgJeql/pick_up/menu')?.buyer).toBe('member')
})

it('accepts only the reviewed table QR intermediary for an entry acknowledgement, never tool execution', () => {
  const qr = 'https://app-205-rd.esgpb.com/order/t/fixture-table-token'
  expect(isPbTableEntryUrl(entry, qr)).toBe(true)
  expect(readPbJourney(qr)).toBeUndefined()
  expect(isPbJourneyPage(entry, qr)).toBe(false)
  expect(isPbTableEntryUrl(entry, qr.replace('app-205-rd.esgpb.com', 'other.example'))).toBe(false)
  expect(isPbTableEntryUrl(entry, `${qr}/extra`)).toBe(false)
  expect(isPbTableEntryUrl(entry, `${qr}?redirect=elsewhere`)).toBe(false)
  expect(isPbTableEntryUrl(entry, `${qr}#fragment`)).toBe(false)
  expect(isPbTableEntryUrl(entry.replace('/select-table', ''), qr)).toBe(false)
})

// Report: this chat, 2026-11-14 — the current PB site replaced the RD deployment.
it('admits the approved current dining journey without crossing flow, origin or store', () => {
  const current = 'https://app.esgpb.com/order/store/1kgJeql/internal_use/menu/select-table'
  expect(readPbJourney(current)).toMatchObject({ flow: 'internal_use', buyer: 'guest' })
  expect(isPbJourneyPage(current, current.replace('/select-table', ''))).toBe(true)
  expect(isPbJourneyPage(current, current.replace('/menu/select-table', '/orders/create'))).toBe(true)
  expect(isPbJourneyPage(current, current.replace('internal_use', 'pick_up'))).toBe(false)
  expect(isPbJourneyPage(current, current.replace('1kgJeql', 'other'))).toBe(false)
  expect(isPbTableEntryUrl(current, 'https://app.esgpb.com/order/t/synthetic-token')).toBe(true)
})

// Report: this chat, 2026-11-15 — PB submission reaches choosePayment, not payment.
it('acknowledges the current payment chooser only within the configured order journey', () => {
  const local = 'http://127.0.0.1:5188/order/store/1kgJeql/internal_use/menu/select-table'
  const result = local.replace('/menu/select-table', '/orders/TEST-1')
  expect(isPbOrderResultUrl(local, `${result}/choosePayment`)).toBe(true)
  expect(isPbOrderResultUrl(local, result)).toBe(true)
  expect(isPbOrderResultUrl(local, `${result}/payment`)).toBe(false)
  expect(isPbOrderResultUrl(local, `${result}/choosePayment?redirect=elsewhere`)).toBe(false)
  expect(isPbOrderResultUrl(local, result.replace('1kgJeql', 'other'))).toBe(false)
  expect(isPbOrderResultUrl(local, result.replace(':5188', ':5189'))).toBe(false)
  expect(isPbOrderResultUrl(local, result.replace('TEST-1', 'create'))).toBe(false)
})
