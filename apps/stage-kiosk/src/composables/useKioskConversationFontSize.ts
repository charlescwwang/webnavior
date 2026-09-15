import { useLocalStorage } from '@vueuse/core'

/** Operator-only display preference for the customer conversation on this browser. */
export function useKioskConversationFontSize() {
  const fontSize = useLocalStorage('kiosk/conversation/font-size', 20)

  // Apply the new kiosk minimum to values saved before the setting changed.
  if (fontSize.value < 20)
    fontSize.value = 20

  return fontSize
}
