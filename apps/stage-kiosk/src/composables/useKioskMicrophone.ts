import { useLocalStorage } from '@vueuse/core'

/** Operator preferences for the November master's browser-only acquisition. */
export function useKioskMicrophone() {
  const settings = useLocalStorage('kiosk/audio/browser-capture', { inputMode: 'auto' as 'auto' | 'uma8' | 'standard' })
  const mapping = useLocalStorage('kiosk/audio/array-mapping', '0,1,2,3,4,5,6')
  const radius = useLocalStorage('kiosk/audio/array-radius-mm', 44)
  const dynamicProcessing = useLocalStorage('kiosk/audio/dynamic-spatial-enabled', true)
  return { settings, mapping, radius, dynamicProcessing }
}
