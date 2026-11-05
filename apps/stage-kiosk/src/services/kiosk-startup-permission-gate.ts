/**
 * Holds optional startup work behind a permission request that must be visible
 * to the visitor first. Browser permission prompts are not safe to overlap.
 */
export function createKioskStartupPermissionGate() {
  let settled = false
  let resolve!: () => void
  const permissionSettled = new Promise<void>((nextResolve) => {
    resolve = nextResolve
  })

  function settle() {
    if (settled)
      return
    settled = true
    resolve()
  }

  async function wait() {
    await permissionSettled
  }

  return { settle, wait }
}

/**
 * Acquires the real microphone stream when a voice-only kiosk starts.
 * The persisted audio toggle only records the operator's preference; it must
 * not be used as evidence of browser consent or a live stream after reload.
 */
export async function prepareKioskMicrophonePermission(input: {
  audioInputEnabled: boolean
  startStream: () => Promise<void>
  signal: AbortSignal
  setAudioInputEnabled: (enabled: boolean) => void
  voiceConversationOnly: boolean
}) {
  if (!input.voiceConversationOnly)
    return

  input.signal.throwIfAborted()

  // getUserMedia for the actual stream owns browser consent. Do not first open
  // a temporary permission-only stream: Firefox can prompt again when that
  // temporary stream is stopped and the real selected microphone starts.
  // The persisted toggle can already be true on reload, so setting it again
  // would not fire the device store watcher. Explicitly acquire capture through
  // the existing deduplicated store request before declaring startup complete.
  await input.startStream()
  input.signal.throwIfAborted()

  // Keep the audio pipeline running after a previously granted permission,
  // including when its local preference was reset between kiosk sessions.
  if (!input.audioInputEnabled)
    input.setAudioInputEnabled(true)
}
