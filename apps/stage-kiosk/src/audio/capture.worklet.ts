/// <reference types="audioworklet" />
import type { CaptureResponse } from './captureProtocol'

import { request, response } from './captureProtocol'
/** Discrete capture and playback quanta share the AudioContext's source clock. */
class ArrayCapture extends AudioWorkletProcessor {
  private running = false
  private offset = 0
  private acknowledged = 0
  private size = 0
  private startTime = 0
  private stable = 0
  private lastCount = -1
  private readonly channels = Array.from({ length: 8 }, () => new Float32Array(384))
  private readonly render = Array.from({ length: 2 }, () => new Float32Array(384))
  constructor() {
    super()
    // NOTICE: Eventa createContext allocates AbortController, which Chromium's
    // AudioWorkletGlobalScope does not expose (eventa dist/context:98). Use its
    // declared event envelope directly on this real-time port; no global polyfill.
    this.port.onmessage = ({ data }) => {
      if (data?.id !== request.id)
        return
      if (data.body?.type === 'run')
        this.running = true
      else if (data.body?.type === 'ack' && data.body.inputFrames >= this.acknowledged && data.body.inputFrames <= this.offset)
        this.acknowledged = data.body.inputFrames
    }
  }

  private send(body: CaptureResponse) {
    const transfer = body.type === 'block' ? [...body.channels, ...body.render].map(channel => channel.buffer).filter((buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer) : []
    this.port.postMessage({ ...response, body }, transfer)
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    outputs[0]?.[0]?.fill(0)
    const channels = inputs[0] ?? []
    const count = channels.length
    const length = channels[0]?.length ?? 128
    if (count !== this.lastCount) {
      this.lastCount = count
      this.stable = 0
    }
    this.stable += length
    if (this.stable === 6144)
      this.send({ type: 'channels', count })
    if (!this.running)
      return true
    if (count !== 8) {
      this.running = false
      this.send({ type: 'error', reason: `UMA-8 requires 8 discrete channels; received ${count}.` })
      return true
    }
    for (let cursor = 0; cursor < length;) {
      if (!this.size)
        this.startTime = currentTime + cursor / sampleRate
      const n = Math.min(length - cursor, 384 - this.size)
      for (let channel = 0; channel < 8; channel++)
        this.channels[channel]!.set(channels[channel]!.subarray(cursor, cursor + n), this.size)
      for (let channel = 0; channel < 2; channel++) {
        const reference = inputs[1]?.[channel] ?? inputs[1]?.[0]
        if (reference)
          this.render[channel]!.set(reference.subarray(cursor, cursor + n), this.size)
        else
          this.render[channel]!.fill(0, this.size, this.size + n)
      }
      this.size += n
      cursor += n
      if (this.size === 384) {
        // Credits bound audio queued while the UI thread is blocked. A full
        // second of undelivered capture retires the utterance instead of growing.
        if (this.offset - this.acknowledged >= 48000) {
          this.running = false
          this.send({ type: 'error', reason: 'UMA-8 capture delivery fell more than one second behind.' })
          return true
        }
        this.send({
          type: 'block',
          channels: this.channels.map(a => a.slice()),
          render: this.render.map(a => a.slice()),
          offsetFrames: this.offset,
          startTime: this.startTime,
        })
        this.offset += this.size
        this.size = 0
      }
    }
    return true
  }
}
registerProcessor('kiosk-array-capture', ArrayCapture)
