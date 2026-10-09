import { useLocalStorage } from '@vueuse/core'

/** Browser-local overlay preferences shared by the scene and both operator settings entry points. */
export function useKioskDiagnostics() {
  // These preferences only affect visibility; detection, reset policy, and
  // decision processing remain owned by their existing runtime modules.
  return {
    idleDiagnosticsEnabled: useLocalStorage('kiosk/diagnostics/idle-enabled', false),
    presenceDiagnosticsEnabled: useLocalStorage('kiosk/diagnostics/presence-enabled', false),
    decisionDiagnosticsEnabled: useLocalStorage('kiosk/diagnostics/decision-enabled', false),
  }
}
