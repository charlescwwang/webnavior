import type { Buffer } from 'node:buffer'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import type { NativeAudioRequest, NativeAudioResult } from '@proj-airi/stage-shared/kiosk-native-audio'

import { spawn } from 'node:child_process'

import { errorMessageFrom } from '@moeru/std'
import { nativeAudioRequestSchema, nativeAudioResultSchema } from '@proj-airi/stage-shared/kiosk-native-audio'
import { boolean, integer, looseObject, minValue, number, object, optional, parse, pipe, string, unknown } from 'valibot'

import { AudioFrameDecoder, encodeFrame } from './audioProtocol'

const envelope = object({ id: pipe(number(), integer(), minValue(1)), ok: boolean(), result: optional(unknown()), error: optional(string()) })

/**
 * Owns one application-local Python process and bounded, correlated requests.
 *
 * Reload/close rejects pending requests, closes stdin and terminates the owned
 * child. Incomplete audio is discarded; no model process survives the window.
 * Capture generation validation lives in the worker as well as the renderer.
 */
export class NativeAudio {
  private child?: ChildProcessWithoutNullStreams
  private closed = false
  private failure?: Error
  private sequence = 0
  private stderr = ''
  private pending = new Map<number, { resolve: (value: NativeAudioResult) => void, reject: (error: Error) => void, timer: ReturnType<typeof setTimeout> }>()

  constructor(private options: {
    executable: string
    entry: string
    model: string
    stateDirectory: string
    /** CPU is explicit development/test mode; packaged builds select OpenVINO GPU. */
    provider: 'openvino' | 'cpu'
    /** Raw input transport never initializes a model or the native RTF pipeline. */
    captureOnly?: boolean
  }) {}

  private launch() {
    if (this.closed)
      throw new Error('Native audio owner has closed.')
    if (this.failure)
      throw this.failure
    if (this.child)
      return this.child
    const child = spawn(this.options.executable, ['-B', '-u', this.options.entry, '--state-dir', this.options.stateDirectory, '--model', this.options.model, '--provider', this.options.provider, ...(this.options.captureOnly ? ['--capture-only'] : [])], { windowsHide: true, stdio: 'pipe' })
    this.child = child
    const decoder = new AudioFrameDecoder()
    child.stderr.on('data', (data: Buffer) => this.stderr = (this.stderr + data.toString('utf8')).slice(-4096))
    child.once('error', error => this.fail(errorMessageFrom(error) ?? 'Native audio could not start.'))
    child.once('exit', () => {
      if (!this.closed)
        this.fail(`Native GPU audio stopped. ${this.stderr.trim().slice(-1200) || 'Check administrator audio diagnostics.'}`)
    })
    child.stdin.on('error', error => this.fail(errorMessageFrom(error) ?? 'Native audio input closed.'))
    child.stdout.on('data', (data: Buffer) => {
      if (this.closed || this.failure)
        return
      try {
        for (const frame of decoder.push(data)) {
          const response = parse(envelope, frame.metadata)
          const pending = this.pending.get(response.id)
          if (!pending)
            throw new Error('Unexpected native audio response id.')
          if (response.ok) {
            const result = parse(nativeAudioResultSchema, { ...parse(looseObject({}), response.result), samples: frame.samples })
            this.pending.delete(response.id)
            clearTimeout(pending.timer)
            pending.resolve(result)
          }
          else {
            this.pending.delete(response.id)
            clearTimeout(pending.timer)
            pending.reject(new Error(response.error ?? 'Native audio request failed.'))
          }
        }
      }
      catch (error) {
        this.fail(errorMessageFrom(error) ?? 'Invalid native audio response.')
      }
    })
    return child
  }

  private fail(message: string) {
    if (this.closed || this.failure)
      return
    this.failure = new Error(message)
    for (const item of this.pending.values()) {
      clearTimeout(item.timer)
      item.reject(this.failure)
    }
    this.pending.clear()
    this.child?.kill()
    console.error('Native audio failure:', message, this.stderr)
  }

  /** No more than 32 pending messages; a timeout retires the whole audio owner. */
  async request(input: NativeAudioRequest): Promise<NativeAudioResult> {
    const request = parse(nativeAudioRequestSchema, input)
    if (this.pending.size >= 32) {
      this.fail('Native audio is more than 256 ms behind capture.')
      throw new Error('Native audio is more than 256 ms behind capture.')
    }
    const child = this.launch()
    const id = ++this.sequence
    const samples = (request.kind === 'block' || request.kind === 'poll') ? request.samples : new Float32Array()
    const metadata = (request.kind === 'block' || request.kind === 'poll') ? { ...request, samples: undefined, id } : { ...request, id }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail('Native GPU audio request timed out.'), (request.kind === 'block' || request.kind === 'poll') ? 5000 : 180000)
      this.pending.set(id, { resolve, reject, timer })
      child.stdin.write(encodeFrame(metadata, samples), (error) => {
        if (error)
          this.fail(errorMessageFrom(error) ?? 'Native audio publish failed.')
      })
    })
  }

  dispose() {
    if (this.closed)
      return
    this.closed = true
    for (const item of this.pending.values()) {
      clearTimeout(item.timer)
      item.reject(new Error('Native audio owner closed.'))
    }
    this.pending.clear()
    const child = this.child
    child?.stdin.end()
    child?.kill()
  }
}
