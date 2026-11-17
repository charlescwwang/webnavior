import { errorMessageFrom } from '@moeru/std'

import { connectPlaybackReference, playbackReferenceContext } from '../audio/playbackReference'
import { applyAudioOutput } from './kioskAudioOutput'

/** Completion describes playback, not synthesis success. */
export type PlaybackResult
  = | { kind: 'ended' | 'stopped' }
    | { kind: 'failed', code: 'play_rejected' | 'media_error', message: string }

/**
 * Owns one media element/object URL. A suspended shared AudioContext must not
 * capture the element's output: play() can otherwise succeed while the graph
 * stays silent. Use native element output until the shared graph is running.
 * onStopped fires once synchronously on termination of an audible player.
 * onPlaying fires once at the native audible-playback boundary, never while
 * audio is merely prepared. Cancellation never closes the borrowed context;
 * every terminal path cleans up. Live volume updates reuse the same player;
 * completed or cancelled players ignore later volume updates.
 */
export function playKioskAudio(audio: Blob, signal: AbortSignal, context?: AudioContext, options: { loop?: boolean, volume?: number, onPlaying?: () => void, onStopped?: () => void } = {}) {
  const result = Promise.withResolvers<PlaybackResult>()
  if (signal.aborted) {
    result.resolve({ kind: 'stopped' })
    return { finished: result.promise, source: undefined, stop: () => {}, setVolume: (_volume: number) => {} }
  }
  context ??= playbackReferenceContext()
  const player = new Audio(URL.createObjectURL(audio))
  player.loop = options.loop ?? false
  player.volume = options.volume ?? 1
  const source = context?.state === 'running' ? context.createMediaElementSource(player) : undefined
  source?.connect(context!.destination)
  const disconnectReference = source ? connectPlaybackReference(source) : undefined
  let finished = false
  let started = false
  player.onplaying = () => {
    if (!started && !finished) {
      started = true
      options.onPlaying?.()
    }
  }
  function finish(outcome: PlaybackResult) {
    if (finished)
      return
    finished = true
    signal.removeEventListener('abort', stop)
    player.onplaying = null
    player.onended = null
    player.onerror = null
    disconnectReference?.()
    source?.disconnect()
    URL.revokeObjectURL(player.src)
    // Synchronous terminal notification lets capture mark the exact stop edge,
    // including abort/error paths, without waiting for the consumer's await.
    if (started)
      options.onStopped?.()
    result.resolve(outcome)
  }
  function stop() {
    player.pause()
    finish({ kind: 'stopped' })
  }
  player.onended = () => finish({ kind: 'ended' })
  player.onerror = () => finish({ kind: 'failed', code: 'media_error', message: `Media playback error (${player.error?.code ?? 0}).` })
  signal.addEventListener('abort', stop, { once: true })
  void applyAudioOutput(source ? context! : player).then(() => {
    if (!finished && !signal.aborted)
      return player.play()
  }).catch(cause => finish({ kind: 'failed', code: 'play_rejected', message: errorMessageFrom(cause) ?? 'Media playback was rejected.' }))
  return { finished: result.promise, source, stop, setVolume(volume: number) {
    if (!finished)
      player.volume = volume
  } }
}
