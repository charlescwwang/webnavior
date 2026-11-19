import type { CaptureBlock } from './captureProtocol'
import type { EchoCancellation } from './echoCancellation'

import { errorMessageFrom } from '@moeru/std'
import { arrayInputRequest, arrayInputResponse } from '@proj-airi/stage-shared/kiosk-array-input'
import { nativeAudioResultSchema } from '@proj-airi/stage-shared/kiosk-native-audio'
import { parse } from 'valibot'

import { createCaptureContext, request, response } from './captureProtocol'
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
let ports: { input: MessagePort, render: MessagePort } | undefined

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

/** Both browser and native sources preserve the same physical/sample clock contract. */
function processBlock(body: CaptureBlock) {
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

function fail(cause: unknown) {
  if (failed)
    return
  failed = true
  ports?.input.close()
  ports?.render.close()
  echo?.dispose()
  echo = undefined
  transport.context.emit(transport.response, { type: 'error', reason: errorMessageFrom(cause) ?? 'UMA-8 processing failed.' })
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
    else if (body.type === 'native-ports') {
      if (ports)
        throw new Error('Native array input is already attached.')
      const { input, render, generation } = body
      ports = { input, render }
      let rendered = 0
      // The two ports bypass the UI: Worklet -> Main/Python -> this DSP Worker.
      // Only final PCM/telemetry crosses the UI for its existing VAD/ASR owner.
      render.onmessage = ({ data }) => {
        if (failed || data?.id !== response.id)
          return
        if (data.body?.type === 'error') {
          fail(new Error(data.body.reason))
          return
        }
        if (data.body?.type !== 'block')
          return
        const block = data.body as CaptureBlock
        if (block.offsetFrames !== rendered || block.render.length !== 2) {
          fail(new Error('Native array render clock is discontinuous.'))
          return
        }
        rendered += 384
        const samples = new Float32Array(768)
        block.render.forEach((channel, index) => samples.set(channel, index * 384))
        // NOTICE: Transferred ArrayBuffer attachments decoded as null in the real
        // Electron port audit. Clone this 3 KiB render packet across processes;
        // transfer ownership only on the browser Worker/Worklet ports.
        // https://www.electronjs.org/docs/latest/api/message-port-main
        // NOTICE: clone PCM at the Electron boundary; transferring an ArrayBuffer
        // makes MessagePortMain receive null: https://github.com/electron/electron/issues/34905.
        input.postMessage({ ...arrayInputRequest, body: { generation, offsetFrames: block.offsetFrames, samples } })
      }
      input.onmessage = ({ data }) => {
        if (failed || data?.id !== arrayInputResponse.id || data.body?.generation !== generation)
          return // Stale generations never enter this worker's AEC/LCMV state.
        try {
          if (data.body.error)
            throw new Error(data.body.error)
          const result = parse(nativeAudioResultSchema, data.body.result)
          if (result.rawOffsetFrames !== inputFrames || result.samples.length % 10 || result.renderFrames === undefined)
            throw new Error('Native array PCM clock is discontinuous.')
          const frames = result.samples.length / 10
          if (frames) {
            const planes = Array.from({ length: 10 }, (_, index) => result.samples.subarray(index * frames, (index + 1) * frames))
            processBlock({ type: 'block', channels: planes.slice(0, 8), render: planes.slice(8), offsetFrames: result.rawOffsetFrames, startTime: 0 })
          }
          render.postMessage({ ...request, body: { type: 'ack', inputFrames: result.renderFrames } })
        }
        catch (cause) {
          fail(cause)
        }
      }
      input.start()
      render.start()
    }
    else if (body.type === 'block') {
      processBlock(body)
    }
  })().catch(fail)
})
