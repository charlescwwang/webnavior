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
 * Voice startup requests consent immediately. With no saved input, consent
 * discovery leaves capture disabled until startup UI confirms a device. A saved
 * input acquires its actual stream without a separate permission-only request.
 * The persisted audio toggle only records the operator's preference; it must
 * not be used as evidence of browser consent or a live stream after reload.
 */
export async function prepareKioskMicrophonePermission(input: {
  hasSelectedMicrophone: boolean
  requestDevices: () => Promise<void>
  startStream: () => Promise<void>
  signal: AbortSignal
  setAudioInputEnabled: (enabled: boolean) => void
  voiceConversationOnly: boolean
}) {
  if (!input.voiceConversationOnly)
    return

  input.signal.throwIfAborted()

  if (!input.hasSelectedMicrophone) {
    input.setAudioInputEnabled(false)
    await input.requestDevices()
    input.signal.throwIfAborted()
    return 'selection-required' as const
  }

  // getUserMedia for the saved stream owns browser consent. Do not first open
  // a temporary permission-only stream: Firefox can prompt again when that
  // temporary stream is stopped and the real selected microphone starts.
  // The persisted toggle can already be true on reload, so setting it again
  // would not fire the device store watcher. Explicitly acquire capture through
  // the existing deduplicated store request before declaring startup complete.
  await input.startStream()
  input.signal.throwIfAborted()

  // Keep the audio pipeline running after a previously granted permission,
  // including when its local preference was reset between kiosk sessions.
  // Permission/device watchers may reset the toggle while acquisition is pending.
  // The current, non-aborted voice owner enables the stream after it succeeds.
  input.setAudioInputEnabled(true)
  return 'capturing' as const
}
