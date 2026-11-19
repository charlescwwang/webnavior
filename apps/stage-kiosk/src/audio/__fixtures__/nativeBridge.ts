import type { KioskNativeAudioBridge, NativeAudioRequest, NativeAudioResult } from '@proj-airi/stage-shared/kiosk-native-audio'

import { arrayInputOpen, arrayInputPortChannel, arrayInputRead, arrayInputRequest, arrayInputResponse } from '@proj-airi/stage-shared/kiosk-array-input'

/** Simulate only the Electron/native boundary for PCM and lifecycle assertions. */
export function createTestBridge(handle: (request: NativeAudioRequest) => Promise<NativeAudioResult>): KioskNativeAudioBridge {
  let port: MessagePort | undefined
  return {
    version: 9,
    async request(input) {
      if (input.kind === 'stop')
        port?.close()
      if (input.kind !== 'connect')
        return handle(input)
      await handle({ ...input, kind: 'start' })
      const channel = new MessageChannel()
      port = channel.port1
      port.onmessage = ({ data }) => {
        if (data?.id === arrayInputOpen.id) {
          void handle({ kind: 'open', generation: input.generation, inputDevice: input.inputDevice }).then(result => port?.postMessage({ ...arrayInputResponse, body: { generation: input.generation, opened: true, result } })).catch(error => port?.postMessage({ ...arrayInputResponse, body: { generation: input.generation, error: error.message } }))
          return
        }
        if (data?.id === arrayInputRead.id) {
          void handle({ kind: 'read', generation: input.generation }).then(result => port?.postMessage({ ...arrayInputResponse, body: { generation: input.generation, result } })).catch(error => port?.postMessage({ ...arrayInputResponse, body: { generation: input.generation, error: error.message } }))
          return
        }
        if (data?.id !== arrayInputRequest.id)
          return
        void handle({ kind: 'poll', ...data.body }).then(result => port?.postMessage({ ...arrayInputResponse, body: { generation: input.generation, result } })).catch(error => port?.postMessage({ ...arrayInputResponse, body: { generation: input.generation, error: error.message } }))
      }
      port.start()
      window.postMessage({ channel: arrayInputPortChannel, generation: input.generation }, location.origin, [channel.port2])
      return { captureDelayFrames: 0, samples: new Float32Array() }
    },
  }
}
