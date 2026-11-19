import { applyAudioOutput } from '../services/kioskAudioOutput'

const sources = new Set<AudioNode>()
let active: {
  context: AudioContext
  input: GainNode
} | undefined
/** A capture owner borrows the kiosk's 48 kHz playback clock; only it may detach this bus. */
export function installPlaybackReference(context: AudioContext) {
  if (context.sampleRate !== 48000 || active)
    throw new Error('UMA-8 requires one 48 kHz playback/capture owner.')
  const input = context.createGain()
  input.channelCount = 2
  input.channelCountMode = 'explicit'
  const owner = { context, input }
  active = owner
  for (const source of sources) {
    if (source.context === context) {
      source.connect(input)
    }
  }
  return { input, dispose() {
    if (active === owner)
      active = undefined
    for (const source of sources) {
      if (source.context === context) {
        try {
          source.disconnect(input)
        }
        catch { /* The playback owner may already have disconnected this source. */ }
      }
    }
    input.disconnect()
  } }
}
/** Mirrors a source into AEC without creating a second audible output. */
export function connectPlaybackReference(source: AudioNode) {
  sources.add(source)
  if (active?.context === source.context) {
    source.connect(active.input)
  }
  return () => {
    sources.delete(source)
    if (active?.context === source.context) {
      try {
        source.disconnect(active.input)
      }
      catch { /* The source's owner may already have disconnected all outputs. */ }
    }
  }
}
export function playbackReferenceContext() {
  return active?.context
}
/** Administrator TTS uses the same reference path as customer speech when capture is active. */
export async function attachReferencePlayback(player: HTMLAudioElement) {
  const context = active?.context
  if (!context)
    return undefined
  await applyAudioOutput(context)
  await context.resume()
  const source = context.createMediaElementSource(player)
  source.connect(context.destination)
  const disconnectReference = connectPlaybackReference(source)
  return () => {
    disconnectReference()
    source.disconnect()
  }
}
