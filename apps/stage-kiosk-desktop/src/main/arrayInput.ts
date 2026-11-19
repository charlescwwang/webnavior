import type { NativeAudioRequest, NativeAudioResult } from '@proj-airi/stage-shared/kiosk-native-audio'
import type { WebContents } from 'electron'

import type { NativeAudio } from './nativeAudio'

import { errorMessageFrom } from '@moeru/std'
import { arrayInputOpen, arrayInputPortChannel, arrayInputRead, arrayInputRequest, arrayInputResponse } from '@proj-airi/stage-shared/kiosk-array-input'
import { nativeAudioRequestSchema } from '@proj-airi/stage-shared/kiosk-native-audio'
import { MessageChannelMain } from 'electron'
import { parse } from 'valibot'

/** One trusted document's native input (raw or Hush); navigation retires port and child. */
export class ArrayInput {
  private queries = new Set<NativeAudio>()
  private revision = 0
  private active?: { generation: string, dispose: () => void, audio: NativeAudio }

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

  async connect(generation: string, inputDevice: string, processed?: { audio: NativeAudio, start: Extract<NativeAudioRequest, { kind: 'start' }> }) {
    const revision = ++this.revision
    await this.release()
    if (revision !== this.revision)
      throw new Error('Native array input was retired before opening.')
    const audio = processed?.audio ?? this.createAudio()
    const { port1, port2 } = new MessageChannelMain()
    let closed = false
    let opening: Promise<NativeAudioResult> | undefined
    const owner = { generation, audio, dispose: () => {
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
      if (this.active !== owner || ![arrayInputRequest.id, arrayInputRead.id, arrayInputOpen.id].includes(data?.id))
        return // Only this port's current generation may publish render PCM.
      void (async () => {
        if (data.id === arrayInputOpen.id) {
          if (!processed || opening || data.body?.generation !== generation)
            throw new Error('Native input open belongs only to the prepared Hush generation.')
          // Hardware begins only after the background Worker owns both ports.
          // No renderer scheduling is needed between open and starting render.
          opening = audio.request({ kind: 'open', generation, inputDevice })
          const result = await opening
          if (this.active === owner)
            port1.postMessage({ ...arrayInputResponse, body: { generation, opened: true, result } })
          return
        }
        if (!opening)
          throw new Error('Native playback arrived before hardware activation.')
        await opening
        if (data.id === arrayInputRead.id && !processed)
          throw new Error('Unpaired reads belong only to the Hush input owner.')
        const request = parse(nativeAudioRequestSchema, { kind: data.id === arrayInputRead.id ? 'read' : 'poll', ...data.body })
        if ((request.kind !== 'poll' && request.kind !== 'read') || request.generation !== generation)
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
      if (processed)
        await audio.request(processed.start)
      const result = processed ? { samples: new Float32Array() } : await (opening = audio.request({ kind: 'open', generation, inputDevice }))
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

  /** Check the active port owner without exposing its mutable process state. */
  owns(generation: string) {
    return this.active?.generation === generation
  }

  /** A retiring page/capture cannot close a newer generation. */
  disconnect(generation: string) {
    if (this.active?.generation === generation)
      this.dispose()
    return { samples: new Float32Array() }
  }

  /** Release PortAudio before a different native pipeline opens the same device. */
  async release() {
    const owner = this.active
    if (!owner)
      return
    try {
      await owner.audio.request({ kind: 'stop', generation: owner.generation })
    }
    finally {
      owner.dispose()
      await owner.audio.release()
    }
  }

  dispose() {
    // Navigation also cancels connect attempts still awaiting a retiring child.
    this.revision++
    this.queries.forEach(audio => audio.dispose())
    this.queries.clear()
    this.active?.dispose()
  }
}
