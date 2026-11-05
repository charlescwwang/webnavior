/** Each graph owns a generation. Offsets are absolute source frames within it. */
export type MaskRequest
  = | { type: 'start', generation: number, channelMap: number[], radiusMm: number }
    | { type: 'block', generation: number, offsetFrames: number, channels: Float32Array[] }
    | { type: 'finish', generation: number }
export type MaskResponse
  = | { type: 'started', generation: number }
    | { type: 'pcm', generation: number, offsetFrames: number, mask: Float32Array, raw: Float32Array }
    | { type: 'progress', generation: number, inputFrames: number, workMs: number }
    | { type: 'done', generation: number, inputFrames: number, outputFrames: number }
    | { type: 'error', generation: number, reason: string }
export type CaptureResponse
  = | Extract<MaskRequest, { type: 'block' }>
    | { type: 'channels', generation: number, count: number }
    | { type: 'stopped', generation: number, inputFrames: number }
    | { type: 'error', generation: number, reason: string }
