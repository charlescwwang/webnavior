import { describe, expect, it } from 'vitest'

import { createAssistanceReminderWindow, defaultKioskAssistanceReminderSettings } from './assistance-reminder'

describe('createAssistanceReminderWindow', () => {
  it('requires a present visitor to remain inactive for the configured wait', () => {
    const window = createAssistanceReminderWindow({ ...defaultKioskAssistanceReminderSettings, waitMs: 1_000 })
    window.start(0)

    expect(window.decide({ observedAtMs: 999, attendingPeople: 0, presencePeople: 1 })).toBeUndefined()
    expect(window.decide({ observedAtMs: 1_000, attendingPeople: 0, presencePeople: 1 })).toMatchObject({
      inactiveForMs: 1_000,
      presencePeople: 1,
      reminderNumber: 1,
    })
  })

  it('restarts its timer after activity and stops at the session reminder limit', () => {
    const window = createAssistanceReminderWindow({
      ...defaultKioskAssistanceReminderSettings,
      waitMs: 1_000,
      maxRemindersPerSession: 2,
    })
    window.start(0)
    window.recordActivity(500)

    expect(window.decide({ observedAtMs: 1_499, attendingPeople: 0, presencePeople: 1 })).toBeUndefined()
    expect(window.decide({ observedAtMs: 1_500, attendingPeople: 0, presencePeople: 1 })).toMatchObject({ reminderNumber: 1 })
    expect(window.decide({ observedAtMs: 2_500, attendingPeople: 0, presencePeople: 1 })).toMatchObject({ reminderNumber: 2 })
    expect(window.decide({ observedAtMs: 3_500, attendingPeople: 0, presencePeople: 1 })).toBeUndefined()
  })

  it('does not create reminders while the calibrated area is empty', () => {
    const window = createAssistanceReminderWindow({ ...defaultKioskAssistanceReminderSettings, waitMs: 1_000 })
    window.start(0)

    expect(window.decide({ observedAtMs: 2_000, attendingPeople: 0, presencePeople: 0 })).toBeUndefined()
    expect(window.decide({ observedAtMs: 2_001, attendingPeople: 0, presencePeople: 1 })).toMatchObject({ reminderNumber: 1 })
  })

  it('restarts its wait after AIRI finishes system work without resetting reminder count', () => {
    const window = createAssistanceReminderWindow({ ...defaultKioskAssistanceReminderSettings, waitMs: 1_000 })
    window.start(0)
    expect(window.decide({ observedAtMs: 1_000, attendingPeople: 0, presencePeople: 1 })).toMatchObject({ reminderNumber: 1 })

    window.restartWait(1_500)
    expect(window.decide({ observedAtMs: 2_499, attendingPeople: 0, presencePeople: 1 })).toBeUndefined()
    expect(window.decide({ observedAtMs: 2_500, attendingPeople: 0, presencePeople: 1 })).toMatchObject({ reminderNumber: 2 })
  })
})
