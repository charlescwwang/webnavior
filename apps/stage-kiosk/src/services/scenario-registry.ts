import type { KioskInteractiveService } from '../composables/useKioskInteractiveServices'
import type { ScenarioBridgeEvent } from './scenario-bridge'

import { computed, markRaw, nextTick, readonly, shallowRef } from 'vue'

import { createScenarioBridge } from './scenario-bridge'

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
  const bridgesById = new Map<string, ReturnType<typeof createScenarioBridge>>()
  const eventListeners = new Set<(event: ScenarioBridgeEvent) => void>()
  const activeScenarioId = shallowRef<string>()
  const revision = shallowRef(0)
  let scenariosById = new Map<string, RegisteredScenario>()
  const activeScenario = computed(() => activeScenarioId.value ? scenariosById.get(activeScenarioId.value) : undefined)
  const activeBridge = computed(() => activeScenarioId.value ? bridgesById.get(activeScenarioId.value) : undefined)

  function createBridge(serviceUrl: string) {
    // Bridges expose nested refs such as `manifest`. Keep the bridge itself
    // outside Vue's deep proxying so consumers can safely read `manifest.value`
    // while an iframe has not announced its manifest yet.
    const bridge = markRaw(createScenarioBridge({ serviceUrl }))
    bridge.on('activity', () => eventListeners.forEach(listener => listener('activity')))
    bridge.on('completed', () => eventListeners.forEach(listener => listener('completed')))
    return bridge
  }

  function setServices(services: readonly KioskInteractiveService[]) {
    const registeredIds = new Set<string>()
    const nextScenarios = services.filter((service) => {
      if (!service.enabled || !isRegisteredScenario(service) || registeredIds.has(service.id))
        return false
      registeredIds.add(service.id)
      return true
    })
    const nextById = new Map(nextScenarios.map(scenario => [scenario.id, scenario]))

    for (const [id, bridge] of bridgesById) {
      const previous = scenariosById.get(id)
      const next = nextById.get(id)
      if (!next || next.serviceUrl !== previous?.serviceUrl) {
        bridge.attach(null)
        bridgesById.delete(id)
      }
    }
    for (const scenario of nextScenarios) {
      if (!bridgesById.has(scenario.id))
        bridgesById.set(scenario.id, createBridge(scenario.serviceUrl))
    }

    scenariosById = nextById
    registeredScenarios.value = nextScenarios
    if (!activeScenarioId.value || !nextById.has(activeScenarioId.value))
      activeScenarioId.value = nextScenarios[0]?.id
    revision.value++
  }

  async function activate(id: string) {
    const scenario = scenariosById.get(id)
    if (!scenario)
      throw new Error(`Kiosk scenario "${id}" is not registered.`)

    if (activeScenarioId.value !== id)
      activeBridge.value?.attach(null)
    activeScenarioId.value = id
    // Let ScenarioSurface create the selected iframe before awaiting its
    // manifest. This keeps navigation independent from page URLs.
    await nextTick()
    return await activeBridge.value?.waitForManifest()
  }

  async function resetActive() {
    await activeBridge.value?.reset()
  }

  function on(event: ScenarioBridgeEvent, listener: () => void) {
    const wrappedListener = (received: ScenarioBridgeEvent) => {
      if (received === event)
        listener()
    }
    eventListeners.add(wrappedListener)
    return () => eventListeners.delete(wrappedListener)
  }

  return {
    activeBridge: readonly(activeBridge),
    activeScenario: readonly(activeScenario),
    activeScenarioId: readonly(activeScenarioId),
    activate,
    on,
    registeredScenarios: readonly(registeredScenarios),
    revision: readonly(revision),
    resetActive,
    setServices,
  }
}

/** The kiosk's deployment-approved interaction surface registry. */
export const scenarioRegistry = createScenarioRegistry()
