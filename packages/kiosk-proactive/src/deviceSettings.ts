import type { KioskInteractionSettings } from './types'

import { defaultKioskInteractionSettings } from './interaction-settings'

/** Operational policy shared by Server, management UI, and the device runtime. */
export interface DeviceSettingsValues {
  observationEnabled: boolean
  greetingEnabled: boolean
  reminderEnabled: boolean
  triggerMode: 'attention' | 'presence' | 'mixed'
  dwellMs: number
  emptyResetMs: number
  minAttendingPeople: number
  reminderWaitMs: number
  maxReminders: number
  zoneX: number
  zoneY: number
  zoneWidth: number
  zoneHeight: number
  mediaCaptureMode: 'off' | 'triggered' | 'continuous'
  proactiveVlmEnabled: boolean
  performanceProfile: 'constrained' | 'balanced' | 'high'
  voiceVadThreshold: number
}

/** Stable allowlist; unknown fields must be rejected at the Server boundary. */
export const deviceSettingKeys = [
  'observationEnabled',
  'greetingEnabled',
  'reminderEnabled',
  'triggerMode',
  'dwellMs',
  'emptyResetMs',
  'minAttendingPeople',
  'reminderWaitMs',
  'maxReminders',
  'zoneX',
  'zoneY',
  'zoneWidth',
  'zoneHeight',
  'mediaCaptureMode',
  'proactiveVlmEnabled',
  'performanceProfile',
  'voiceVadThreshold',
] as const satisfies readonly (keyof DeviceSettingsValues)[]

export type DeviceSettingKey = typeof deviceSettingKeys[number]

/** Admin and local overrides are separate so revocation can discard local values. */
export interface DeviceSettings {
  version: number
  localControls: DeviceSettingKey[]
  overrides: Partial<DeviceSettingsValues>
  localOverrides: Partial<DeviceSettingsValues>
}

/** Snapshot read at a revision; writes compare the revision and never silently merge. */
export interface DeviceSettingsSnapshot {
  deviceId: string
  settings: DeviceSettings
  defaults: DeviceSettingsValues
  effective: DeviceSettingsValues
}

export const defaultDeviceSettings: DeviceSettings = {
  version: 1,
  localControls: [],
  overrides: {},
  localOverrides: {},
}

export const defaultDeviceSettingsValues: DeviceSettingsValues = {
  observationEnabled: false,
  greetingEnabled: false,
  reminderEnabled: false,
  triggerMode: 'attention',
  dwellMs: 2500,
  emptyResetMs: 1500,
  minAttendingPeople: 1,
  reminderWaitMs: 20000,
  maxReminders: 2,
  zoneX: 0.2,
  zoneY: 0.15,
  zoneWidth: 0.6,
  zoneHeight: 0.7,
  mediaCaptureMode: 'off',
  proactiveVlmEnabled: false,
  performanceProfile: 'balanced',
  voiceVadThreshold: 0.72,
}

/** Site defaults < administrator device overrides < explicitly delegated local overrides. */
export function resolveDeviceSettings(defaults: DeviceSettingsValues, settings: DeviceSettings): DeviceSettingsValues {
  const delegated = Object.fromEntries(Object.entries(settings.localOverrides)
    .filter(([key]) => settings.localControls.includes(key as DeviceSettingKey)))
  return { ...defaults, ...settings.overrides, ...delegated }
}

/** Projects Server-owned device values onto the existing local observation state machine. */
export function observationSettings(values: DeviceSettingsValues): KioskInteractionSettings {
  return {
    ...defaultKioskInteractionSettings,
    observation: {
      enabled: values.observationEnabled,
      detectionZone: { x: values.zoneX, y: values.zoneY, width: values.zoneWidth, height: values.zoneHeight },
    },
    proactiveGreeting: {
      ...defaultKioskInteractionSettings.proactiveGreeting,
      enabled: values.greetingEnabled,
      triggerMode: values.triggerMode,
      dwellMs: values.dwellMs,
      emptyResetMs: values.emptyResetMs,
      minAttendingPeople: values.minAttendingPeople,
    },
    assistanceReminder: {
      ...defaultKioskInteractionSettings.assistanceReminder,
      enabled: values.reminderEnabled,
      waitMs: values.reminderWaitMs,
      maxRemindersPerSession: values.maxReminders,
    },
  }
}
