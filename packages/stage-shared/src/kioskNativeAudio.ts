import type { InferOutput } from 'valibot'

import { defineInvokeEventa } from '@moeru/eventa'
import { array, boolean, check, finite, instance, integer, literal, maxLength, maxValue, minLength, minValue, number, object, optional, picklist, pipe, strictObject, string, variant } from 'valibot'

const generation = pipe(string(), minLength(1), maxLength(128))
const natural = pipe(number(), integer(), minValue(0))
const pcm = pipe(instance(Float32Array), check(data => data.length <= 500_000 && data.every(Number.isFinite), 'Invalid native PCM'))
const channels = pipe(array(pipe(number(), integer(), minValue(0), maxValue(7))), check(data => data.length === 7 && new Set(data).size === 7, 'Seven physical channels required'))
/** Hush limits apply to one continuous capture session, after MVDR PCM reconstruction. */
export const hushSettingsSchema = strictObject({
  attenuationDb: pipe(number(), finite(), minValue(0), maxValue(100)),
  dryMixPercent: pipe(number(), finite(), minValue(0), maxValue(100)),
})
export type HushSettings = InferOutput<typeof hushSettingsSchema>

const start = {
  hush: hushSettingsSchema,
  generation,
  channels,
  gainDb: pipe(number(), finite(), minValue(0), maxValue(40)),
  silenceMs: pipe(number(), integer(), minValue(100), maxValue(3000)),
  minSpeechMs: pipe(number(), integer(), minValue(20), maxValue(1000)),
}

/** One trusted main-frame capture generation; no filesystem paths or model URLs cross IPC. */
export const nativeAudioRequestSchema = variant('kind', [
  strictObject({ kind: literal('status') }),
  strictObject({ kind: literal('devices') }),
  strictObject({ kind: literal('open'), generation, inputDevice: pipe(string(), maxLength(2048)) }),
  strictObject({ kind: literal('read'), generation }),
  strictObject({ kind: literal('poll'), generation, offsetFrames: natural, samples: pipe(pcm, check(data => data.length === 768 && data.every(value => Math.abs(value) <= 1.001), 'Expected stereo planar 384-frame playback')) }),
  strictObject({ kind: literal('start'), ...start }),
  strictObject({ kind: literal('connect'), ...start, inputDevice: pipe(string(), maxLength(2048)) }),
  strictObject({ kind: literal('stop'), generation }),
  strictObject({ kind: literal('block'), generation, offsetFrames: natural, samples: pipe(pcm, check(data => data.length === 3840 && data.every(value => Math.abs(value) <= 1.001), 'Expected ten planar 384-frame channels')) }),
])
export type NativeAudioRequest = InferOutput<typeof nativeAudioRequestSchema>

/** Descriptors address a contiguous response PCM buffer, never arrival timestamps. */
export const nativeAudioResultSchema = object({
  devices: optional(array(object({ id: string(), name: string(), host: string(), inputChannels: natural, outputChannels: natural }))),
  inputDevice: optional(string()),
  rawOffsetFrames: optional(natural),
  captureDelayFrames: optional(natural),
  renderFrames: optional(natural),
  inputPower: optional(pipe(number(), finite(), minValue(0))),
  referenceFrames: optional(natural),
  state: optional(string()),
  phraseActive: optional(boolean()),
  runtime: optional(string()),
  hush: optional(hushSettingsSchema),
  aecEnabled: optional(boolean()),
  sampleRate: optional(natural),
  frameLength: optional(natural),
  modelDelaySamples: optional(natural),
  device_name: optional(string()),
  requested_provider: optional(string()),
  active_providers: optional(array(string())),
  available_providers: optional(array(string())),
  capturedFrames: optional(natural),
  processedFrames: optional(natural),
  processingMs: optional(pipe(number(), finite(), minValue(0))),
  frames: optional(array(object({ offsetSamples: natural, length: natural, pcmStart: natural, speech: boolean(), rtfState: picklist(['acquiring', 'tracking', 'holding', 'frozen', 'disabled']), rtfUpdates: natural }))),
  segments: optional(array(object({ startSample: natural, length: natural, pcmStart: natural, endReason: picklist(['silence', 'max_duration', 'end_of_stream']) }))),
  samples: pcm,
})
export type NativeAudioResult = InferOutput<typeof nativeAudioResultSchema>

/** Application-owned audio worker, automatically launched and stopped by Electron. */
export interface KioskNativeAudioBridge {
  /** Independent native microphone plus browser playback reference; requires the matching Hush EXE. */
  version: 9
  request: (input: NativeAudioRequest) => Promise<NativeAudioResult>
}
export const invokeNativeAudio = defineInvokeEventa<NativeAudioResult, NativeAudioRequest>('airi:kiosk:native-audio:v9')

declare global {
  interface Window {
    airiKioskAudio?: KioskNativeAudioBridge
  }
}
