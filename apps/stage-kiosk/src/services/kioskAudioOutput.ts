/** Browser-local output preference shared by TTS, prompts and waiting music. */
export const audioOutputStorageKey = 'kiosk/audio/output'

/** Applies output to the owner of audible sound: a media element or its Web Audio graph. */
export async function applyAudioOutput(target: HTMLMediaElement | AudioContext, deviceId = localStorage.getItem(audioOutputStorageKey) ?? '') {
  // NOTICE: Web Audio output routing is absent from some browser API typings and
  // runtimes. Default output remains usable; an explicit selection must work
  // rather than silently playing through an unrelated speaker.
  // https://developer.chrome.com/blog/audiocontext-setsinkid
  if (!('setSinkId' in target) || typeof target.setSinkId !== 'function') {
    if (deviceId)
      throw new Error('Audio output selection is unavailable in this browser.')
    return
  }
  if ('sinkId' in target && target.sinkId === deviceId)
    return
  await target.setSinkId(deviceId)
}
