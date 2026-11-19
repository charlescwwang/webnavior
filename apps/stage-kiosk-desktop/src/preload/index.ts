import type { KioskArrayInputBridge } from '@proj-airi/stage-shared/kiosk-array-input'
import type { KioskDesktopBridge } from '@proj-airi/stage-shared/kiosk-desktop'
import type { KioskNativeAudioBridge } from '@proj-airi/stage-shared/kiosk-native-audio'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import { arrayInputControlSchema, arrayInputPortChannel, arrayInputPortSchema, invokeArrayInput } from '@proj-airi/stage-shared/kiosk-array-input'
import { desktopServiceRequestSchema, desktopSurfaceActivity, desktopSurfaceActivitySchema, desktopSurfaceNavigation, desktopSurfaceNavigationSchema, desktopSurfaceResultSchema, invokeDesktopService, updateDesktopSurface } from '@proj-airi/stage-shared/kiosk-desktop'
import { invokeNativeAudio, nativeAudioRequestSchema, nativeAudioResultSchema } from '@proj-airi/stage-shared/kiosk-native-audio'
import { contextBridge, ipcRenderer } from 'electron'
import { parse, safeParse } from 'valibot'

// about:blank popups inherit Electron preferences, including this preload.
// Their DOM belongs to the host Vue tree; they need no desktop RPC capability.
if (location.protocol === 'http:' || location.protocol === 'https:') {
  const transport = createContext(ipcRenderer, { messageEventName: 'airi-kiosk-desktop', pushEventName: 'airi-kiosk-desktop-push', errorEventName: 'airi-kiosk-desktop-error' })
  const invoke = defineInvoke(transport.context, updateDesktopSurface)
  let sequence = 0
  const bridge: KioskDesktopBridge = {
    version: 1,
    invokeService: input => defineInvoke(transport.context, invokeDesktopService)(parse(desktopServiceRequestSchema, input), { signal: AbortSignal.timeout(60_000) }),
    updateSurface: async input => parse(desktopSurfaceResultSchema, await invoke({ ...input, sequence: ++sequence }, { signal: AbortSignal.timeout(30_000) })),
    onActivity: listener => transport.context.on(desktopSurfaceActivity, (event) => {
      // An event without a valid document binding cannot extend the current visitor session.
      const result = safeParse(desktopSurfaceActivitySchema, event.body)
      if (result.success)
        listener(result.output)
    }),
    onNavigation: listener => transport.context.on(desktopSurfaceNavigation, (event) => {
      const result = safeParse(desktopSurfaceNavigationSchema, event.body)
      if (result.success)
        listener(result.output)
    }),
  }
  contextBridge.exposeInMainWorld('airiKioskDesktop', bridge)
  const audio: KioskNativeAudioBridge = {
    version: 9,
    request: async input => parse(nativeAudioResultSchema, await defineInvoke(transport.context, invokeNativeAudio)(
      parse(nativeAudioRequestSchema, input),
      { signal: AbortSignal.timeout((input.kind === 'block' || input.kind === 'poll') ? 6000 : 182000) },
    )),
  }
  contextBridge.exposeInMainWorld('airiKioskAudio', audio)
  const array: KioskArrayInputBridge = {
    version: 1,
    request: async input => parse(nativeAudioResultSchema, await defineInvoke(transport.context, invokeArrayInput)(parse(arrayInputControlSchema, input), { signal: AbortSignal.timeout(30000) })),
  }
  ipcRenderer.on(arrayInputPortChannel, (event, metadata) => {
    const result = safeParse(arrayInputPortSchema, metadata)
    if (result.success && event.ports.length === 1)
      window.postMessage({ channel: arrayInputPortChannel, ...result.output }, location.origin, event.ports)
    else
      event.ports.forEach(port => port.close())
  })
  contextBridge.exposeInMainWorld('airiKioskArrayInput', array)
}
