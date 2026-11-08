/** Host-only operations must never enter the conversational Agent's tool list. */
export const hostToolNames = [
  'kiosk_test_menu',
  'kiosk_customer_entry_start',
  'kiosk_customer_phone',
  'kiosk_fast_path_clarify',
  'kiosk_interaction_state',
  'kiosk_conversation_context',
  'kiosk_fast_path_context',
  'kiosk_fast_path_execute',
  'kiosk_fast_path_continue',
  'kiosk_dialogue_presented',
  'kiosk_question_validate',
  'kiosk_agent_task',
  'kiosk_query_scope',
  'kiosk_ordering_reset',
] as const

/** Names shared by native registration and the embedding host's tool filter. */
export type HostToolName = typeof hostToolNames[number]
