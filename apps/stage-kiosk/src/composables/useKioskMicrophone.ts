import type { HushSettings } from '@proj-airi/stage-shared/kiosk-native-audio'

import type { ArrayProcessing } from '../audio/captureProtocol'

import { hushSettingsSchema } from '@proj-airi/stage-shared/kiosk-native-audio'
import { useLocalStorage } from '@vueuse/core'
import { parse } from 'valibot'
import { computed } from 'vue'

import { defaultLcmv, validateLcmv } from '../audio/tuning'

/** Documented comparison presets; applying one preserves microphone mapping and gain. */
export const hushPresets = [
  { id: 'preset-a', attenuationDb: 20, dryMixPercent: 30 },
  { id: 'preset-b', attenuationDb: 20, dryMixPercent: 10 },
  { id: 'preset-baseline', attenuationDb: 100, dryMixPercent: 0 },
] satisfies (HushSettings & { id: string })[]

/** Local hardware preferences, for native and browser capture. */
export function useKioskMicrophone() {
  // Model startup alone does not qualify continuous capture. Opt in explicitly;
  // keep each pipeline's tuning so returning to existing capture is reversible.
  const processingBackend = useLocalStorage<'existing' | 'native-hush'>('kiosk/audio/array-backend', 'existing')
  const arrayInputDevice = useLocalStorage('kiosk/audio/native-lcmv-input', '')
  const nativeSelected = computed(() => processingBackend.value === 'native-hush')
  const algorithm = useLocalStorage<'lcmv' | 'spatial-mask'>('kiosk/audio/legacy-array-algorithm', 'lcmv')
  const spatialMask = useLocalStorage('kiosk/audio/spatial-mask', { aec3Enabled: true, gainDb: 15 })
  const nativeSettings = useLocalStorage('kiosk/audio/native-hush', { channelMap: '0,1,2,3,4,5,6', gainDb: 30, inputDevice: '', hush: { attenuationDb: 100, dryMixPercent: 0 } }, { mergeDefaults: true })
  const settings = useLocalStorage('kiosk/audio/microphone-processing', {
    inputMode: 'auto' as 'auto' | 'uma8' | 'standard',
    channelMap: '0,1,2,3,4,5,6',
    radiusMm: 44,
    gainDb: 15,
    ...defaultLcmv,
  })
  // Array selections require explicit apply; standard microphones are an
  // independent hardware choice and never load an array backend.
  const backendAvailable = computed(() => settings.value.inputMode === 'standard' || processingBackend.value === 'existing' || processingBackend.value === 'native-hush')
  return {
    /** Desktop acquisition policy; standard and Mask keep their existing sources. */
    usesNativeLcmv(array: boolean) {
      return array && processingBackend.value === 'existing' && algorithm.value === 'lcmv'
    },
    arrayInputDevice,
    processingBackend,
    backendAvailable,
    nativeSelected,
    settings,
    nativeSettings,
    /** Native RTF owns its gain and mapping, independently of the existing beamformers. */
    nativeConfiguration(value = nativeSettings.value) {
      const channels = value.channelMap.split(',').map(part => Number(part.trim()))
      if (!/^\s*[0-7](?:\s*,\s*[0-7]){6}\s*$/.test(value.channelMap) || channels.length !== 7 || new Set(channels).size !== 7 || channels.some(channel => !Number.isInteger(channel) || channel < 0 || channel > 7)
        || !Number.isFinite(value.gainDb) || value.gainDb < 0 || value.gainDb > 40) {
        throw new Error('Native UMA-8 requires seven physical channels and gain between 0 and 40 dB.')
      }
      return { channels, gainDb: value.gainDb, inputDevice: value.inputDevice ?? '', hush: parse(hushSettingsSchema, value.hush) }
    },
    algorithm,
    spatialMask,
    /** Save a complete new configuration; the Scene replaces its capture generation. */
    applySpatialSettings(nextAlgorithm: 'lcmv' | 'spatial-mask', next: { aec3Enabled: boolean, gainDb: number }) {
      validateSpatialSettings(nextAlgorithm, next)
      spatialMask.value = { ...next }
      algorithm.value = nextAlgorithm
    },
    isArray(label: string) {
      return settings.value.inputMode === 'uma8' || (settings.value.inputMode === 'auto' && /uma[\s_-]*8|miniDSP.*micArray/i.test(label))
    },
    configuration() {
      const value = settings.value
      const selected = algorithm.value
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
      return { processing, channelMap, radiusMm: value.radiusMm, gainDb }
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
