import type { InferOutput } from 'valibot'

import type { NativeAudioResult } from './kioskNativeAudio'

import { defineEventa, defineInvokeEventa } from '@moeru/eventa'
import { literal, maxLength, minLength, object, pipe, strictObject, string, variant } from 'valibot'

const generation = pipe(string(), minLength(1), maxLength(128))
/** Control requests only; PCM uses a generation-owned MessagePort outside the UI thread. */
export const arrayInputControlSchema = variant('kind', [
  strictObject({ kind: literal('devices') }),
  strictObject({ kind: literal('connect'), generation, inputDevice: pipe(string(), maxLength(2048)) }),
  strictObject({ kind: literal('disconnect'), generation }),
])
export const arrayInputPortSchema = object({ generation })
export const arrayInputPortChannel = 'airi:kiosk:array-input:port:v1'
export const arrayInputRequest = defineEventa<{ generation: string, offsetFrames: number, samples: Float32Array }>('airi:kiosk:array-input:request:v1')
export const arrayInputResponse = defineEventa<{ generation: string, result?: NativeAudioResult, error?: string }>('airi:kiosk:array-input:response:v1')
export const invokeArrayInput = defineInvokeEventa<NativeAudioResult, InferOutput<typeof arrayInputControlSchema>>('airi:kiosk:array-input:control:v1')

/** Native eight-channel input for the original array DSP, independently of OpenVINO. */
export interface KioskArrayInputBridge {
  version: 1
  request: (input: InferOutput<typeof arrayInputControlSchema>) => Promise<NativeAudioResult>
}

declare global {
  interface Window {
    airiKioskArrayInput?: KioskArrayInputBridge
  }
}
