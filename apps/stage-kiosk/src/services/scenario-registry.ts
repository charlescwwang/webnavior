import type { KioskInteractiveService } from '../composables/useKioskInteractiveServices'

import { computed, nextTick, readonly, shallowRef } from 'vue'

/** A customer-facing web application explicitly approved for one kiosk deployment. */
export interface RegisteredScenario {
  /** Stable ID exposed to the model. It is never a URL or arbitrary user input. */
  id: string
  /** Short customer-facing name displayed above the iframe. */
  title: string
  /** Specific customer task this page supports. Used to constrain model navigation. */
  description: string
  /** HTTPS production URL or a local development URL owned by the deployment. */
  serviceUrl: string
}

export type InteractiveServiceEvent = 'activity' | 'completed'

interface InteractiveServiceEventMessage {
  source: 'airi-interaction-lifecycle'
  type: InteractiveServiceEvent
}

function isRegisteredScenario(scenario: RegisteredScenario): boolean {
  if (!/^[a-z][a-z0-9-]*$/.test(scenario.id) || !scenario.title.trim() || !scenario.description.trim())
    return false
  try {
    const serviceUrl = new URL(scenario.serviceUrl)
    return serviceUrl.protocol === 'https:' || serviceUrl.protocol === 'http:'
  }
  catch {
    return false
  }
}

/**
 * Owns the kiosk's approved interactive pages and the active page selection.
 *
 * The registry is the navigation security boundary: callers select a known
 * scenario ID, while URLs remain deployment configuration rather than model
 * tool input.
 */
export function createScenarioRegistry() {
  const registeredScenarios = shallowRef<readonly RegisteredScenario[]>([])
  const eventListeners = new Set<(event: InteractiveServiceEvent) => void>()
  const activeScenarioId = shallowRef<string>()
  const revision = shallowRef(0)
  const iframeRevision = shallowRef(0)
  let scenariosById = new Map<string, RegisteredScenario>()
  let activeFrameWindow: Window | null = null
  const activeScenario = computed(() => activeScenarioId.value ? scenariosById.get(activeScenarioId.value) : undefined)

  window.addEventListener('message', (event: MessageEvent<InteractiveServiceEventMessage>) => {
    const scenario = activeScenario.value
    if (!scenario || event.source !== activeFrameWindow || event.origin !== new URL(scenario.serviceUrl).origin)
      return
    if (event.data?.source !== 'airi-interaction-lifecycle' || (event.data.type !== 'activity' && event.data.type !== 'completed'))
      return
    eventListeners.forEach(listener => listener(event.data.type))
  })

  function setServices(services: readonly KioskInteractiveService[]) {
    const registeredIds = new Set<string>()
    const nextScenarios = services.filter((service) => {
      if (!service.enabled || !isRegisteredScenario(service) || registeredIds.has(service.id))
        return false
      registeredIds.add(service.id)
      return true
    })
    const nextById = new Map(nextScenarios.map(scenario => [scenario.id, scenario]))

    scenariosById = nextById
    registeredScenarios.value = nextScenarios
    if (!activeScenarioId.value || !nextById.has(activeScenarioId.value))
      activeScenarioId.value = nextScenarios[0]?.id
    iframeRevision.value++
    revision.value++
  }

  async function activate(id: string) {
    const scenario = scenariosById.get(id)
    if (!scenario)
      throw new Error(`Kiosk scenario "${id}" is not registered.`)

    if (activeScenarioId.value !== id)
      activeFrameWindow = null
    activeScenarioId.value = id
    // Let ScenarioSurface create the selected iframe before returning. Opening
    // an approved page must not depend on that page implementing WebMCP: its
    // manifest only controls optional follow-up tools.
    await nextTick()
    return scenario
  }

  function reloadActive() {
    activeFrameWindow = null
    iframeRevision.value++
  }

  function attachActiveFrame(windowRef: Window | null) {
    activeFrameWindow = windowRef
  }

  function on(event: InteractiveServiceEvent, listener: () => void) {
    const wrappedListener = (received: InteractiveServiceEvent) => {
      if (received === event)
        listener()
    }
    eventListeners.add(wrappedListener)
    return () => eventListeners.delete(wrappedListener)
  }

  return {
    activeScenario: readonly(activeScenario),
    activeScenarioId: readonly(activeScenarioId),
    activate,
    attachActiveFrame,
    iframeRevision: readonly(iframeRevision),
    on,
    registeredScenarios: readonly(registeredScenarios),
    revision: readonly(revision),
    reloadActive,
    setServices,
  }
}

/** The kiosk's deployment-approved interaction surface registry. */
export const scenarioRegistry = createScenarioRegistry()
