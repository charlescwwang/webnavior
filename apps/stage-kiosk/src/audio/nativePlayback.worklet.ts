/// <reference types="audioworklet" />
import { request, response } from './captureProtocol'

/** Mirror browser speaker PCM for AEC; no browser microphone or audible duplicate. */
class NativePlayback extends AudioWorkletProcessor {
  private delivery: MessagePort = this.port
  private running: boolean
  private readonly waitForRun: boolean
  private offset = 0
  private acknowledged = 0
  private size = 0
  private failed = false
  private readonly render = [new Float32Array(384), new Float32Array(384)]
  constructor(options?: { processorOptions?: { waitForPort?: boolean, waitForRun?: boolean } }) {
    super()
    this.waitForRun = !!options?.processorOptions?.waitForRun
    this.running = !options?.processorOptions?.waitForPort && !this.waitForRun
    // NOTICE: Worklet scope has no AbortController required by Eventa's
    // createContext. Use the central Eventa envelope on this realtime port.
    this.port.onmessage = ({ data }) => {
      if (data?.id === request.id && data.body?.type === 'reference-port') {
        this.delivery = data.body.port
        this.delivery.onmessage = this.port.onmessage
        this.delivery.start()
        this.running = !this.waitForRun
        if (this.waitForRun)
          this.delivery.postMessage({ ...response, body: { type: 'ready' } })
        return
      }
      if (data?.id === request.id && data.body?.type === 'run')
        this.running = true
      if (data?.id === request.id && data.body?.type === 'ack')
        this.acknowledged = data.body.inputFrames
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    outputs[0]?.[0]?.fill(0)
    if (this.failed || !this.running)
      return true
    const input = inputs[0] ?? []
    const length = input[0]?.length ?? 128
    for (let cursor = 0; cursor < length;) {
      const count = Math.min(length - cursor, 384 - this.size)
      for (let channel = 0; channel < 2; channel++) {
        const source = input[channel] ?? input[0]
        for (let index = 0; index < count; index++) {
          // Mirror the full-scale-limited application mix sent to the browser
          // speaker; do not create a second audible playback path.
          this.render[channel]![this.size + index] = Math.max(-1, Math.min(1, source?.[cursor + index] ?? 0))
        }
      }
      this.size += count
      cursor += count
      if (this.size === 384) {
        if (this.offset - this.acknowledged >= 12000) {
          this.failed = true
          this.delivery.postMessage({ ...response, body: { type: 'error', reason: 'Native playback delivery exceeded 250 ms.' } })
          return true
        }
        const render = this.render.map(channel => channel.slice())
        this.delivery.postMessage({ ...response, body: { type: 'block', channels: [], render, offsetFrames: this.offset, startTime: currentTime } }, render.map(channel => channel.buffer))
        this.offset += 384
        this.size = 0
      }
    }
    return true
  }
}
registerProcessor('kiosk-native-playback', NativePlayback)
