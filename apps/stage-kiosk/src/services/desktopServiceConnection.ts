import type { ServiceConnection } from '@proj-airi/stage-shared/interactive-service'
import type { DesktopServiceRequest, KioskDesktopBridge } from '@proj-airi/stage-shared/kiosk-desktop'

/** Keeps one native surface lifetime under the common client ownership/recovery policy. */
export function connectDesktop(bridge: Pick<KioskDesktopBridge, 'invokeService'>, binding: Pick<DesktopServiceRequest, 'serviceId' | 'documentKey'>): ServiceConnection {
  const lifetime = new AbortController()
  function request(command: DesktopServiceRequest['command'], signal: AbortSignal): Promise<unknown> {
    const combined = AbortSignal.any([lifetime.signal, signal])
    combined.throwIfAborted()
    // Cancellation ends the local wait only. An accepted vendor operation may
    // still finish; the shared client records it as unsettled and must inspect.
    return new Promise((resolve, reject) => {
      const abort = () => reject(combined.reason)
      combined.addEventListener('abort', abort, { once: true })
      // Surface readiness also carries a URL; only ownership keys belong in the strict RPC envelope.
      void bridge.invokeService({ serviceId: binding.serviceId, documentKey: binding.documentKey, command }).then(resolve, reject).finally(() => combined.removeEventListener('abort', abort))
    })
  }
  return {
    signal: lifetime.signal,
    discover: (input, signal) => request({ kind: 'discover', request: input }, signal),
    execute: (input, signal) => request({ kind: 'execute', request: input }, signal),
    inspect: (input, signal) => request({ kind: 'inspect', request: input }, signal),
    dispose: reason => lifetime.abort(reason),
  }
}
