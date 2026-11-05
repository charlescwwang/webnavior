import type { AudioWarning } from '@proj-airi/stage-shared/kiosk-audio'
import type { Ref } from 'vue'

import type { SpatialInput } from '../audio/spatialInput'

import { errorMessageFrom } from '@moeru/std'
import { useLocalStorage } from '@vueuse/core'
import { onScopeDispose, readonly, shallowRef, watch } from 'vue'

import { orderingMessages } from '../../../../packages/i18n/src/orderingMessages'
import { arrayCaptureConstraints, inspectChannels, selectProcessing, standardCaptureConstraints } from '../audio/microphoneInput'
import { createSpatialInput } from '../audio/spatialInput'

/**
 * Automatically routes each capture generation. The device store owns tracks;
 * this owner only changes their capture constraints and owns the optional Mask graph.
 * Only device preference and geometry persist; actual channels select DSP anew.
 * LCMV remains on the test page.
 */
export function useArrayMicrophone(input: Ref<MediaStream | undefined>, enabled: Ref<boolean>, constraints: Ref<MediaTrackConstraints | undefined>) {
  const mode = shallowRef<'standard' | 'mask'>('standard')
  const automaticDeviceSelection = useLocalStorage('kiosk/audio/automatic-device', true)
  const mapping = useLocalStorage('kiosk/audio/array-mapping', '0,1,2,3,4,5,6')
  const radius = useLocalStorage('kiosk/audio/array-radius-mm', 44)
  const stream = shallowRef<MediaStream>()
  const pcmSource = shallowRef<SpatialInput>()
  const channelCount = shallowRef<number>()
  const status = shallowRef('stopped')
  const error = shallowRef('')
  const warning = shallowRef<AudioWarning>()
  let generation = 0
  let probe: AbortController | undefined
  let lifecycle = Promise.resolve()

  // Set this before the device store opens getUserMedia, otherwise its normal
  // echo/noise processing may collapse an array into mono before detection.
  watch(automaticDeviceSelection, (automatic) => {
    // The shared store normally pins its saved/default deviceId. In automatic
    // mode, omit that pin so getUserMedia can rank all available microphones
    // against ideal8CH. This is a preference, never an exact8CH requirement;
    // ordinary microphones remain valid and actual Worklet channels decide DSP.
    constraints.value = { ...arrayCaptureConstraints, ...(automatic ? { deviceId: undefined } : {}) }
  }, { immediate: true, flush: 'sync' })
  function disconnect() {
    probe?.abort()
    pcmSource.value?.dispose()
    pcmSource.value = undefined
    stream.value = undefined
  }
  watch([input, enabled, mapping, radius], ([raw, active]) => {
    const ticket = ++generation
    disconnect()
    mode.value = 'standard'
    error.value = ''
    warning.value = undefined
    channelCount.value = undefined
    status.value = raw && active ? 'detecting' : 'stopped'
    const current = new AbortController()
    probe = current
    const track = raw?.getAudioTracks()[0]
    // Serialize applyConstraints too: a slow fallback on a borrowed track must
    // finish before a restart applies raw constraints to that same track.
    lifecycle = lifecycle.then(async () => {
      if (ticket !== generation || !raw || !active || !track)
        return
      const deviceId = track.getConstraints().deviceId
      async function standard(reason?: string, stage: AudioWarning['stage'] = 'capture') {
        if (ticket !== generation)
          return
        pcmSource.value?.dispose()
        pcmSource.value = undefined
        stream.value = undefined
        mode.value = 'standard'
        try {
          await track!.applyConstraints({ ...standardCaptureConstraints, ...(deviceId ? { deviceId } : {}) })
        }
        catch (cause) {
          // Never claim original capture has been restored if the device refused it.
          if (ticket === generation) {
            warning.value = { generation: ticket, stage, outcome: 'unavailable', ...(channelCount.value !== undefined ? { channels: channelCount.value } : {}) }
            status.value = 'error'
            error.value = errorMessageFrom(cause) ?? 'Standard microphone capture could not be restored.'
          }
          return
        }
        if (ticket !== generation)
          return
        warning.value = reason ? { generation: ticket, stage, outcome: 'standard', ...(channelCount.value !== undefined ? { channels: channelCount.value } : {}) } : undefined
        error.value = reason ? orderingMessages['zh-Hant'].arrayAudio.suppressionOff.replace('{reason}', reason) : ''
        status.value = reason ? 'fallback' : 'standard'
        stream.value = raw
      }
      let stage: AudioWarning['stage'] = 'capture'
      try {
        await track.applyConstraints({ ...arrayCaptureConstraints, ...(deviceId ? { deviceId } : {}) })
        if (ticket !== generation)
          return
        stage = 'channels'
        const channels = await inspectChannels(raw, current.signal, () => {
          if (ticket === generation)
            status.value = 'awaiting-interaction'
        })
        if (ticket !== generation)
          return
        channelCount.value = channels
        if (selectProcessing(channels) === 'standard') {
          await standard()
          return
        }
        stage = 'mask_init'
        const channelMap = mapping.value.split(',').map(value => Number(value.trim()))
        if (channelMap.length !== 7 || new Set(channelMap).size !== 7 || channelMap.some(ch => !Number.isInteger(ch) || ch < 0 || ch > 7))
          throw new Error('Seven distinct hardware channels (0..7) are required.')
        let attached = false
        let failureScheduled = false
        const processed = await createSpatialInput(raw, { generation: ticket, channelMap, radiusMm: radius.value, signal: current.signal, onWaiting: () => {
          if (ticket === generation)
            status.value = 'awaiting-interaction'
        }, onError: (reason) => {
          if (ticket !== generation || !attached || failureScheduled)
            return
          failureScheduled = true
          // Runtime failures fall back once for this generation. A restart or
          // replacement starts a new probe instead of permanently disabling Mask.
          disconnect()
          lifecycle = lifecycle.then(() => standard(reason, 'mask_runtime'))
        } })
        if (ticket !== generation || current.signal.aborted) {
          processed.dispose()
          return
        }
        attached = true
        pcmSource.value = processed
        mode.value = 'mask'
        stream.value = raw
        status.value = 'ready'
      }
      catch (cause) {
        if (ticket === generation)
          await standard(errorMessageFrom(cause) ?? 'Microphone direction suppression unavailable.', stage)
      }
    }).catch((cause) => {
      if (ticket === generation) {
        status.value = 'error'
        error.value = errorMessageFrom(cause) ?? 'Microphone initialization failed.'
      }
    })
  }, { immediate: true, flush: 'sync' })
  onScopeDispose(() => {
    ++generation
    disconnect()
    constraints.value = undefined
  })
  return { automaticDeviceSelection, mode: readonly(mode), mapping, radius, stream, pcmSource, channelCount: readonly(channelCount), status, error, warning: readonly(warning) }
}
