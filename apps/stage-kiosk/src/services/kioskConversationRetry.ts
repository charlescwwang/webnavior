const retrySafeToolNames = new Set([
  'cart_get',
  'kiosk_session_history',
  'menu_get',
  'menu_recommend',
  'menu_show_recommendations',
])

/**
 * A timed-out turn is replayable only before it attempts an order mutation.
 * Repeating a lookup is harmless; repeating an add, edit, checkout, or
 * payment action can create a duplicate customer operation.
 */
export function isKioskConversationRetrySafeTool(toolName: string) {
  return retrySafeToolNames.has(toolName)
}
