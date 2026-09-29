import { describe, expect, it } from 'vitest'

import { isKioskConversationRetrySafeTool } from './kioskConversationRetry'

describe('kiosk conversation retry safety', () => {
  it('only allows a replay after read-only menu and cart tools', () => {
    expect(isKioskConversationRetrySafeTool('menu_recommend')).toBe(true)
    expect(isKioskConversationRetrySafeTool('cart_get')).toBe(true)
    expect(isKioskConversationRetrySafeTool('kiosk_session_history')).toBe(true)
    expect(isKioskConversationRetrySafeTool('order_add_item')).toBe(false)
    expect(isKioskConversationRetrySafeTool('cart_set_line_quantity')).toBe(false)
    expect(isKioskConversationRetrySafeTool('checkout_select_payment')).toBe(false)
  })
})
