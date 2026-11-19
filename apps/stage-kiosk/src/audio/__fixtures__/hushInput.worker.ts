import { arrayInputOpen, arrayInputRead, arrayInputResponse } from '@proj-airi/stage-shared/kiosk-array-input'

// Only external hardware is simulated. The independent microphone clock keeps
// advancing while the real capture Worker and UI exchange production envelopes.
globalThis.onmessage = ({ data }) => {
  const port: MessagePort = data.port
  const generation: string = data.generation
  let origin = 0
  let captured = 0
  let emittedSegment = false
  port.onmessage = ({ data: message }) => {
    if (message?.body?.generation !== generation)
      return
    if (message.id === arrayInputOpen.id) {
      setTimeout(() => {
        origin = performance.now()
        port.postMessage({ ...arrayInputResponse, body: { generation, opened: true, result: { samples: new Float32Array() } } })
      }, data.openDelayMs ?? 0)
      return
    }
    if (message.id !== arrayInputRead.id || data.stall)
      return
    const previous = captured
    captured = Math.floor((performance.now() - origin) / 10) * 480
    const length = (captured - previous) / 3
    const segment = !emittedSegment && captured >= 19200
    emittedSegment ||= segment
    const samples = new Float32Array(length + (segment ? 480 : 0)).fill(0.02)
    const result = {
      capturedFrames: captured,
      processedFrames: captured,
      referenceFrames: 0,
      processingMs: 1,
      phraseActive: captured < 19200,
      frames: length ? [{ offsetSamples: previous / 3, length, pcmStart: 0, speech: true, rtfState: 'tracking', rtfUpdates: 1 }] : [],
      segments: segment ? [{ startSample: 0, pcmStart: length, length: 480, endReason: 'silence' }] : [],
      samples,
    }
    port.postMessage({ ...arrayInputResponse, body: { generation: 'retired-generation', error: 'Must be ignored.' } })
    port.postMessage({ ...arrayInputResponse, body: { generation, result } }, [samples.buffer])
  }
  port.start()
}
