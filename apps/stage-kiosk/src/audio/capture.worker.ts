import type { EchoCancellation } from './echoCancellation'

import { errorMessageFrom } from '@moeru/std'

import { createCaptureContext } from './captureProtocol'
import { LcmvStream } from './lcmvStream'
import { SpatialMask } from './spatialMask'

// One port owns one generation. Capture waits for ready before sending blocks;
// no DSP state survives termination, device replacement or algorithm changes.
const transport = createCaptureContext({
  postMessage: (message, transfer) => globalThis.postMessage(message, { transfer }),
  addEventListener: (name, listener) => globalThis.addEventListener(name, listener),
  removeEventListener: (name, listener) => globalThis.removeEventListener(name, listener),
}, 'processor')
let echo: EchoCancellation | undefined
let beam: LcmvStream | undefined
let mask: SpatialMask | undefined
let channelMap: number[] = []
let inputFrames = 0
let referenceSignalFrames = 0
let failed = false

/** DSP consumes physical mapping once, after optional seven-channel AEC. */
function processChannels(channels: Float32Array[]) {
  if (mask) {
    // Mask already includes its own FIR and lookahead; never apply LCMV delay
    // compensation or a second 48→16 kHz decimator to these samples.
    mask.push(channels)
  }
  else if (beam) {
    const mapped: Float32Array[] = Array.from({ length: 8 }, () => new Float32Array(channels[0]!.length))
    channelMap.forEach((hardware, index) => mapped[hardware] = channels[index]!)
    beam.push(mapped)
  }
  else {
    throw new Error('Array DSP is not ready.')
  }
}

transport.context.on(transport.request, ({ body }) => {
  if (failed || !body)
    return
  void (async () => {
    if (body.type === 'start') {
      if (beam || mask)
        throw new Error('Array capture already started.')
      channelMap = body.channelMap
      const emit: ConstructorParameters<typeof SpatialMask>[0] = packet => transport.context.emit(transport.response, { type: 'pcm', packet })
      if (body.processing.algorithm === 'spatial-mask')
        mask = new SpatialMask(emit, body.radiusMm)
      else
        beam = new LcmvStream(emit, body.radiusMm, channelMap, body.processing.tuning)
      const aec3Enabled = body.processing.algorithm === 'lcmv' || body.processing.aec3Enabled
      if (aec3Enabled) {
        if (!body.wasmUrl)
          throw new Error('AEC3 requires its WASM asset.')
        // Loading the module belongs to the enabled path too: disabled Mask
        // must remain usable without fetching or instantiating AEC3.
        const { createEchoCancellation } = await import('./echoCancellation')
        echo = await createEchoCancellation(processChannels, body.wasmUrl)
      }
      transport.context.emit(transport.response, { type: 'ready' })
    }
    else if (body.type === 'block') {
      if ((!beam && !mask) || body.offsetFrames !== inputFrames || body.channels.length !== 8)
        throw new Error('UMA-8 source samples are discontinuous.')
      const channels = channelMap.map(index => body.channels[index]!)
      if (echo) {
        if (body.render.some(channel => channel.some(sample => Math.abs(sample) > 1e-7)))
          referenceSignalFrames += body.channels[0]!.length
        echo.push(channels, body.render)
      }
      else {
        processChannels(channels)
      }
      inputFrames += body.channels[0]!.length
      transport.context.emit(transport.response, { type: 'processed', inputFrames, referenceSignalFrames })
    }
  })().catch((cause) => {
    failed = true
    echo?.dispose()
    echo = undefined
    transport.context.emit(transport.response, { type: 'error', reason: errorMessageFrom(cause) ?? 'UMA-8 processing failed.' })
  })
})
