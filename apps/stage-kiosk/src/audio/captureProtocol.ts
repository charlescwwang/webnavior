import type { NativeAudioResult } from '@proj-airi/stage-shared/kiosk-native-audio'

import type { LcmvTuning } from './tuning'

import { createContext, defineEventa } from '@moeru/eventa'
/** Algorithm configuration owned by the capture boundary; hardware routing stays separate. */
export type ArrayProcessing = { algorithm: 'lcmv', tuning: LcmvTuning } | { algorithm: 'spatial-mask', aec3Enabled: boolean }

/** Both 16 kHz branches refer to the same source sample offset. */
export interface PcmPacket {
  /** Mapped sixth microphone, after optional AEC and resampling. */
  raw: Float32Array
  /** Selected LCMV or Spatial Mask output, before recognition gain. */
  mask: Float32Array
  offsetFrames: number
}
export interface CaptureBlock {
  type: 'block'
  channels: Float32Array[]
  render: Float32Array[]
  offsetFrames: number
  startTime: number
}
export type CaptureRequest = {
  type: 'start'
  channelMap: number[]
  radiusMm: number
  processing: ArrayProcessing
  wasmUrl?: string
} | {
  type: 'native-input'
  generation: string
  input: MessagePort
} | {
  type: 'native-ports'
  generation: string
  input: MessagePort
  render: MessagePort
} | {
  type: 'reference-port'
  port: MessagePort
} | CaptureBlock | {
  type: 'run'
} | {
  type: 'ack'
  inputFrames: number
}
export type CaptureResponse = CaptureBlock | {
  type: 'native-ready'
  /** Absolute performance clock; excludes renderer scheduling and device-open delay. */
  startedAtMs: number
} | {
  type: 'native-result'
  result: NativeAudioResult
  inputFrames: number
  roundTripMs: number
} | {
  type: 'ready'
} | {
  type: 'error'
  reason: string
} | {
  type: 'channels'
  count: number
} | {
  type: 'pcm'
  packet: PcmPacket
} | {
  type: 'processed'
  inputFrames: number
  referenceSignalFrames: number
}
export const request = defineEventa<CaptureRequest>('kiosk:array:request')
export const response = defineEventa<CaptureResponse>('kiosk:array:response')
interface AudioPort {
  postMessage: (message: unknown, transfer: Transferable[]) => void
  addEventListener: (name: 'message', listener: (event: MessageEvent) => void) => void
  removeEventListener: (name: 'message', listener: (event: MessageEvent) => void) => void
}
/** Eventa transport for Worker and real-time Worklet ports. Each port owns one generation. */
export function createCaptureContext(port: AudioPort, side: 'client' | 'processor') {
  const context = createContext()
  const outgoing = defineEventa<CaptureRequest | CaptureResponse>(side === 'client' ? request.id : response.id)
  const incoming = defineEventa<CaptureRequest | CaptureResponse>(side === 'client' ? response.id : request.id)
  // Separate request/response ids prevent an inbound event being forwarded back.
  const off = context.on(outgoing, (event) => {
    const body = event.body
    if (!body)
      return
    const arrays = body.type === 'native-result' ? [body.result.samples] : body.type === 'block' ? [...body.channels, ...body.render] : body.type === 'pcm' ? [body.packet.raw, body.packet.mask] : []
    const transfer: Transferable[] = []
    if (body.type === 'native-input')
      transfer.push(body.input)
    else if (body.type === 'native-ports')
      transfer.push(body.input, body.render)
    else if (body.type === 'reference-port')
      transfer.push(body.port)
    for (const array of arrays) {
      if (array.buffer instanceof ArrayBuffer && !transfer.includes(array.buffer))
        transfer.push(array.buffer)
    }
    port.postMessage({ id: event.id, type: event.type, body }, transfer)
  })
  const receive = (event: MessageEvent) => {
    if (event.data?.id === incoming.id)
      context.emit(incoming, event.data.body)
  }
  port.addEventListener('message', receive)
  return {
    context,
    request,
    response,
    dispose() {
      off()
      port.removeEventListener('message', receive)
    },
  }
}
