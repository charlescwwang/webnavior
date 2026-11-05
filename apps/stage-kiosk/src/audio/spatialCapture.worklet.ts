/// <reference types="audioworklet" />
import type { CaptureResponse } from './spatialMaskMessages'

/** Captures discrete channels only. The Worker owns all spectral processing. */
class SpatialCapture extends AudioWorkletProcessor {
  private generation: number
  private running = false
  private channelsSeen = -1
  private offset = 0
  private size = 0
  private buffers = Array.from({ length: 8 }, () => new Float32Array(2048))
  constructor(options: AudioWorkletNodeOptions) {
    super()
    this.generation = options.processorOptions.generation
    this.port.onmessage = ({ data }) => {
      if (data.generation !== this.generation)
        return
      if (data.type === 'start')
        this.running = true
      if (data.type === 'stop') {
        this.running = false
        this.flush()
        this.send({ type: 'stopped', generation: this.generation, inputFrames: this.offset })
      }
    }
  }

  private send(message: CaptureResponse, transfer: Transferable[] = []) {
    this.port.postMessage(message, transfer)
  }

  private flush() {
    if (!this.size)
      return
    const channels = this.buffers.map(buffer => buffer.slice(0, this.size))
    this.send({ type: 'block', generation: this.generation, offsetFrames: this.offset, channels }, channels.map(ch => ch.buffer))
    this.offset += this.size
    this.size = 0
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    outputs[0]?.[0]?.fill(0)
    const channels = inputs[0] ?? []
    if (channels.length > 0 && channels.length !== this.channelsSeen) {
      this.channelsSeen = channels.length
      this.send({ type: 'channels', generation: this.generation, count: channels.length })
    }
    if (!this.running)
      return true
    if (channels.length !== 8 || channels.some(channel => channel.length !== channels[0].length)) {
      this.running = false
      this.send({ type: 'error', generation: this.generation, reason: 'Expected eight discrete microphone channels.' })
      return true
    }
    const length = channels[0].length
    for (let cursor = 0; cursor < length;) {
      const count = Math.min(length - cursor, 2048 - this.size)
      for (let ch = 0; ch < 8; ch++)
        this.buffers[ch].set(channels[ch].subarray(cursor, cursor + count), this.size)
      this.size += count
      cursor += count
      if (this.size === 2048)
        this.flush()
    }
    return true
  }
}
registerProcessor('kiosk-spatial-capture', SpatialCapture)
