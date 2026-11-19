import { applyAudioOutput } from './kioskAudioOutput'

/**
 * Plays verified reply sentences with one bounded lookahead. The current audio
 * gateway returns MP3 bodies without a negotiated streaming protocol: these are
 * cancellable sentence requests, not word timing or provider streaming claims.
 */
export function createSpeechPlayer(options: {
  synthesize: (input: { locale: string, text: string, signal: AbortSignal }) => Promise<Blob>
  onSynthesis?: (index: number) => void
  onReady?: () => void
  onPlaying: (text: string, first: boolean) => void
  /** Fires synchronously when audible output stops, including cancellation. */
  onStopped?: () => void
  onSource: (player: HTMLAudioElement | undefined) => (() => void) | undefined | Promise<(() => void) | undefined>
}) {
  let active: AbortController | undefined
  let audible = false
  function notifyStopped() {
    if (!audible)
      return
    audible = false
    options.onStopped?.()
  }
  function stop() {
    active?.abort()
    notifyStopped()
    active = undefined
  }
  return {
    stop,
    async play(input: { text: string, locale: string, signal: AbortSignal, preparedAudio?: Blob }) {
      stop()
      const owner = new AbortController()
      active = owner
      const signal = AbortSignal.any([owner.signal, input.signal])
      const sentences = input.preparedAudio ? [input.text] : input.text.match(/[^。！？!?；;\n]+[。！？!?；;\n]*/gu) ?? []
      // Long unpunctuated replies are bounded too; splitting affects speech
      // cadence only. The complete verified text stays visible in the chat.
      const segments = input.preparedAudio
        ? [input.text]
        : sentences.flatMap(sentence => Array.from(sentence).reduce<string[]>((parts, char) => {
            if (!parts.length || Array.from(parts[parts.length - 1]).length >= 120)
              parts.push(char)
            else
              parts[parts.length - 1] += char
            return parts
          }, [])).filter(segment => segment.trim())
      if (input.preparedAudio && !segments.length)
        segments.push('')
      let first = true
      let failed = false
      const synthesize = (index: number) => {
        options.onSynthesis?.(index)
        return options.synthesize({ locale: input.locale, text: segments[index], signal })
      }
      let pending = input.preparedAudio ? Promise.resolve(input.preparedAudio) : segments.length ? synthesize(0) : undefined
      try {
        for (let index = 0; index < segments.length && !signal.aborted; index++) {
          const audio = await pending
          if (!audio || signal.aborted)
            break
          if (index === 0)
            options.onReady?.()
          // Prefetch only the next sentence. Attach a rejection handler now so
          // cancellation during playback cannot create an unhandled rejection.
          const next = index + 1 < segments.length ? synthesize(index + 1).then(audio => ({ audio }), error => ({ error })) : undefined
          const url = URL.createObjectURL(audio)
          const player = new Audio(url)
          let disposeSource: (() => void) | undefined
          try {
            disposeSource = await options.onSource(player)
            // A supplied graph owns its audible device (including native DAC).
            // Only a standalone media element needs its own browser sink.
            if (!disposeSource)
              await applyAudioOutput(player)
            await new Promise<void>((resolve) => {
              let settled = false
              const finish = () => {
                if (settled)
                  return
                settled = true
                player.pause()
                signal.removeEventListener('abort', finish)
                resolve()
              }
              player.onended = finish
              player.onerror = () => {
                failed = true
                finish()
              }
              player.onplaying = () => {
                if (!signal.aborted) {
                  audible = true
                  options.onPlaying(segments[index], first)
                  first = false
                }
              }
              signal.addEventListener('abort', finish, { once: true })
              if (signal.aborted) {
                finish()
              }
              else {
                void player.play().catch(() => {
                  failed = true
                  finish()
                })
              }
            })
          }
          finally {
            disposeSource?.()
            URL.revokeObjectURL(url)
          }
          pending = next?.then((result) => {
            if ('error' in result)
              throw result.error
            return result.audio
          })
          // On cancellation do not leave an already rejected prefetch dangling.
          if (signal.aborted)
            void pending?.catch(() => {})
        }
        return signal.aborted ? 'cancelled' as const : failed ? 'failed' as const : 'completed' as const
      }
      finally {
        owner.abort()
        if (active === owner) {
          notifyStopped()
          active = undefined
        }
      }
    },
  }
}
