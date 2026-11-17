import type { SpeechRecognitionPolicy } from '@proj-airi/stage-shared/falcon-settings'

import { speechRecognitionPolicySchema } from '@proj-airi/stage-shared/falcon-settings'
import { parse } from 'valibot'
import { onScopeDispose, shallowRef, watch } from 'vue'

import { fetchSpeechRecognitionPolicy } from '../services/kiosk-device'

/** Live mode changes invalidate only unsubmitted capture/transcription, never accepted ordering work. */
export function useKioskSpeechRecognition(enabled: () => boolean, readPolicy = fetchSpeechRecognitionPolicy) {
  const policy = shallowRef<SpeechRecognitionPolicy>()
  const error = shallowRef(false)
  const captureSignal = shallowRef(new AbortController().signal)
  let capture = new AbortController()
  captureSignal.value = capture.signal
  let read: AbortController | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  function invalidate() {
    capture.abort()
    capture = new AbortController()
    captureSignal.value = capture.signal
  }
  async function refresh() {
    const current = new AbortController()
    read = current
    try {
      const next = parse(speechRecognitionPolicySchema, await readPolicy(AbortSignal.any([current.signal, AbortSignal.timeout(5000)])))
      if (disposed || current.signal.aborted || !enabled())
        return
      if (JSON.stringify(next) !== JSON.stringify(policy.value)) {
        invalidate()
        policy.value = next
      }
      error.value = false
    }
    catch {
      if (!current.signal.aborted)
        error.value = true
      // An unavailable read retains the last acknowledged mode. Before the
      // first successful read, capture waits rather than guessing a provider.
    }
    finally {
      if (!disposed && !current.signal.aborted && enabled())
        timer = setTimeout(() => void refresh(), 10_000)
    }
  }
  watch(enabled, (active) => {
    clearTimeout(timer)
    read?.abort()
    invalidate()
    policy.value = undefined
    if (active)
      void refresh()
  }, { immediate: true })
  onScopeDispose(() => {
    disposed = true
    clearTimeout(timer)
    read?.abort()
    capture.abort()
  })
  return { policy, error, captureSignal }
}
