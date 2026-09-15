import { useLocalStorage } from '@vueuse/core'

export interface KioskAudioStatusPosition {
  x: number
  y: number
}

/** Stores the operator-selected location of the kiosk's status overlay. */
export function useKioskAudioStatusPosition() {
  return useLocalStorage<KioskAudioStatusPosition>('kiosk/audio-status-position', { x: 50, y: 50 })
}
