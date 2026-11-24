import { useLocalStorage } from '@vueuse/core'

/** Operator-only display preference for the customer conversation on this browser. */
export function useKioskConversationFontSize() {
  const fontSize = useLocalStorage('kiosk/conversation/font-size', 28)

  // Apply the new kiosk minimum to values saved before the setting changed.
  if (fontSize.value < 20)
    fontSize.value = 20

  return fontSize
}

export const defaultThoughtBubbleFontSize = 24

/** Stores the avatar bubble size independently of conversation text on this browser. */
export function useThoughtBubbleFontSize() {
  return useLocalStorage('kiosk/thought-bubble/font-size', defaultThoughtBubbleFontSize)
}
