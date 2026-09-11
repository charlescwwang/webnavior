import type { KioskVisitorMediaKind } from '../services/kiosk-device'

import { uploadKioskVisitorMedia } from '../services/kiosk-device'

const continuousSegmentMs = 30_000
const triggeredClipMs = 10_000

/**
 * Captures POC evidence from the already-approved kiosk camera and microphone.
 * Continuous footage is split into independently playable files; interaction
 * clips give reviewers a short, direct view of the trigger context.
 */
export function useKioskMediaCapture(getVisitorSessionId: () => string | undefined) {
  let cameraStream: MediaStream | undefined
  let continuousRecorder: MediaRecorder | undefined
  let continuousTimer: number | undefined
  let continuousCaptureEnabled = false

  function attachCameraStream(stream: MediaStream | undefined) {
    stopContinuousCapture()
    cameraStream = stream
    continuousCaptureEnabled = Boolean(cameraStream)
    if (cameraStream)
      startContinuousSegment()
  }

  function save(kind: KioskVisitorMediaKind, recording: Blob, timing?: { endedAt?: Date, interactionEntryId?: string, startedAt?: Date }) {
    const visitorSessionId = getVisitorSessionId()
    if (!visitorSessionId || recording.size === 0)
      return
    void uploadKioskVisitorMedia({ kind, recording, visitorSessionId, ...timing }).catch(error => console.error('Failed to save kiosk media:', error))
  }

  function startContinuousSegment() {
    if (!cameraStream || continuousRecorder)
      return
    const recorder = new MediaRecorder(cameraStream, { mimeType: supportedVideoMimeType() })
    const startedAt = new Date()
    const chunks: BlobPart[] = []
    recorder.ondataavailable = event => chunks.push(event.data)
    recorder.onstop = () => {
      if (continuousRecorder === recorder)
        continuousRecorder = undefined
      save('continuous_video', new Blob(chunks, { type: recorder.mimeType }), { endedAt: new Date(), startedAt })
      if (continuousCaptureEnabled && cameraStream?.active)
        startContinuousSegment()
    }
    continuousRecorder = recorder
    recorder.start()
    continuousTimer = window.setTimeout(() => recorder.stop(), continuousSegmentMs)
  }

  function captureInteractionClip(interactionEntryId: string | undefined) {
    if (!cameraStream?.active)
      return
    const recorder = new MediaRecorder(cameraStream, { mimeType: supportedVideoMimeType() })
    const startedAt = new Date()
    const chunks: BlobPart[] = []
    recorder.ondataavailable = event => chunks.push(event.data)
    recorder.onstop = () => save('triggered_video', new Blob(chunks, { type: recorder.mimeType }), { endedAt: new Date(), interactionEntryId, startedAt })
    recorder.start()
    window.setTimeout(() => recorder.stop(), triggeredClipMs)
  }

  function saveAudio(recording: Blob, interactionEntryId: string | undefined) {
    save('audio_recording', recording, { endedAt: new Date(), interactionEntryId })
  }

  function stopContinuousCapture() {
    continuousCaptureEnabled = false
    if (continuousTimer != null)
      window.clearTimeout(continuousTimer)
    continuousTimer = undefined
    if (continuousRecorder?.state !== 'inactive')
      continuousRecorder?.stop()
    continuousRecorder = undefined
  }

  return { attachCameraStream, captureInteractionClip, saveAudio, stopContinuousCapture }
}

function supportedVideoMimeType() {
  return MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus') ? 'video/webm;codecs=vp8,opus' : 'video/webm'
}
