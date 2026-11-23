import type { SpatialMode, SpatialProcessing } from './spatialMask'

/** 128ms of actual render frames; startup-only, never a speech buffer. */
export const channelStabilityFrames = 6144

/** Each graph owns a generation. Offsets are absolute source frames within it. */
export type MaskRequest
  = | { type: 'start', generation: number, channelMap: number[], radiusMm: number, processing?: SpatialProcessing }
    | { type: 'block', generation: number, offsetFrames: number, channels: Float32Array[] }
    | { type: 'playback', generation: number, offsetFrames: number, playing: boolean }
    | { type: 'finish', generation: number }
export type MaskResponse
  = | { type: 'started', generation: number }
    | { type: 'pcm', generation: number, offsetFrames: number, mask: Float32Array, raw: Float32Array }
    | { type: 'progress', generation: number, inputFrames: number, workMs: number, processingMode: SpatialMode, playbackTransitions: number }
    | { type: 'done', generation: number, inputFrames: number, outputFrames: number }
    | { type: 'error', generation: number, reason: string }
export type CaptureResponse
  = | Extract<MaskRequest, { type: 'block' }>
    | Extract<MaskRequest, { type: 'playback' }>
    | { type: 'channels', generation: number, count: number, stableFrames: number }
    | { type: 'stopped', generation: number, inputFrames: number }
    | { type: 'error', generation: number, reason: string }
