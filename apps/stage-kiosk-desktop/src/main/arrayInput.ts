import type { WebContents } from 'electron'

import type { NativeAudio } from './nativeAudio'

import { errorMessageFrom } from '@moeru/std'
import { arrayInputPortChannel, arrayInputRequest, arrayInputResponse } from '@proj-airi/stage-shared/kiosk-array-input'
import { nativeAudioRequestSchema } from '@proj-airi/stage-shared/kiosk-native-audio'
import { MessageChannelMain } from 'electron'
import { parse } from 'valibot'

/** One trusted document's raw array input; navigation retires its port and child. */
export class ArrayInput {
  private queries = new Set<NativeAudio>()
  private active?: { generation: string, dispose: () => void }

  constructor(private contents: WebContents, private createAudio: () => NativeAudio) {}

  /** Enumeration owns a separate short-lived process and cannot block live PCM. */
  async devices() {
    const audio = this.createAudio()
    this.queries.add(audio)
    try {
      return await audio.request({ kind: 'devices' })
    }
    finally {
      this.queries.delete(audio)
      audio.dispose()
    }
  }

  async connect(generation: string, inputDevice: string) {
    this.active?.dispose()
    const audio = this.createAudio()
    const { port1, port2 } = new MessageChannelMain()
    let closed = false
    const owner = { generation, dispose: () => {
      if (closed)
        return
      closed = true
      if (this.active === owner)
        this.active = undefined
      port1.close()
      port2.close()
      audio.dispose()
    } }
    this.active = owner
    port1.on('close', () => owner.dispose())
    port1.on('message', ({ data }) => {
      if (this.active !== owner || data?.id !== arrayInputRequest.id)
        return // Only this port's current generation may publish render PCM.
      void (async () => {
        const request = parse(nativeAudioRequestSchema, { kind: 'poll', ...data.body })
        if (request.kind !== 'poll' || request.generation !== generation)
          throw new Error('Native array port generation mismatch.')
        const result = await audio.request(request)
        if (this.active === owner)
          port1.postMessage({ ...arrayInputResponse, body: { generation, result } })
      })().catch((cause) => {
        if (this.active !== owner)
          return
        port1.postMessage({ ...arrayInputResponse, body: { generation, error: errorMessageFrom(cause) ?? 'Native array input failed.' } })
        owner.dispose()
      })
    })
    try {
      const result = await audio.request({ kind: 'open', generation, inputDevice })
      if (this.active !== owner)
        throw new Error('Native array input was replaced before opening.')
      port1.start()
      // Ports are handed to preload once, then transferred into the DSP Worker.
      // PCM does not pass through contextBridge or the renderer UI event loop.
      this.contents.postMessage(arrayInputPortChannel, { generation }, [port2])
      return result
    }
    catch (cause) {
      owner.dispose()
      throw cause
    }
  }

  /** A retiring page/capture cannot close a newer generation. */
  disconnect(generation: string) {
    if (this.active?.generation === generation)
      this.dispose()
    return { samples: new Float32Array() }
  }

  dispose() {
    this.queries.forEach(audio => audio.dispose())
    this.queries.clear()
    this.active?.dispose()
  }
}
