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
 * Re-checks browser microphone consent whenever a voice-only kiosk starts.
 * The persisted audio toggle only records the operator's preference; it must
 * not be used as evidence of browser consent.
 */
export async function prepareKioskMicrophonePermission(input: {
  audioInputEnabled: boolean
  requestPermission: () => Promise<void>
  startAudioInput: () => Promise<unknown>
  setAudioInputEnabled: (enabled: boolean) => void
  voiceConversationOnly: boolean
}) {
  if (!input.voiceConversationOnly)
    return

  // Browsers do not display another prompt for an existing grant, but asking
  // again detects a permission reset or revocation between kiosk sessions.
  await input.requestPermission()

  // Keep the audio pipeline running after a previously granted permission,
  // including when its local preference was reset between kiosk sessions.
  if (!input.audioInputEnabled)
    input.setAudioInputEnabled(true)

  // A persisted true toggle does not trigger its watcher again after restart.
  // Permission probes release their temporary stream; start the owned input
  // explicitly even when the operator's enabled preference was already true.
  await input.startAudioInput()
}
