import type { BackgroundSpeechMode } from '@proj-airi/stage-shared/kiosk-service-mode'

/** Local VAD evidence only. No transcript, semantic decision or commerce authority enters this policy. */
export interface SpeechInterruptionState {
  reason: 'idle' | 'semantic-required' | 'visual-required' | 'below-threshold' | 'collecting' | 'qualified'
  durationMs: number
}

/**
 * Binds fast playback interruption to one capture. Feed every VAD score, including
 * identical scores and silence. A 250 ms high-score run qualifies once; inference
 * gaps over 100 ms break the run. Ending ASR releases only its own capture owner.
 */
export function createSpeechInterruption() {
  let owner: number | undefined
  let startedAt: number | undefined
  let lastAt: number | undefined
  let qualified = false
  let state: SpeechInterruptionState = { reason: 'idle', durationMs: 0 }
  function reset() {
    owner = undefined
    startedAt = lastAt = undefined
    qualified = false
    state = { reason: 'idle', durationMs: 0 }
  }
  return {
    reset,
    begin(id: number) {
      reset()
      owner = id
    },
    release(id: number) {
      if (owner === id)
        reset()
    },
    snapshot: () => state,
    blocksPlayback: () => qualified,
    observe(id: number | undefined, timeMs: number, probability: number, threshold: number, visuallyValid: boolean, mode: BackgroundSpeechMode) {
      if (owner === undefined || id !== owner)
        return false
      // Observe reports semantic decisions without granting them a veto. Enforce
      // retains the existing post-ASR admission path, including on mode changes.
      if (mode === 'enforce') {
        qualified = false
        startedAt = lastAt = undefined
        state = { reason: 'semantic-required', durationMs: 0 }
        return false
      }
      if (qualified)
        return false
      if (!visuallyValid || !Number.isFinite(probability) || probability <= threshold) {
        startedAt = lastAt = undefined
        state = { reason: visuallyValid ? 'below-threshold' : 'visual-required', durationMs: 0 }
        return false
      }
      if (lastAt === undefined || timeMs <= lastAt || timeMs - lastAt > 100)
        startedAt = timeMs
      lastAt = timeMs
      const durationMs = timeMs - startedAt!
      qualified = durationMs >= 250
      state = { reason: qualified ? 'qualified' : 'collecting', durationMs }
      return qualified
    },
  }
}
