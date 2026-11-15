import { expect, it } from 'vitest'

import { invoiceCode } from './invoiceInput'

it('accepts the existing scanner formats without guessing a missing character', () => {
  expect(invoiceCode('carrier', ' /ab12+.-\r\n')).toBe('/AB12+.-')
  expect(invoiceCode('citizen', 'ab12345678901234')).toBe('AB12345678901234')
  expect(invoiceCode('carrier', '/AB123')).toBeUndefined()
  expect(invoiceCode('carrier', '0912345678')).toBeUndefined()
  expect(invoiceCode('citizen', '/AB12345')).toBeUndefined()
  expect(invoiceCode('carrier', '/AB 1234')).toBeUndefined()
})
