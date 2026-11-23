import type { AudioWarning } from '@proj-airi/stage-shared/kiosk-audio'
import type { Ref } from 'vue'

import type { MicrophoneCaptureMode } from '../audio/microphoneInput'
import type { SpatialInput } from '../audio/spatialInput'

import { errorMessageFrom } from '@moeru/std'
import { useLocalStorage } from '@vueuse/core'
import { computed, onScopeDispose, readonly, shallowRef, watch } from 'vue'

import { orderingMessages } from '../../../../packages/i18n/src/orderingMessages'
import { arrayCaptureConstraints, arrayInputGainDb, dynamicInputGainDb, inspectChannels, selectProcessing, standardCaptureConstraints } from '../audio/microphoneInput'
import { createSpatialInput } from '../audio/spatialInput'

/**
 * Automatically routes each capture generation. The device store owns tracks;
 * this owner changes constraints, requests same-device reacquisition when needed,
 * and owns the optional Mask graph.
 * Device preference, geometry and explicit dynamic overrides persist; actual
 * channels select DSP anew. Native TTS state changes filters without graph resets.
 * LCMV remains on the test page.
 */
export function useArrayMicrophone(input: Ref<MediaStream | undefined>, enabled: Ref<boolean>, playback: Ref<boolean> = shallowRef(false), capture?: { mode: Readonly<Ref<MicrophoneCaptureMode>>, requestStandardCapture: () => void }) {
  const mode = shallowRef<'standard' | 'mask'>('standard')
  const captureMode = capture?.mode ?? shallowRef<MicrophoneCaptureMode>('raw')
  // Actual Worklet channels below still gate all spatial processing. The new
  // default-on policy has its own preference: the old opt-in key's false value
  // may only reflect its former default, not a current operator decision.
  // An explicit disable here persists and retains the soft-path fallback.
  const dynamicProcessing = useLocalStorage('kiosk/audio/dynamic-spatial-enabled', true)
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

  function disconnect(retireProbe = true) {
    if (retireProbe)
      probe?.abort()
    pcmSource.value?.dispose()
    pcmSource.value = undefined
    stream.value = undefined
  }
  watch([input, enabled, mapping, radius, dynamicProcessing, captureMode], ([raw, active]) => {
    const ticket = ++generation
    const profile = captureMode.value
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
          // A retired track must not request reacquisition for its replacement.
          if (ticket !== generation)
            return
          const applied = track!.getSettings()
          if ([applied.echoCancellation, applied.noiseSuppression, applied.autoGainControl].includes(false)) {
            // NOTICE: Chromium can resolve applyConstraints(true) while keeping
            // processing disabled after a raw acquisition (native browser
            // regression in useKioskMicrophoneSelection.browser.test.ts).
            // The device owner must reacquire the SAME pinned input. Its mode
            // marks the new stream, preventing another raw probe/retry loop.
            if (profile === 'raw' && capture) {
              status.value = 'reacquiring-standard'
              capture.requestStandardCapture()
              return
            }
            // NS/AGC support varies. Keep those actual states visible without
            // disabling a usable AEC-enabled microphone after the bounded retry.
            if (applied.echoCancellation === false)
              throw new Error(orderingMessages['zh-Hant'].arrayAudio.processingUnavailable)
          }
          // Browser echo processing may change channel count. Do not present the
          // raw array probe's channel count as the active standard capture count.
          const channels = await inspectChannels(raw!, current.signal)
          if (ticket !== generation)
            return
          channelCount.value = channels
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
        if (profile === 'standard') {
          // This stream was reacquired for ordinary speech after a real raw
          // probe. Do not disable its newly established browser processing.
          await standard()
          return
        }
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
        const processed = await createSpatialInput(raw, { generation: ticket, channelMap, radiusMm: radius.value, processing: dynamicProcessing.value ? 'dynamic' : 'soft', signal: current.signal, onWaiting: () => {
          if (ticket === generation)
            status.value = 'awaiting-interaction'
        }, onError: (reason) => {
          if (ticket !== generation || !attached || failureScheduled)
            return
          failureScheduled = true
          // Runtime failures fall back once for this generation. A restart or
          // replacement starts a new probe instead of permanently disabling Mask.
          // Keep the capture generation alive for its standard-channel probe.
          disconnect(false)
          lifecycle = lifecycle.then(() => standard(reason, 'mask_runtime'))
        } })
        if (ticket !== generation || current.signal.aborted) {
          processed.dispose()
          return
        }
        attached = true
        if (playback.value)
          processed.setPlayback(true)
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
  watch(playback, playing => pcmSource.value?.setPlayback(playing), { flush: 'sync' })
  // Field-trial +15dB lifts preserved weak speech, not bins removed by Binary.
  // Keep it fixed across TTS edges and retain the existing limiter. Restoring
  // Soft Mask's +65dB here would also amplify residual echo and clip gated Raw.
  const inputGainDb = computed(() => {
    if (mode.value !== 'mask')
      return 0
    return dynamicProcessing.value ? dynamicInputGainDb : arrayInputGainDb
  })
  const earlyBargeIn = computed(() => mode.value === 'mask' && Boolean(pcmSource.value) && dynamicProcessing.value)
  onScopeDispose(() => {
    ++generation
    disconnect()
  })
  return { dynamicProcessing, inputGainDb, earlyBargeIn, mode: readonly(mode), mapping, radius, stream, pcmSource, channelCount: readonly(channelCount), status, error, warning: readonly(warning) }
}
