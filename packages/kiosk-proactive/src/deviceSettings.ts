import type { BackgroundSpeechMode, ServiceMode } from '../../stage-shared/src/kioskServiceMode'
import type { KioskInteractionSettings } from './types'

import { defaultKioskInteractionSettings } from './interaction-settings'

/** Selects the local vision evidence used by the kiosk presence policy. */
export type PresenceVisionMode = 'face_only' | 'pose_only' | 'pose_plus_conditional_face'

/** Silero VAD segmenting policy, owned by a kiosk Site and applied on the device. */
export interface KioskVoiceVadSettings {
  threshold: number
  minSpeechDurationMs: number
  maxSpeechDurationS: number
  minSilenceDurationMs: number
  speechPadMs: number
}

export const defaultKioskVoiceVadSettings: KioskVoiceVadSettings = {
  threshold: 0.5,
  minSpeechDurationMs: 250,
  maxSpeechDurationS: 9999,
  minSilenceDurationMs: 250,
  speechPadMs: 2000,
}

/** Operational policy shared by Server, management UI, and the device runtime. */
export interface DeviceSettingsValues {
  serviceMode: ServiceMode
  backgroundSpeechMode: BackgroundSpeechMode
  /** Allows this device to use text input regardless of its shared voice-only Profile. */
  textOnlyMode: boolean
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
  mediaCaptureMode: 'off' | 'snapshot' | 'triggered' | 'continuous'
  /** MediaPipe acceptance threshold; lower values detect smaller/distant faces with more false positives. */
  faceDetectionConfidence: number
  proactiveVlmEnabled: boolean
  performanceProfile: 'constrained' | 'balanced' | 'high'
  /** Server-managed rollout switch for the anonymous local presence policy. */
  presenceVisionMode: PresenceVisionMode
  voiceVadSettings: KioskVoiceVadSettings
  /** Enables on-screen ASR and turn-policy diagnostics for this device only. */
  voiceDiagnosticsEnabled: boolean
  /** Shows the latest end-to-end LLM and browser-tool duration in the conversation pane. */
  conversationDiagnosticsEnabled: boolean
}

/** Stable allowlist; unknown fields must be rejected at the Server boundary. */
export const deviceSettingKeys = [
  'serviceMode',
  'backgroundSpeechMode',
  'textOnlyMode',
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
  'faceDetectionConfidence',
  'proactiveVlmEnabled',
  'performanceProfile',
  'presenceVisionMode',
  'voiceVadSettings',
  'voiceDiagnosticsEnabled',
  'conversationDiagnosticsEnabled',
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

/** Birth policy for newly enrolled devices; existing saved overrides remain authoritative. */
export const newDeviceSettings: DeviceSettings = {
  version: 1,
  localControls: ['observationEnabled', 'greetingEnabled', 'reminderEnabled', 'triggerMode', 'voiceDiagnosticsEnabled'],
  overrides: { observationEnabled: true, greetingEnabled: true, reminderEnabled: true, triggerMode: 'mixed', voiceDiagnosticsEnabled: true },
  localOverrides: {},
}

export const defaultDeviceSettingsValues: DeviceSettingsValues = {
  serviceMode: 'kiosk',
  backgroundSpeechMode: 'off',
  textOnlyMode: false,
  observationEnabled: false,
  greetingEnabled: false,
  reminderEnabled: false,
  triggerMode: 'attention',
  dwellMs: defaultKioskInteractionSettings.proactiveGreeting.dwellMs,
  emptyResetMs: 1500,
  minAttendingPeople: 1,
  reminderWaitMs: 20000,
  maxReminders: 2,
  zoneX: 0.2,
  zoneY: 0.15,
  zoneWidth: 0.6,
  zoneHeight: 0.7,
  mediaCaptureMode: 'off',
  faceDetectionConfidence: 0.6,
  proactiveVlmEnabled: false,
  performanceProfile: 'balanced',
  presenceVisionMode: 'pose_plus_conditional_face',
  voiceVadSettings: defaultKioskVoiceVadSettings,
  voiceDiagnosticsEnabled: false,
  conversationDiagnosticsEnabled: false,
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
