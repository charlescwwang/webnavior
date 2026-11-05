import { errorMessageFrom } from '@moeru/std'

/** Completion describes playback, not synthesis success. */
export type PlaybackResult
  = | { kind: 'ended' | 'stopped' }
    | { kind: 'failed', code: 'play_rejected' | 'media_error', message: string }

/**
 * Owns one media element/object URL. A suspended shared AudioContext must not
 * capture the element's output: play() can otherwise succeed while the graph
 * stays silent. Use native element output until the shared graph is running.
 * Cancellation never closes the borrowed context, and every terminal path cleans up.
 */
export function playKioskAudio(audio: Blob, signal: AbortSignal, context?: AudioContext) {
  const result = Promise.withResolvers<PlaybackResult>()
  if (signal.aborted) {
    result.resolve({ kind: 'stopped' })
    return { finished: result.promise, source: undefined, stop: () => {} }
  }
  const player = new Audio(URL.createObjectURL(audio))
  const source = context?.state === 'running' ? context.createMediaElementSource(player) : undefined
  source?.connect(context!.destination)
  let finished = false
  function finish(outcome: PlaybackResult) {
    if (finished)
      return
    finished = true
    signal.removeEventListener('abort', stop)
    player.onended = null
    player.onerror = null
    source?.disconnect()
    URL.revokeObjectURL(player.src)
    result.resolve(outcome)
  }
  function stop() {
    player.pause()
    finish({ kind: 'stopped' })
  }
  player.onended = () => finish({ kind: 'ended' })
  player.onerror = () => finish({ kind: 'failed', code: 'media_error', message: `Media playback error (${player.error?.code ?? 0}).` })
  signal.addEventListener('abort', stop, { once: true })
  void player.play().catch(cause => finish({ kind: 'failed', code: 'play_rejected', message: errorMessageFrom(cause) ?? 'Media playback was rejected.' }))
  return { finished: result.promise, source, stop }
}
