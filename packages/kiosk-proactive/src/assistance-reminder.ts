import type { AttentionObservation, KioskAssistanceReminderCandidate, KioskAssistanceReminderSettings } from './types'

/** Conservative defaults for the deterministic, local kiosk assistance reminder policy. */
export const defaultKioskAssistanceReminderSettings: KioskAssistanceReminderSettings = {
  enabled: true,
  waitMs: 40_000,
  maxRemindersPerSession: 2,
  reminderText: '現場參考：訪客仍停留在 kiosk 前，但暫時沒有操作。可視目前對話與頁面情境，低打擾地提供協助。',
}

/**
 * Enforces the local limits for an inactivity reminder without deciding its
 * wording or output channel. A future Agent adapter can evaluate each emitted
 * candidate, but cannot bypass presence, delay, or per-session count limits.
 */
export function createAssistanceReminderWindow(settings: KioskAssistanceReminderSettings) {
  let lastActivityAtMs: number | undefined
  let lastObservedAtMs = -Infinity
  let reminderCount = 0

  function start(observedAtMs: number) {
    validateTimestamp(observedAtMs, lastObservedAtMs)
    lastObservedAtMs = observedAtMs
    lastActivityAtMs = observedAtMs
    reminderCount = 0
  }

  function recordActivity(observedAtMs: number) {
    validateTimestamp(observedAtMs, lastObservedAtMs)
    lastObservedAtMs = observedAtMs
    lastActivityAtMs = observedAtMs
  }

  /**
   * Restarts the reminder delay after AIRI finishes work for the customer.
   * Unlike {@link recordActivity}, this preserves the session's reminder count
   * because it is a system lifecycle transition rather than visitor activity.
   */
  function restartWait(observedAtMs: number) {
    validateTimestamp(observedAtMs, lastObservedAtMs)
    lastObservedAtMs = observedAtMs
    if (lastActivityAtMs !== undefined)
      lastActivityAtMs = observedAtMs
  }

  function decide(observation: AttentionObservation): KioskAssistanceReminderCandidate | undefined {
    validateObservation(observation, lastObservedAtMs)
    lastObservedAtMs = observation.observedAtMs

    if (!settings.enabled || lastActivityAtMs === undefined || observation.presencePeople === 0)
      return undefined

    const inactiveForMs = observation.observedAtMs - lastActivityAtMs
    if (inactiveForMs < settings.waitMs || reminderCount >= settings.maxRemindersPerSession)
      return undefined

    reminderCount += 1
    // A reminder begins the next waiting interval. This avoids a new candidate
    // on every camera frame while still allowing a second bounded reminder.
    lastActivityAtMs = observation.observedAtMs
    return {
      observedAtMs: observation.observedAtMs,
      presencePeople: observation.presencePeople,
      reminderNumber: reminderCount,
      inactiveForMs,
    }
  }

  function reset() {
    lastActivityAtMs = undefined
    lastObservedAtMs = -Infinity
    reminderCount = 0
  }

  return { decide, recordActivity, reset, restartWait, start }
}

function validateTimestamp(observedAtMs: number, lastObservedAtMs: number) {
  if (!Number.isFinite(observedAtMs) || observedAtMs < lastObservedAtMs)
    throw new Error('Assistance reminder timestamps must be monotonic and finite')
}

function validateObservation(observation: AttentionObservation, lastObservedAtMs: number) {
  validateTimestamp(observation.observedAtMs, lastObservedAtMs)
  if (!Number.isInteger(observation.presencePeople) || observation.presencePeople < 0)
    throw new Error('presencePeople must be a non-negative integer')
}
