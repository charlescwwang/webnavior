/**
 * Resumes a borrowed context, retrying within trusted operator interaction when
 * autoplay policy leaves resume pending. The owner must abort on retirement;
 * this function removes listeners but never closes the borrowed context.
 */
export function resumeAudioContext(context: AudioContext, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  if (context.state === 'running')
    return Promise.resolve()
  if (context.state === 'closed')
    return Promise.reject(new Error('Audio context is closed.'))

  return new Promise((resolve, reject) => {
    let settled = false
    function finish(error?: unknown) {
      if (settled)
        return
      settled = true
      signal.removeEventListener('abort', abort)
      context.removeEventListener('statechange', changed)
      window.removeEventListener('pointerdown', interact, true)
      window.removeEventListener('keydown', interact, true)
      if (error !== undefined)
        reject(error)
      else
        resolve()
    }
    function abort() {
      finish(signal.reason)
    }
    function changed() {
      if (context.state === 'running')
        finish()
      else if (context.state === 'closed')
        finish(new Error('Audio context closed while waiting for activation.'))
    }
    function resume() {
      // Firefox can keep this promise pending without throwing. Trusted input
      // retries resume synchronously; a policy block is not a DSP timeout.
      void context.resume().then(changed, finish)
    }
    function interact(event: Event) {
      if (event.isTrusted && !settled)
        resume()
    }
    signal.addEventListener('abort', abort, { once: true })
    context.addEventListener('statechange', changed)
    window.addEventListener('pointerdown', interact, true)
    window.addEventListener('keydown', interact, true)
    resume()
  })
}
