/// <reference types="audioworklet" />
import type { ArrayCapture } from './capture'

import { ArrayBeamformer, fftSize } from './lcmv'

/** The processor owns one capture at a time. Generation/capture IDs are returned unchanged. */
class ArrayProcessor extends AudioWorkletProcessor {
  private beam: ArrayBeamformer
  private frameCount = 0
  private delay = Array.from({ length: 8 }, () => new Float32Array(fftSize))
  private referenceChannel: number
  private capture?: Omit<ArrayCapture, 'type'>
  private failed = false

  constructor(options: AudioWorkletNodeOptions) {
    super()
    this.beam = new ArrayBeamformer(options.processorOptions.weights, options.processorOptions.channelMap)
    this.referenceChannel = options.processorOptions.channelMap[5]
    this.port.onmessage = ({ data }) => {
      if (data.type === 'cancel')
        this.capture = undefined
      if (data.type === 'capture' && !this.capture) {
        const count = 15 * sampleRate
        if (!(data.raw instanceof Float32Array) || !(data.reference instanceof Float32Array) || !(data.processed instanceof Float32Array) || data.raw.length !== count * 8 || data.reference.length !== count || data.processed.length !== count)
          return
        this.capture = { id: data.id, raw: data.raw, reference: data.reference, processed: data.processed, offset: 0, sampleStart: -1 }
      }
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    const channels = inputs[0]
    const output = outputs[0]?.[0]
    if (this.failed || !output)
      return true
    if (!channels?.length)
      return true
    if (channels.length !== 8) {
      this.failed = true
      this.capture = undefined
      this.port.postMessage({ type: 'error', reason: 'Expected eight discrete input channels.' })
      return true
    }
    this.beam.process(channels, output)
    for (let i = 0; i < output.length; i++) {
      const slot = this.frameCount % fftSize
      const capture = this.capture
      // Reference/raw are delayed by the same1024frames as the streaming STFT.
      if (capture && this.frameCount >= fftSize) {
        if (capture.offset === 0)
          capture.sampleStart = this.frameCount - fftSize
        for (let ch = 0; ch < 8; ch++) capture.raw[capture.offset * 8 + ch] = this.delay[ch]![slot]!
        capture.reference[capture.offset] = this.delay[this.referenceChannel]![slot]!
        capture.processed[capture.offset++] = output[i]!
        if (capture.offset === capture.processed.length) {
          this.capture = undefined
          this.port.postMessage({ type: 'capture', ...capture }, [capture.raw.buffer, capture.reference.buffer, capture.processed.buffer])
        }
      }
      for (let ch = 0; ch < 8; ch++) this.delay[ch]![slot] = channels[ch]![i]!
      this.frameCount++
    }
    return true
  }
}
registerProcessor('kiosk-array-lcmv', ArrayProcessor)
