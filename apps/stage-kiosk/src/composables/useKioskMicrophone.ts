import type { SpeechRecognitionPolicy } from '@proj-airi/stage-shared/falcon-settings'

import type { ArrayProcessing } from '../audio/captureProtocol'

import { useLocalStorage } from '@vueuse/core'

import { defaultLcmv, validateLcmv } from '../audio/tuning'

/** Local hardware preferences, independent of the Server's ASR/Falcon recognition mode. */
export function useKioskMicrophone() {
  const algorithm = useLocalStorage<'lcmv' | 'spatial-mask'>('kiosk/audio/legacy-array-algorithm', 'lcmv')
  const spatialMask = useLocalStorage('kiosk/audio/spatial-mask', { aec3Enabled: true, gainDb: 15 })
  const falconGainDb = useLocalStorage('kiosk/audio/falcon-input-gain-db', 0)
  const settings = useLocalStorage('kiosk/audio/microphone-processing', {
    inputMode: 'auto' as 'auto' | 'uma8' | 'standard',
    channelMap: '0,1,2,3,4,5,6',
    radiusMm: 44,
    gainDb: 15,
    ...defaultLcmv,
  })
  return {
    settings,
    falconGainDb,
    algorithm,
    spatialMask,
    /** Save a complete new configuration; the Scene replaces its capture generation. */
    applySpatialSettings(nextAlgorithm: 'lcmv' | 'spatial-mask', next: { aec3Enabled: boolean, gainDb: number }) {
      validateSpatialSettings(nextAlgorithm, next)
      spatialMask.value = { ...next }
      algorithm.value = nextAlgorithm
    },
    isArray(label: string) {
      return settings.value.inputMode === 'uma8' || (settings.value.inputMode === 'auto' && /uma[\s_-]*8/i.test(label))
    },
    configuration(mode: SpeechRecognitionPolicy['mode'] = 'legacy') {
      const value = settings.value
      // Falcon retains LCMV even when a legacy Mask preference is saved.
      const selected = mode === 'falcon' ? 'lcmv' : algorithm.value
      let processing: ArrayProcessing
      let gainDb: number
      if (selected === 'spatial-mask') {
        validateSpatialSettings(selected, spatialMask.value)
        processing = { algorithm: selected, aec3Enabled: spatialMask.value.aec3Enabled }
        gainDb = spatialMask.value.gainDb
      }
      else {
        if (selected !== 'lcmv')
          throw new Error('Unknown array algorithm.')
        validateLcmv(value)
        processing = { algorithm: 'lcmv', tuning: { ...value } }
        gainDb = value.gainDb
      }
      const channelMap = value.channelMap.split(',').map(value => Number(value.trim()))
      if (!/^\s*[0-7](?:\s*,\s*[0-7]){6}\s*$/.test(value.channelMap) || channelMap.length !== 7 || new Set(channelMap).size !== 7 || channelMap.some(index => !Number.isInteger(index) || index < 0 || index > 7))
        throw new Error('UMA-8 requires seven distinct mapped channels (0–7).')
      if (!Number.isFinite(value.radiusMm) || value.radiusMm < 10 || value.radiusMm > 100 || !Number.isFinite(value.gainDb) || value.gainDb < 0 || value.gainDb > 30)
        throw new Error('Invalid UMA-8 radius or input gain.')
      if (!Number.isFinite(falconGainDb.value) || falconGainDb.value < 0 || falconGainDb.value > 30)
        throw new Error('Falcon input gain must be between 0 and 30 dB.')
      return { processing, channelMap, radiusMm: value.radiusMm, gainDb, falconGainDb: falconGainDb.value }
    },
  }
}

/** Reject invalid saved or draft Mask settings before replacing a live capture. */
function validateSpatialSettings(algorithm: string, settings: { aec3Enabled: boolean, gainDb: number }) {
  if (algorithm !== 'lcmv' && algorithm !== 'spatial-mask')
    throw new Error('Unknown array algorithm.')
  if (typeof settings.aec3Enabled !== 'boolean' || !Number.isFinite(settings.gainDb) || settings.gainDb < 0 || settings.gainDb > 80)
    throw new Error('Spatial Mask requires an AEC3 boolean and gain between 0 and 80 dB.')
}
