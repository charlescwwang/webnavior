import type { DeviceSettingsValues } from '@proj-airi/kiosk-proactive'

import { boolean, integer, maxValue, minValue, number, partial, picklist, pipe, safeParse, strictObject } from 'valibot'

import { createBadRequestError } from '../../../utils/error'

/** PIN principals are device-scoped; management/account writes retain role checks. */
export type DeviceSettingsUpdate = { deviceId: string, siteId: string, body: unknown } & (
  | { source: 'admin' | 'local', userId: string }
  | { source: 'local-pin', deviceCredential: string }
)

const duration = pipe(number(), integer(), minValue(0), maxValue(600000))
const fraction = pipe(number(), minValue(0), maxValue(1))
const overrides = partial(strictObject({
  serviceMode: picklist(['kiosk', 'table-service']),
  backgroundSpeechMode: picklist(['off', 'observe', 'enforce']),
  textOnlyMode: boolean(),
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
  presenceVisionMode: picklist(['face_only', 'pose_only', 'pose_plus_conditional_face']),
  voiceVadSettings: strictObject({
    threshold: pipe(number(), minValue(0.1), maxValue(0.99)),
    minSpeechDurationMs: pipe(number(), integer(), minValue(0), maxValue(60_000)),
    maxSpeechDurationS: pipe(number(), integer(), minValue(1), maxValue(9_999)),
    minSilenceDurationMs: pipe(number(), integer(), minValue(0), maxValue(60_000)),
    speechPadMs: pipe(number(), integer(), minValue(0), maxValue(10_000)),
  }),
  voiceDiagnosticsEnabled: boolean(),
  conversationDiagnosticsEnabled: boolean(),
}))
const version = pipe(number(), integer(), minValue(1))

const deviceSettingsSchema = strictObject({ version, overrides })

/** Also check the resolved rectangle: individually valid overrides may exceed its bounds. */
export function assertDetectionZone(values: DeviceSettingsValues) {
  if (values.zoneX + values.zoneWidth > 1.000001 || values.zoneY + values.zoneHeight > 1.000001)
    throw createBadRequestError('Detection zone must stay inside the camera image', 'INVALID_REQUEST')
}

/** Both editors use the same strict write contract; authorization is checked by the service. */
export function parseSettingsChange(body: unknown) {
  const result = safeParse(deviceSettingsSchema, body)
  if (!result.success)
    throw createBadRequestError('Invalid device settings', 'INVALID_REQUEST', result.issues)
  return result.output
}
