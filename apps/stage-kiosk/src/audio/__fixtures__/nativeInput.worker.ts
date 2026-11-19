import { arrayInputRequest, arrayInputResponse } from '@proj-airi/stage-shared/kiosk-array-input'

// Only the external native hardware boundary is simulated. Real AEC3/LCMV and
// Worklet/Worker MessagePorts run in the browser integration test.
globalThis.onmessage = ({ data }) => {
  const port: MessagePort = data.port
  const generation: string = data.generation
  let offset = 0
  port.onmessage = ({ data }) => {
    if (data?.id !== arrayInputRequest.id || data.body.generation !== generation)
      return
    const samples = new Float32Array(3840)
    for (let channel = 0; channel < 8; channel++) {
      for (let frame = 0; frame < 384; frame++)
        samples[channel * 384 + frame] = 0.02 * Math.sin(2 * Math.PI * (300 + channel * 100) * (offset + frame) / 48000)
    }
    samples.set(data.body.samples, 3072)
    port.postMessage({ ...arrayInputResponse, body: { generation, result: { rawOffsetFrames: offset, processedFrames: offset + 384, renderFrames: data.body.offsetFrames + 384, samples } } }, [samples.buffer])
    offset += 384
  }
  port.start()
}
