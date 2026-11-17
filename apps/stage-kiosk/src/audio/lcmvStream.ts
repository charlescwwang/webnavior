import type { PcmPacket as MaskOutput } from './captureProtocol'
import type { LcmvTuning } from './tuning'

import { Decimator } from './decimator'
import { ArrayBeamformer, fftSize } from './lcmv'
import { designTunedWeights } from './lcmvWeights'
/** Adapts the original LCMV streaming beamformer to 16 kHz source-aligned output. */
export class LcmvStream {
  private readonly beam: ArrayBeamformer
  private readonly down: Decimator
  private readonly references: Float32Array[] = []
  private referencePosition = 0
  private beamFrames = 0
  private inputFrames = 0
  private pairedFrames = 0
  private ended = false
  private playing = false
  private transitions = 0
  constructor(emit: (packet: MaskOutput) => void, radiusMm: number, private channelMap: number[], tuning?: LcmvTuning) {
    this.beam = new ArrayBeamformer(designTunedWeights(radiusMm, 48000, tuning), channelMap)
    this.down = new Decimator((raw, mask, offsetFrames) => emit({ raw, mask, offsetFrames }))
  }

  push(channels: Float32Array[]) {
    if (this.ended)
      throw new Error('LCMV stream has ended')
    const n = channels[0]?.length ?? 0
    if (channels.length !== 8 || channels.some(c => c.length !== n))
      throw new Error('LCMV requires eight equal-length channels')
    if (!n)
      return
    this.inputFrames += n
    this.references.push(channels[this.channelMap[5]].slice())
    this.processBeam(channels, n)
  }

  private processBeam(channels: Float32Array[], n: number) {
    const output = new Float32Array(n)
    this.beam.process(channels, output)
    const skip = Math.min(n, Math.max(0, fftSize - this.beamFrames))
    this.beamFrames += n
    let pos = skip
    // Discard the original beamformer's 1024 startup frames. The FIFO pairs
    // every subsequent output with its original source sample, not current input.
    while (pos < n && this.pairedFrames < this.inputFrames) {
      const reference = this.references[0]
      if (!reference)
        throw new Error('LCMV reference clock exhausted')
      const size = Math.min(n - pos, reference.length - this.referencePosition, this.inputFrames - this.pairedFrames)
      this.down.push(reference.subarray(this.referencePosition, this.referencePosition + size), output.subarray(pos, pos + size))
      pos += size
      this.referencePosition += size
      this.pairedFrames += size
      if (this.referencePosition === reference.length) {
        this.references.shift()
        this.referencePosition = 0
      }
    }
  }

  setPlayback(playing: boolean, _sourceFrame48k: number) {
    // Keep the same diagnostic edges, but fixed LCMV never changes with TTS.
    if (playing !== this.playing) {
      this.playing = playing
      this.transitions++
    }
  }

  finish() {
    if (this.ended)
      return
    this.ended = true
    if (this.inputFrames) {
      this.processBeam(Array.from({ length: 8 }, () => new Float32Array(fftSize)), fftSize)
    }
    if (this.pairedFrames !== this.inputFrames || this.references.length)
      throw new Error('LCMV alignment did not drain')
    this.down.finish()
    if (this.outputLength !== Math.ceil(this.inputFrames / 3))
      throw new Error('LCMV output sample count mismatch')
  }

  get outputLength() { return this.down.outputLength }
  get statistics() { return { processingMode: 'lcmv' as const, playbackTransitions: this.transitions } }
}
