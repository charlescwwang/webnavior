import type { MaybeRefOrGetter } from 'vue'

import { errorMessageFrom } from '@moeru/std'
import { shallowRef, toValue, watch } from 'vue'

/** Attaches external speech to a visual analyser without owning or stopping audible playback. */
export function useExternalSpeechSource(
  source: MaybeRefOrGetter<AudioNode | undefined>,
  enabled: MaybeRefOrGetter<boolean>,
  prepareTarget: () => Promise<AudioNode | undefined>,
) {
  const active = shallowRef(false)
  watch([() => toValue(source), () => toValue(enabled)], async ([node, allowed], _previous, onCleanup) => {
    if (!node || !allowed)
      return
    let retired = false
    let connected: AudioNode | undefined
    onCleanup(() => {
      retired = true
      active.value = false
      if (!connected)
        return
      try {
        // Disconnect only this visual branch. The caller retains its speaker
        // connection and may already have disconnected every branch on stop.
        node.disconnect(connected)
      }
      catch { /* An already-disconnected source needs no further visual cleanup. */ }
    })
    try {
      const target = await prepareTarget()
      if (retired || !target)
        return
      node.connect(target)
      connected = target
      active.value = true
    }
    catch (error) {
      // Mouth sync is optional presentation; its failure must not stop TTS.
      console.warn('Could not attach external speech lip sync:', errorMessageFrom(error))
    }
  }, { immediate: true })
  return active
}
