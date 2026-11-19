import { errorMessageFrom } from '@moeru/std'
import { arrayInputOpen, arrayInputRead, arrayInputResponse } from '@proj-airi/stage-shared/kiosk-array-input'
import { nativeAudioResultSchema } from '@proj-airi/stage-shared/kiosk-native-audio'
import { parse } from 'valibot'

import { createCaptureContext, request, response } from './captureProtocol'

const transport = createCaptureContext({
  postMessage: (message, transfer) => postMessage(message, { transfer }),
  addEventListener: (_, listener) => addEventListener('message', listener),
  removeEventListener: (_, listener) => removeEventListener('message', listener),
}, 'processor')
let input: MessagePort | undefined
let closed = false
let opened = false
let capturedFrames = 0
let processedFrames = 0
let scheduled: ReturnType<typeof setTimeout> | undefined
let deadline: ReturnType<typeof setTimeout> | undefined
let sentAt: number | undefined
let lastRoundTripMs = 0
let lastProcessingMs = 0

function fail(reason: string) {
  if (closed)
    return
  closed = true
  clearTimeout(scheduled)
  clearTimeout(deadline)
  input?.close()
  transport.context.emit(response, { type: 'error', reason })
}

transport.context.on(request, ({ body }) => {
  if (closed || body?.type !== 'native-input')
    return
  if (input) {
    fail('Native microphone port was already connected.')
    return
  }
  input = body.input
  const generation = body.generation
  function read() {
    if (closed || !opened)
      return
    // Only one read may be in flight. Native callbacks own the sample clock;
    // each read drains actual microphone PCM, never a fabricated playback clock.
    sentAt = performance.now()
    deadline = setTimeout(fail, 250, `Native microphone read exceeded 250 ms. [captured=${capturedFrames}, processed=${processedFrames}, lastRTT=${Math.round(lastRoundTripMs)}ms, DSP=${Math.round(lastProcessingMs)}ms]`)
    input!.postMessage({ ...arrayInputRead, body: { generation } })
  }
  input.onmessage = ({ data }) => {
    if (closed || data?.id !== arrayInputResponse.id || data.body?.generation !== generation)
      return
    try {
      if (data.body.error)
        throw new Error(data.body.error)
      const result = parse(nativeAudioResultSchema, data.body.result)
      if (data.body.opened) {
        if (opened)
          throw new Error('Native microphone was activated twice.')
        opened = true
        transport.context.emit(response, { type: 'native-ready', startedAtMs: performance.timeOrigin + performance.now() })
        read()
        return
      }
      if (sentAt === undefined || result.capturedFrames === undefined || result.processedFrames === undefined
        || result.capturedFrames < capturedFrames || result.processedFrames < processedFrames || result.processedFrames > result.capturedFrames) {
        throw new Error('Native microphone source clock is discontinuous.')
      }
      clearTimeout(deadline)
      lastRoundTripMs = performance.now() - sentAt
      sentAt = undefined
      capturedFrames = result.capturedFrames
      processedFrames = result.processedFrames
      lastProcessingMs = result.processingMs ?? 0
      transport.context.emit(response, { type: 'native-result', result, inputFrames: capturedFrames, roundTripMs: lastRoundTripMs })
      // Coalesce real input between reads instead of making 125 reference RPCs/s.
      // Timer jitter changes batch size, never source timestamps or sample count.
      scheduled = setTimeout(read, 16)
    }
    catch (error) {
      fail(errorMessageFrom(error) ?? 'Native Hush microphone processing failed.')
    }
  }
  input.onmessageerror = () => fail('Native microphone MessagePort failed.')
  input.start()
  input.postMessage({ ...arrayInputOpen, body: { generation } })
})
transport.context.emit(response, { type: 'ready' })
