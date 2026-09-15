import type { DeviceSettingsValues } from '@proj-airi/kiosk-proactive'

import { deviceSettingKeys } from '@proj-airi/kiosk-proactive'
import { array, boolean, integer, maxValue, minValue, number, optional, partial, picklist, pipe, safeParse, strictObject } from 'valibot'

import { createBadRequestError } from '../../../utils/error'

const duration = pipe(number(), integer(), minValue(0), maxValue(600000))
const fraction = pipe(number(), minValue(0), maxValue(1))
const overrides = partial(strictObject({
  observationEnabled: boolean(),
  greetingEnabled: boolean(),
  reminderEnabled: boolean(),
  triggerMode: picklist(['attention', 'presence', 'mixed']),
  dwellMs: duration,
  emptyResetMs: duration,
  minAttendingPeople: pipe(number(), integer(), minValue(1), maxValue(10)),
  reminderWaitMs: duration,
  maxReminders: pipe(number(), integer(), minValue(0), maxValue(10)),
  zoneX: fraction,
  zoneY: fraction,
  zoneWidth: pipe(number(), minValue(0.01), maxValue(1)),
  zoneHeight: pipe(number(), minValue(0.01), maxValue(1)),
  mediaCaptureMode: picklist(['off', 'snapshot', 'triggered', 'continuous']),
  faceDetectionConfidence: pipe(number(), minValue(0.4), maxValue(0.8)),
  proactiveVlmEnabled: boolean(),
  performanceProfile: picklist(['constrained', 'balanced', 'high']),
  voiceVadThreshold: pipe(number(), minValue(0.5), maxValue(0.95)),
}))
const version = pipe(number(), integer(), minValue(1))

export const localDeviceSettingsSchema = strictObject({ version, overrides })
export const adminDeviceSettingsSchema = strictObject({
  version,
  overrides,
  localControls: array(picklist(deviceSettingKeys)),
  clearLocalOverrides: optional(array(picklist(deviceSettingKeys)), []),
})

/** Also check the resolved rectangle: individually valid overrides may exceed its bounds. */
export function assertDetectionZone(values: DeviceSettingsValues) {
  if (values.zoneX + values.zoneWidth > 1.000001 || values.zoneY + values.zoneHeight > 1.000001)
    throw createBadRequestError('Detection zone must stay inside the camera image', 'INVALID_REQUEST')
}

/** Strict input parsing rejects unknown fields, including forged delegation in local requests. */
export function parseSettingsChange(source: 'admin' | 'local', body: unknown) {
  const result = safeParse(source === 'admin' ? adminDeviceSettingsSchema : localDeviceSettingsSchema, body)
  if (!result.success)
    throw createBadRequestError('Invalid device settings', 'INVALID_REQUEST', result.issues)
  return result.output
}
