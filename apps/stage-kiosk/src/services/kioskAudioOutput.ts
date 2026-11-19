/** Browser-local output preference shared by TTS, prompts and waiting music. */
export const audioOutputStorageKey = 'kiosk/audio/output'

/** Apply the independent browser speaker preference to any application playback path. */
export async function applyAudioOutput(target: HTMLMediaElement | AudioContext, deviceId?: string) {
  // NOTICE: TypeScript's DOM declarations expose setSinkId on media elements,
  // but omit Chromium's AudioContext variant.
  // Inspect that runtime capability without inventing a second browser contract.
  // https://developer.chrome.com/blog/audiocontext-setsinkid
  const sinkId: unknown = Reflect.get(target, 'sinkId')
  const setSinkId: unknown = Reflect.get(target, 'setSinkId')
  deviceId ??= localStorage.getItem(audioOutputStorageKey) ?? ''
  if (typeof setSinkId !== 'function') {
    if (deviceId)
      throw new Error('Audio output selection is unavailable in this browser.')
    return
  }
  if (sinkId === deviceId)
    return
  await setSinkId.call(target, deviceId)
}
