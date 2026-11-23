import type { MaskRequest, MaskResponse } from './spatialMaskMessages'

import { errorMessageFrom } from '@moeru/std'

import { SpatialMask } from './spatialMask'

let engine: SpatialMask | undefined
let generation = -1
let channelMap: number[] = []
let inputFrames = 0
function send(message: MaskResponse, transfer: Transferable[] = []) {
  globalThis.postMessage(message, { transfer })
}
globalThis.onmessage = ({ data }: MessageEvent<MaskRequest>) => {
  if (data.type !== 'start' && data.generation !== generation)
    return // A retired graph cannot feed this engine.
  try {
    if (data.type === 'start') {
      generation = data.generation
      if (data.channelMap.length !== 7 || new Set(data.channelMap).size !== 7 || data.channelMap.some(ch => !Number.isInteger(ch) || ch < 0 || ch > 7))
        throw new Error('Seven distinct array channels are required.')
      channelMap = data.channelMap
      inputFrames = 0
      engine = new SpatialMask(({ mask, raw, offsetFrames }) => {
        send({ type: 'pcm', generation, mask, raw, offsetFrames }, [mask.buffer, raw.buffer])
      }, data.radiusMm, data.processing)
      send({ type: 'started', generation })
    }
    else if (data.type === 'block' && engine) {
      if (data.offsetFrames !== inputFrames || data.channels.length !== 8)
        throw new Error('Discontinuous eight-channel audio.')
      const started = performance.now()
      engine.push(channelMap.map(ch => data.channels[ch]))
      inputFrames += data.channels[0].length
      send({ type: 'progress', generation, inputFrames, workMs: performance.now() - started, processingMode: engine.statistics.processingMode, playbackTransitions: engine.statistics.playbackTransitions })
    }
    else if (data.type === 'playback' && engine) {
      engine.setPlayback(data.playing, data.offsetFrames)
    }
    else if (data.type === 'finish' && engine) {
      engine.finish()
      send({ type: 'done', generation, inputFrames, outputFrames: engine.outputLength })
      engine = undefined
    }
  }
  catch (cause) {
    send({ type: 'error', generation, reason: errorMessageFrom(cause) ?? 'Mask Worker failed.' })
    engine = undefined
  }
}
