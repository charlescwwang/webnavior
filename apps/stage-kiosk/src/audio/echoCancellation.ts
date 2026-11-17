import createWebRtc from '@ennuicastr/webrtcaec3.js'

const frameSize = 480
export const echoCaptureChannels = 7
export const echoRenderChannels = 2
type WebRtc = Awaited<ReturnType<typeof createWebRtc>>
export async function createEchoCancellation(emit: (channels: Float32Array[]) => void, wasmUrl?: string, captureChannels = echoCaptureChannels) {
  // Emscripten accepts locateFile; the package declaration only lists the
  // no-argument Node form. Resolve the packaged WASM explicitly in workers.
  const load = createWebRtc as (options?: {
    locateFile: (name: string) => string
  }) => Promise<WebRtc>
  const module = await load(wasmUrl ? { locateFile: () => wasmUrl } : undefined)
  return new EchoCancellation(new module.AEC3(48000, echoRenderChannels, captureChannels), emit, captureChannels)
}
export class EchoCancellation {
  private readonly capture: Float32Array[]
  private readonly render = Array.from({ length: echoRenderChannels }, () => new Float32Array(frameSize))
  private readonly result: Float32Array[]
  private buffered = 0
  constructor(private readonly aec: InstanceType<WebRtc['AEC3']>, private readonly emit: (channels: Float32Array[]) => void, captureChannels = echoCaptureChannels) {
    this.capture = Array.from({ length: captureChannels }, () => new Float32Array(frameSize))
    this.result = Array.from({ length: captureChannels }, () => new Float32Array(frameSize))
  }

  push(capture: Float32Array[], render: Float32Array[]) {
    const length = capture[0]?.length
    if (length === undefined || capture.length !== this.capture.length || render.length !== echoRenderChannels
      || [...capture, ...render].some(channel => channel.length !== length)) {
      throw new Error('AEC3 capture and playback-reference clocks differ')
    }
    for (let start = 0; start < length;) {
      const count = Math.min(frameSize - this.buffered, length - start)
      const end = start + count
      capture.forEach((channel, i) => this.capture[i].set(channel.subarray(start, end), this.buffered))
      render.forEach((channel, i) => this.render[i].set(channel.subarray(start, end), this.buffered))
      this.buffered += count
      start = end
      if (this.buffered === frameSize)
        this.process()
    }
  }

  finish() {
    if (!this.buffered)
      return
    for (const channel of [...this.capture, ...this.render])
      channel.fill(0, this.buffered)
    this.process()
  }

  dispose() { this.aec.free() }
  private process() {
    const count = this.buffered
    this.aec.analyze(this.render)
    this.aec.process(this.result, this.capture)
    this.buffered = 0
    this.emit(this.result.map(channel => channel.subarray(0, count)))
  }
}
